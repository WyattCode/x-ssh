//! SSH 会话:连接、认证、PTY/命令通道。
//!
//! 设计:核心自己持有 tokio 运行时,对外暴露同步 API(移动端 UI / uniffi 直接调用),
//! 服务端消息通过 [`Shell::poll_msg`] 拉取;输出字节喂给 [`crate::terminal::Terminal`] 上屏,
//! 终端应答([`crate::terminal::TerminalEvent::Write`])写回 [`Shell::write`]。

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::ChannelId;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::AbortHandle;

use crate::forward::{
    dest_host, socks5_fail_reply, socks5_greeting, socks5_greeting_len, socks5_parse_connect,
    socks5_success_reply, validate_spec, ForwardError, ForwardId, ForwardInfo, ForwardMode,
    ForwardSpec, SocksErr,
};

/// 连接 + 认证总超时。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// 连接建立之后的单步操作(开通道、写数据、改窗口、断开)的上限。
///
/// 原来这些都是裸的 `block_on`:TCP 已经悄悄断了(息屏后 Wi-Fi 省电、
/// 系统后台限网)而客户端还不知道时,开通道会一直等服务端回应 ——
/// 界面就永远停在「正在连接」,只有杀进程才能恢复。
const STEP_TIMEOUT: Duration = Duration::from_secs(10);

/// 认证方式。
#[derive(Debug, Clone)]
pub enum Auth {
    /// 密码认证。
    Password(String),
    /// 私钥文件认证(可带口令)。
    KeyFile { path: PathBuf, passphrase: Option<String> },
    /// 私钥内容认证(OpenSSH / PEM 文本)。移动端把导入的私钥加密存在应用里,
    /// 连接时只在内存里解密交过来,磁盘上不落明文文件。
    KeyData { pem: String, passphrase: Option<String> },
}

/// 导入私钥时要给用户看的信息。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyInfo {
    /// 算法名,如 `ssh-ed25519`、`rsa-sha2-512`。
    pub algorithm: String,
    /// 公钥指纹 `SHA256:…`(和 `ssh-keygen -lf` 一致,方便对照服务器上的 authorized_keys)。
    pub fingerprint: String,
    /// 公钥一行(`ssh-ed25519 AAAA…`),可以直接贴进服务器的 authorized_keys。
    pub public_key: String,
}

/// 解析私钥文本。带口令的私钥没给口令时返回 [`SshError::KeyEncrypted`],
/// 界面据此提示"这把私钥有口令"而不是笼统的"格式不对"。
pub fn parse_private_key(pem: &str, passphrase: Option<&str>) -> Result<russh::keys::PrivateKey, SshError> {
    let pem = pem.trim();
    let passphrase = passphrase.filter(|p| !p.is_empty());
    russh::keys::decode_secret_key(pem, passphrase).map_err(|err| {
        if matches!(err, russh::keys::Error::KeyIsEncrypted) {
            return SshError::KeyEncrypted;
        }
        // 口令填错时报的是解密 / 校验一类的错误,不是"已加密"。先确认这把钥匙本身带口令,
        // 带的话就是口令不对 —— 别让用户以为文件格式有问题。
        let locked = passphrase.is_some()
            && matches!(russh::keys::decode_secret_key(pem, None), Err(russh::keys::Error::KeyIsEncrypted));
        if locked { SshError::KeyEncrypted } else { SshError::Key(err.to_string()) }
    })
}

/// 在设备上新生成的一把私钥:OpenSSH 格式文本(给了口令就是加密过的)+ 公开信息。
#[derive(Debug, Clone)]
pub struct GeneratedKey {
    pub pem: String,
    pub info: KeyInfo,
}

/// 生成一把 ed25519 密钥(现在服务器都认、最短、最快)。[comment] 写进公钥末尾,
/// 方便在服务器的 authorized_keys 里认出是哪台设备的钥匙。
pub fn generate_ed25519(comment: &str, passphrase: Option<&str>) -> Result<GeneratedKey, SshError> {
    use russh::keys::ssh_key::{Algorithm, LineEnding};
    let mut rng = rand::rng();
    let mut key = russh::keys::PrivateKey::random(&mut rng, Algorithm::Ed25519)
        .map_err(|err| SshError::Key(err.to_string()))?;
    key.set_comment(comment);
    let public = key.public_key();
    let info = KeyInfo {
        algorithm: public.algorithm().to_string(),
        fingerprint: public.fingerprint(HashAlg::Sha256).to_string(),
        public_key: public.to_openssh().map_err(|err| SshError::Key(err.to_string()))?,
    };
    let stored = match passphrase.filter(|p| !p.is_empty()) {
        Some(p) => key.encrypt(&mut rng, p).map_err(|err| SshError::Key(err.to_string()))?,
        None => key,
    };
    let pem = stored.to_openssh(LineEnding::LF).map_err(|err| SshError::Key(err.to_string()))?;
    Ok(GeneratedKey { pem: pem.to_string(), info })
}

/// 校验一把私钥,返回算法、指纹和公钥(导入时用)。
pub fn inspect_private_key(pem: &str, passphrase: Option<&str>) -> Result<KeyInfo, SshError> {
    let key = parse_private_key(pem, passphrase)?;
    let public = key.public_key();
    Ok(KeyInfo {
        algorithm: public.algorithm().to_string(),
        fingerprint: public.fingerprint(HashAlg::Sha256).to_string(),
        public_key: public.to_openssh().map_err(|err| SshError::Key(err.to_string()))?,
    })
}

/// 连接目标。
#[derive(Debug, Clone)]
pub struct Target {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: Auth,
    /// 已信任的服务端主机密钥指纹(SHA256)。None = 还没信任过任何密钥。
    pub known_key: Option<String>,
    /// 跳板机(ProxyJump):先登录这台,再让它开一条隧道(`direct-tcpip`)到本目标,
    /// 目标的 SSH 握手整个走在隧道里 —— 跳板机只转发加密后的字节,看不到里面的内容。
    ///
    /// 只支持一层:跳板机自己的 `jump` 不看(和桌面版的 `jumpHostId` 一致)。
    /// 两台主机的密钥各验各的,不认识 / 变了都会停下来,见 [`SshError::Jump`]。
    pub jump: Option<Box<Target>>,
}

/// 服务端主机密钥的校验结论。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyVerdict {
    /// 与已信任的指纹一致。
    Trusted,
    /// 还没有信任过这台主机的任何密钥(首次连接)。
    Unknown,
    /// 与已信任的指纹不一致 —— 服务器重装,或者有人在中间。
    Changed,
}

/// 纯函数:拿实际指纹和已信任的比对。
///
/// `known` 可以是一把指纹,也可以是多行(每行一把)——一台主机允许同时信任多把
/// 主机密钥,服务端轮换时旧的不必作废。指纹是 "SHA256:" + base64,base64 大小写
/// 有意义 —— 必须逐字节相等;忽略大小写会把两把不同的密钥判成同一把。
pub fn verify_host_key(known: Option<&str>, actual: &str) -> HostKeyVerdict {
    let actual = actual.trim();
    let keys: Vec<&str> = known
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(|k| {
            k.lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if keys.is_empty() {
        HostKeyVerdict::Unknown
    } else if keys.iter().any(|k| *k == actual) {
        HostKeyVerdict::Trusted
    } else {
        HostKeyVerdict::Changed
    }
}

/// 服务端消息(按通道标注,为将来的端口转发复用)。
#[derive(Debug)]
pub enum ServerMsg {
    Data { channel: ChannelId, data: Vec<u8> },
    ExtendedData { channel: ChannelId, data: Vec<u8> },
    Eof { channel: ChannelId },
    Close { channel: ChannelId },
    ExitStatus { channel: ChannelId, status: u32 },
    /// 连接整体断开(网络错误或服务端主动断开):必须让 UI 知道,否则界面会假死。
    Disconnected,
}

/// SSH 错误。
#[derive(Debug)]
pub enum SshError {
    Io(std::io::Error),
    Key(String),
    /// 私钥有口令,但没给口令(或口令不对)。
    KeyEncrypted,
    /// SFTP 操作失败(没有权限、文件不存在、服务器没开 sftp 子系统……),带服务器给的原因。
    Sftp(String),
    /// 用户取消了传输。
    Cancelled,
    AuthFailed,
    /// 连接/认证超时(默认 15 秒),避免 UI 无限"连接中"。
    Timeout,
    /// 本连接已有通道占用事件流(当前每个连接只支持一个通道)。
    ChannelInUse,
    /// 首次见到这台主机的密钥,需要用户确认后再连。
    HostKeyUnknown { fingerprint: String },
    /// 主机密钥与已信任的不一致,连接已拒绝。
    HostKeyChanged { expected: String, actual: String },
    /// 跳板机这一跳失败了(连不上、认证失败、主机密钥不认识 / 变了……),里面是原因。
    ///
    /// 单独包一层:同样是「主机密钥不认识」,是跳板机的还是目标的,界面要存到不同的主机上;
    /// 同样是「认证失败」,用户要去改的也是不同主机的密码。
    Jump(Box<SshError>),
    /// 跳板机登录成功了,但它不肯 / 没能开隧道到目标(目标地址不对、跳板机连不过去、
    /// 服务器关了 `AllowTcpForwarding`)。带跳板机给的原因。
    Tunnel(String),
    /// 端口转发失败(前缀 `forward: `,界面按前缀翻译)。
    Forward(ForwardError),
    Russh(russh::Error),
}

impl fmt::Display for SshError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(err) => write!(f, "io: {err}"),
            Self::Key(err) => write!(f, "key: {err}"),
            Self::KeyEncrypted => write!(f, "private key is encrypted: passphrase missing or wrong"),
            Self::Sftp(err) => write!(f, "sftp: {err}"),
            Self::Cancelled => write!(f, "cancelled"),
            Self::AuthFailed => write!(f, "authentication failed"),
            Self::Timeout => write!(f, "connection timed out"),
            Self::ChannelInUse => write!(f, "connection already has an active channel"),
            Self::HostKeyUnknown { fingerprint } => {
                write!(f, "unknown host key {fingerprint}")
            }
            Self::HostKeyChanged { expected, actual } => {
                write!(f, "host key changed: expected {expected}, got {actual}")
            }
            // 这两句的开头是给宿主认的(Android 按前缀换成中文),别改措辞。
            Self::Jump(inner) => write!(f, "jump host: {inner}"),
            Self::Tunnel(reason) => write!(f, "jump host could not open a tunnel: {reason}"),
            Self::Forward(err) => write!(f, "{err}"),
            Self::Russh(err) => write!(f, "ssh: {err}"),
        }
    }
}

impl std::error::Error for SshError {}

impl From<std::io::Error> for SshError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<ForwardError> for SshError {
    fn from(err: ForwardError) -> Self {
        Self::Forward(err)
    }
}

impl From<russh::Error> for SshError {
    fn from(err: russh::Error) -> Self {
        Self::Russh(err)
    }
}

/// russh 回调 → 消息队列。
struct Handler {
    tx: mpsc::UnboundedSender<ServerMsg>,
    server_key: Arc<Mutex<Option<String>>>,
    /// 已信任的指纹;None 表示首次连接,握手会被拒绝并交给上层确认。
    known_key: Option<String>,
    verdict: Arc<Mutex<Option<HostKeyVerdict>>>,
    /// 终端(shell)通道的编号。只有它的数据和开关事件进消息队列:
    /// 同一条连接上的 SFTP 通道自己读自己的字节流,它的数据要是也进来,二进制会被当成终端输出画上屏,
    /// 它一关闭,终端还会以为自己断了。
    shell_channel: Arc<Mutex<Option<ChannelId>>>,
    /// 远端端口转发(-R):服务器监听端口 → 本机目标。没有对应规则的 forwarded-tcpip 直接拒。
    remote_dests: Arc<Mutex<HashMap<u32, (String, u16)>>>,
}

impl Handler {
    fn is_shell(&self, channel: ChannelId) -> bool {
        self.shell_channel.lock().map(|slot| *slot == Some(channel)).unwrap_or(false)
    }
}

impl client::Handler for Handler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // 只接受已信任的密钥。首次连接与指纹变更都在这里拒绝握手,由 connect()
        // 翻译成带指纹的错误交给 UI 确认 —— 免得默默信任任何服务器。
        let fingerprint = server_key_fingerprint(server_public_key);
        let verdict = verify_host_key(self.known_key.as_deref(), &fingerprint);
        if let Ok(mut slot) = self.server_key.lock() {
            *slot = Some(fingerprint);
        }
        if let Ok(mut slot) = self.verdict.lock() {
            *slot = Some(verdict.clone());
        }
        Ok(verdict == HostKeyVerdict::Trusted)
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if self.is_shell(channel) {
            let _ = self.tx.send(ServerMsg::Data { channel, data: data.to_vec() });
        }
        Ok(())
    }

    async fn extended_data(
        &mut self,
        channel: ChannelId,
        _ext: u32,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if self.is_shell(channel) {
            let _ = self.tx.send(ServerMsg::ExtendedData { channel, data: data.to_vec() });
        }
        Ok(())
    }

    async fn exit_status(
        &mut self,
        channel: ChannelId,
        exit_status: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if self.is_shell(channel) {
            let _ = self.tx.send(ServerMsg::ExitStatus { channel, status: exit_status });
        }
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if self.is_shell(channel) {
            let _ = self.tx.send(ServerMsg::Eof { channel });
        }
        Ok(())
    }

    async fn channel_close(
        &mut self,
        channel: ChannelId,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if self.is_shell(channel) {
            let _ = self.tx.send(ServerMsg::Close { channel });
        }
        Ok(())
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: client::ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let dest = self
            .remote_dests
            .lock()
            .ok()
            .and_then(|m| m.get(&connected_port).cloned());
        let Some((host, port)) = dest else {
            // 丢掉 reply = 拒绝这条通道。
            drop(reply);
            return Ok(());
        };
        reply.accept().await;
        tokio::spawn(async move {
            let mut tcp = match TcpStream::connect((host.as_str(), port)).await {
                Ok(t) => t,
                Err(_) => return,
            };
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await;
        });
        Ok(())
    }

    async fn disconnected(
        &mut self,
        _reason: client::DisconnectReason<Self::Error>,
    ) -> Result<(), Self::Error> {
        let _ = self.tx.send(ServerMsg::Disconnected);
        Ok(())
    }
}

fn server_key_fingerprint(key: &PublicKeyOrCertificate) -> String {
    key.public_key().fingerprint(HashAlg::Sha256).to_string()
}

/// 一跳握手时记下的东西:服务端给了哪个指纹、我们判成了什么。
///
/// 握手被我们自己(`check_server_key` 返回 false)拒掉时,russh 只报一个笼统的错;
/// 靠这份记录翻译成带指纹的具体原因,界面才能让用户比对、确认。
#[derive(Default)]
struct Probe {
    server_key: Arc<Mutex<Option<String>>>,
    verdict: Arc<Mutex<Option<HostKeyVerdict>>>,
}

impl Probe {
    fn handler(
        &self,
        tx: mpsc::UnboundedSender<ServerMsg>,
        known_key: Option<String>,
        shell_channel: Arc<Mutex<Option<ChannelId>>>,
        remote_dests: Arc<Mutex<HashMap<u32, (String, u16)>>>,
    ) -> Handler {
        Handler {
            tx,
            server_key: self.server_key.clone(),
            known_key,
            verdict: self.verdict.clone(),
            shell_channel,
            remote_dests,
        }
    }

    /// 握手走到了服务端亮出主机密钥那一步没有。
    fn saw_key(&self) -> bool {
        self.server_key.lock().map(|slot| slot.is_some()).unwrap_or(false)
    }

    fn fingerprint(&self) -> String {
        self.server_key.lock().ok().and_then(|slot| slot.clone()).unwrap_or_default()
    }

    /// 握手失败的原因:是我们因为主机密钥拒掉的,就换成带指纹的错误;否则原样。
    fn explain(&self, err: SshError, known_key: Option<&str>) -> SshError {
        match self.verdict.lock().ok().and_then(|slot| slot.clone()) {
            Some(HostKeyVerdict::Unknown) => SshError::HostKeyUnknown { fingerprint: self.fingerprint() },
            Some(HostKeyVerdict::Changed) => SshError::HostKeyChanged {
                expected: known_key.unwrap_or_default().to_string(),
                actual: self.fingerprint(),
            },
            _ => err,
        }
    }
}

/// 用 [target] 里的凭据认证一条刚握完手的连接(跳板机和目标共用)。
async fn authenticate(handle: &mut Handle<Handler>, target: &Target) -> Result<(), SshError> {
    let success = match &target.auth {
        Auth::Password(password) => {
            handle.authenticate_password(target.username.clone(), password.as_str()).await?.success()
        }
        Auth::KeyFile { .. } | Auth::KeyData { .. } => {
            let key = match &target.auth {
                Auth::KeyFile { path, passphrase } => {
                    load_secret_key(path, passphrase.as_deref()).map_err(|err| SshError::Key(err.to_string()))?
                }
                Auth::KeyData { pem, passphrase } => parse_private_key(pem, passphrase.as_deref())?,
                Auth::Password(_) => unreachable!(),
            };
            let hash = handle.best_supported_rsa_hash().await?.flatten();
            handle
                .authenticate_publickey(target.username.clone(), PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await?
                .success()
        }
    };
    if success { Ok(()) } else { Err(SshError::AuthFailed) }
}

/// 一条已认证的 SSH 连接。
pub struct Ssh {
    runtime: Arc<tokio::runtime::Runtime>,
    handle: Arc<Handle<Handler>>,
    /// 经跳板机连的话,跳板机那条连接。隧道长在它上面,它一断目标就断 —— 必须和目标活得一样久。
    jump: Option<Handle<Handler>>,
    events: Option<mpsc::UnboundedReceiver<ServerMsg>>,
    server_key: String,
    shell_channel: Arc<Mutex<Option<ChannelId>>>,
    /// 正在跑的端口转发(本机监听 / 远端监听)。断开时全部拆掉。
    forwards: ForwardBook,
}

/// 一条连接上的转发台账。
struct ForwardBook {
    next_id: AtomicU64,
    live: Mutex<HashMap<ForwardId, LiveForward>>,
    remote_dests: Arc<Mutex<HashMap<u32, (String, u16)>>>,
}

struct LiveForward {
    spec: ForwardSpec,
    abort: AbortHandle,
}

impl ForwardBook {
    fn new(remote_dests: Arc<Mutex<HashMap<u32, (String, u16)>>>) -> Self {
        Self {
            next_id: AtomicU64::new(1),
            live: Mutex::new(HashMap::new()),
            remote_dests,
        }
    }

    fn list(&self) -> Vec<ForwardInfo> {
        let live = self.live.lock().unwrap_or_else(|e| e.into_inner());
        let mut out: Vec<_> = live
            .iter()
            .map(|(&id, lf)| ForwardInfo {
                id,
                spec: lf.spec.clone(),
            })
            .collect();
        out.sort_by_key(|i| i.id);
        out
    }

    fn has(&self, mode: ForwardMode, port: u16) -> bool {
        self.live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .any(|lf| lf.spec.mode == mode && lf.spec.local_port == port)
    }
}

impl Ssh {
    /// 连接并完成认证(阻塞直到握手与认证结束)。设了 [`Target::jump`] 就先连跳板机、再经它的隧道连目标。
    pub fn connect(target: &Target) -> Result<Self, SshError> {
        let runtime = Arc::new(
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .thread_name("xssh-net")
                .build()?,
        );

        let (tx, rx) = mpsc::unbounded_channel();

        let config = Arc::new(client::Config {
            inactivity_timeout: None,
            // 15s 一次、连丢 2 次判死:死连接 30~45s 内就会报出来(原来 30s×3 要 90s)。
            // 手机上 TCP 悄悄断掉是常态,早一点知道,界面就早一点能重连。
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 2,
            ..Default::default()
        });

        let shell_channel = Arc::new(Mutex::new(None));
        let probe = Probe::default();
        let jump_probe = Probe::default();

        let connected = runtime.block_on(async {
            // 第一跳:跳板机。它的 Handler 和目标**共用一个消息队列** —— 跳板机断了,隧道随之断,
            // 终端要立刻收到 `Disconnected` 好去重连,而不是等目标那头的心跳慢慢超时。
            // 它不登记终端通道,所以隧道里的字节不会被当成终端输出(那些字节走隧道自己的流)。
            let jump = match target.jump.as_deref() {
                None => None,
                Some(hop) => {
                    let handler = jump_probe.handler(
                        tx.clone(),
                        hop.known_key.clone(),
                        Arc::new(Mutex::new(None)),
                        Arc::new(Mutex::new(HashMap::new())),
                    );
                    let reached = tokio::time::timeout(CONNECT_TIMEOUT, async {
                        let mut handle = client::connect(config.clone(), (hop.host.as_str(), hop.port), handler).await?;
                        authenticate(&mut handle, hop).await?;
                        Ok::<_, SshError>(handle)
                    })
                    .await
                    .unwrap_or(Err(SshError::Timeout));
                    let handle = reached
                        .map_err(|err| SshError::Jump(Box::new(jump_probe.explain(err, hop.known_key.as_deref()))))?;
                    Some(handle)
                }
            };

            let remote_dests: Arc<Mutex<HashMap<u32, (String, u16)>>> =
                Arc::new(Mutex::new(HashMap::new()));
            let handler = probe.handler(
                tx,
                target.known_key.clone(),
                shell_channel.clone(),
                remote_dests.clone(),
            );
            let reached = tokio::time::timeout(CONNECT_TIMEOUT, async {
                let mut handle = match &jump {
                    None => client::connect(config, (target.host.as_str(), target.port), handler).await?,
                    Some(jump) => {
                        // 发起方地址填什么都行(服务器只拿来记日志),OpenSSH 的 ProxyJump 也是这么填的。
                        let channel = jump
                            .channel_open_direct_tcpip(target.host.clone(), u32::from(target.port), "127.0.0.1", 0)
                            .await
                            .map_err(|err| SshError::Tunnel(err.to_string()))?;
                        client::connect_stream(config, channel.into_stream(), handler).await?
                    }
                };
                authenticate(&mut handle, target).await?;
                Ok::<_, SshError>(handle)
            })
            .await
            .unwrap_or(Err(SshError::Timeout))
            .map_err(|err| match err {
                // 经跳板机时,目标还没亮出主机密钥连接就断了:隧道那头根本没有 SSH 服务
                // (端口不对、目标没开机)。有的服务器(Windows 的 OpenSSH)会先答应开隧道、
                // 连不过去再关掉,报出来的只是一句「对方断开」—— 要说清楚是隧道没通。
                SshError::Russh(_) | SshError::Io(_) if jump.is_some() && !probe.saw_key() => {
                    SshError::Tunnel(format!("closed before the server answered ({err})"))
                }
                err => probe.explain(err, target.known_key.as_deref()),
            });

            match reached {
                Ok(handle) => Ok((handle, jump, remote_dests)),
                Err(err) => {
                    // 跳板机连上了、目标没连上:跳板机那条别漏在外面。
                    if let Some(jump) = jump {
                        let _ = tokio::time::timeout(
                            Duration::from_secs(3),
                            jump.disconnect(russh::Disconnect::ByApplication, "", "en"),
                        )
                        .await;
                    }
                    Err(err)
                }
            }
        });
        let (handle, jump, remote_dests) = connected?;

        Ok(Self {
            runtime,
            handle: Arc::new(handle),
            jump,
            events: Some(rx),
            server_key: probe.fingerprint(),
            shell_channel,
            forwards: ForwardBook::new(remote_dests),
        })
    }

    /// 在这条连接上再开一个 SFTP 通道(不影响终端)。服务器没开 sftp 子系统时报错。
    pub fn open_sftp(&self) -> Result<crate::sftp::Sftp, SshError> {
        let session = self.runtime.block_on(async {
            tokio::time::timeout(STEP_TIMEOUT, async {
                let channel = self.handle.channel_open_session().await?;
                channel.request_subsystem(true, "sftp").await?;
                russh_sftp::client::SftpSession::new(channel.into_stream())
                    .await
                    .map_err(|err| SshError::Sftp(err.to_string()))
            })
            .await
        });
        let session = session.map_err(|_| SshError::Timeout)??;
        Ok(crate::sftp::Sftp::new(self.runtime.clone(), session))
    }

    /// 服务端主机密钥指纹(SHA256)。
    pub fn server_key(&self) -> &str {
        &self.server_key
    }

    /// 打开交互式 PTY shell。
    pub fn open_shell(&mut self, cols: u16, rows: u16, term: &str) -> Result<Shell, SshError> {
        self.open_channel(cols, rows, term, None)
    }

    /// 打开 PTY 并执行命令(脚本式,不进入交互 shell)。
    pub fn open_exec(
        &mut self,
        cols: u16,
        rows: u16,
        term: &str,
        command: &str,
    ) -> Result<Shell, SshError> {
        self.open_channel(cols, rows, term, Some(command))
    }

    fn open_channel(
        &mut self,
        cols: u16,
        rows: u16,
        term: &str,
        command: Option<&str>,
    ) -> Result<Shell, SshError> {
        let events = self.events.take().ok_or(SshError::ChannelInUse)?;
        let shell_channel = self.shell_channel.clone();
        let channel = self.runtime.block_on(async {
            tokio::time::timeout(STEP_TIMEOUT, async {
                let channel = self.handle.channel_open_session().await?;
                // 通道一开就登记成"终端的"——必须在请求 shell **之前**。Handler 只转发登记过的通道,
                // 服务端在应答 shell 请求后紧跟着就发欢迎语和第一个提示符;等 request_shell 返回再登记的话,
                // 这几段数据到的时候通道还没登记,会被当成别的通道(SFTP)的数据丢掉,终端开出来是空的。
                if let Ok(mut slot) = shell_channel.lock() {
                    *slot = Some(channel.id());
                }
                channel.request_pty(false, term, cols as u32, rows as u32, 0, 0, &[]).await?;
                match command {
                    Some(command) => channel.exec(false, command).await?,
                    None => channel.request_shell(false).await?,
                }
                Ok::<_, russh::Error>(channel)
            })
            .await
        });
        let channel = match channel {
            // 失败路径必须把 events 放回去:连接本身还活着,丢了它之后每次
            // open_channel 都是 ChannelInUse,这条连接就废了。(已打开的
            // channel 随 drop 留给服务端按通道超时收尾。)
            Ok(Ok(c)) => c,
            Ok(Err(e)) => {
                self.events = Some(events);
                return Err(e.into());
            }
            Err(_) => {
                self.events = Some(events);
                return Err(SshError::Timeout);
            }
        };


        // russh 收到通道数据时,先 `send().await` 塞进通道**自己的**消息队列(容量
        // channel_buffer_size,默认 100),然后才调我们 Handler 的回调。我们只用回调,
        // 从不读那个队列 —— 第 100 条消息之后 send 就永远等下去,russh 的会话循环整个卡住:
        // 收不到数据、发不出按键、保活和断开也都处理不了。
        //
        // 实测:Codex 恢复历史会话,输出正好在第 99 条停住,输入框再也画不出来;
        // 本机连敲 400 个字符,写到一百多个时超时。平时 shell 里每一次回显、每一段输出
        // 都是一条消息,所以**任何会话**用上一阵子都会冻住 —— "连过几次就卡住"也是它。
        //
        // 拆成读写两半,读的那一半交给后台任务一直读空(内容丢掉,数据走回调那条路)。
        let (mut reader, writer) = channel.split();
        self.runtime.spawn(async move { while reader.wait().await.is_some() {} });

        Ok(Shell { runtime: self.runtime.handle().clone(), channel: writer, events })
    }

    /// 开一条端口转发(本机 / 远端 / SOCKS)。失败不伤终端通道。
    pub fn add_forward(&self, spec: ForwardSpec) -> Result<ForwardInfo, SshError> {
        validate_spec(&spec)?;
        if self.forwards.has(spec.mode, spec.local_port) {
            return Err(ForwardError::Already {
                port: spec.local_port,
            }
            .into());
        }
        let id = self.forwards.next_id.fetch_add(1, Ordering::Relaxed);
        let abort = match spec.mode {
            ForwardMode::Local => self.spawn_local_listener(&spec)?,
            ForwardMode::Dynamic => self.spawn_dynamic_listener(spec.local_port)?,
            ForwardMode::Remote => self.start_remote_forward(&spec)?,
        };
        let info = ForwardInfo {
            id,
            spec: spec.clone(),
        };
        self.forwards
            .live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, LiveForward { spec, abort });
        Ok(info)
    }

    /// 按编号拆掉一条转发。
    pub fn remove_forward(&self, id: ForwardId) -> Result<(), SshError> {
        let lf = self
            .forwards
            .live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id)
            .ok_or(ForwardError::NotFound { id })?;
        lf.abort.abort();
        if lf.spec.mode == ForwardMode::Remote {
            let port = u32::from(lf.spec.local_port);
            if let Ok(mut map) = self.forwards.remote_dests.lock() {
                map.remove(&port);
            }
            let handle = self.handle.clone();
            let _ = self.runtime.block_on(async {
                let _ = handle.cancel_tcpip_forward("127.0.0.1", port).await;
            });
        }
        Ok(())
    }

    /// 当前这条连接上开着的转发。
    pub fn forwards(&self) -> Vec<ForwardInfo> {
        self.forwards.list()
    }

    /// 拆掉全部转发(断开前调用)。
    pub fn close_all_forwards(&self) {
        let mut live = self.forwards.live.lock().unwrap_or_else(|e| e.into_inner());
        for (_, lf) in live.drain() {
            lf.abort.abort();
            if lf.spec.mode == ForwardMode::Remote {
                let port = u32::from(lf.spec.local_port);
                if let Ok(mut map) = self.forwards.remote_dests.lock() {
                    map.remove(&port);
                }
                let handle = self.handle.clone();
                let _ = self.runtime.block_on(async {
                    let _ = handle.cancel_tcpip_forward("127.0.0.1", port).await;
                });
            }
        }
    }

    fn spawn_local_listener(&self, spec: &ForwardSpec) -> Result<AbortHandle, SshError> {
        let listener = self.runtime.block_on(bind_local(spec.local_port))?;
        let handle = self.handle.clone();
        let dest = dest_host(&spec.remote_host).to_string();
        let dest_port = u32::from(spec.remote_port);
        let origin = u32::from(spec.local_port);
        let join = self.runtime.spawn(async move {
            loop {
                let Ok((tcp, _)) = listener.accept().await else { break };
                let handle = handle.clone();
                let dest = dest.clone();
                tokio::spawn(async move {
                    let _ = pipe_direct(handle, tcp, dest, dest_port, origin).await;
                });
            }
        });
        Ok(join.abort_handle())
    }

    fn spawn_dynamic_listener(&self, local_port: u16) -> Result<AbortHandle, SshError> {
        let listener = self.runtime.block_on(bind_local(local_port))?;
        let handle = self.handle.clone();
        let join = self.runtime.spawn(async move {
            loop {
                let Ok((tcp, _)) = listener.accept().await else { break };
                let handle = handle.clone();
                tokio::spawn(async move {
                    let _ = pipe_socks(handle, tcp).await;
                });
            }
        });
        Ok(join.abort_handle())
    }

    fn start_remote_forward(&self, spec: &ForwardSpec) -> Result<AbortHandle, SshError> {
        let port = u32::from(spec.local_port);
        let handle = self.handle.clone();
        self.runtime
            .block_on(async {
                handle
                    .tcpip_forward("127.0.0.1", port)
                    .await
                    .map_err(|e| ForwardError::Denied {
                        reason: e.to_string(),
                    })
            })?;
        let dest = (
            dest_host(&spec.remote_host).to_string(),
            spec.remote_port,
        );
        if let Ok(mut map) = self.forwards.remote_dests.lock() {
            map.insert(port, dest);
        }
        let handle = self.handle.clone();
        let dests = self.forwards.remote_dests.clone();
        let join = self.runtime.spawn(async move {
            std::future::pending::<()>().await;
            let _ = handle.cancel_tcpip_forward("127.0.0.1", port).await;
            if let Ok(mut map) = dests.lock() {
                map.remove(&port);
            }
        });
        Ok(join.abort_handle())
    }

    /// 断开连接。
    pub fn disconnect(&self) {
        self.close_all_forwards();
        // 死连接上断开可能等不到回音;最多等 3 秒,别把调用方(会话收尾)卡住。
        // 计时器必须在 async 块**里面**构造:写成 block_on 的参数的话,它在进入运行时
        // 之前就被求值,tokio 找不到当前运行时直接 panic("no reactor running")。
        self.runtime.block_on(async {
            let _ = tokio::time::timeout(
                Duration::from_secs(3),
                self.handle.disconnect(russh::Disconnect::ByApplication, "", "en"),
            )
            .await;
            // 目标先断、跳板机后断:反过来的话目标的断开消息走不出去(隧道已经没了)。
            if let Some(jump) = &self.jump {
                let _ = tokio::time::timeout(
                    Duration::from_secs(3),
                    jump.disconnect(russh::Disconnect::ByApplication, "", "en"),
                )
                .await;
            }
        });
    }
}

async fn bind_local(port: u16) -> Result<TcpListener, SshError> {
    TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                SshError::from(ForwardError::PortInUse { port })
            } else {
                SshError::Io(e)
            }
        })
}

async fn pipe_direct(
    handle: Arc<Handle<Handler>>,
    mut tcp: TcpStream,
    dest_host: String,
    dest_port: u32,
    origin_port: u32,
) -> Result<(), ()> {
    let channel = handle
        .channel_open_direct_tcpip(dest_host, dest_port, "127.0.0.1", origin_port)
        .await
        .map_err(|_| ())?;
    let mut stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await;
    Ok(())
}

async fn pipe_socks(handle: Arc<Handle<Handler>>, mut tcp: TcpStream) -> Result<(), ()> {
    let mut buf = Vec::with_capacity(64);
    loop {
        let mut tmp = [0u8; 64];
        let n = tcp.read(&mut tmp).await.map_err(|_| ())?;
        if n == 0 {
            return Err(());
        }
        buf.extend_from_slice(&tmp[..n]);
        match socks5_greeting(&buf) {
            None => continue,
            Some(Err(_)) => {
                let _ = tcp.write_all(&[0x05, 0xFF]).await;
                return Err(());
            }
            Some(Ok(reply)) => {
                tcp.write_all(&reply).await.map_err(|_| ())?;
                let len = socks5_greeting_len(&buf).unwrap_or(buf.len());
                buf.drain(..len.min(buf.len()));
                break;
            }
        }
    }
    let (host, port) = loop {
        match socks5_parse_connect(&buf) {
            Ok(None) => {
                let mut tmp = [0u8; 256];
                let n = tcp.read(&mut tmp).await.map_err(|_| ())?;
                if n == 0 {
                    return Err(());
                }
                buf.extend_from_slice(&tmp[..n]);
            }
            Ok(Some(target)) => break target,
            Err(SocksErr::BadCommand) => {
                let _ = tcp.write_all(&socks5_fail_reply(0x07)).await;
                return Err(());
            }
            Err(_) => {
                let _ = tcp.write_all(&socks5_fail_reply(0x01)).await;
                return Err(());
            }
        }
    };
    let channel = match handle
        .channel_open_direct_tcpip(host, u32::from(port), "127.0.0.1", 0)
        .await
    {
        Ok(c) => c,
        Err(_) => {
            let _ = tcp.write_all(&socks5_fail_reply(0x05)).await;
            return Err(());
        }
    };
    tcp.write_all(&socks5_success_reply()).await.map_err(|_| ())?;
    let mut stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await;
    Ok(())
}

impl Drop for Ssh {
    fn drop(&mut self) {
        // 只 abort 监听任务、清表;不再 block_on(取消远端转发) ——
        // Drop 时运行时可能正在拆,block_on 会恐慌。disconnect() 里会做完整清理。
        let mut live = self.forwards.live.lock().unwrap_or_else(|e| e.into_inner());
        for (_, lf) in live.drain() {
            lf.abort.abort();
        }
        if let Ok(mut map) = self.forwards.remote_dests.lock() {
            map.clear();
        }
    }
}

/// 一个已开启的通道(shell 或 exec)。
pub struct Shell {
    runtime: tokio::runtime::Handle,
    channel: russh::ChannelWriteHalf<client::Msg>,
    events: mpsc::UnboundedReceiver<ServerMsg>,
}

impl Shell {
    /// 发送按键/粘贴数据。
    pub fn write(&self, bytes: &[u8]) -> Result<(), SshError> {
        // 通道窗口用完、连接又断了时 data() 会一直等窗口调整;而调用方拿着通道锁,
        // 轮询也跟着停住 —— 整个会话看起来就是"卡死"。
        self.runtime
            .block_on(async { tokio::time::timeout(STEP_TIMEOUT, self.channel.data(bytes)).await })
            .map_err(|_| SshError::Timeout)??;
        Ok(())
    }

    /// 通知远端窗口尺寸变化。
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), SshError> {
        self.runtime
            .block_on(async {
                tokio::time::timeout(
                    STEP_TIMEOUT,
                    self.channel.window_change(cols as u32, rows as u32, 0, 0),
                )
                .await
            })
            .map_err(|_| SshError::Timeout)??;
        Ok(())
    }

    /// 非阻塞取一条服务端消息。
    pub fn poll_msg(&mut self) -> Option<ServerMsg> {
        self.events.try_recv().ok()
    }

    /// 半关闭(发送 EOF)。
    pub fn eof(&self) -> Result<(), SshError> {
        // 与 write/resize 同一套纪律:死连接上 socket 写缓冲塞满时,russh 的
        // 会话循环会卡在 flush_into 上,不加超时这里就永久等下去。
        self.runtime
            .block_on(async { tokio::time::timeout(STEP_TIMEOUT, self.channel.eof()).await })
            .map_err(|_| SshError::Timeout)??;
        Ok(())
    }

    /// 关闭通道。
    pub fn close(&self) -> Result<(), SshError> {
        self.runtime
            .block_on(async { tokio::time::timeout(STEP_TIMEOUT, self.channel.close()).await })
            .map_err(|_| SshError::Timeout)??;
        Ok(())
    }
}


#[cfg(test)]
mod tests {
    use super::{inspect_private_key, verify_host_key, HostKeyVerdict, SshError};

    // 测试专用的一次性密钥(只在这里用过,没有放到任何服务器上)。
    const PLAIN_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACCOX2TFjJykQB49AejSPEeullPCXMVB4mc8zLbdJvhvMQAAAIhbIKMUWyCj
FAAAAAtzc2gtZWQyNTUxOQAAACCOX2TFjJykQB49AejSPEeullPCXMVB4mc8zLbdJvhvMQ
AAAEC06P+Sjh3min4ldSJ4NYv63RUZW7flHDaFAQ1EoCk/o45fZMWMnKRAHj0B6NI8R66W
U8JcxUHiZzzMtt0m+G8xAAAABHRlc3QB
-----END OPENSSH PRIVATE KEY-----
";
    /// 口令是 `pw123`。
    const LOCKED_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABBS7uy2Hu
SMRFX1PEQPdh5cAAAAGAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIK39PcJJEL5bcoKH
UfSQb2YF8rVWuqbsMyMKdNWytQSjAAAAkHYjEG+65bWqDjbRpm5f1vZHRe2RLH0l9j0jcW
541GvfuIZjACmp6Xs0hGhe0Kn2tjexjJDpy+GnbH8c2XgXpDP5oS9EL7ARNPPazjEmlzyh
D0CIHjyFdamhF+XZuRgVSXjyKe3N8K8+jDEwyp+xSLG1Mr5FonHy5fshcN6U0rJZnHz2+N
H+1bWL3HrzyeMpLQ==
-----END OPENSSH PRIVATE KEY-----
";

    #[test]
    fn inspects_an_unencrypted_key() {
        let info = inspect_private_key(PLAIN_KEY, None).expect("应能解析");
        assert_eq!(info.algorithm, "ssh-ed25519");
        // 和 `ssh-keygen -lf plain.pub` 的输出一致。
        assert_eq!(info.fingerprint, "SHA256:Jj0HIeewaSgaFIpQEShYu53Wc3w6AdkjDBaPhhhj68E");
        assert!(info.public_key.starts_with("ssh-ed25519 AAAA"));
    }

    #[test]
    fn encrypted_key_needs_the_passphrase() {
        assert!(matches!(inspect_private_key(LOCKED_KEY, None), Err(SshError::KeyEncrypted)));
        assert!(matches!(inspect_private_key(LOCKED_KEY, Some("")), Err(SshError::KeyEncrypted)));
        assert!(matches!(inspect_private_key(LOCKED_KEY, Some("wrong")), Err(SshError::KeyEncrypted)));
        let info = inspect_private_key(LOCKED_KEY, Some("pw123")).expect("口令正确应能解开");
        assert_eq!(info.algorithm, "ssh-ed25519");
    }

    #[test]
    fn generated_key_round_trips() {
        let plain = super::generate_ed25519("xssh@pad", None).expect("生成");
        assert!(plain.pem.contains("BEGIN OPENSSH PRIVATE KEY"));
        assert!(plain.info.public_key.starts_with("ssh-ed25519 ") && plain.info.public_key.ends_with("xssh@pad"));
        // 生成出来的私钥自己能解开,指纹一致。
        let again = inspect_private_key(&plain.pem, None).expect("能解析");
        assert_eq!(again.fingerprint, plain.info.fingerprint);

        let locked = super::generate_ed25519("xssh@pad", Some("secret")).expect("生成带口令的");
        assert!(matches!(inspect_private_key(&locked.pem, None), Err(SshError::KeyEncrypted)));
        let opened = inspect_private_key(&locked.pem, Some("secret")).expect("口令能解开");
        assert_eq!(opened.fingerprint, locked.info.fingerprint);
        // 两次生成的不是同一把钥匙。
        assert_ne!(plain.info.fingerprint, locked.info.fingerprint);
    }

    #[test]
    fn garbage_is_not_a_key() {
        assert!(matches!(inspect_private_key("hello", None), Err(SshError::Key(_))));
        // 公钥不是私钥。
        assert!(matches!(
            inspect_private_key("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII5fZMWMnKRAHj0B6NI8R66WU8JcxUHiZzzMtt0m+G8x test", None),
            Err(SshError::Key(_))
        ));
    }

    #[test]
    fn first_connection_is_unknown() {
        assert_eq!(verify_host_key(None, "SHA256:aaa"), HostKeyVerdict::Unknown);
        // 空字符串等同于"没存过",别把它当成一个要比对的指纹。
        assert_eq!(verify_host_key(Some(""), "SHA256:aaa"), HostKeyVerdict::Unknown);
        assert_eq!(verify_host_key(Some("  "), "SHA256:aaa"), HostKeyVerdict::Unknown);
    }

    #[test]
    fn same_fingerprint_is_trusted() {
        assert_eq!(verify_host_key(Some("SHA256:aaa"), "SHA256:aaa"), HostKeyVerdict::Trusted);
        // 只忽略首尾空白(存取时容易混进来),内容本身一个字符都不能差。
        assert_eq!(
            verify_host_key(Some(" SHA256:aaa "), "SHA256:aaa
"),
            HostKeyVerdict::Trusted
        );
        // base64 是大小写敏感的:换了大小写就是另一把密钥。
        assert_eq!(
            verify_host_key(Some("SHA256:aaa"), "SHA256:AAA"),
            HostKeyVerdict::Changed
        );
    }

    #[test]
    fn different_fingerprint_is_a_change() {
        assert_eq!(verify_host_key(Some("SHA256:aaa"), "SHA256:bbb"), HostKeyVerdict::Changed);
        // 前缀相同也不算通过。
        assert_eq!(verify_host_key(Some("SHA256:aaa"), "SHA256:aaab"), HostKeyVerdict::Changed);
    }

    #[test]
    fn any_of_several_trusted_keys_is_accepted() {
        let known = "SHA256:aaa\nSHA256:bbb\nSHA256:ccc";
        assert_eq!(verify_host_key(Some(known), "SHA256:bbb"), HostKeyVerdict::Trusted);
        assert_eq!(verify_host_key(Some(known), "SHA256:aaa"), HostKeyVerdict::Trusted);
        assert_eq!(verify_host_key(Some(known), "SHA256:zzz"), HostKeyVerdict::Changed);
        // 空行 / 首尾空白不影响。
        let spaced = "  SHA256:aaa  \n\n  SHA256:bbb  ";
        assert_eq!(verify_host_key(Some(spaced), "SHA256:bbb"), HostKeyVerdict::Trusted);
    }
}