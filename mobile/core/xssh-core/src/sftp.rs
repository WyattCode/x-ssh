//! SFTP:在已认证的连接上再开一个 `sftp` 子系统通道,和终端共用同一条 SSH 连接
//! (不再认证一次、不多占一个 TCP 连接)。
//!
//! 接口是同步的(内部 `block_on`),和 [`crate::ssh::Shell`] 一样,方便宿主在自己的 IO 线程里调。
//! 上传下载走调用方给的 `Read` / `Write`(移动端传的是系统文件选择器给的文件描述符),
//! 边读边写,不在内存里攒整份文件。

use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;

use russh_sftp::client::SftpSession;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::ssh::SshError;

/// 每次读写的块大小。SFTP 单个请求的载荷上限一般是 32KB~256KB,取中间值,
/// 进度回调的频率也合适(千兆局域网上大约每毫秒一次,不会把界面刷爆)。
const CHUNK: usize = 64 * 1024;

/// 一个远端文件 / 目录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteEntry {
    pub name: String,
    /// 完整路径(父目录 + 名字)。
    pub path: String,
    pub is_dir: bool,
    pub is_link: bool,
    pub size: u64,
    /// 修改时间(Unix 秒);服务器没给时为 0。
    pub modified: u64,
    /// 权限位(`0o755` 这种);没给时为 0。
    pub permissions: u32,
}

/// 一个 SFTP 会话。
pub struct Sftp {
    // 持有运行时的强引用:终端那边先断开、销毁了 Ssh,这里的请求也不会撞上"运行时已关"而崩溃。
    runtime: Arc<tokio::runtime::Runtime>,
    session: SftpSession,
}

fn sftp_err(err: impl std::fmt::Display) -> SshError {
    SshError::Sftp(err.to_string())
}

/// 拼路径:SFTP 路径总是 `/` 分隔,不管服务器是什么系统。
pub fn join(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

/// 上一级目录(根目录的上一级还是根目录)。
pub fn parent(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) | None => "/".to_owned(),
        Some(i) => trimmed[..i].to_owned(),
    }
}

impl Sftp {
    pub(crate) fn new(runtime: Arc<tokio::runtime::Runtime>, session: SftpSession) -> Self {
        Self { runtime, session }
    }

    fn block<F: std::future::Future>(&self, future: F) -> F::Output {
        self.runtime.block_on(future)
    }

    /// 登录后的起始目录(一般是家目录)。
    pub fn home(&self) -> Result<String, SshError> {
        self.block(self.session.canonicalize(".")).map_err(sftp_err)
    }

    /// 列目录:目录在前,再按名字排(不分大小写);不含 `.` 和 `..`。
    pub fn list(&self, path: &str) -> Result<Vec<RemoteEntry>, SshError> {
        let dir = self.block(self.session.read_dir(path)).map_err(sftp_err)?;
        let mut entries: Vec<RemoteEntry> = dir
            .filter(|entry| {
                let name = entry.file_name();
                name != "." && name != ".."
            })
            .map(|entry| {
                let meta = entry.metadata();
                let kind = entry.file_type();
                let name = entry.file_name();
                RemoteEntry {
                    path: join(path, &name),
                    name,
                    is_dir: kind.is_dir(),
                    is_link: kind.is_symlink(),
                    size: meta.size.unwrap_or(0),
                    modified: meta.mtime.map(u64::from).unwrap_or(0),
                    permissions: meta.permissions.unwrap_or(0) & 0o7777,
                }
            })
            .collect();
        entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(entries)
    }

    /// 符号链接指向的是不是目录(列表里的链接要点得进去)。
    pub fn is_dir(&self, path: &str) -> bool {
        self.block(self.session.metadata(path)).map(|m| m.file_type().is_dir()).unwrap_or(false)
    }

    /// 下载:远端 [path] 的内容写进 [out]。[progress] 返回 false 表示取消。返回写了多少字节。
    pub fn download(
        &self,
        path: &str,
        out: &mut dyn Write,
        progress: &mut dyn FnMut(u64, u64) -> bool,
    ) -> Result<u64, SshError> {
        self.block(async {
            let total = self.session.metadata(path).await.map(|m| m.size.unwrap_or(0)).unwrap_or(0);
            let mut file = self.session.open(path).await.map_err(sftp_err)?;
            let mut buffer = vec![0u8; CHUNK];
            let mut done = 0u64;
            loop {
                let n = file.read(&mut buffer).await.map_err(sftp_err)?;
                if n == 0 {
                    break;
                }
                out.write_all(&buffer[..n])?;
                done += n as u64;
                if !progress(done, total) {
                    return Err(SshError::Cancelled);
                }
            }
            out.flush()?;
            Ok(done)
        })
    }

    /// 上传:[input] 的内容写到远端 [path](已存在就覆盖)。[total] 只用于进度显示,不知道就传 0。
    pub fn upload(
        &self,
        path: &str,
        input: &mut dyn Read,
        total: u64,
        progress: &mut dyn FnMut(u64, u64) -> bool,
    ) -> Result<u64, SshError> {
        self.block(async {
            let mut file = self.session.create(path).await.map_err(sftp_err)?;
            let mut buffer = vec![0u8; CHUNK];
            let mut done = 0u64;
            loop {
                let n = input.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                file.write_all(&buffer[..n]).await.map_err(sftp_err)?;
                done += n as u64;
                if !progress(done, total) {
                    // 取消:把传了一半的文件删掉,别在服务器上留个残缺的。
                    let _ = file.shutdown().await;
                    let _ = self.session.remove_file(path).await;
                    return Err(SshError::Cancelled);
                }
            }
            file.shutdown().await.map_err(sftp_err)?;
            Ok(done)
        })
    }

    pub fn mkdir(&self, path: &str) -> Result<(), SshError> {
        self.block(self.session.create_dir(path)).map_err(sftp_err)
    }

    /// 删除文件或空目录。
    pub fn remove(&self, path: &str, is_dir: bool) -> Result<(), SshError> {
        if is_dir {
            self.block(self.session.remove_dir(path)).map_err(sftp_err)
        } else {
            self.block(self.session.remove_file(path)).map_err(sftp_err)
        }
    }

    pub fn rename(&self, from: &str, to: &str) -> Result<(), SshError> {
        self.block(self.session.rename(from, to)).map_err(sftp_err)
    }

    /// 关闭 SFTP 通道(终端不受影响)。
    pub fn close(&self) {
        let _ = self.block(async { tokio::time::timeout(Duration::from_secs(3), self.session.close()).await });
    }
}

#[cfg(test)]
mod tests {
    use super::{join, parent};

    #[test]
    fn paths_join_and_go_up() {
        assert_eq!(join("/home/user", "a.txt"), "/home/user/a.txt");
        assert_eq!(join("/", "etc"), "/etc");
        assert_eq!(parent("/home/user/"), "/home");
        assert_eq!(parent("/home"), "/");
        assert_eq!(parent("/"), "/");
        // Windows OpenSSH 的 SFTP 路径长这样。
        assert_eq!(parent("/C:/Users/user"), "/C:/Users");
    }
}
