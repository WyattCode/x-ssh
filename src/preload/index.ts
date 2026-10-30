import { contextBridge, ipcRenderer, clipboard, webUtils, webFrame } from 'electron'
import { IPC, PREFS_ARG } from '../shared/ipc'
import type {
  ConnectParams,
  ConnectResult,
  Host,
  HostForward,
  ForwardMode,
  ForwardErrorCode,
  KnownHostEntry,
  ManagedKey,
  SessionEvent,
  SftpList,
  SftpProgress,
  Snippet,
  UiPrefs,
  LocalEntry,
  UploadOverwrite,
  SettingsWriteResult,
  ThemePref,
  Reachability
} from '../shared/types'

/** Startup preferences main passed as a launch argument — no IPC, no storage. */
function initialPrefs(): UiPrefs {
  const arg = process.argv.find((a) => a.startsWith(PREFS_ARG))
  if (!arg) return {}
  try {
    return JSON.parse(arg.slice(PREFS_ARG.length)) as UiPrefs
  } catch {
    return {}
  }
}

interface SftpResult {
  ok: boolean
  canceled?: boolean
  count?: number
  error?: string
}

export interface SshData {
  sessionId: string
  data: string
}

const api = {
  prefs: initialPrefs(),
  hosts: {
    list: (): Promise<Host[]> => ipcRenderer.invoke(IPC.hostsList),
    secretsStatus: (): Promise<'ok' | 'missing' | 'bad'> =>
      ipcRenderer.invoke(IPC.hostsSecretsStatus),
    /** Online / offline for the given saved hosts (all when omitted). */
    probe: (ids?: string[]): Promise<Record<string, Reachability>> => ipcRenderer.invoke(IPC.hostsProbe, ids),
    onChanged: (cb: () => void): (() => void) => {
      const h = (): void => cb()
      ipcRenderer.on(IPC.hostsChanged, h)
      return () => ipcRenderer.removeListener(IPC.hostsChanged, h)
    },
    save: (host: Host, password?: string, passphrase?: string): Promise<Host[]> =>
      ipcRenderer.invoke(IPC.hostsSave, host, password, passphrase),
    delete: (id: string): Promise<Host[]> => ipcRenderer.invoke(IPC.hostsDelete, id),
    importSshConfig: (): Promise<{ ok: boolean; count: number; error?: string }> =>
      ipcRenderer.invoke(IPC.hostsImportSshConfig),
    exportJson: (): Promise<{ ok: boolean; count?: number; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.hostsExportJson),
    exportSshConfig: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.hostsExportSshConfig),
    importJson: (): Promise<{ ok: boolean; count?: number; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.hostsImportJson)
  },
  data: {
    exportAll: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.dataExportAll),
    importAll: (): Promise<{ ok: boolean; count?: number; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.dataImportAll),
    backupNow: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.dataBackupNow),
    rescheduleBackup: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.dataRescheduleBackup)
  },
  knownHosts: {
    list: (): Promise<KnownHostEntry[]> => ipcRenderer.invoke(IPC.knownHostsList),
    forget: (host: string, port: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.knownHostsForget, host, port)
  },
  connLog: {
    list: (): Promise<{ at: number; event: string; host: string; port: number; username: string; detail?: string; bytes?: number }[]> =>
      ipcRenderer.invoke(IPC.connLogList),
    clear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.connLogClear),
    push: (entry: { at: number; event: string; host: string; port: number; username: string; detail?: string; bytes?: number }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.connLogPush, entry)
  },
  lock: {
    status: (): Promise<{ enabled: boolean; locked: boolean }> =>
      ipcRenderer.invoke(IPC.lockStatus),
    setPassphrase: (passphrase: string): Promise<{ ok: boolean; enabled: boolean; locked: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.lockSetPassphrase, passphrase),
    disable: (passphrase: string): Promise<{ ok: boolean; enabled: boolean; locked: boolean }> =>
      ipcRenderer.invoke(IPC.lockDisable, passphrase),
    unlock: (passphrase: string): Promise<{ ok: boolean; enabled: boolean; locked: boolean }> =>
      ipcRenderer.invoke(IPC.lockUnlock, passphrase),
    lockNow: (): Promise<{ enabled: boolean; locked: boolean }> =>
      ipcRenderer.invoke(IPC.lockLockNow),
    reset: (passphrase: string): Promise<{ ok: boolean; enabled: boolean; locked: boolean }> =>
      ipcRenderer.invoke(IPC.lockReset, passphrase)
  },
  userVerify: {
    status: (): Promise<{
      supported: boolean
      enabled: boolean
      available: 'available' | 'unavailable' | 'unsupported'
      sessionUnlocked: boolean
    }> => ipcRenderer.invoke(IPC.userVerifyStatus),
    setEnabled: (on: boolean): Promise<{
      supported: boolean
      enabled: boolean
      available: 'available' | 'unavailable' | 'unsupported'
      sessionUnlocked: boolean
    }> => ipcRenderer.invoke(IPC.userVerifySetEnabled, on),
    test: (): Promise<{ outcome: 'verified' | 'canceled' | 'unavailable' | 'failed' | 'unsupported'; detail?: string }> =>
      ipcRenderer.invoke(IPC.userVerifyTest)
  },
  snippets: {
    list: (): Promise<Snippet[]> => ipcRenderer.invoke(IPC.snippetsList),
    save: (snippet: Snippet): Promise<Snippet[]> =>
      ipcRenderer.invoke(IPC.snippetsSave, snippet),
    delete: (id: string): Promise<Snippet[]> => ipcRenderer.invoke(IPC.snippetsDelete, id)
  },
  history: {
    list: (): Promise<{ sessionId: string; label: string; text: string }[]> =>
      ipcRenderer.invoke(IPC.historyList),
    export: (text: string): Promise<{ ok: boolean; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.historyExport, text)
  },
  local: {
    home: (): Promise<string> => ipcRenderer.invoke(IPC.localHome),
    list: (dir: string): Promise<{ path: string; entries: LocalEntry[] }> =>
      ipcRenderer.invoke(IPC.localList, dir),
    create: (dir: string, name: string, kind: 'file' | 'folder'): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.localCreate, dir, name, kind),
    rename: (dir: string, oldName: string, newName: string): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.localRename, dir, oldName, newName),
    del: (dir: string, name: string, isDir: boolean): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.localDelete, dir, name, isDir),
    readText: (path: string): Promise<{ ok: boolean; content?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.localReadText, path),
    pickFile: (): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.localPickFile)
  },
  ssh: {
    connect: (params: ConnectParams): Promise<ConnectResult> =>
      ipcRenderer.invoke(IPC.sshConnect, params),
    disconnect: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.sshDisconnect, sessionId),
    forgetHostKey: (host: string, port: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.sshForgetHostKey, host, port),
    trustHostKey: (
      host: string,
      port: number,
      fingerprint: string
    ): Promise<{ ok: boolean; code?: 'corrupt' | 'rejected' | 'error'; error?: string }> =>
      ipcRenderer.invoke(IPC.sshTrustHostKey, host, port, fingerprint),
    input: (sessionId: string, data: string): void =>
      ipcRenderer.send(IPC.sshInput, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number): void =>
      ipcRenderer.send(IPC.sshResize, sessionId, cols, rows),
    /** Call right after onData(): main flushes the output buffered since the
     *  shell opened, which would otherwise have been dropped. */
    attach: (sessionId: string): void => ipcRenderer.send(IPC.sshAttach, sessionId),
    startLog: (sessionId: string): Promise<{ ok: boolean; canceled?: boolean; path?: string }> =>
      ipcRenderer.invoke(IPC.sessionLogStart, sessionId),
    stopLog: (sessionId: string): void => ipcRenderer.send(IPC.sessionLogStop, sessionId),
    /** Fires when a live log stream fails mid-write (disk full, dir removed);
     *  main has already stopped logging — the renderer should clear its state. */
    onLogFailed: (cb: (payload: { sessionId: string }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { sessionId: string }): void => cb(payload)
      ipcRenderer.on(IPC.sessionLogFailed, listener)
      return () => ipcRenderer.removeListener(IPC.sessionLogFailed, listener)
    },
    onData: (cb: (payload: SshData) => void): (() => void) => {
      const listener = (_e: unknown, payload: SshData): void => cb(payload)
      ipcRenderer.on(IPC.sshData, listener)
      return () => ipcRenderer.removeListener(IPC.sshData, listener)
    },
    onEvent: (cb: (event: SessionEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: SessionEvent): void => cb(event)
      ipcRenderer.on(IPC.sshEvent, listener)
      return () => ipcRenderer.removeListener(IPC.sshEvent, listener)
    },
    tmuxList: (sessionId: string): Promise<string[]> =>
      ipcRenderer.invoke(IPC.sshTmuxList, sessionId),
    tmuxAttach: (sessionId: string, name: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.sshTmuxAttach, sessionId, name),
    forwardAdd: (sessionId: string, rule: HostForward): Promise<{ ok: boolean; error?: string; code?: ForwardErrorCode }> =>
      ipcRenderer.invoke(IPC.sshForwardAdd, sessionId, rule),
    forwardRemove: (
      sessionId: string,
      rule: { mode?: ForwardMode; localPort: number }
    ): Promise<{ ok: boolean; error?: string; code?: ForwardErrorCode }> =>
      ipcRenderer.invoke(IPC.sshForwardRemove, sessionId, rule)
  },
  sftp: {
    list: (sessionId: string, path?: string): Promise<SftpList> =>
      ipcRenderer.invoke(IPC.sftpList, sessionId, path),
    download: (sessionId: string, remotePath: string, name: string, concurrency?: number): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpDownload, sessionId, remotePath, name, concurrency),
    downloadMany: (
      sessionId: string,
      items: { path: string; name: string; isDir: boolean }[],
      concurrency?: number,
      overwriteLocal?: boolean
    ): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpDownloadMany, sessionId, items, concurrency, overwriteLocal),
    downloadTo: (
      sessionId: string,
      items: { path: string; name: string; isDir: boolean }[],
      targetDir: string,
      concurrency?: number,
      overwriteLocal?: boolean
    ): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpDownloadTo, sessionId, items, targetDir, concurrency, overwriteLocal),
    revealLocal: (target: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.sftpRevealLocal, target),
    upload: (sessionId: string, remoteDir: string, concurrency?: number, overwrite?: UploadOverwrite): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpUpload, sessionId, remoteDir, concurrency, overwrite),
    uploadDir: (sessionId: string, remoteDir: string, concurrency?: number, overwrite?: UploadOverwrite): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpUploadDir, sessionId, remoteDir, concurrency, overwrite),
    uploadPaths: (sessionId: string, remoteDir: string, paths: string[], concurrency?: number, overwrite?: UploadOverwrite): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpUploadPaths, sessionId, remoteDir, paths, concurrency, overwrite),
    sync: (
      sessionId: string,
      localDir: string,
      remoteDir: string,
      mode: 'up' | 'down' | 'both',
      deleteExtras: boolean,
      concurrency?: number
    ): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpSync, sessionId, localDir, remoteDir, mode, deleteExtras, concurrency),
    watchStart: (
      sessionId: string,
      localDir: string,
      remoteDir: string,
      mode: 'up' | 'down' | 'both',
      deleteExtras: boolean,
      intervalSec: number
    ): Promise<{ ok: boolean; watchId?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.sftpWatchStart, sessionId, localDir, remoteDir, mode, deleteExtras, intervalSec),
    watchStop: (sessionId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.sftpWatchStop, sessionId),
    diffDirs: (
      sessionId: string,
      localDir: string,
      remoteDir: string
    ): Promise<{ ok: boolean; onlyLocal?: string[]; onlyRemote?: string[]; sizeDiff?: string[]; error?: string }> =>
      ipcRenderer.invoke(IPC.sftpDiffDirs, sessionId, localDir, remoteDir),
    packDownload: (
      sessionId: string,
      items: { path: string; name: string; isDir: boolean }[],
      archiveName?: string
    ): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpPackDownload, sessionId, items, archiveName),
    extract: (sessionId: string, remoteDir: string, archiveFileName: string): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpExtract, sessionId, remoteDir, archiveFileName),
    uploadExtract: (sessionId: string, remoteDir: string, concurrency?: number, overwrite?: UploadOverwrite): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpUploadExtract, sessionId, remoteDir, concurrency, overwrite),
    mkdir: (sessionId: string, path: string): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpMkdir, sessionId, path),
    createFile: (sessionId: string, path: string): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpCreateFile, sessionId, path),
    rename: (sessionId: string, oldPath: string, newPath: string): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpRename, sessionId, oldPath, newPath),
    remove: (sessionId: string, path: string, isDir: boolean): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpDelete, sessionId, path, isDir),
    chmod: (
      sessionId: string,
      path: string,
      mode: number,
      recursive: boolean,
      isDir: boolean
    ): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpChmod, sessionId, path, mode, recursive, isDir),
    readText: (
      sessionId: string,
      path: string
    ): Promise<{ ok: boolean; content?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.sftpReadText, sessionId, path),
    readBinary: (
      sessionId: string,
      path: string
    ): Promise<{ ok: boolean; base64?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.sftpReadBinary, sessionId, path),
    writeText: (sessionId: string, path: string, content: string): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpWriteText, sessionId, path, content),
    editExternal: (sessionId: string, path: string, name: string): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpEditExternal, sessionId, path, name),
    openWith: (sessionId: string, path: string, name: string, program?: string): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpOpenWith, sessionId, path, name, program),
    startDrag: (sessionId: string, items: { remotePath: string; name: string; isDir: boolean }[]): void =>
      ipcRenderer.send(IPC.sftpStartDrag, sessionId, items),
    prefetchDrag: (sessionId: string, items: { remotePath: string; name: string; isDir: boolean }[]): void =>
      ipcRenderer.send(IPC.sftpPrefetchDrag, sessionId, items),
    cancel: (id: string): void => ipcRenderer.send(IPC.sftpCancel, id),
    pause: (id: string, paused: boolean): void => ipcRenderer.send(IPC.sftpPause, id, paused),
    pauseAll: (paused: boolean): void => ipcRenderer.send(IPC.sftpPauseAll, paused),
    setRate: (id: string, bytesPerSec: number): void => ipcRenderer.send(IPC.sftpSetRate, id, bytesPerSec),
    onProgress: (cb: (p: SftpProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: SftpProgress): void => cb(p)
      ipcRenderer.on(IPC.sftpProgress, listener)
      return () => ipcRenderer.removeListener(IPC.sftpProgress, listener)
    }
  },
  settings: {
    get: <T = unknown>(key: string): Promise<T | undefined> =>
      ipcRenderer.invoke(IPC.settingsGet, key),
    /** Resolves `{ ok: false }` when main refuses the key — see SettingsWriteResult. */
    set: (key: string, value: unknown): Promise<SettingsWriteResult> =>
      ipcRenderer.invoke(IPC.settingsSet, key, value),
    status: (): Promise<'ok' | 'bad'> => ipcRenderer.invoke(IPC.settingsStatus)
  },
  theme: {
    /** Saves the appearance choice and pins the native theme (title bar) to it.
     *  Resolves whether the window is now dark — for 'system', the OS's real
     *  setting, so the renderer can switch without a wrong-color frame first. */
    set: (pref: ThemePref): Promise<{ ok: boolean; dark: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.themeSet, pref)
  },
  /** Opens a terminal link in the default browser (http/https only). */
  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.openExternal, url),
  /** A launch target (CLI `-c` / x-ssh:// URL) from main, to open a connection. */
  onOpenTarget: (cb: (target: string) => void): (() => void) => {
    const listener = (_e: unknown, target: string): void => cb(target)
    ipcRenderer.on(IPC.appOpenTarget, listener)
    return () => ipcRenderer.removeListener(IPC.appOpenTarget, listener)
  },
  /** Machine woke from sleep / screen unlocked → re-evaluate connectivity. */
  onOnlineChanged: (cb: (online: boolean) => void): (() => void) => {
    const listener = (_e: unknown, online: boolean): void => cb(online)
    ipcRenderer.on(IPC.appOnlineChanged, listener)
    return () => ipcRenderer.removeListener(IPC.appOnlineChanged, listener)
  },
  checkUpdate: (): Promise<{
    ok: boolean
    fresh?: boolean
    current?: string
    latest?: string
    url?: string
    name?: string
    notes?: string
    error?: string
  }> => ipcRenderer.invoke(IPC.appCheckUpdate),
  /** Register/replace (or clear, with '') the global show/hide hotkey. */
  setGlobalShortcut: (accelerator: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.appGlobalShortcut, accelerator),
  /** Shows a native notification (respects the notifications/notifySound settings). */
  notify: (title: string, body: string, sound = false): void =>
    ipcRenderer.send(IPC.notify, title, body, sound),
  pickKeyFile: (): Promise<string | undefined> => ipcRenderer.invoke(IPC.pickKeyFile),
  pickExecutable: (): Promise<string | undefined> =>
    ipcRenderer.invoke(IPC.pickExecutable),
  pickDirectory: (): Promise<string | undefined> =>
    ipcRenderer.invoke(IPC.pickDirectory),
  keys: {
    list: (): Promise<ManagedKey[]> => ipcRenderer.invoke(IPC.keysList),
    generate: (opts: { name: string; type?: string; passphrase?: string; bits?: number }): Promise<{ ok: boolean; key?: ManagedKey; error?: string; code?: string }> =>
    labelsStatus: (): Promise<{ loadFailed: boolean }> => ipcRenderer.invoke(IPC.keysLabelsStatus),
    generate: (opts: { name: string; type?: string; passphrase?: string; bits?: number }): Promise<{ ok: boolean; key?: ManagedKey; error?: string }> =>
      ipcRenderer.invoke(IPC.keysGenerate, opts),
    import: (): Promise<{ ok: boolean; key?: ManagedKey; error?: string; code?: string; canceled?: boolean }> =>
      ipcRenderer.invoke(IPC.keysImport),
    del: (id: string): Promise<{ ok: boolean; error?: string; code?: string }> => ipcRenderer.invoke(IPC.keysDelete, id),
    publicKey: (id: string): Promise<{ ok: boolean; text?: string; error?: string; code?: string }> =>
      ipcRenderer.invoke(IPC.keysPublicKey, id),
    publish: (
      keyId: string,
      hostIds: string[]
    ): Promise<{ ok: boolean; results?: { host: string; ok: boolean; error?: string }[]; error?: string; code?: string }> =>
      ipcRenderer.invoke(IPC.keysPublish, keyId, hostIds),
    revoke: (
      keyId: string,
      hostIds: string[]
    ): Promise<{ ok: boolean; results?: { host: string; ok: boolean; error?: string }[]; error?: string; code?: string }> =>
      ipcRenderer.invoke(IPC.keysRevoke, keyId, hostIds)
  },
  /** Resolve a dropped File's absolute path (File.path was removed in Electron 32+). */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** Host OS, so the renderer can pick the right modifier (⌘ on macOS, Ctrl elsewhere). */
  platform: process.platform,
  zoom: {
    get: (): number => webFrame.getZoomLevel(),
    set: (level: number): void => webFrame.setZoomLevel(level)
  },
  clipboard: {
    readText: (): string => clipboard.readText(),
    writeText: (text: string): void => clipboard.writeText(text)
  }
}

// The saved zoom goes on before the page's first paint; restored later from
// App.vue it showed one frame at 100 % and then jumped.
{
  const z = Number(api.prefs.zoom)
  if (Number.isFinite(z) && z !== 0) webFrame.setZoomLevel(z)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
