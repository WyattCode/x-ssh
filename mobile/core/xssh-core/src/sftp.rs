//! SFTP:在已认证的连接上再开一个 `sftp` 子系统通道,和终端共用同一条 SSH 连接
//! (不再认证一次、不多占一个 TCP 连接)。
//!
//! 接口是同步的(内部 `block_on`),和 [`crate::ssh::Shell`] 一样,方便宿主在自己的 IO 线程里调。
//! 上传下载走调用方给的 `Read` / `Write`(移动端传的是系统文件选择器给的文件描述符),
//! 边读边写,不在内存里攒整份文件。

use std::io::{Read, Write};
use std::sync::{Arc, Mutex, OnceLock};
use std::collections::HashSet;
use std::time::Duration;

use russh_sftp::client::SftpSession;
use tokio::io::{AsyncReadExt, AsyncWriteExt, AsyncSeekExt};

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

const OWNER_MAGIC: &[u8] = b"XSSH-STAGING-V1\n";
const STAGING_TTL: u64 = 24 * 60 * 60;

struct OwnedNames {
    target: String,
    part: String,
    backup: String,
    marker: String,
}

// Legacy suffixes without a marker are never evidence of ownership.
fn owned_names(marker: &str) -> Option<OwnedNames> {
    let (target, id) = marker.rsplit_once(".xssh-owner-")?;
    if target.is_empty() || target == "." || target == ".." || target.contains('/') || id.len() != 32 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(OwnedNames {
        target: target.to_owned(),
        part: format!("{target}.xssh-part-{id}"),
        backup: format!("{target}.xssh-old-{id}"),
        marker: marker.to_owned(),
    })
}

fn expired_owned(magic: &[u8], lease_mtime: u64, artifact_mtime: u64, server_now: u64, active: bool) -> bool {
    magic == OWNER_MAGIC && !active && lease_mtime > 0 && artifact_mtime > 0
        && server_now.saturating_sub(lease_mtime.max(artifact_mtime)) > STAGING_TTL
}

#[derive(Debug, PartialEq, Eq)]
enum BackupCleanup { Delete, Restore, Keep }
fn backup_cleanup(target_exists_as_regular_file: Option<bool>) -> BackupCleanup {
    match target_exists_as_regular_file {
        Some(true) => BackupCleanup::Delete,
        Some(false) => BackupCleanup::Restore,
        None => BackupCleanup::Keep,
    }
}

fn active_uploads() -> &'static Mutex<HashSet<String>> {
    static ACTIVE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashSet::new()))
}
struct ActiveUpload(String);
impl ActiveUpload {
    fn new(marker: String) -> Self {
        active_uploads().lock().unwrap_or_else(|e| e.into_inner()).insert(marker.clone());
        Self(marker)
    }
}
impl Drop for ActiveUpload {
    fn drop(&mut self) {
        active_uploads().lock().unwrap_or_else(|e| e.into_inner()).remove(&self.0);
    }
}

fn require_staging<T>(staged: Option<T>) -> Result<T, SshError> {
    staged.ok_or_else(|| SshError::Sftp("cannot-create-upload-temp".to_owned()))
}

/// 128 random bits plus exclusive creation; no client timestamp is used for expiry.
fn unique_suffix() -> String {
    format!("{:032x}", rand::random::<u128>())
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

    /// Listing only sweeps artifacts with our exclusive ownership sidecar.
    pub fn list(&self, path: &str) -> Result<Vec<RemoteEntry>, SshError> {
        let dir = self.block(self.session.canonicalize(path)).unwrap_or_else(|_| path.to_owned());
        let entries = self.read_entries(&dir)?;
        if self.block(self.sweep_owned(&dir, &entries)) {
            return self.read_entries(&dir);
        }
        Ok(entries)
    }

    /// 列目录:目录在前,再按名字排(不分大小写);不含 `.` 和 `..`。
    fn read_entries(&self, path: &str) -> Result<Vec<RemoteEntry>, SshError> {
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

    /// The probe mtime comes from this server, never from the phone's wall clock.
    /// If the server refuses a probe or omits mtimes, cleanup is disabled.
    async fn server_now(&self, dir: &str) -> Option<u64> {
        let (mut file, temp, marker, mut lease) = self.create_temp(&join(dir, ".xssh-clock"), Some(0o600)).await?;
        let now = file.metadata().await.ok().and_then(|m| m.mtime).map(u64::from);
        let _ = file.shutdown().await;
        let _ = lease.shutdown().await;
        let _ = self.session.remove_file(temp).await;
        let _ = self.session.remove_file(marker).await;
        now.filter(|t| *t > 0)
    }

    async fn sweep_owned(&self, dir: &str, entries: &[RemoteEntry]) -> bool {
        let candidates: Vec<_> = entries.iter().filter(|e| !e.is_dir && !e.is_link && owned_names(&e.name).is_some()).collect();
        if candidates.is_empty() { return false; }
        let Some(now) = self.server_now(dir).await else { return false; };
        let mut changed = false;
        for owner in candidates {
            let Some(names) = owned_names(&owner.name) else { continue; };
            let marker = join(dir, &names.marker);
            let active = active_uploads().lock().unwrap_or_else(|e| e.into_inner()).contains(&marker);
            if active || owner.size != OWNER_MAGIC.len() as u64 { continue; }
            // Re-stat without following symlinks, then read a bounded marker.
            let Ok(meta) = self.session.symlink_metadata(marker.clone()).await else { continue; };
            if !meta.file_type().is_file() || meta.file_type().is_symlink() { continue; }
            let lease_mtime = meta.mtime.map(u64::from).unwrap_or(0);
            let Ok(mut lease) = self.session.open(marker.clone()).await else { continue; };
            let mut magic = Vec::new();
            let read = (&mut lease).take((OWNER_MAGIC.len() + 1) as u64).read_to_end(&mut magic).await;
            let _ = lease.shutdown().await;
            if read.is_err() { continue; }
            if !expired_owned(&magic, lease_mtime, lease_mtime, now, active) { continue; }
            for (name, backup) in [(&names.part, false), (&names.backup, true)] {
                let artifact = join(dir, name);
                let Ok(meta) = self.session.symlink_metadata(artifact.clone()).await else { continue; };
                if !meta.file_type().is_file() || meta.file_type().is_symlink() { continue; }
                if !expired_owned(&magic, lease_mtime, meta.mtime.map(u64::from).unwrap_or(0), now, active) { continue; }
                // A fresh heartbeat between listing and deletion cancels cleanup.
                let current = self.session.symlink_metadata(marker.clone()).await.ok();
                if current.and_then(|m| m.mtime).map(u64::from) != Some(lease_mtime) { continue; }
                let result = if backup {
                    let target = join(dir, &names.target);
                    let exists = match self.session.symlink_metadata(target.clone()).await {
                        Ok(m) if m.file_type().is_file() && !m.file_type().is_symlink() => Some(true),
                        Ok(_) => None,
                        Err(_) => match self.session.try_exists(target.clone()).await {
                            Ok(false) => Some(false),
                            _ => None,
                        },
                    };
                    match backup_cleanup(exists) {
                        BackupCleanup::Delete => self.session.remove_file(artifact).await,
                        BackupCleanup::Restore => self.session.rename(artifact, target).await,
                        BackupCleanup::Keep => continue,
                    }
                } else {
                    self.session.remove_file(artifact).await
                };
                changed |= result.is_ok();
            }
            // Keep failed deletions recoverable and retryable on a later visit.
            if matches!(self.session.try_exists(join(dir, &names.part)).await, Ok(false))
                && matches!(self.session.try_exists(join(dir, &names.backup)).await, Ok(false)) {
                changed |= self.session.remove_file(marker).await.is_ok();
            }
        }
        changed
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
    /// (去掉文件类型位)。返回打开的文件和它的路径;创建不了返回 None,由调用方拒绝上传。
    ///
    /// 独占很关键:原来用的是 `create`(`CREATE | TRUNCATE`),它会**跟着符号链接走**并截断已有文件 ——
    /// 在别人也能写的目录里,有人预先放一个同名符号链接指向你的文件,你的上传就会把那个文件覆盖掉。
    /// 独占创建遇到任何已存在的东西(包括符号链接)都会失败,换个名字再试。
    async fn create_temp(
        &self,
        target: &str,
        permissions: Option<u32>,
    ) -> Option<(russh_sftp::client::fs::File, String, String, russh_sftp::client::fs::File)> {
        use russh_sftp::protocol::{FileAttributes, OpenFlags};
        for _ in 0..4 {
            let id = unique_suffix();
            let temp = format!("{target}.xssh-part-{id}");
            let marker = format!("{target}.xssh-owner-{id}");
            let flags = OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE;
            let owner_attrs = FileAttributes { permissions: Some(0o600), ..Default::default() };
            let Ok(mut lease) = self.session.open_with_flags_and_attributes(marker.clone(), flags, owner_attrs).await else { continue; };
            if async {
                lease.write_all(OWNER_MAGIC).await?;
                lease.flush().await
            }.await.is_err() {
                let _ = lease.shutdown().await;
                let _ = self.session.remove_file(marker).await;
                continue;
            }
            let attributes = FileAttributes { permissions: permissions.map(|p| p & 0o7777), ..Default::default() };
            match self.session.open_with_flags_and_attributes(temp.clone(), flags, attributes).await {
                Ok(file) => return Some((file, temp, marker, lease)),
                Err(_) => {
                    let _ = lease.shutdown().await;
                    let _ = self.session.remove_file(marker).await;
                }
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
            // Refuse if staging is unavailable: direct writes can destroy the original.
            let (mut file, temp, marker, mut lease) = require_staging(
                self.create_temp(&target, previous.as_ref().and_then(|m| m.permissions)).await
            )?;

            let _active = ActiveUpload::new(marker.clone());
            let mut heartbeat = std::time::Instant::now();
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
                    if heartbeat.elapsed() >= Duration::from_secs(60) {
                        lease.rewind().await.map_err(sftp_err)?;
                        lease.write_all(OWNER_MAGIC).await.map_err(sftp_err)?;
                        lease.flush().await.map_err(sftp_err)?;
                        heartbeat = std::time::Instant::now();
                    }
                    if !progress(done, total) {
                        let _ = file.shutdown().await;
                        return Err(SshError::Cancelled);
                    }
                }
                file.shutdown().await.map_err(sftp_err)?;
                Ok(done)
            }
            .await;

            // Refresh the server-side lease before entering the backup/rename window.
            let refreshed = async {
                lease.rewind().await.map_err(sftp_err)?;
                lease.write_all(OWNER_MAGIC).await.map_err(sftp_err)?;
                lease.shutdown().await.map_err(sftp_err)
            }.await;
            let done = match outcome.and_then(|done| refreshed.map(|_| done)) {
                Ok(done) => done,
                Err(err) => {
                    // 取消、写失败、读本地失败:只收拾自己的临时文件,目标不动。
                    let _ = file.shutdown().await;
                    if self.session.remove_file(temp.clone()).await.is_ok() {
                        let _ = self.session.remove_file(marker.clone()).await;
                    }
                    return Err(err);
                }
            };

            // 盖过去。SFTP v3 的 rename 在目标已存在时会失败(这个库也没暴露 posix-rename 扩展),
            // 原来是先删目标再改名 —— 中间掉线或改名失败,原文件就没了。
            // 现在是**先把旧文件改名成备份、新文件改名过去、成功了才删备份**;
            // 新文件没能就位就把备份改回来,原文件任何时候都找得回。
            let backup = format!("{target}.xssh-old-{}", marker.rsplit_once(".xssh-owner-").unwrap().1);
            let had_target = previous.is_some();
            let moved_aside = had_target && self.session.rename(target.clone(), backup.clone()).await.is_ok();
            if had_target && !moved_aside {
                if self.session.remove_file(temp.clone()).await.is_ok() {
                    let _ = self.session.remove_file(marker.clone()).await;
                }
                return Err(SshError::Sftp("cannot-stage-existing-target".to_owned()));
            }
            if let Err(err) = self.session.rename(temp.clone(), target.clone()).await {
                if moved_aside {
                    let _ = self.session.rename(backup.clone(), target.clone()).await;
                }
                // 内容还在临时文件里,报错时把它的名字带出去,用户不至于两头空。
                return Err(SshError::Sftp(format!("{}(内容已上传到 {temp})", sftp_err(err))));
            }
            if moved_aside {
                self.session.remove_file(backup.clone()).await.map_err(|err|
                    SshError::Sftp(format!("upload-complete-backup-retained:{backup}:{}", sftp_err(err))))?;
            }
            let _ = self.session.remove_file(marker).await;
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
    use super::{join, parent, unique_suffix, require_staging, owned_names, expired_owned, backup_cleanup, BackupCleanup, OWNER_MAGIC};

    #[test]
    fn b19_cleanup_requires_ownership_and_server_age_for_parts_and_backups() {
        let id = "0123456789abcdef0123456789abcdef";
        let owner = format!("report.xssh-owner-{id}");
        let names = owned_names(&owner).unwrap();
        assert_eq!(names.part, format!("report.xssh-part-{id}"));
        assert_eq!(names.backup, format!("report.xssh-old-{id}"));
        assert!(expired_owned(OWNER_MAGIC, 1, 1, 90000, false));
        assert!(!expired_owned(b"user file", 1, 1, 90000, false));
        assert!(!expired_owned(OWNER_MAGIC, 89999, 1, 90000, false));
        assert!(!expired_owned(OWNER_MAGIC, 1, 89999, 90000, false));
        assert!(!expired_owned(OWNER_MAGIC, 1, 1, 90000, true));
        assert!(!expired_owned(OWNER_MAGIC, 0, 1, 90000, false));
        assert!(!expired_owned(OWNER_MAGIC, 90000, 90000, 1, false));
        assert!(!expired_owned(OWNER_MAGIC, 1, 1, 86401, false));
        assert!(owned_names("report.xssh-part-0123456789abcdef0123456789abcdef").is_none());
        assert!(owned_names("report.xssh-part-deadbeef").is_none());
        assert!(owned_names("report.xssh-old-deadbeef").is_none());
        assert!(owned_names("report.xssh-owner-abc123").is_none());
    }

    #[test]
    fn b19_never_discards_the_only_backup() {
        assert_eq!(backup_cleanup(Some(true)), BackupCleanup::Delete);
        assert_eq!(backup_cleanup(Some(false)), BackupCleanup::Restore);
        assert_eq!(backup_cleanup(None), BackupCleanup::Keep);
    }

    #[test]
    fn b18_missing_staging_refuses_upload() {
        assert!(require_staging::<()>(None).is_err());
        assert_eq!(require_staging(Some(42)).unwrap(), 42);
    }

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
