//! 终端仿真:字节流 → 网格视图。
//!
//! 平台无关、不做任何 I/O:输入是远程(SSH/PTY)的原始字节,输出是可供渲染的视图与光标。
//! 桌面、Android、iOS 共用同一实现,保证终端语义(转义序列、宽字符、备用屏)完全一致。

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use alacritty_terminal::event::{Event, EventListener, WindowSize};
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line, Point, Side};
use alacritty_terminal::selection::{Selection, SelectionType};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::color::Colors;
use alacritty_terminal::term::{Config, Term, TermDamage, TermMode};
use alacritty_terminal::vte::ansi::{Color, CursorShape, NamedColor, Processor, Rgb};

/// 回滚缓冲上限(行)。
pub const DEFAULT_SCROLLBACK: usize = 10_000;

/// 终端尺寸(列 × 行)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Size {
    pub cols: usize,
    pub rows: usize,
}

impl Size {
    pub const fn new(cols: usize, rows: usize) -> Self {
        Self { cols, rows }
    }
}

impl Dimensions for Size {
    fn total_lines(&self) -> usize {
        self.rows
    }

    fn screen_lines(&self) -> usize {
        self.rows
    }

    fn columns(&self) -> usize {
        self.cols
    }
}

/// 光标快照(视口坐标,0 起)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cursor {
    pub col: usize,
    pub row: usize,
    pub visible: bool,
}

/// 远端程序打开的输入相关模式。实体键盘、触控板的字节编码要跟着它们变:
/// 应用光标模式下方向键是 `ESC O A` 而不是 `ESC [ A`(vim、less 认前者)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct InputModes {
    /// DECCKM:方向键 / Home / End 用 SS3(`ESC O x`)。
    pub app_cursor: bool,
    /// 粘贴要包在 `ESC[200~` … `ESC[201~` 里。
    pub bracketed_paste: bool,
    /// 备用屏(全屏程序)。
    pub alt_screen: bool,
    /// 程序要鼠标事件(任一种上报模式)。
    pub mouse_report: bool,
    /// 鼠标事件用 SGR 编码(`ESC[<b;x;yM`)。
    pub sgr_mouse: bool,
    /// 备用屏里滚轮换成方向键(DECSET 1007)。
    pub alternate_scroll: bool,
}

/// 怎么选:按格、按词(双击 / 长按)、按行(三击)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectKind {
    Cell,
    Word,
    Line,
}

/// 选区落在当前视口里的部分(行列 0 起、闭区间)。滚出视口的部分已裁掉,
/// 选区整个在视口外时为 None —— 选区本身还在,滚回来又能看到。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewSelection {
    pub start_row: usize,
    pub start_col: usize,
    pub end_row: usize,
    pub end_col: usize,
}

/// 按词选择时的分隔符:alacritty 的默认值,加上全角标点,去掉 `:` ——
/// `user@host:22`、`http://…` 这种一下选中整段更有用;中文句子遇到「。,」要断开
/// (不加的话 `Corporation。保留所有权利。` 会被当成一个词)。
const WORD_DELIMITERS: &str = concat!(
    ",│`|\"' ()[]{}<>\t",
    // 全角:,。、;:?!()【】《》「」“”‘’ —— 用转义写,免得被编辑器或输入法换成半角。
    "\u{FF0C}\u{3002}\u{3001}\u{FF1B}\u{FF1A}\u{FF1F}\u{FF01}\u{FF08}\u{FF09}",
    "\u{3010}\u{3011}\u{300A}\u{300B}\u{300C}\u{300D}\u{201C}\u{201D}\u{2018}\u{2019}",
);

/// [`Run::cells`] 里单元格之间的分隔符(U+001F,控制字符,绝不会出现在单元格内容里)。
pub const CELL_SEP: char = '\u{1f}';

/// [`Run::flags`] 的位。
pub mod style {
    pub const BOLD: u8 = 1;
    pub const DIM: u8 = 1 << 1;
    pub const ITALIC: u8 = 1 << 2;
    pub const UNDERLINE: u8 = 1 << 3;
    pub const INVERSE: u8 = 1 << 4;
    pub const STRIKE: u8 = 1 << 5;
}

/// 一段**列连续、样式相同**的单元格。
///
/// 为什么不直接给一行字符串:宽字符(中文、emoji)占两列,一行字符串里却只有一个字符,
/// 宿主拿它当整串画,字形宽度又不正好是两格 —— 中文后面的内容就一路往右漂,
/// 按列定位的全屏程序(Codex、htop、vim)整个错位,尾巴被裁掉。这里把列保留下来,
/// 宿主逐格落到 `col × 格宽` 上。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Run {
    /// 起始列(0 起)。
    pub col: usize,
    /// 每个单元格的内容,用 [`CELL_SEP`] 分隔;宽字符后面的占位格是空串,
    /// 所以分隔后的第 i 项就是第 `col + i` 列。组合字符并在所属单元格里。
    pub cells: String,
    /// 前景色 `0xAARRGGBB`;0 表示"默认前景",由宿主按主题取色。
    pub fg: u32,
    /// 背景色,同上;0 表示"默认背景"。
    pub bg: u32,
    /// [`style`] 里的位。
    pub flags: u8,
}

/// 自上次 [`Terminal::take_damage`] 以来的变更范围。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Damage {
    /// 全屏重绘(首帧、resize、滚动等)。
    Full,
    /// 逐行增量:(row, left, right),列为闭区间。
    Lines(Vec<(usize, usize, usize)>),
}

/// 终端状态机产生、需要宿主处理的事件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalEvent {
    /// 必须写回连接的应答(光标位置/设备属性查询、焦点上报等)。
    /// 不回写会让远端程序挂起(实测:Windows ConPTY 启动后即挂;vim 等也会)。
    Write(Vec<u8>),
    /// 窗口标题(OSC 0/2)。
    Title(String),
    /// 标题复位。
    ResetTitle,
    /// 响铃(BEL)。
    Bell,
    /// OSC 52:请求写入系统剪贴板。
    ClipboardStore(String),
}

/// 收集状态机事件,供宿主批量取走。
#[derive(Clone, Debug, Default)]
struct EventQueue(Arc<Mutex<VecDeque<Event>>>);

impl EventListener for EventQueue {
    fn send_event(&self, event: Event) {
        if let Ok(mut queue) = self.0.lock() {
            queue.push_back(event);
        }
    }
}

/// 回答颜色查询(OSC 10/11/12)用的主题色,`0xRRGGBB`。宿主按自己的主题设置。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Theme {
    pub foreground: u32,
    pub background: u32,
    pub cursor: u32,
}

impl Default for Theme {
    fn default() -> Self {
        // 与安卓端深色主题一致(termFg / termBg / termCursor)。
        Self { foreground: 0xE6E8EC, background: 0x0E0F12, cursor: 0x6EA8FE }
    }
}

/// 终端仿真状态机。
pub struct Terminal {
    term: Term<EventQueue>,
    events: EventQueue,
    parser: Processor,
    size: Size,
    theme: Theme,
    /// ANSI 0..15 的颜色(`0xRRGGBB`)。浅色主题下不能沿用深色那套 —— "白色"文字在白底上看不见。
    base16: [u32; 16],
    /// 单元格像素尺寸,回答 CSI 14t / 16t 这类"窗口多大"的查询。
    cell_px: (u16, u16),
}

impl Terminal {
    /// 新建终端(含回滚缓冲)。
    pub fn new(cols: usize, rows: usize) -> Self {
        let size = Size::new(cols.max(1), rows.max(1));
        let config = Config {
            scrolling_history: DEFAULT_SCROLLBACK,
            semantic_escape_chars: WORD_DELIMITERS.to_owned(),
            ..Config::default()
        };
        let events = EventQueue::default();
        let term = Term::new(config, &size, events.clone());
        Self {
            term,
            events,
            parser: Processor::new(),
            size,
            theme: Theme::default(),
            base16: DEFAULT_BASE16,
            cell_px: (10, 20),
        }
    }

    /// 设置 ANSI 0..15 的颜色(`0xRRGGBB`)。不足 16 个的部分保持默认。
    pub fn set_palette(&mut self, colors: &[u32]) {
        for (slot, color) in self.base16.iter_mut().zip(colors) {
            *slot = color & 0xFF_FFFF;
        }
    }

    /// 设置回答颜色查询用的主题色。
    pub fn set_theme(&mut self, theme: Theme) {
        self.theme = theme;
    }

    /// 设置单元格像素尺寸(宿主量出来的格宽格高)。
    pub fn set_cell_pixels(&mut self, width: u16, height: u16) {
        self.cell_px = (width.max(1), height.max(1));
    }

    /// 定时调用(宿主每一帧都调)。返回屏幕是否因此变化。
    ///
    /// 程序用「同步刷新」(`CSI ? 2026 h` … `CSI ? 2026 l`)包住一帧时,vte 会先把输出攒起来,
    /// 等到结束序列或者 **150ms 超时**再一起画 —— 而这个超时**要宿主自己触发**:alacritty
    /// 自己的事件循环在超时后调 `stop_sync`。我们原来从不调,一旦结束序列晚到,攒着的那一帧
    /// 就再也放不出来;更糟的是超时之后 vte 不再攒新数据,后面只发"变化部分"的增量画在一张
    /// 空白屏上 —— Codex(ratatui)进去之后整屏空白,就是这个。
    pub fn tick(&mut self) -> bool {
        match self.parser.sync_timeout().sync_timeout() {
            Some(deadline) if Instant::now() >= deadline => {
                self.parser.stop_sync(&mut self.term);
                true
            }
            _ => false,
        }
    }

    /// 当前尺寸。
    pub fn size(&self) -> Size {
        self.size
    }

    /// 喂入远程输出。分片不敏感,可任意切分。
    pub fn feed(&mut self, bytes: &[u8]) {
        self.parser.advance(&mut self.term, bytes);
    }

    /// 尺寸变化(折叠、旋转、软键盘弹出)。
    pub fn resize(&mut self, cols: usize, rows: usize) {
        // 和 `new` 一样夹住:0 行 / 0 列会让下面 `size.rows - 1` 这类减法在 usize 上溢,
        // 进程直接 abort。构造函数夹了,这里原来漏了(界面那边碰巧也夹了,所以还没炸过)。
        self.size = Size::new(cols.max(1), rows.max(1));
        self.term.resize(self.size);
    }

    /// 光标位置与可见性。
    ///
    /// `cursor.point` 是**网格坐标**,要加上显示偏移才是视口里的行 —— 和 [`Self::screen_runs`]
    /// 里那一句 `row = line + offset` 是同一件事。原来这里直接用了网格行号:
    /// 往回翻历史之后,光标的网格行永远在活动屏上(判定恒为"可见"),于是那道蓝色下划线
    /// 被画到了历史内容中间某一行下面。正确的结果是它跟着内容滚出视口、不该画。
    pub fn cursor(&self) -> Cursor {
        let content = self.term.renderable_content();
        let row = content.cursor.point.line.0 + content.display_offset as i32;
        let on_screen = row >= 0 && (row as usize) < self.size.rows;
        Cursor {
            col: content.cursor.point.column.0,
            row: row.max(0) as usize,
            visible: on_screen && content.cursor.shape != CursorShape::Hidden,
        }
    }

    /// 往回翻 [lines] 行(正数向上/看更早的内容,负数往回走);会被夹在历史范围内。
    ///
    /// 翻上去之后**新输出不会把视口拽回底部** —— alacritty 的网格在滚动时会同步抬高
    /// 显示偏移,视口锚在原处。看日志时这是刚需,否则远端一有输出就被弹走。
    pub fn scroll(&mut self, lines: i32) {
        self.term.scroll_display(Scroll::Delta(lines));
    }

    /// 回到底部(贴着最新输出)。用户一敲键盘就该回到这里。
    pub fn scroll_to_bottom(&mut self) {
        self.term.scroll_display(Scroll::Bottom);
    }

    /// 当前视口离底部有多少行(0 = 贴底)。
    pub fn scroll_offset(&self) -> usize {
        self.term.grid().display_offset()
    }

    /// 回滚缓冲里攒了多少行(备用屏下为 0)。
    pub fn history_len(&self) -> usize {
        self.term.grid().history_size()
    }

    /// 是否处于备用屏(vim/htop 等全屏程序)。
    pub fn alt_screen(&self) -> bool {
        self.term.mode().contains(TermMode::ALT_SCREEN)
    }

    /// 视口里的 (行, 列) → 网格坐标。网格坐标里历史是负行号,新输出滚上来时
    /// alacritty 会把选区跟着"转"(`Selection::rotate`),所以选区记在网格坐标上就能跟着内容走。
    fn grid_point(&self, row: usize, col: usize) -> Point {
        let offset = self.term.grid().display_offset() as i32;
        let row = row.min(self.size.rows - 1) as i32;
        Point::new(Line(row - offset), Column(col.min(self.size.cols - 1)))
    }

    /// 开始选择。[right_half] 是按在格子的右半边 —— 往回拖时起点这一格算不算进去由它决定
    /// (和桌面终端的手感一致)。
    pub fn select_start(&mut self, row: usize, col: usize, right_half: bool, kind: SelectKind) {
        let point = self.grid_point(row, col);
        let ty = match kind {
            SelectKind::Cell => SelectionType::Simple,
            SelectKind::Word => SelectionType::Semantic,
            SelectKind::Line => SelectionType::Lines,
        };
        let side = if right_half { Side::Right } else { Side::Left };
        let mut selection = Selection::new(ty, point, side);
        // 按格选时,刚按下还没拖动算空选区;按词 / 按行一按下就有内容。
        if kind != SelectKind::Cell {
            selection.update(point, side);
        }
        self.term.selection = Some(selection);
    }

    /// 拖到 (row, col)。选区的起点不动,已经随滚动转过的也照样对。
    pub fn select_update(&mut self, row: usize, col: usize, right_half: bool) {
        let point = self.grid_point(row, col);
        if let Some(selection) = self.term.selection.as_mut() {
            selection.update(point, if right_half { Side::Right } else { Side::Left });
        }
    }

    /// 清掉选区。
    pub fn select_clear(&mut self) {
        self.term.selection = None;
    }

    /// 选中的文字(跨行时带换行,行尾空白去掉);没有选区或是空选区时为 None。
    pub fn selection_text(&self) -> Option<String> {
        self.term.selection_to_string().filter(|text| !text.is_empty())
    }

    /// 选区在当前视口里的范围(给宿主画高亮)。
    pub fn view_selection(&self) -> Option<ViewSelection> {
        let range = self.term.selection.as_ref()?.to_range(&self.term)?;
        let offset = self.term.grid().display_offset() as i32;
        let rows = self.size.rows as i32;
        let start_row = range.start.line.0 + offset;
        let end_row = range.end.line.0 + offset;
        if end_row < 0 || start_row >= rows {
            return None;
        }
        // 上端滚出视口就从第 0 列算起,下端滚出视口就画到行尾。
        let (start_row, start_col) =
            if start_row < 0 { (0, 0) } else { (start_row as usize, range.start.column.0) };
        let (end_row, end_col) = if end_row >= rows {
            (self.size.rows - 1, self.size.cols - 1)
        } else {
            (end_row as usize, range.end.column.0)
        };
        Some(ViewSelection { start_row, start_col, end_row, end_col })
    }

    /// 宿主编码按键/滚轮/粘贴时要看的模式(实体键盘、触控板用)。
    pub fn input_modes(&self) -> InputModes {
        let mode = *self.term.mode();
        InputModes {
            app_cursor: mode.contains(TermMode::APP_CURSOR),
            bracketed_paste: mode.contains(TermMode::BRACKETED_PASTE),
            alt_screen: mode.contains(TermMode::ALT_SCREEN),
            mouse_report: mode.intersects(TermMode::MOUSE_MODE),
            sgr_mouse: mode.contains(TermMode::SGR_MOUSE),
            alternate_scroll: mode.contains(TermMode::ALTERNATE_SCROLL),
        }
    }

    /// 视口逐行的样式段(见 [`Run`])。行尾默认样式的空白会被裁掉。
    pub fn screen_runs(&self) -> Vec<Vec<Run>> {
        struct Open {
            run: Run,
            len: usize,
        }
        let content = self.term.renderable_content();
        let offset = content.display_offset as i32;
        let colors = content.colors;
        let mut rows: Vec<Vec<Open>> = (0..self.size.rows).map(|_| Vec::new()).collect();

        for indexed in content.display_iter {
            let row = indexed.point.line.0 + offset;
            if row < 0 || row as usize >= rows.len() {
                continue;
            }
            let col = indexed.point.column.0;
            let cell = indexed.cell;

            let text: String = if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                String::new()
            } else if cell.flags.intersects(Flags::HIDDEN | Flags::LEADING_WIDE_CHAR_SPACER) {
                " ".to_string()
            } else {
                let mut t = String::from(cell.c);
                if let Some(zero_width) = cell.zerowidth() {
                    t.extend(zero_width);
                }
                t
            };

            let mut flags = 0u8;
            if cell.flags.contains(Flags::BOLD) {
                flags |= style::BOLD;
            }
            if cell.flags.contains(Flags::DIM) {
                flags |= style::DIM;
            }
            if cell.flags.contains(Flags::ITALIC) {
                flags |= style::ITALIC;
            }
            if cell.flags.intersects(Flags::ALL_UNDERLINES) {
                flags |= style::UNDERLINE;
            }
            if cell.flags.contains(Flags::INVERSE) {
                flags |= style::INVERSE;
            }
            if cell.flags.contains(Flags::STRIKEOUT) {
                flags |= style::STRIKE;
            }
            let fg = resolve_color(cell.fg, colors, &self.base16);
            let bg = resolve_color(cell.bg, colors, &self.base16);

            let line = &mut rows[row as usize];
            match line.last_mut() {
                Some(open)
                    if open.run.col + open.len == col
                        && open.run.fg == fg
                        && open.run.bg == bg
                        && open.run.flags == flags =>
                {
                    open.run.cells.push(CELL_SEP);
                    open.run.cells.push_str(&text);
                    open.len += 1;
                }
                _ => line.push(Open { run: Run { col, cells: text, fg, bg, flags }, len: 1 }),
            }
        }

        rows.into_iter()
            .map(|line| {
                let mut runs: Vec<Run> = line.into_iter().map(|open| open.run).collect();
                // 行尾那段"默认样式的空白"不必跨边界搬过去。
                while let Some(last) = runs.last_mut() {
                    let plain = last.bg == 0
                        && last.flags & (style::INVERSE | style::UNDERLINE | style::STRIKE) == 0;
                    if !plain {
                        break;
                    }
                    let mut cells: Vec<&str> = last.cells.split(CELL_SEP).collect();
                    while cells.last().is_some_and(|c| *c == " ") {
                        cells.pop();
                    }
                    if cells.is_empty() {
                        runs.pop();
                    } else {
                        last.cells = cells.join(&CELL_SEP.to_string());
                        break;
                    }
                }
                runs
            })
            .collect()
    }

    /// 视口逐行文本:行尾空白裁剪,宽字符占位与隐藏单元跳过,组合字符并入前一个单元。
    pub fn screen_lines(&self) -> Vec<String> {
        let mut lines: Vec<String> = Vec::with_capacity(self.size.rows);
        let mut current = String::new();
        let mut current_row: Option<i32> = None;

        for indexed in self.term.renderable_content().display_iter {
            let point = indexed.point;
            let cell = indexed.cell;
            if current_row != Some(point.line.0) {
                if current_row.is_some() {
                    lines.push(std::mem::take(&mut current));
                }
                current_row = Some(point.line.0);
            }
            if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                continue;
            }
            // 隐藏单元(conceal)与前置宽字符占位仍占一列,补空格以保持列对齐。
            if cell.flags.intersects(Flags::HIDDEN | Flags::LEADING_WIDE_CHAR_SPACER) {
                current.push(' ');
            } else {
                current.push(cell.c);
            }
            if let Some(zero_width) = cell.zerowidth() {
                current.extend(zero_width);
            }
        }
        if current_row.is_some() {
            lines.push(current);
        }

        for line in &mut lines {
            let trimmed_len = line.trim_end().len();
            line.truncate(trimmed_len);
        }
        lines
    }

    /// 视口文本(行以 `\n` 连接,末尾空行裁剪)。
    pub fn text(&self) -> String {
        let mut lines = self.screen_lines();
        while lines.last().is_some_and(|line| line.is_empty()) {
            lines.pop();
        }
        lines.join("\n")
    }

    /// 取出自上次调用以来产生的事件(写回应答、标题、蜂鸣等)。
    pub fn poll_events(&mut self) -> Vec<TerminalEvent> {
        let mut out = Vec::new();
        let mut queue = self.events.0.lock().expect("terminal event queue poisoned");
        while let Some(event) = queue.pop_front() {
            match event {
                Event::PtyWrite(text) => out.push(TerminalEvent::Write(text.into_bytes())),
                Event::Title(title) => out.push(TerminalEvent::Title(title)),
                Event::ResetTitle => out.push(TerminalEvent::ResetTitle),
                Event::Bell => out.push(TerminalEvent::Bell),
                Event::ClipboardStore(_, text) => out.push(TerminalEvent::ClipboardStore(text)),
                // 程序问"你的前景/背景/某个调色板颜色是什么"(OSC 10/11/12/4)。
                // 不回答的话,问的一方要等到自己的超时 —— Codex 这类程序启动时就会问背景色,
                // 据此选深色还是浅色主题。
                Event::ColorRequest(index, format) => {
                    let rgb = self.color_for(index);
                    out.push(TerminalEvent::Write(format(rgb).into_bytes()));
                }
                // 程序问窗口多大(CSI 14t / 18t 等)。
                Event::TextAreaSizeRequest(format) => {
                    let size = WindowSize {
                        num_lines: self.size.rows as u16,
                        num_cols: self.size.cols as u16,
                        cell_width: self.cell_px.0,
                        cell_height: self.cell_px.1,
                    };
                    out.push(TerminalEvent::Write(format(size).into_bytes()));
                }
                // OSC 52 读剪贴板:故意不回答 —— 远端不该能读走手机的剪贴板。
                _ => {}
            }
        }
        out
    }

    fn color_for(&self, index: usize) -> Rgb {
        fn rgb(v: u32) -> Rgb {
            Rgb { r: (v >> 16) as u8, g: (v >> 8) as u8, b: v as u8 }
        }
        if let Some(set) = self.term.colors()[index] {
            return set;
        }
        match index {
            i if i < 256 => rgb(palette(i as u8, &self.base16) & 0xFF_FFFF),
            i if i == NamedColor::Foreground as usize => rgb(self.theme.foreground),
            i if i == NamedColor::Background as usize => rgb(self.theme.background),
            i if i == NamedColor::Cursor as usize => rgb(self.theme.cursor),
            _ => rgb(self.theme.foreground),
        }
    }

    /// 读取并重置变更范围(渲染器每帧调用,只重绘脏行)。
    pub fn take_damage(&mut self) -> Damage {
        let damage = match self.term.damage() {
            TermDamage::Full => Damage::Full,
            TermDamage::Partial(iter) => {
                Damage::Lines(iter.map(|line| (line.line, line.left, line.right)).collect())
            }
        };
        self.term.reset_damage();
        damage
    }
}

/// 把单元格颜色解析成 `0xAARRGGBB`;"默认前景/背景"返回 0,交给宿主按主题取色。
fn resolve_color(color: Color, colors: &Colors, base16: &[u32; 16]) -> u32 {
    fn pack(c: Rgb) -> u32 {
        0xFF00_0000 | (c.r as u32) << 16 | (c.g as u32) << 8 | c.b as u32
    }
    let indexed =
        |index: usize| colors[index].map(pack).unwrap_or_else(|| palette(index as u8, base16));
    match color {
        Color::Spec(rgb) => pack(rgb),
        Color::Indexed(index) => indexed(index as usize),
        Color::Named(named) => {
            let index = named as usize;
            match named {
                NamedColor::Foreground
                | NamedColor::Background
                | NamedColor::Cursor
                | NamedColor::BrightForeground
                | NamedColor::DimForeground => 0,
                _ if index < 16 => indexed(index),
                // Dim 系列(DimBlack.. DimWhite)接在 Cursor 后面,折回 0..7 的基础色。
                _ => indexed((index - NamedColor::DimBlack as usize) % 8),
            }
        }
    }
}

/// 默认 16 色:深色背景上对比度够的一组(与常见终端一致)。
pub const DEFAULT_BASE16: [u32; 16] = [
    0x000000, 0xCD3131, 0x0DBC79, 0xE5E510, 0x2472C8, 0xBC3FBC, 0x11A8CD, 0xE5E5E5,
    0x666666, 0xF14C4C, 0x23D18B, 0xF5F543, 0x3B8EEA, 0xD670D6, 0x29B8DB, 0xFFFFFF,
];

/// xterm 256 色调色板:前 16 色可换([base16]),其余是标准的 6×6×6 色立方和灰阶。
fn palette(index: u8, base16: &[u32; 16]) -> u32 {
    let rgb = match index {
        0..=15 => base16[index as usize],
        16..=231 => {
            let i = index as u32 - 16;
            let level = |v: u32| if v == 0 { 0 } else { 55 + v * 40 };
            level(i / 36) << 16 | level(i / 6 % 6) << 8 | level(i % 6)
        }
        _ => {
            let v = 8 + (index as u32 - 232) * 10;
            v << 16 | v << 8 | v
        }
    };
    0xFF00_0000 | rgb
}

#[cfg(test)]
mod tests {

    /// 往回翻历史之后,光标要跟着内容滚出视口 —— 不能还画在历史内容中间。
    ///
    /// 原来 `cursor()` 直接用网格行号、不加显示偏移:网格光标永远在活动屏上,
    /// 于是判定恒为"可见",那道蓝色下划线被画到了回滚内容里随便某一行下面。
    #[test]
    fn cursor_follows_the_viewport_when_scrolled_back() {
        let mut term = Terminal::new(20, 4);
        for i in 0..40 {
            term.feed(format!("line{i}
").as_bytes());
        }
        let bottom = term.cursor();
        assert!(bottom.visible, "贴底时光标该看得见");

        term.scroll(10);
        assert_eq!(term.scroll_offset(), 10);
        assert!(!term.cursor().visible, "翻上去 10 行之后光标早出视口了,不该再画");

        term.scroll_to_bottom();
        let back = term.cursor();
        assert!(back.visible, "回到底部又该看得见");
        assert_eq!(back.row, bottom.row, "回到底部,行号该和原来一样");
    }

    /// 往回翻之后,远端继续输出**不能**把视口拽回底部 —— 看日志时这是刚需。
    #[test]
    fn scrolling_back_survives_new_output() {
        let mut term = Terminal::new(20, 4);
        for i in 0..40 {
            term.feed(format!("line{i}
").as_bytes());
        }
        assert_eq!(term.scroll_offset(), 0, "刚喂完应该贴底");
        assert!(term.history_len() > 0, "该攒下回滚内容");

        term.scroll(10);
        let offset = term.scroll_offset();
        assert_eq!(offset, 10);
        let view = term.screen_lines();

        // 远端又来了几行
        for i in 40..45 {
            term.feed(format!("line{i}
").as_bytes());
        }
        // 断言真正要保证的性质:看到的内容不变。
        // (别去断言偏移正好涨几行 —— 那取决于喂进去的字节滚了几行,是在测 alacritty 不是测自己。)
        assert_eq!(term.screen_lines(), view, "看到的还是同几行");
        assert!(term.scroll_offset() > offset, "偏移随内容抬高,视口才锚得住");

        term.scroll_to_bottom();
        assert_eq!(term.scroll_offset(), 0);
    }

    /// 翻不过头:超出历史范围要被夹住,不能翻出空白。
    #[test]
    fn scrolling_is_clamped_to_history() {
        let mut term = Terminal::new(20, 4);
        for i in 0..10 {
            term.feed(format!("line{i}
").as_bytes());
        }
        let history = term.history_len();
        term.scroll(10_000);
        assert_eq!(term.scroll_offset(), history, "最多翻到历史顶");
        term.scroll(-10_000);
        assert_eq!(term.scroll_offset(), 0, "最多翻回底部");
    }

    use super::*;

    #[test]
    fn plain_text_and_cursor() {
        let mut t = Terminal::new(20, 4);
        t.feed(b"hello");
        assert_eq!(t.text(), "hello");
        assert_eq!(t.cursor(), Cursor { col: 5, row: 0, visible: true });
    }

    #[test]
    fn crlf_moves_lines() {
        let mut t = Terminal::new(20, 4);
        t.feed(b"a\r\nb");
        assert_eq!(t.text(), "a\nb");
        assert_eq!(t.cursor().row, 1);
        assert_eq!(t.cursor().col, 1);
    }

    #[test]
    fn sgr_sequences_do_not_leak_into_text() {
        let mut t = Terminal::new(40, 4);
        t.feed(b"\x1b[31mred\x1b[0m normal");
        assert_eq!(t.text(), "red normal");
    }

    #[test]
    fn synchronized_update_is_flushed_on_timeout() {
        let mut t = Terminal::new(20, 2);
        // 进备用屏 + 开始同步刷新,但结束序列迟迟不来。
        t.feed(b"\x1b[?1049h\x1b[?2026hhello");
        assert_eq!(t.text(), "", "同步块里的内容先攒着");
        assert!(!t.tick(), "还没到超时");
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert!(t.tick(), "超时后必须放出来");
        assert_eq!(t.text(), "hello");
        // 放出来之后继续正常工作。
        t.feed(b" world");
        assert_eq!(t.text(), "hello world");
    }

    #[test]
    fn without_tick_the_synchronized_frame_is_lost() {
        // 钉住 bug 的机制:同步块的结束序列没及时到,超时之后又没人调 tick ——
        // vte 会把**之后的所有输出**都继续扣着,屏幕上什么都没有。Codex 整屏空白就是这样。
        let mut t = Terminal::new(20, 2);
        t.feed(b"\x1b[?2026hhello");
        std::thread::sleep(std::time::Duration::from_millis(200));
        t.feed(b" world");
        assert_eq!(t.text(), "", "不调 tick:之前的和之后的输出全被扣住");
        assert!(t.tick());
        assert_eq!(t.text(), "hello world", "调了 tick 全部放出来");
    }

    #[test]
    fn synchronized_update_with_end_marker_needs_no_tick() {
        let mut t = Terminal::new(20, 2);
        t.feed(b"\x1b[?2026hframe\x1b[?2026l");
        assert_eq!(t.text(), "frame");
    }

    #[test]
    fn custom_palette_changes_named_colors() {
        let mut t = Terminal::new(20, 2);
        t.set_palette(&[0, 0x112233]);
        t.feed(b"[31mr");
        assert_eq!(t.screen_runs()[0][0].fg, 0xFF112233, "红色走自定义 16 色");
    }

    #[test]
    fn answers_background_color_query() {
        let mut t = Terminal::new(20, 2);
        t.set_theme(Theme { foreground: 0xE6E8EC, background: 0x0E0F12, cursor: 0x6EA8FE });
        t.feed(b"\x1b]11;?\x07");
        let events = t.poll_events();
        let reply = events
            .iter()
            .find_map(|e| match e {
                TerminalEvent::Write(bytes) => Some(String::from_utf8_lossy(bytes).to_string()),
                _ => None,
            })
            .expect("背景色查询要有回答");
        assert!(reply.starts_with("\x1b]11;rgb:0e0e/0f0f/1212"), "回答是 {reply:?}");
    }

    #[test]
    fn answers_text_area_size_query() {
        let mut t = Terminal::new(40, 12);
        t.set_cell_pixels(9, 18);
        t.feed(b"\x1b[18t");
        let events = t.poll_events();
        assert!(
            events.contains(&TerminalEvent::Write(b"\x1b[8;12;40t".to_vec())),
            "字符网格尺寸查询的回答: {events:?}"
        );
    }

    #[test]
    fn runs_keep_wide_chars_on_their_columns() {
        let mut t = Terminal::new(20, 2);
        t.feed("你好a".as_bytes());
        let runs = &t.screen_runs()[0];
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].col, 0);
        // 占位格是空串:分隔后第 i 项正好是第 i 列,"a" 落在第 4 列。
        let cells: Vec<&str> = runs[0].cells.split(CELL_SEP).collect();
        assert_eq!(cells, vec!["你", "", "好", "", "a"]);
    }

    #[test]
    fn runs_split_on_style_and_resolve_colors() {
        let mut t = Terminal::new(20, 2);
        t.feed(b"\x1b[31mred\x1b[0m ok \x1b[7mX\x1b[0m");
        let runs = &t.screen_runs()[0];
        assert_eq!(runs[0].col, 0);
        assert_eq!(runs[0].cells, "r\u{1f}e\u{1f}d");
        assert_eq!(runs[0].fg, 0xFFCD3131);
        assert_eq!(runs[1].col, 3);
        assert_eq!(runs[1].fg, 0, "默认前景交给宿主");
        let inverse = runs.iter().find(|r| r.cells == "X").expect("反白那一格");
        assert_eq!(inverse.col, 7, "r e d 空 o k 空 X:第 7 列");
        assert!(inverse.flags & style::INVERSE != 0);
    }

    #[test]
    fn runs_trim_trailing_blank_but_keep_colored_blank() {
        let mut t = Terminal::new(10, 2);
        t.feed(b"ab   ");
        assert_eq!(t.screen_runs()[0][0].cells, "a\u{1f}b");
        let mut t = Terminal::new(10, 2);
        t.feed(b"\x1b[44m  \x1b[0m");
        let runs = &t.screen_runs()[0];
        assert_eq!(runs.len(), 1, "有背景色的空格要留着(状态栏、选中行靠它)");
        assert_eq!(runs[0].bg, 0xFF2472C8);
    }

    #[test]
    fn cjk_wide_chars_occupy_two_cells() {
        let mut t = Terminal::new(20, 4);
        t.feed("你好a".as_bytes());
        assert_eq!(t.text(), "你好a");
        assert_eq!(t.cursor().col, 5);
    }

    #[test]
    fn alt_screen_switch_keeps_main_buffer() {
        let mut t = Terminal::new(20, 4);
        t.feed(b"main");
        t.feed(b"\x1b[?1049h\x1b[H");
        assert!(t.alt_screen());
        t.feed(b"vim");
        assert_eq!(t.text(), "vim");
        t.feed(b"\x1b[?1049l");
        assert!(!t.alt_screen());
        assert_eq!(t.text(), "main");
    }

    #[test]
    fn cursor_position_escape() {
        let mut t = Terminal::new(20, 4);
        t.feed(b"\x1b[2;3HX");
        assert_eq!(t.cursor().row, 1);
        assert_eq!(t.cursor().col, 3);
        assert_eq!(t.screen_lines()[1], "  X");
    }

    #[test]
    fn screen_scrolls_and_keeps_viewport() {
        let mut t = Terminal::new(10, 3);
        t.feed(b"1\r\n2\r\n3\r\n4\r\n5");
        assert_eq!(t.screen_lines().join("|"), "3|4|5");
    }

    #[test]
    fn resize_keeps_content() {
        let mut t = Terminal::new(10, 3);
        t.feed(b"hello\r\nworld");
        t.resize(20, 6);
        assert_eq!(t.size(), Size::new(20, 6));
        assert_eq!(t.screen_lines()[0], "hello");
        assert_eq!(t.screen_lines()[1], "world");
    }

    #[test]
    fn hidden_cells_keep_column_alignment() {
        let mut t = Terminal::new(20, 4);
        t.feed(b"a\x1b[8mb\x1b[0mc");
        assert_eq!(t.text(), "a c");
    }

    #[test]
    fn damage_is_full_first_then_incremental() {
        let mut t = Terminal::new(20, 4);
        assert_eq!(t.take_damage(), Damage::Full);
        t.feed(b"hi");
        assert_eq!(t.take_damage(), Damage::Lines(vec![(0, 0, 2)]));
        // 无新输出时,仅光标所在单元为脏(渲染器每帧都要重画光标)。
        assert_eq!(t.take_damage(), Damage::Lines(vec![(0, 2, 2)]));
    }

    #[test]
    fn device_status_report_is_answered() {
        let mut t = Terminal::new(20, 4);
        t.feed(b"\x1b[3;5H");
        let _ = t.poll_events();
        t.feed(b"\x1b[6n");
        assert_eq!(t.poll_events(), vec![TerminalEvent::Write(b"\x1b[3;5R".to_vec())]);
    }

    #[test]
    fn bracketed_paste_and_mouse_modes_are_tracked() {
        let mut t = Terminal::new(20, 4);
        t.feed(b"\x1b[?2004h");
        assert!(t.term.mode().contains(TermMode::BRACKETED_PASTE));
        t.feed(b"\x1b[?2004l");
        assert!(!t.term.mode().contains(TermMode::BRACKETED_PASTE));
    }

    #[test]
    fn selection_follows_content_when_output_scrolls() {
        let mut t = Terminal::new(20, 4);
        t.feed(b"alpha\r\nbeta\r\ngamma");
        // 选中第 1 行的 "beta"。
        t.select_start(1, 0, false, SelectKind::Cell);
        t.select_update(1, 3, true);
        assert_eq!(t.selection_text().as_deref(), Some("beta"));
        assert_eq!(
            t.view_selection(),
            Some(ViewSelection { start_row: 1, start_col: 0, end_row: 1, end_col: 3 })
        );
        // 新输出把整屏往上推两行:高亮跟着 "beta" 走到第 0 行之上(滚进历史),文字不变。
        t.feed(b"\r\ndelta\r\nepsilon\r\nzeta");
        assert_eq!(t.selection_text().as_deref(), Some("beta"));
        assert_eq!(t.view_selection(), None);
        // 往回翻两行又能看到高亮。
        t.scroll(2);
        let view = t.view_selection().expect("翻回来应该看得到选区");
        assert_eq!((view.start_row, view.start_col, view.end_col), (1, 0, 3));
    }

    #[test]
    fn word_selection_stops_at_full_width_punctuation() {
        let mut t = Terminal::new(40, 2);
        t.feed("(c) Microsoft Corporation\u{3002}\u{4FDD}\u{7559}".as_bytes());
        // 双击 "Corporation" 中间。
        t.select_start(0, 18, false, SelectKind::Word);
        assert_eq!(t.selection_text().as_deref(), Some("Corporation"));
        // user@host:22 整段是一个词(冒号不算分隔)。
        let mut t = Terminal::new(40, 2);
        t.feed(b"ssh user@host:22 ok");
        t.select_start(0, 8, false, SelectKind::Word);
        assert_eq!(t.selection_text().as_deref(), Some("user@host:22"));
    }

    #[test]
    fn selection_can_reach_into_scrollback() {
        let mut t = Terminal::new(20, 2);
        t.feed(b"one\r\ntwo\r\nthree\r\nfour");
        t.scroll(2); // 视口现在是 "one" / "two"
        t.select_start(0, 0, false, SelectKind::Line);
        t.select_update(1, 0, false);
        assert_eq!(t.selection_text().as_deref(), Some("one\ntwo\n"));
    }

    #[test]
    fn input_modes_follow_the_program() {
        let mut t = Terminal::new(20, 4);
        assert!(!t.input_modes().app_cursor);
        // vim 启动时的典型序列:应用光标 + 备用屏 + SGR 鼠标。
        t.feed(b"\x1b[?1h\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?2004h");
        let m = t.input_modes();
        assert!(m.app_cursor && m.alt_screen && m.mouse_report && m.sgr_mouse && m.bracketed_paste);
        t.feed(b"\x1b[?1l\x1b[?1049l\x1b[?1000l\x1b[?1006l\x1b[?2004l");
        let m = t.input_modes();
        assert!(!m.app_cursor && !m.alt_screen && !m.mouse_report && !m.sgr_mouse && !m.bracketed_paste);
    }
}