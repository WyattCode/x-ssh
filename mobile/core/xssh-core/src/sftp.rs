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

/// 临时文件 / 备份文件名里的后缀:进程号 + 时间 + 递增计数。不是为了"猜不到"
/// (独占创建本身就挡住了抢先放符号链接的人),只是让两次上传、两个进程不会互相踩到。
fn unique_suffix() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!(
        "{:x}{:x}{:x}",
        std::process::id(),
        nanos & 0xffff_ffff_ffff,
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
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

    /// 在 [target] 旁边**独占创建**一个临时文件(`CREATE | EXCLUDE`),并在创建时就带上 [permissions]
    /// (去掉文件类型位)。返回打开的文件和它的路径;创建不了返回 None,由调用方退回直写。
    ///
    /// 独占很关键:原来用的是 `create`(`CREATE | TRUNCATE`),它会**跟着符号链接走**并截断已有文件 ——
    /// 在别人也能写的目录里,有人预先放一个同名符号链接指向你的文件,你的上传就会把那个文件覆盖掉。
    /// 独占创建遇到任何已存在的东西(包括符号链接)都会失败,换个名字再试。
    async fn create_temp(
        &self,
        target: &str,
        permissions: Option<u32>,
    ) -> Option<(russh_sftp::client::fs::File, String)> {
        use russh_sftp::protocol::{FileAttributes, OpenFlags};
        for _ in 0..4 {
            let temp = format!("{target}.xssh-part-{}", unique_suffix());
            let attributes = FileAttributes {
                permissions: permissions.map(|p| p & 0o7777),
                ..Default::default()
            };
            let flags = OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE;
            if let Ok(file) = self.session.open_with_flags_and_attributes(temp.clone(), flags, attributes).await {
                return Some((file, temp));
            }
        }
        None
    }

    /// 上传:[input] 的内容写到远端 [path](已存在就覆盖)。[total] 只用于进度显示,不知道就传 0。
    ///
    /// **先写同目录下的临时文件,整个传完再改名盖过去。**
    ///
    /// 原来是直接 `create(path)` 往目标上写 —— `create` 会把已有文件截断,而取消时又
    /// `remove_file(path)`,删掉的其实是**用户原来那个文件**。更糟的是上层把"会话断开"
    /// 也当成取消(RemoteFiles.close),所以传一半掉个线,服务器上那个文件就没了,
    /// 界面还只说一句「已取消」。出错(写到一半网断)同样会在服务器上留下一个被截断、
    /// 但名字看着完全正常的文件。
    ///
    /// 现在:传输过程中目标文件一直原封不动;取消或出错只删临时文件。
    pub fn upload(
        &self,
        path: &str,
        input: &mut dyn Read,
        total: u64,
        progress: &mut dyn FnMut(u64, u64) -> bool,
    ) -> Result<u64, SshError> {
        // 临时文件必须和目标**同一个目录**:改名只在同一个文件系统内才保证是原子的,
        // 放 /tmp 再改名可能跨设备失败。名字带随机后缀、用独占方式创建,见 `create_temp`。
        self.block(async {
            // 目标原来的权限位:改名之后要照原样补回去。
            //
            // 直接往目标写时,inode 不变,权限自然保留。改成"新建临时文件再改名"之后,
            // 落地的是一个**新建**的文件,权限按服务端 umask 走 —— 覆盖一次
            // `~/.ssh/authorized_keys`,0600 就变成 0644,sshd 直接不认那个文件了;
            // 可执行脚本也会掉 +x。
            //
            // 目标要是一个符号链接(用链接管理的点文件),先解析成真实路径再操作:
            // 否则"改名盖过去"会把链接本身换成一个普通文件。解析不了(新文件、悬空链接)就用原路径。
            let target = self.session.canonicalize(path).await.unwrap_or_else(|_| path.to_owned());
            let previous = self.session.metadata(target.clone()).await.ok();
            // 先开临时文件,**创建的那一刻就带上原来的权限位**:原来是等改名之后才补回去,
            // 整个上传期间 0600 的私钥 / 凭据文件的新内容是按服务端默认(通常 0644)躺在磁盘上的。
            //
            // **开不出来就退回直接写目标**:目录不可写、而文件本身可写的情况
            // (别人家目录下一个 group-writable 的文件)本来传得动,不能因为多了这道保护就传不了。
            // 退回的那条路没有"传完再换"的保护,和以前一样。
            let (mut file, temp) = match self.create_temp(&target, previous.as_ref().and_then(|m| m.permissions)).await {
                Some((file, temp)) => (file, Some(temp)),
                None => (self.session.create(target.clone()).await.map_err(sftp_err)?, None),
            };

            let outcome = async {
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
                        let _ = file.shutdown().await;
                        return Err(SshError::Cancelled);
                    }
                }
                file.shutdown().await.map_err(sftp_err)?;
                Ok(done)
            }
            .await;

            let done = match outcome {
                Ok(done) => done,
                Err(err) => {
                    // 取消、写失败、读本地失败:只收拾自己的临时文件,目标不动。
                    // 退回直写的那条路上没有临时文件可收 —— 目标已经被截断了,无能为力。
                    if let Some(temp) = &temp {
                        let _ = self.session.remove_file(temp.clone()).await;
                    }
                    return Err(err);
                }
            };

            let Some(temp) = temp else {
                return Ok(done);
            };

            // 盖过去。SFTP v3 的 rename 在目标已存在时会失败(这个库也没暴露 posix-rename 扩展),
            // 原来是先删目标再改名 —— 中间掉线或改名失败,原文件就没了。
            // 现在是**先把旧文件改名成备份、新文件改名过去、成功了才删备份**;
            // 新文件没能就位就把备份改回来,原文件任何时候都找得回。
            let backup = format!("{target}.xssh-old-{}", unique_suffix());
            let had_target = previous.is_some();
            let moved_aside = had_target && self.session.rename(target.clone(), backup.clone()).await.is_ok();
            if had_target && !moved_aside {
                // 旧文件挪不开:退回原来的办法(先删再改名),总比整个上传失败强。
                let _ = self.session.remove_file(target.clone()).await;
            }
            if let Err(err) = self.session.rename(temp.clone(), target.clone()).await {
                if moved_aside {
                    let _ = self.session.rename(backup.clone(), target.clone()).await;
                }
                // 内容还在临时文件里,报错时把它的名字带出去,用户不至于两头空。
                return Err(SshError::Sftp(format!("{}(内容已上传到 {temp})", sftp_err(err))));
            }
            if moved_aside {
                let _ = self.session.remove_file(backup).await;
            }
            // 权限再核一遍(创建时已经带上了;服务端要是忽略了那个属性,这里补上。拿不到原来的就随服务端默认)。
            if let Some(permissions) = previous.and_then(|before| before.permissions) {
                let keep = russh_sftp::protocol::FileAttributes {
                    permissions: Some(permissions & 0o7777),
                    ..Default::default()
                };
                let _ = self.session.set_metadata(target, keep).await;
            }
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
    use super::{join, parent, unique_suffix};

    #[test]
    fn temp_and_backup_names_do_not_collide() {
        let names: std::collections::HashSet<String> = (0..1000).map(|_| unique_suffix()).collect();
        assert_eq!(names.len(), 1000, "连着生成的后缀不该重复");
    }

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
