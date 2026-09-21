//! uniffi 导出层:给 Kotlin / Swift 用的稳定接口。
//!
//! 约定:
//! - 凭据只在本层与核心之间传递,UI 层拿到即用即弃;
//! - 轮询式 API(`Shell::poll` / `Term::take_events`),宿主按帧调用,不需要回调线程;
//! - 字节(`Vec<u8>`)跨边界即 Kotlin `ByteArray`。

use std::sync::{Arc, Mutex};

use xssh_core::ssh::{self, Ssh};
use xssh_core::terminal::{self, TerminalEvent as CoreTerminalEvent};

uniffi::setup_scaffolding!();

/// 连接目标。
#[derive(Debug, Clone, uniffi::Record)]
pub struct HostConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    /// 已信任的主机密钥指纹(SHA256)。为空表示还没信任过 —— 连接会被拒绝并
    /// 抛出 HostKeyUnknown,异常文本就是服务端这次的指纹,由界面让用户确认。
    pub known_key: Option<String>,
}

/// 认证方式。
#[derive(Debug, Clone, uniffi::Enum)]
pub enum AuthMethod {
    Password { password: String },
    KeyFile { path: String, passphrase: Option<String> },
}

/// 服务端消息。
#[derive(Debug, Clone, uniffi::Enum)]
pub enum ServerEvent {
    Data { data: Vec<u8> },
    Eof,
    Close,
    ExitStatus { status: u32 },
    /// 连接整体断开(网络错误或服务端断开)。
    Disconnected,
}

/// 终端产生的事件。
#[derive(Debug, Clone, uniffi::Enum)]
pub enum TerminalEvent {
    /// 必须写回连接(DSR/DA 等应答)。
    Write { data: Vec<u8> },
    Title { title: String },
    ResetTitle,
    Bell,
    ClipboardStore { text: String },
}

/// 一段列连续、样式相同的单元格(见 core 的 `terminal::Run`)。
#[derive(Debug, Clone, uniffi::Record)]
pub struct StyledRun {
    /// 起始列。
    pub col: u32,
    /// 单元格内容,用 U+001F 分隔;宽字符后面的占位格是空串 —— 分隔后第 i 项就是第 col+i 列。
    pub cells: String,
    /// `0xAARRGGBB`,0 = 默认前景。
    pub fg: u32,
    /// `0xAARRGGBB`,0 = 默认背景。
    pub bg: u32,
    /// 位:1 粗体、2 暗淡、4 斜体、8 下划线、16 反白、32 删除线。
    pub flags: u8,
}

/// 视口里的一行。
#[derive(Debug, Clone, uniffi::Record)]
pub struct ScreenRow {
    pub runs: Vec<StyledRun>,
}

/// 光标状态。
#[derive(Debug, Clone, uniffi::Record)]
pub struct CursorState {
    pub col: u32,
    pub row: u32,
    pub visible: bool,
}

/// 错误(flat_error:只有变体名和 Display 文本跨边界,字段不过去)。
///
/// 两个主机密钥变体的 Display **就是服务端指纹本身**,不加任何说明文字 ——
/// 宿主要拿它去存/去比对,掺了人话就得反过来解析字符串。给人看的措辞由 UI 拼,
/// 已信任的那个指纹本来就在宿主手里。
#[derive(Debug, uniffi::Error)]
#[uniffi(flat_error)]
pub enum FfiError {
    Message { message: String },
    /// 首次见到这台主机的密钥,需要用户确认。
    HostKeyUnknown { fingerprint: String },
    /// 主机密钥与已信任的不一致,连接已拒绝。
    HostKeyChanged { actual: String },
}

impl std::fmt::Display for FfiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Message { message } => write!(f, "{message}"),
            Self::HostKeyUnknown { fingerprint } => write!(f, "{fingerprint}"),
            Self::HostKeyChanged { actual } => write!(f, "{actual}"),
        }
    }
}

impl From<ssh::SshError> for FfiError {
    fn from(err: ssh::SshError) -> Self {
        match err {
            ssh::SshError::HostKeyUnknown { fingerprint } => Self::HostKeyUnknown { fingerprint },
            ssh::SshError::HostKeyChanged { actual, .. } => Self::HostKeyChanged { actual },
            other => Self::Message { message: other.to_string() },
        }
    }
}

/// 一条 SSH 连接。
#[derive(uniffi::Object)]
pub struct Session {
    inner: Mutex<Ssh>,
}

#[uniffi::export]
impl Session {
    /// 连接并认证(阻塞至完成;请在工作线程调用)。
    #[uniffi::constructor]
    pub fn connect(config: HostConfig) -> Result<Arc<Self>, FfiError> {
        let auth = match config.auth {
            AuthMethod::Password { password } => ssh::Auth::Password(password),
            AuthMethod::KeyFile { path, passphrase } => {
                ssh::Auth::KeyFile { path: path.into(), passphrase }
            }
        };
        let target = ssh::Target {
            host: config.host,
            port: config.port,
            username: config.username,
            auth,
            known_key: config.known_key,
        };
        let ssh = Ssh::connect(&target)?;
        Ok(Arc::new(Self { inner: Mutex::new(ssh) }))
    }

    /// 服务端主机密钥指纹(SHA256)。
    pub fn host_key(&self) -> String {
        self.lock().server_key().to_string()
    }

    /// 打开交互式 PTY shell。
    pub fn open_shell(&self, cols: u32, rows: u32, term: String) -> Result<Arc<Shell>, FfiError> {
        let mut guard = self.lock();
        let shell = guard.open_shell(cols as u16, rows as u16, &term)?;
        Ok(Arc::new(Shell { inner: Mutex::new(shell) }))
    }

    /// 打开 PTY 并执行命令。
    pub fn open_exec(
        &self,
        cols: u32,
        rows: u32,
        term: String,
        command: String,
    ) -> Result<Arc<Shell>, FfiError> {
        let mut guard = self.lock();
        let shell = guard.open_exec(cols as u16, rows as u16, &term, &command)?;
        Ok(Arc::new(Shell { inner: Mutex::new(shell) }))
    }

    /// 断开连接。
    pub fn disconnect(&self) {
        self.lock().disconnect();
    }
}

impl Session {
    fn lock(&self) -> std::sync::MutexGuard<'_, Ssh> {
        match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

/// 一个已开启的通道。
#[derive(uniffi::Object)]
pub struct Shell {
    inner: Mutex<ssh::Shell>,
}

#[uniffi::export]
impl Shell {
    /// 发送按键/粘贴数据。
    pub fn write(&self, data: Vec<u8>) -> Result<(), FfiError> {
        self.lock().write(&data)?;
        Ok(())
    }

    /// 通知远端新的窗口尺寸。
    pub fn resize(&self, cols: u32, rows: u32) -> Result<(), FfiError> {
        self.lock().resize(cols as u16, rows as u16)?;
        Ok(())
    }

    /// 取走当前所有服务端消息(不阻塞)。
    pub fn poll(&self) -> Vec<ServerEvent> {
        let mut guard = self.lock();
        let mut out = Vec::new();
        while let Some(msg) = guard.poll_msg() {
            out.push(match msg {
                ssh::ServerMsg::Data { data, .. } => ServerEvent::Data { data },
                ssh::ServerMsg::ExtendedData { data, .. } => ServerEvent::Data { data },
                ssh::ServerMsg::Eof { .. } => ServerEvent::Eof,
                ssh::ServerMsg::Close { .. } => ServerEvent::Close,
                ssh::ServerMsg::ExitStatus { status, .. } => ServerEvent::ExitStatus { status },
                ssh::ServerMsg::Disconnected => ServerEvent::Disconnected,
            });
        }
        out
    }
}

impl Shell {
    fn lock(&self) -> std::sync::MutexGuard<'_, ssh::Shell> {
        match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

/// 终端仿真状态机。
#[derive(uniffi::Object)]
pub struct Term {
    inner: Mutex<terminal::Terminal>,
}

#[uniffi::export]
impl Term {
    #[uniffi::constructor]
    pub fn new(cols: u32, rows: u32) -> Arc<Self> {
        Arc::new(Self { inner: Mutex::new(terminal::Terminal::new(cols as usize, rows as usize)) })
    }

    /// 喂入远端输出。
    pub fn feed(&self, data: Vec<u8>) {
        self.lock().feed(&data);
    }

    /// 尺寸变化。
    pub fn resize(&self, cols: u32, rows: u32) {
        self.lock().resize(cols as usize, rows as usize);
    }

    /// 每一帧调一次:同步刷新超时就把攒着的输出放出来。返回屏幕是否因此变化。
    pub fn tick(&self) -> bool {
        self.lock().tick()
    }

    /// 回答颜色查询用的主题色(`0xRRGGBB`)。
    pub fn set_theme(&self, foreground: u32, background: u32, cursor: u32) {
        self.lock().set_theme(terminal::Theme { foreground, background, cursor });
    }

    /// 单元格像素尺寸(回答窗口尺寸查询用)。
    pub fn set_cell_pixels(&self, width: u32, height: u32) {
        self.lock().set_cell_pixels(width.min(u16::MAX as u32) as u16, height.min(u16::MAX as u32) as u16);
    }

    /// 视口逐行文本(已裁剪行尾空白)。
    pub fn lines(&self) -> Vec<String> {
        self.lock().screen_lines()
    }

    /// 视口逐行的样式段:保留列位置(宽字符占两列)和颜色、粗体、反白等样式。
    /// 界面按这个画 —— 用 `lines()` 整行画的话,中文后面的内容会错位。
    pub fn rows(&self) -> Vec<ScreenRow> {
        self.lock()
            .screen_runs()
            .into_iter()
            .map(|runs| ScreenRow {
                runs: runs
                    .into_iter()
                    .map(|run| StyledRun {
                        col: run.col as u32,
                        cells: run.cells,
                        fg: run.fg,
                        bg: run.bg,
                        flags: run.flags,
                    })
                    .collect(),
            })
            .collect()
    }

    /// 光标状态。
    pub fn cursor(&self) -> CursorState {
        let cursor = self.lock().cursor();
        CursorState {
            col: cursor.col as u32,
            row: cursor.row as u32,
            visible: cursor.visible,
        }
    }

    /// 往回翻 [lines] 行(正数看更早的内容);超出历史范围会被夹住。
    pub fn scroll(&self, lines: i32) {
        self.lock().scroll(lines);
    }

    /// 回到底部(贴着最新输出)。
    pub fn scroll_to_bottom(&self) {
        self.lock().scroll_to_bottom();
    }

    /// 视口离底部多少行(0 = 贴底);界面据此决定要不要显示「回到底部」。
    pub fn scroll_offset(&self) -> u32 {
        self.lock().scroll_offset() as u32
    }

    /// 是否处于备用屏(全屏 TUI)。
    pub fn alt_screen(&self) -> bool {
        self.lock().alt_screen()
    }

    /// 取走终端事件(应答/标题/响铃等)。
    pub fn take_events(&self) -> Vec<TerminalEvent> {
        self.lock()
            .poll_events()
            .into_iter()
            .map(|event| match event {
                CoreTerminalEvent::Write(bytes) => TerminalEvent::Write { data: bytes },
                CoreTerminalEvent::Title(title) => TerminalEvent::Title { title },
                CoreTerminalEvent::ResetTitle => TerminalEvent::ResetTitle,
                CoreTerminalEvent::Bell => TerminalEvent::Bell,
                CoreTerminalEvent::ClipboardStore(text) => {
                    TerminalEvent::ClipboardStore { text }
                }
            })
            .collect()
    }
}

impl Term {
    fn lock(&self) -> std::sync::MutexGuard<'_, terminal::Terminal> {
        match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}
