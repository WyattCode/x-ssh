/** Centralized IPC channel names so main/preload/renderer never drift. */
export const IPC = {
  // Host store (invoke/handle)
  hostsList: 'hosts:list',
  hostsSave: 'hosts:save',
  hostsDelete: 'hosts:delete',
  hostsImportSshConfig: 'hosts:importSshConfig',
  hostsExportJson: 'hosts:exportJson',
  hostsImportJson: 'hosts:importJson',

  // SSH key library (invoke/handle)
  keysList: 'keys:list',
  keysGenerate: 'keys:generate',
  keysImport: 'keys:import',
  keysDelete: 'keys:delete',

  // SSH lifecycle (invoke/handle)
  sshConnect: 'ssh:connect',
  sshDisconnect: 'ssh:disconnect',
  sshForgetHostKey: 'ssh:forgetHostKey',

  // Known-hosts management (invoke/handle)
  knownHostsList: 'knownHosts:list',
  knownHostsForget: 'knownHosts:forget',

  // Cross-session output history (invoke/handle)
  historyList: 'history:list',

  // Local filesystem browsing (dual-panel SFTP) (invoke/handle)
  localList: 'local:list',
  localHome: 'local:home',
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
  sftpMkdir: 'sftp:mkdir',
  sftpCreateFile: 'sftp:createFile',
  sftpRename: 'sftp:rename',
  sftpDelete: 'sftp:delete',
  sftpChmod: 'sftp:chmod',
  sftpCancel: 'sftp:cancel',
  sftpReadText: 'sftp:readText',
  sftpWriteText: 'sftp:writeText',
  sftpEditExternal: 'sftp:editExternal',
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
  sshData: 'ssh:data', // main -> renderer : stdout/stderr
  sshEvent: 'ssh:event', // main -> renderer : status changes

  // Settings (invoke/handle)
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  // Misc
  pickKeyFile: 'dialog:pickKey',
  pickExecutable: 'dialog:pickExecutable',
  openExternal: 'shell:openExternal',
  notify: 'notify'
} as const

/** Prefix of the launch argument carrying UiPrefs from main to the preload. */
export const PREFS_ARG = '--x-ssh-prefs='
