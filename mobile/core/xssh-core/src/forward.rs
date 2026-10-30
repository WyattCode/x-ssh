//! 端口转发:本机监听(-L)、远端监听(-R)、本机 SOCKS5(-D)。
//!
//! 规则挂在已认证的 [`crate::ssh::Ssh`] 上;断开时一并拆掉。监听只绑 `127.0.0.1`,
//! 不对外网口开放。SOCKS 握手的纯函数放这里,方便不连网也能单测。

use std::fmt;
use std::net::{Ipv4Addr, Ipv6Addr};

/// 转发方式(和桌面版 `ForwardMode` 一致)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ForwardMode {
    /// 本机监听 → 经 SSH 连到服务器视角的地址(-L)。
    Local,
    /// 服务器监听 → 连回本机地址(-R)。
    Remote,
    /// 本机 SOCKS5 代理(-D)。
    Dynamic,
}

/// 一条要开的转发规则。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForwardSpec {
    pub mode: ForwardMode,
    /// Local/Dynamic:本机监听端口。Remote:服务器监听端口。
    pub local_port: u16,
    /// Local:服务器视角的目标主机(空 = `127.0.0.1`)。
    /// Remote:本机目标主机(空 = `127.0.0.1`)。Dynamic:不用。
    pub remote_host: String,
    /// Local/Remote 的目标端口。Dynamic:不用(写 0)。
    pub remote_port: u16,
}

/// 运行中规则的编号(同一次连接内单调递增;重连后重新从 1 起)。
pub type ForwardId = u64;

/// 一条已开着的转发(给界面列出来)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForwardInfo {
    pub id: ForwardId,
    pub spec: ForwardSpec,
}

/// 空主机名按 OpenSSH / 桌面版惯例当成回环。
pub fn dest_host(host: &str) -> &str {
    if host.trim().is_empty() {
        "127.0.0.1"
    } else {
        host.trim()
    }
}

/// 端口合法性(不查是否已被占用 —— 那要真去 bind)。
pub fn validate_spec(spec: &ForwardSpec) -> Result<(), ForwardError> {
    if spec.local_port == 0 {
        return Err(ForwardError::BadPort);
    }
    match spec.mode {
        ForwardMode::Local | ForwardMode::Remote if spec.remote_port == 0 => Err(ForwardError::BadPort),
        _ => Ok(()),
    }
}

/// 同一连接内判重用的键:`mode:localPort`(和桌面版一致)。
pub fn forward_key(mode: ForwardMode, local_port: u16) -> String {
    let tag = match mode {
        ForwardMode::Local => "local",
        ForwardMode::Remote => "remote",
        ForwardMode::Dynamic => "dynamic",
    };
    format!("{tag}:{local_port}")
}

/// 转发层自己的错误(再由 `SshError` 包一层带稳定前缀的 Display)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForwardError {
    BadPort,
    PortInUse { port: u16 },
    Already { port: u16 },
    Denied { reason: String },
    NotFound { id: ForwardId },
}

impl fmt::Display for ForwardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BadPort => write!(f, "forward: bad port"),
            Self::PortInUse { port } => write!(f, "forward: port in use: {port}"),
            Self::Already { port } => write!(f, "forward: already forwarding: {port}"),
            Self::Denied { reason } => write!(f, "forward: denied: {reason}"),
            Self::NotFound { id } => write!(f, "forward: not found: {id}"),
        }
    }
}

impl std::error::Error for ForwardError {}

/// SOCKS5 握手解析失败。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SocksErr {
    BadVersion,
    NoAcceptableMethod,
    BadCommand,
    BadAddressType,
    Truncated,
}

/// 读到完整 greeting 时返回要写回客户端的两个字节;字节不够返回 `None`。
pub fn socks5_greeting(buf: &[u8]) -> Option<Result<[u8; 2], SocksErr>> {
    if buf.len() < 2 {
        return None;
    }
    if buf[0] != 0x05 {
        return Some(Err(SocksErr::BadVersion));
    }
    let nmethods = buf[1] as usize;
    if buf.len() < 2 + nmethods {
        return None;
    }
    let methods = &buf[2..2 + nmethods];
    if methods.iter().any(|&m| m == 0x00) {
        Some(Ok([0x05, 0x00]))
    } else {
        Some(Err(SocksErr::NoAcceptableMethod))
    }
}

/// greeting 占用的字节数(VER + NMETHODS + METHODS)。不够时返回 `None`。
pub fn socks5_greeting_len(buf: &[u8]) -> Option<usize> {
    if buf.len() < 2 {
        return None;
    }
    Some(2 + buf[1] as usize)
}

/// 解析 CONNECT 请求。`Ok(None)` = 还要更多字节;`Ok(Some)` = 目标;`Err` = 协议错。
pub fn socks5_parse_connect(buf: &[u8]) -> Result<Option<(String, u16)>, SocksErr> {
    if buf.len() < 4 {
        return Ok(None);
    }
    if buf[0] != 0x05 {
        return Err(SocksErr::BadVersion);
    }
    if buf[1] != 0x01 {
        // CONNECT only; BIND/UDP ASSOCIATE → fail
        return Err(SocksErr::BadCommand);
    }
    // buf[2] = RSV
    let atyp = buf[3];
    let (host, port_at) = match atyp {
        0x01 => {
            if buf.len() < 4 + 4 + 2 {
                return Ok(None);
            }
            let ip = Ipv4Addr::new(buf[4], buf[5], buf[6], buf[7]);
            (ip.to_string(), 8)
        }
        0x03 => {
            if buf.len() < 5 {
                return Ok(None);
            }
            let n = buf[4] as usize;
            if buf.len() < 5 + n + 2 {
                return Ok(None);
            }
            let name = std::str::from_utf8(&buf[5..5 + n]).map_err(|_| SocksErr::BadAddressType)?;
            (name.to_string(), 5 + n)
        }
        0x04 => {
            if buf.len() < 4 + 16 + 2 {
                return Ok(None);
            }
            let mut octets = [0u8; 16];
            octets.copy_from_slice(&buf[4..20]);
            let ip = Ipv6Addr::from(octets);
            (ip.to_string(), 20)
        }
        _ => return Err(SocksErr::BadAddressType),
    };
    if buf.len() < port_at + 2 {
        return Ok(None);
    }
    let port = u16::from_be_bytes([buf[port_at], buf[port_at + 1]]);
    Ok(Some((host, port)))
}

/// CONNECT 成功应答(绑定地址填 0.0.0.0:0)。
pub fn socks5_success_reply() -> [u8; 10] {
    [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]
}

/// CONNECT 失败应答。`code` 见 RFC 1928(0x05 = connection refused, 0x07 = command not supported)。
pub fn socks5_fail_reply(code: u8) -> [u8; 10] {
    [0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dest_host_blank_is_loopback() {
        assert_eq!(dest_host(""), "127.0.0.1");
        assert_eq!(dest_host("  "), "127.0.0.1");
        assert_eq!(dest_host("db"), "db");
    }

    #[test]
    fn validate_rejects_zero_ports() {
        assert!(validate_spec(&ForwardSpec {
            mode: ForwardMode::Local,
            local_port: 0,
            remote_host: String::new(),
            remote_port: 80,
        })
        .is_err());
        assert!(validate_spec(&ForwardSpec {
            mode: ForwardMode::Local,
            local_port: 8080,
            remote_host: String::new(),
            remote_port: 0,
        })
        .is_err());
        assert!(validate_spec(&ForwardSpec {
            mode: ForwardMode::Dynamic,
            local_port: 1080,
            remote_host: String::new(),
            remote_port: 0,
        })
        .is_ok());
    }

    #[test]
    fn forward_key_includes_mode() {
        assert_eq!(forward_key(ForwardMode::Local, 8080), "local:8080");
        assert_eq!(forward_key(ForwardMode::Dynamic, 8080), "dynamic:8080");
        assert_ne!(
            forward_key(ForwardMode::Local, 8080),
            forward_key(ForwardMode::Remote, 8080)
        );
    }

    #[test]
    fn socks5_greeting_incomplete() {
        assert!(socks5_greeting(&[0x05]).is_none());
        assert!(socks5_greeting(&[0x05, 0x02, 0x00]).is_none());
    }

    #[test]
    fn socks5_greeting_noauth() {
        assert_eq!(socks5_greeting(&[0x05, 0x01, 0x00]), Some(Ok([0x05, 0x00])));
        assert_eq!(socks5_greeting(&[0x05, 0x02, 0x00, 0x02]), Some(Ok([0x05, 0x00])));
    }

    #[test]
    fn socks5_greeting_rejects_no_noauth() {
        assert_eq!(
            socks5_greeting(&[0x05, 0x01, 0x02]),
            Some(Err(SocksErr::NoAcceptableMethod))
        );
    }

    #[test]
    fn socks5_parse_ipv4() {
        // VER CMD RSV ATYP 1.2.3.4 :80
        let buf = [0x05, 0x01, 0x00, 0x01, 1, 2, 3, 4, 0, 80];
        assert_eq!(
            socks5_parse_connect(&buf).unwrap(),
            Some(("1.2.3.4".into(), 80))
        );
    }

    #[test]
    fn socks5_parse_domain() {
        let mut buf = vec![0x05, 0x01, 0x00, 0x03, 0x0b];
        buf.extend(b"example.com");
        buf.extend([0x01, 0xbb]); // 443
        assert_eq!(
            socks5_parse_connect(&buf).unwrap(),
            Some(("example.com".into(), 443))
        );
    }

    #[test]
    fn socks5_parse_truncated() {
        assert_eq!(socks5_parse_connect(&[0x05, 0x01, 0x00, 0x01, 1]).unwrap(), None);
    }

    #[test]
    fn socks5_parse_rejects_bind() {
        let buf = [0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        assert_eq!(socks5_parse_connect(&buf), Err(SocksErr::BadCommand));
    }
}
