/** Centralized IPC channel names so main/preload/renderer never drift. */
export const IPC = {
  // Host store (invoke/handle)
  hostsList: 'hosts:list',
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
  dataRescheduleBackup: 'data:rescheduleBackup', // re-read auto-backup prefs & restart timer

  // SSH key library (invoke/handle)
  keysList: 'keys:list',
  keysGenerate: 'keys:generate',
  keysImport: 'keys:import',
  keysDelete: 'keys:delete',
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
  sftpStartDrag: 'sftp:startDrag', // renderer -> main (drag out)
  sftpPrefetchDrag: 'sftp:prefetchDrag', // renderer -> main : pre-fetch for drag-out
  sftpProgress: 'sftp:progress', // main -> renderer
  sftpPackDownload: 'sftp:packDownload', // remote tar.zip -> download
  sftpExtract: 'sftp:extract', // extract uploaded archive on remote
  sftpUploadExtract: 'sftp:uploadExtract', // upload archive then extract on remote

  // SSH data stream (send, no reply)
  sshInput: 'ssh:input', // renderer -> main : keystrokes
  sshResize: 'ssh:resize', // renderer -> main : pty resize
  sshAttach: 'ssh:attach', // renderer -> main : listener ready, flush buffered output
  sshTmuxList: 'ssh:tmuxList', // list remote tmux sessions
  sshTmuxAttach: 'ssh:tmuxAttach', // attach-or-create a remote tmux session
  sshForwardAdd: 'ssh:forwardAdd', // start a port forward on the live session
  sshForwardRemove: 'ssh:forwardRemove', // stop a port forward on the live session
  sshData: 'ssh:data', // main -> renderer : stdout/stderr
  sshEvent: 'ssh:event', // main -> renderer : status changes

  // Settings (invoke/handle)
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
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

  // Misc
  pickKeyFile: 'dialog:pickKey',
  pickExecutable: 'dialog:pickExecutable',
  pickDirectory: 'dialog:pickDirectory',
  openExternal: 'shell:openExternal',
  notify: 'notify',

  // Launch target (CLI arg / x-ssh:// protocol) forwarded from main → renderer
  appOpenTarget: 'app:openTarget',

  // Update check against the GitHub releases feed
  appCheckUpdate: 'app:checkUpdate',

  // Global (systemwide) hotkey: show/hide the main window
  appGlobalShortcut: 'app:globalShortcut',

  // Main → renderer: machine woke from sleep / unlock → re-evaluate connectivity
  appOnlineChanged: 'app:onlineChanged'
} as const

/** Prefix of the launch argument carrying UiPrefs from main to the preload. */
export const PREFS_ARG = '--x-ssh-prefs='
