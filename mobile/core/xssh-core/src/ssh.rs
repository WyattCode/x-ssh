//! SSH 会话:连接、认证、PTY/命令通道。
//!
//! 设计:核心自己持有 tokio 运行时,对外暴露同步 API(移动端 UI / uniffi 直接调用),
//! 服务端消息通过 [`Shell::poll_msg`] 拉取;输出字节喂给 [`crate::terminal::Terminal`] 上屏,
//! 终端应答([`crate::terminal::TerminalEvent::Write`])写回 [`Shell::write`]。

use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::ChannelId;
use tokio::sync::mpsc;

/// 连接 + 认证总超时。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// 认证方式。
#[derive(Debug, Clone)]
pub enum Auth {
    /// 密码认证。
    Password(String),
    /// 私钥文件认证(可带口令)。
    KeyFile { path: PathBuf, passphrase: Option<String> },
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

/// 纯函数:拿实际指纹和已信任的比对。指纹比较不区分大小写与首尾空白。
pub fn verify_host_key(known: Option<&str>, actual: &str) -> HostKeyVerdict {
    match known.map(str::trim).filter(|k| !k.is_empty()) {
        None => HostKeyVerdict::Unknown,
        // 指纹是 "SHA256:" + base64,base64 大小写有意义 —— 必须逐字节相等。
        // 忽略大小写会让两把不同的密钥被判成同一把,是白送出去的安全余量。
        Some(known) if known == actual.trim() => HostKeyVerdict::Trusted,
        Some(_) => HostKeyVerdict::Changed,
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
    AuthFailed,
    /// 连接/认证超时(默认 15 秒),避免 UI 无限"连接中"。
    Timeout,
    /// 本连接已有通道占用事件流(当前每个连接只支持一个通道)。
    ChannelInUse,
    /// 首次见到这台主机的密钥,需要用户确认后再连。
    HostKeyUnknown { fingerprint: String },
    /// 主机密钥与已信任的不一致,连接已拒绝。
    HostKeyChanged { expected: String, actual: String },
    Russh(russh::Error),
}

impl fmt::Display for SshError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(err) => write!(f, "io: {err}"),
            Self::Key(err) => write!(f, "key: {err}"),
            Self::AuthFailed => write!(f, "authentication failed"),
            Self::Timeout => write!(f, "connection timed out"),
            Self::ChannelInUse => write!(f, "connection already has an active channel"),
            Self::HostKeyUnknown { fingerprint } => {
                write!(f, "unknown host key {fingerprint}")
            }
            Self::HostKeyChanged { expected, actual } => {
                write!(f, "host key changed: expected {expected}, got {actual}")
            }
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
        let _ = self.tx.send(ServerMsg::Data { channel, data: data.to_vec() });
        Ok(())
    }

    async fn extended_data(
        &mut self,
        channel: ChannelId,
        _ext: u32,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let _ = self.tx.send(ServerMsg::ExtendedData { channel, data: data.to_vec() });
        Ok(())
    }

    async fn exit_status(
        &mut self,
        channel: ChannelId,
        exit_status: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let _ = self.tx.send(ServerMsg::ExitStatus { channel, status: exit_status });
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let _ = self.tx.send(ServerMsg::Eof { channel });
        Ok(())
    }

    async fn channel_close(
        &mut self,
        channel: ChannelId,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let _ = self.tx.send(ServerMsg::Close { channel });
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

/// 一条已认证的 SSH 连接。
pub struct Ssh {
    runtime: Arc<tokio::runtime::Runtime>,
    handle: Handle<Handler>,
    events: Option<mpsc::UnboundedReceiver<ServerMsg>>,
    server_key: String,
}

impl Ssh {
    /// 连接并完成认证(阻塞直到握手与认证结束)。
    pub fn connect(target: &Target) -> Result<Self, SshError> {
        let runtime = Arc::new(
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .thread_name("xssh-net")
                .build()?,
        );

        let (tx, rx) = mpsc::unbounded_channel();
        let server_key = Arc::new(Mutex::new(None));
        let verdict = Arc::new(Mutex::new(None));

        let config = Arc::new(client::Config {
            inactivity_timeout: None,
            keepalive_interval: Some(Duration::from_secs(30)),
            keepalive_max: 3,
            ..Default::default()
        });

        let handler = Handler {
            tx,
            server_key: server_key.clone(),
            known_key: target.known_key.clone(),
            verdict: verdict.clone(),
        };
        let handle = runtime.block_on(async {
            tokio::time::timeout(CONNECT_TIMEOUT, async {
                let mut handle =
                    client::connect(config, (target.host.as_str(), target.port), handler).await?;

                let success = match &target.auth {
                    Auth::Password(password) => {
                        handle
                            .authenticate_password(target.username.clone(), password.as_str())
                            .await?
                            .success()
                    }
                    Auth::KeyFile { path, passphrase } => {
                        let key = load_secret_key(path, passphrase.as_deref())
                            .map_err(|err| SshError::Key(err.to_string()))?;
                        let hash = handle.best_supported_rsa_hash().await?.flatten();
                        handle
                            .authenticate_publickey(
                                target.username.clone(),
                                PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                            )
                            .await?
                            .success()
                    }
                };

                if !success {
                    return Err(SshError::AuthFailed);
                }
            Ok::<Handle<Handler>, SshError>(handle)
            })
            .await
            .map_err(|_| SshError::Timeout)?
        });

        let fingerprint = server_key.lock().ok().and_then(|slot| slot.clone()).unwrap_or_default();
        // 握手被我们自己拒掉时,russh 只会报一个笼统的错;换成带指纹的具体原因。
        let handle = match handle {
            Ok(handle) => handle,
            Err(err) => {
                let verdict = verdict.lock().ok().and_then(|slot| slot.clone());
                return Err(match verdict {
                    Some(HostKeyVerdict::Unknown) => {
                        SshError::HostKeyUnknown { fingerprint }
                    }
                    Some(HostKeyVerdict::Changed) => SshError::HostKeyChanged {
                        expected: target.known_key.clone().unwrap_or_default(),
                        actual: fingerprint,
                    },
                    _ => err,
                });
            }
        };

        Ok(Self { runtime, handle, events: Some(rx), server_key: fingerprint })
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
        let channel = self.runtime.block_on(async {
            let channel = self.handle.channel_open_session().await?;
            channel.request_pty(false, term, cols as u32, rows as u32, 0, 0, &[]).await?;
            match command {
                Some(command) => channel.exec(false, command).await?,
                None => channel.request_shell(false).await?,
            }
            Ok::<_, russh::Error>(channel)
        })?;
        Ok(Shell { runtime: self.runtime.handle().clone(), channel, events })
    }

    /// 断开连接。
    pub fn disconnect(&self) {
        let _ = self.runtime.block_on(self.handle.disconnect(
            russh::Disconnect::ByApplication,
            "",
            "en",
        ));
    }
}

/// 一个已开启的通道(shell 或 exec)。
pub struct Shell {
    runtime: tokio::runtime::Handle,
    channel: russh::Channel<client::Msg>,
    events: mpsc::UnboundedReceiver<ServerMsg>,
}

impl Shell {
    /// 发送按键/粘贴数据。
    pub fn write(&self, bytes: &[u8]) -> Result<(), SshError> {
        self.runtime.block_on(self.channel.data(bytes))?;
        Ok(())
    }

    /// 通知远端窗口尺寸变化。
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), SshError> {
        self.runtime.block_on(self.channel.window_change(
            cols as u32,
            rows as u32,
            0,
            0,
        ))?;
        Ok(())
    }

    /// 非阻塞取一条服务端消息。
    pub fn poll_msg(&mut self) -> Option<ServerMsg> {
        self.events.try_recv().ok()
    }

    /// 半关闭(发送 EOF)。
    pub fn eof(&self) -> Result<(), SshError> {
        self.runtime.block_on(self.channel.eof())?;
        Ok(())
    }

    /// 关闭通道。
    pub fn close(&self) -> Result<(), SshError> {
        self.runtime.block_on(self.channel.close())?;
        Ok(())
    }
}


#[cfg(test)]
mod tests {
    use super::{verify_host_key, HostKeyVerdict};

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
}
