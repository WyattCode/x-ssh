//! 终端仿真:字节流 → 网格视图。
//!
//! 平台无关、不做任何 I/O:输入是远程(SSH/PTY)的原始字节,输出是可供渲染的视图与光标。
//! 桌面、Android、iOS 共用同一实现,保证终端语义(转义序列、宽字符、备用屏)完全一致。

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::{Config, Term, TermDamage, TermMode};
use alacritty_terminal::vte::ansi::{CursorShape, Processor};

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

/// 终端仿真状态机。
pub struct Terminal {
    term: Term<EventQueue>,
    events: EventQueue,
    parser: Processor,
    size: Size,
}

impl Terminal {
    /// 新建终端(含回滚缓冲)。
    pub fn new(cols: usize, rows: usize) -> Self {
        let size = Size::new(cols.max(1), rows.max(1));
        let config = Config { scrolling_history: DEFAULT_SCROLLBACK, ..Config::default() };
        let events = EventQueue::default();
        let term = Term::new(config, &size, events.clone());
        Self { term, events, parser: Processor::new(), size }
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
        self.size = Size::new(cols, rows);
        self.term.resize(self.size);
    }

    /// 光标位置与可见性。
    pub fn cursor(&self) -> Cursor {
        let content = self.term.renderable_content();
        let line = content.cursor.point.line.0;
        let on_screen = line >= 0 && (line as usize) < self.size.rows;
        Cursor {
            col: content.cursor.point.column.0,
            row: line.max(0) as usize,
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
                _ => {}
            }
        }
        out
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

#[cfg(test)]
mod tests {

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
}