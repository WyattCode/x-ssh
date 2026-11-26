/** Centralized IPC channel names so main/preload/renderer never drift. */
export const IPC = {
  clipboardRead: 'clipboard:readText',
  clipboardWrite: 'clipboard:writeText',
  // Host store (invoke/handle)
  hostsList: 'hosts:list',
  hostsSecretsStatus: 'hosts:secretsStatus',
  hostsResetSecrets: 'hosts:resetSecrets',
  hostsStatus: 'hosts:status',
  hostsReset: 'hosts:reset',
  hostsSave: 'hosts:save',
  hostsDelete: 'hosts:delete',
  hostsProbe: 'hosts:probe',
  /** main → renderer: saved hosts changed outside the renderer (e.g. OS detected). */
  hostsChanged: 'hosts:changed',
  hostsImportSshConfig: 'hosts:importSshConfig',
  hostsExportJson: 'hosts:exportJson',
  hostsExportSshConfig: 'hosts:exportSshConfig',
  hostsImportJson: 'hosts:importJson',

  // Full data backup (hosts+secrets+snippets+snapshots+history+known hosts)
  dataExportAll: 'data:exportAll',
  dataImportAll: 'data:importAll',
  dataBackupNow: 'data:backupNow', // trigger a scheduled-style backup immediately
  /** Main-owned: picks the backup folder and stores it itself. The renderer
   *  never gets to name a path that will receive plaintext credentials. */
  backupPickDir: 'backup:pickDir',
  dataRescheduleBackup: 'data:rescheduleBackup', // re-read auto-backup prefs & restart timer

  // SSH key library (invoke/handle)
  keysList: 'keys:list',
  keysGenerate: 'keys:generate',
  keysImport: 'keys:import',
  keysDelete: 'keys:delete',
  keysLabelsStatus: 'keys:labelsStatus',
  keysPublicKey: 'keys:publicKey', // read a managed key's public line
  keysPublish: 'keys:publish', // append a public key to selected hosts

  // SSH lifecycle (invoke/handle)
  sshConnect: 'ssh:connect',
  sshDisconnect: 'ssh:disconnect',
  sshForgetHostKey: 'ssh:forgetHostKey',
  sshTrustHostKey: 'ssh:trustHostKey',
  // Per-session output log-to-file (invoke/handle)
  sessionLogStart: 'sessionLog:start',
  sessionLogStop: 'sessionLog:stop',
  /** main → renderer: the log stream failed mid-write and logging stopped. */
  sessionLogFailed: 'sessionLog:failed',

  // Known-hosts management (invoke/handle)
  knownHostsList: 'knownHosts:list',
  knownHostsForget: 'knownHosts:forget',

  // Cross-session output history (invoke/handle)
  historyList: 'history:list',
  historyExport: 'history:export',

  // Local filesystem browsing (dual-panel SFTP) (invoke/handle)
  localList: 'local:list',
  localHome: 'local:home',
  localReadText: 'local:readText',
  localPickFile: 'local:pickFile',
  localCreate: 'local:create',
  localRename: 'local:rename',
  localDelete: 'local:delete',
  localCopyIn: 'local:copyIn',

  // Command snippets (invoke/handle)
  snippetsList: 'snippets:list',
  snippetsSave: 'snippets:save',
  snippetsDelete: 'snippets:delete',

  // SFTP (invoke/handle)
  sftpList: 'sftp:list',  sftpDownload: 'sftp:download',
  sftpDownloadMany: 'sftp:downloadMany',
  sftpDownloadTo: 'sftp:downloadTo',
  sftpUpload: 'sftp:upload',
  sftpUploadDir: 'sftp:uploadDir',
  sftpUploadPaths: 'sftp:uploadPaths',
  sftpSync: 'sftp:sync', // incremental local<->remote directory sync
  sftpWatchStart: 'sftp:watchStart', // start a continuous (polling) auto-sync
  sftpWatchStop: 'sftp:watchStop', // stop the session's continuous auto-sync
  sftpMkdir: 'sftp:mkdir',
  sftpCreateFile: 'sftp:createFile',
  sftpRename: 'sftp:rename',
  sftpDelete: 'sftp:delete',
  sftpChmod: 'sftp:chmod',
  sftpCancel: 'sftp:cancel',
  sftpPause: 'sftp:pause', // pause/resume one transfer job
  sftpPauseAll: 'sftp:pauseAll', // pause/resume every live transfer
  sftpSetRate: 'sftp:setRate', // throttle one job (bytes/sec; 0 = unlimited)
  sftpReadText: 'sftp:readText',
  sftpReadBinary: 'sftp:readBinary', // base64 for inline image preview
  sftpWriteText: 'sftp:writeText',
  sftpEditExternal: 'sftp:editExternal',
  sftpOpenWith: 'sftp:openWith', // open with a per-extension program or OS default
  sftpRevealLocal: 'sftp:revealLocal', // show a finished download in the OS file manager
  sftpProgress: 'sftp:progress', // main -> renderer
  sftpPackDownload: 'sftp:packDownload', // remote tar.zip -> download
  sftpExtract: 'sftp:extract', // extract uploaded archive on remote
  sftpUploadExtract: 'sftp:uploadExtract', // upload archive then extract on remote

  // SSH data stream (send, no reply)
  sshInput: 'ssh:input', // renderer -> main : keystrokes
  imeTrace: 'ime:trace', // renderer -> main : one IME trace line (dropped unless tracing is on)
  imeTraceEnabled: 'ime:traceEnabled', // renderer -> main : is voice-input tracing switched on?
  sshResize: 'ssh:resize', // renderer -> main : pty resize
  sshAttach: 'ssh:attach', // renderer -> main : listener ready, flush buffered output
  hostsPatch: 'hosts:patch', // renderer -> main : group / order changes for several hosts in one write
  windowDim: 'window:dim', // renderer -> main : a dialog's dim layer is up (the OS-drawn caption buttons follow it)
  windowZoom: 'window:zoom', // renderer -> main : the app zoom factor changed (Windows caption buttons follow it)
  sshPing: 'ssh:ping', // round-trip time of a live session, in ms (null when it cannot be measured)
  sshCompare: 'ssh:compare', // run one fixed comparison probe (service version / disk use) on a live session
  sshTmuxList: 'ssh:tmuxList', // list remote tmux sessions
  sshTmuxAttach: 'ssh:tmuxAttach', // attach-or-create a remote tmux session
  sshForwardAdd: 'ssh:forwardAdd', // start a port forward on the live session
  sshForwardRemove: 'ssh:forwardRemove', // stop a port forward on the live session
  sshData: 'ssh:data', // main -> renderer : stdout/stderr
  sshEvent: 'ssh:event', // main -> renderer : status changes

  // Settings (invoke/handle)
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsStatus: 'settings:status',
  themeSet: 'theme:set',

  // Connection audit log (invoke/handle)
  connLogList: 'connLog:list',
  connLogClear: 'connLog:clear',
  connLogPush: 'connLog:push', // renderer -> main : record a transfer/forward event
  sftpDiffDirs: 'sftp:diffDirs', // compare a local & remote directory tree
  keysRevoke: 'keys:revoke', // remove a managed key's pub line from hosts

  // App master-lock (invoke/handle)
  lockStatus: 'lock:status',
  lockSetPassphrase: 'lock:setPassphrase',
  lockDisable: 'lock:disable',
  lockUnlock: 'lock:unlock',
  lockLockNow: 'lock:lockNow',
  lockReset: 'lock:reset',

  // Windows Hello user verification (invoke/handle)
  userVerifyStatus: 'userVerify:status',
  userVerifySetEnabled: 'userVerify:setEnabled',
  userVerifyTest: 'userVerify:test',

  // Misc
  pickKeyFile: 'dialog:pickKey',
  pickExecutable: 'dialog:pickExecutable',
  pickDirectory: 'dialog:pickDirectory',
  openExternal: 'shell:openExternal',
  notify: 'notify',

  // Launch target (CLI arg / x-ssh:// protocol) forwarded from main → renderer
  appOpenTarget: 'app:openTarget',

  // Update check against the GitHub releases feed (electron-updater when packaged)
  appCheckUpdate: 'app:checkUpdate',

  // Renderer → main: current updater state-machine snapshot (pull on settings mount)
  appGetUpdateState: 'app:getUpdateState',

  // Main → renderer: electron-updater state-machine transitions (AppUpdateState)
  appUpdateState: 'app:updateState',

  // Global (systemwide) hotkey: show/hide the main window
  appGlobalShortcut: 'app:globalShortcut',

  // Main → renderer: machine woke from sleep / unlock → re-evaluate connectivity
  appOnlineChanged: 'app:onlineChanged'
} as const

/**
 * electron-updater 更新状态机(main → renderer 广播,见 src/main/updater.ts)。
 * error 只放稳定机器码(分类见 updater.ts 的 classifyUpdateError;三语文案由
 * renderer 的 mainError.ts 出),原始异常全文只留在主进程日志,绝不上界面。
 */
export type AppUpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface AppUpdateState {
  phase: AppUpdatePhase
  /** 新版本号(available/downloading/downloaded 阶段)。 */
  latest?: string
  /** 该版本的 GitHub 发布页(前往下载用)。 */
  url?: string
  /** 下载百分比(downloading 阶段,0–100)。 */
  percent?: number
  /** error 阶段:只放稳定机器码(分类见 src/main/updater.ts 的 classifyUpdateError),
   *  绝不放文案或异常原文(原文只进主进程日志)。 */
  error?: string
  /** idle 且当次检查确认「无更新」(not-available 迁移携带,latest 同时=当前版本):
   *  设置面板重开时靠回读它显示「已是最新版本 X」,而不是「版本未知」。 */
  fresh?: boolean
}

/** Prefix of the launch argument carrying UiPrefs from main to the preload. */
export const PREFS_ARG = '--x-ssh-prefs='
