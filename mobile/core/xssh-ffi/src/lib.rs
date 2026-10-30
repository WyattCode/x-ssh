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
    /// 经这台跳板机连(ProxyJump)。它自己的主机密钥 / 认证出了问题,报的是 `JumpHostKey*`
    /// 或带 `jump host: ` 前缀的错误,宿主据此知道该改哪台主机。
    #[uniffi(default = None)]
    pub jump: Option<JumpHost>,
}

/// 跳板机:和 [`HostConfig`] 一样的连接信息,只是它自己不能再经过跳板机(只支持一层)。
#[derive(Debug, Clone, uniffi::Record)]
pub struct JumpHost {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    /// 跳板机的已信任指纹,规则同 [`HostConfig::known_key`]。
    pub known_key: Option<String>,
}

/// 端口转发方式(和桌面版 / 核心一致)。
#[derive(Debug, Clone, Copy, uniffi::Enum)]
pub enum ForwardMode {
    Local,
    Remote,
    Dynamic,
}

/// 要开的一条转发规则。
#[derive(Debug, Clone, uniffi::Record)]
pub struct ForwardSpec {
    pub mode: ForwardMode,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

/// 已开着的一条转发。
#[derive(Debug, Clone, uniffi::Record)]
pub struct ForwardInfo {
    pub id: u64,
    pub mode: ForwardMode,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

/// 认证方式。
#[derive(Debug, Clone, uniffi::Enum)]
pub enum AuthMethod {
    Password { password: String },
    KeyFile { path: String, passphrase: Option<String> },
    /// 私钥内容(导入后加密存在应用里,连接时在内存里解密传过来)。
    KeyData { pem: String, passphrase: Option<String> },
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

/// 怎么选:按格(拖动)、按词(双击 / 长按)、按行(三击)。
#[derive(Debug, Clone, Copy, uniffi::Enum)]
pub enum SelectKind {
    Cell,
    Word,
    Line,
}

/// 选区落在当前视口里的部分(闭区间),给界面画高亮。
#[derive(Debug, Clone, uniffi::Record)]
pub struct ViewSelection {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

/// 远端程序打开的输入模式(实体键盘、滚轮、粘贴按它编码)。
#[derive(Debug, Clone, uniffi::Record)]
pub struct InputModes {
    pub app_cursor: bool,
    pub bracketed_paste: bool,
    pub alt_screen: bool,
    pub mouse_report: bool,
    pub sgr_mouse: bool,
    pub alternate_scroll: bool,
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
    /// 同上两条,但说的是**跳板机**的密钥 —— 宿主要把指纹存到跳板机那台主机上,不是目标。
    JumpHostKeyUnknown { fingerprint: String },
    JumpHostKeyChanged { actual: String },
    /// 私钥带口令,没给或给错了(导入 / 连接时界面据此提示填口令)。
    KeyEncrypted { detail: String },
    /// 传输被用户取消(不是错误,界面不用提示)。
    Cancelled { detail: String },
}

impl std::fmt::Display for FfiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Message { message } => write!(f, "{message}"),
            Self::HostKeyUnknown { fingerprint } | Self::JumpHostKeyUnknown { fingerprint } => {
                write!(f, "{fingerprint}")
            }
            Self::HostKeyChanged { actual } | Self::JumpHostKeyChanged { actual } => write!(f, "{actual}"),
            Self::KeyEncrypted { detail } | Self::Cancelled { detail } => write!(f, "{detail}"),
        }
    }
}

impl From<ssh::SshError> for FfiError {
    fn from(err: ssh::SshError) -> Self {
        match err {
            // 跳板机那一跳:主机密钥换成专门的变体(指纹要存到跳板机上);口令问题保留变体、
            // 文本带前缀;其余一律是带前缀的消息。
            ssh::SshError::Jump(inner) => match *inner {
                ssh::SshError::HostKeyUnknown { fingerprint } => Self::JumpHostKeyUnknown { fingerprint },
                ssh::SshError::HostKeyChanged { actual, .. } => Self::JumpHostKeyChanged { actual },
                ssh::SshError::KeyEncrypted => Self::KeyEncrypted { detail: format!("jump host: {inner}") },
                ssh::SshError::Cancelled => Self::Cancelled { detail: inner.to_string() },
                other => Self::Message { message: ssh::SshError::Jump(Box::new(other)).to_string() },
            },
            ssh::SshError::HostKeyUnknown { fingerprint } => Self::HostKeyUnknown { fingerprint },
            ssh::SshError::HostKeyChanged { actual, .. } => Self::HostKeyChanged { actual },
            ssh::SshError::KeyEncrypted => Self::KeyEncrypted { detail: err.to_string() },
            ssh::SshError::Cancelled => Self::Cancelled { detail: err.to_string() },
            other => Self::Message { message: other.to_string() },
        }
    }
}

/// 一把私钥的公开信息(导入时展示给用户核对)。
#[derive(Debug, Clone, uniffi::Record)]
pub struct KeyInfo {
    pub algorithm: String,
    /// `SHA256:…`,和 `ssh-keygen -lf` 一致。
    pub fingerprint: String,
    /// 公钥一行,可以直接贴进服务器的 authorized_keys。
    pub public_key: String,
}

/// 远端的一个文件 / 目录。
#[derive(Debug, Clone, uniffi::Record)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_link: bool,
    pub size: u64,
    /// 修改时间(Unix 秒),0 = 服务器没给。
    pub modified: u64,
    pub permissions: u32,
}

impl From<xssh_core::sftp::RemoteEntry> for RemoteEntry {
    fn from(e: xssh_core::sftp::RemoteEntry) -> Self {
        Self {
            name: e.name,
            path: e.path,
            is_dir: e.is_dir,
            is_link: e.is_link,
            size: e.size,
            modified: e.modified,
            permissions: e.permissions,
        }
    }
}

/// 传输进度(宿主实现)。返回 false = 取消。
#[uniffi::export(with_foreign)]
pub trait TransferListener: Send + Sync {
    fn progress(&self, done: u64, total: u64) -> bool;
}

/// 一个 SFTP 会话(和终端共用同一条 SSH 连接)。
#[derive(uniffi::Object)]
pub struct Sftp {
    inner: xssh_core::sftp::Sftp,
}

/// 接管宿主给的文件描述符(Android:`ParcelFileDescriptor.detachFd()`),用完自动关闭。
#[cfg(unix)]
fn file_from_fd(fd: i32) -> Result<std::fs::File, FfiError> {
    use std::os::fd::FromRawFd;
    if fd < 0 {
        return Err(FfiError::Message { message: "invalid file descriptor".into() });
    }
    // SAFETY:宿主把这个描述符的所有权交给了我们(detachFd 之后它不会再关),这里只接管一次。
    Ok(unsafe { std::fs::File::from_raw_fd(fd) })
}

#[cfg(not(unix))]
fn file_from_fd(_fd: i32) -> Result<std::fs::File, FfiError> {
    Err(FfiError::Message { message: "file descriptors are only supported on unix".into() })
}

#[uniffi::export]
impl Sftp {
    /// 起始目录(一般是家目录)。
    pub fn home(&self) -> Result<String, FfiError> {
        Ok(self.inner.home()?)
    }

    /// 列目录(目录在前)。
    pub fn list(&self, path: String) -> Result<Vec<RemoteEntry>, FfiError> {
        Ok(self.inner.list(&path)?.into_iter().map(Into::into).collect())
    }

    /// 这个路径是不是目录(符号链接点进去之前先问一下)。
    pub fn is_dir(&self, path: String) -> bool {
        self.inner.is_dir(&path)
    }

    /// 下载远端文件,写进宿主给的文件描述符(接管并关闭它)。返回字节数。
    pub fn download_to_fd(&self, path: String, fd: i32, listener: Arc<dyn TransferListener>) -> Result<u64, FfiError> {
        let mut file = file_from_fd(fd)?;
        Ok(self.inner.download(&path, &mut file, &mut |done, total| listener.progress(done, total))?)
    }

    /// 从宿主给的文件描述符读内容,上传到远端(已存在就覆盖)。[total] 只用于进度。
    pub fn upload_from_fd(
        &self,
        path: String,
        fd: i32,
        total: u64,
        listener: Arc<dyn TransferListener>,
    ) -> Result<u64, FfiError> {
        let mut file = file_from_fd(fd)?;
        Ok(self.inner.upload(&path, &mut file, total, &mut |done, total| listener.progress(done, total))?)
    }

    pub fn mkdir(&self, path: String) -> Result<(), FfiError> {
        Ok(self.inner.mkdir(&path)?)
    }

    pub fn remove(&self, path: String, is_dir: bool) -> Result<(), FfiError> {
        Ok(self.inner.remove(&path, is_dir)?)
    }

    pub fn rename(&self, from: String, to: String) -> Result<(), FfiError> {
        Ok(self.inner.rename(&from, &to)?)
    }

    /// 关闭 SFTP 通道(终端不受影响)。不叫 close:Kotlin 绑定里 close() 是 AutoCloseable 的,会重名。
    pub fn shutdown(&self) {
        self.inner.close();
    }
}

/// 在设备上生成的一把新私钥。
#[derive(Debug, Clone, uniffi::Record)]
pub struct GeneratedKey {
    /// OpenSSH 格式的私钥文本(宿主加密后保存)。
    pub pem: String,
    pub info: KeyInfo,
}

/// 生成一把 ed25519 密钥。[comment] 写进公钥末尾(在服务器上认出是哪台设备)。
#[uniffi::export]
pub fn generate_key(comment: String, passphrase: Option<String>) -> Result<GeneratedKey, FfiError> {
    let key = ssh::generate_ed25519(&comment, passphrase.as_deref())?;
    Ok(GeneratedKey {
        pem: key.pem,
        info: KeyInfo {
            algorithm: key.info.algorithm,
            fingerprint: key.info.fingerprint,
            public_key: key.info.public_key,
        },
    })
}

/// 校验私钥文本(导入时调用)。带口令而没给口令时返回 [`FfiError::KeyEncrypted`]。
#[uniffi::export]
pub fn inspect_key(pem: String, passphrase: Option<String>) -> Result<KeyInfo, FfiError> {
    let info = ssh::inspect_private_key(&pem, passphrase.as_deref())?;
    Ok(KeyInfo { algorithm: info.algorithm, fingerprint: info.fingerprint, public_key: info.public_key })
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
        let auth = auth_of(config.auth);
        let jump = config.jump.map(|hop| {
            Box::new(ssh::Target {
                host: hop.host,
                port: hop.port,
                username: hop.username,
                auth: auth_of(hop.auth),
                known_key: hop.known_key,
                jump: None,
            })
        });
        let target = ssh::Target {
            host: config.host,
            port: config.port,
            username: config.username,
            auth,
            known_key: config.known_key,
            jump,
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

    /// 在同一条连接上开一个 SFTP 通道(终端不受影响)。
    pub fn open_sftp(&self) -> Result<Arc<Sftp>, FfiError> {
        let sftp = self.lock().open_sftp()?;
        Ok(Arc::new(Sftp { inner: sftp }))
    }

    /// 开一条端口转发。失败不伤终端。错误文本带 `forward: ` 前缀。
    pub fn add_forward(&self, spec: ForwardSpec) -> Result<ForwardInfo, FfiError> {
        let info = self.lock().add_forward(to_core_spec(spec))?;
        Ok(from_core_info(info))
    }

    /// 按编号拆掉一条转发。
    pub fn remove_forward(&self, id: u64) -> Result<(), FfiError> {
        self.lock().remove_forward(id)?;
        Ok(())
    }

    /// 这条连接上现在开着的转发。
    pub fn forwards(&self) -> Vec<ForwardInfo> {
        self.lock().forwards().into_iter().map(from_core_info).collect()
    }

    /// 断开连接。
    pub fn disconnect(&self) {
        self.lock().disconnect();
    }
}

fn auth_of(auth: AuthMethod) -> ssh::Auth {
    match auth {
        AuthMethod::Password { password } => ssh::Auth::Password(password),
        AuthMethod::KeyFile { path, passphrase } => ssh::Auth::KeyFile { path: path.into(), passphrase },
        AuthMethod::KeyData { pem, passphrase } => ssh::Auth::KeyData { pem, passphrase },
    }
}

fn to_core_spec(spec: ForwardSpec) -> xssh_core::forward::ForwardSpec {
    use xssh_core::forward::{ForwardMode as M, ForwardSpec as S};
    S {
        mode: match spec.mode {
            ForwardMode::Local => M::Local,
            ForwardMode::Remote => M::Remote,
            ForwardMode::Dynamic => M::Dynamic,
        },
        local_port: spec.local_port,
        remote_host: spec.remote_host,
        remote_port: spec.remote_port,
    }
}

fn from_core_info(info: xssh_core::forward::ForwardInfo) -> ForwardInfo {
    use xssh_core::forward::ForwardMode as M;
    ForwardInfo {
        id: info.id,
        mode: match info.spec.mode {
            M::Local => ForwardMode::Local,
            M::Remote => ForwardMode::Remote,
            M::Dynamic => ForwardMode::Dynamic,
        },
        local_port: info.spec.local_port,
        remote_host: info.spec.remote_host,
        remote_port: info.spec.remote_port,
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

    /// ANSI 0..15 的颜色(`0xRRGGBB`),跟着界面的深浅色主题换。
    pub fn set_palette(&self, colors: Vec<u32>) {
        self.lock().set_palette(&colors);
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

    /// 开始选择(视口坐标)。[right_half]:按在格子右半边。
    pub fn select_start(&self, row: u32, col: u32, right_half: bool, kind: SelectKind) {
        let kind = match kind {
            SelectKind::Cell => terminal::SelectKind::Cell,
            SelectKind::Word => terminal::SelectKind::Word,
            SelectKind::Line => terminal::SelectKind::Line,
        };
        self.lock().select_start(row as usize, col as usize, right_half, kind);
    }

    /// 拖到 (row, col)。
    pub fn select_update(&self, row: u32, col: u32, right_half: bool) {
        self.lock().select_update(row as usize, col as usize, right_half);
    }

    /// 清掉选区。
    pub fn select_clear(&self) {
        self.lock().select_clear();
    }

    /// 选中的文字;没选时为 None。
    pub fn selection_text(&self) -> Option<String> {
        self.lock().selection_text()
    }

    /// 选区在视口里的范围;没选、或整个在视口外时为 None。
    pub fn view_selection(&self) -> Option<ViewSelection> {
        self.lock().view_selection().map(|v| ViewSelection {
            start_row: v.start_row as u32,
            start_col: v.start_col as u32,
            end_row: v.end_row as u32,
            end_col: v.end_col as u32,
        })
    }

    /// 输入模式(应用光标、括号粘贴、鼠标上报……)。
    pub fn input_modes(&self) -> InputModes {
        let m = self.lock().input_modes();
        InputModes {
            app_cursor: m.app_cursor,
            bracketed_paste: m.bracketed_paste,
            alt_screen: m.alt_screen,
            mouse_report: m.mouse_report,
            sgr_mouse: m.sgr_mouse,
            alternate_scroll: m.alternate_scroll,
        }
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
