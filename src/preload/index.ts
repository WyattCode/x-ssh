import { contextBridge, ipcRenderer, clipboard, webUtils, webFrame } from 'electron'
import { IPC, PREFS_ARG } from '../shared/ipc'
import type {
  ConnectParams,
  ConnectResult,
  Host,
  HostForward,
  KnownHostEntry,
  ManagedKey,
  SessionEvent,
  SftpList,
  SftpProgress,
  Snippet,
  UiPrefs,
  LocalEntry
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
    save: (host: Host, password?: string, passphrase?: string): Promise<Host[]> =>
      ipcRenderer.invoke(IPC.hostsSave, host, password, passphrase),
    delete: (id: string): Promise<Host[]> => ipcRenderer.invoke(IPC.hostsDelete, id),
    importSshConfig: (): Promise<{ ok: boolean; count: number; error?: string }> =>
      ipcRenderer.invoke(IPC.hostsImportSshConfig),
    exportJson: (): Promise<{ ok: boolean; count?: number; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.hostsExportJson),
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
    forget: (host: string, port: number): Promise<void> =>
      ipcRenderer.invoke(IPC.knownHostsForget, host, port)
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
      ipcRenderer.invoke(IPC.localDelete, dir, name, isDir)
  },
  ssh: {
    connect: (params: ConnectParams): Promise<ConnectResult> =>
      ipcRenderer.invoke(IPC.sshConnect, params),
    disconnect: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.sshDisconnect, sessionId),
    forgetHostKey: (host: string, port: number): Promise<void> =>
      ipcRenderer.invoke(IPC.sshForgetHostKey, host, port),
    input: (sessionId: string, data: string): void =>
      ipcRenderer.send(IPC.sshInput, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number): void =>
      ipcRenderer.send(IPC.sshResize, sessionId, cols, rows),
    /** Call right after onData(): main flushes the output buffered since the
     *  shell opened, which would otherwise have been dropped. */
    attach: (sessionId: string): void => ipcRenderer.send(IPC.sshAttach, sessionId),
    onData: (cb: (payload: SshData) => void): (() => void) => {
      const listener = (_e: unknown, payload: SshData): void => cb(payload)
      ipcRenderer.on(IPC.sshData, listener)
      return () => ipcRenderer.removeListener(IPC.sshData, listener)
    },
    onEvent: (cb: (event: SessionEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: SessionEvent): void => cb(event)
      ipcRenderer.on(IPC.sshEvent, listener)
      return () => ipcRenderer.removeListener(IPC.sshEvent, listener)
    }
  },
  sftp: {
    list: (sessionId: string, path?: string): Promise<SftpList> =>
      ipcRenderer.invoke(IPC.sftpList, sessionId, path),
    download: (sessionId: string, remotePath: string, name: string, concurrency?: number): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpDownload, sessionId, remotePath, name, concurrency),
    downloadMany: (
      sessionId: string,
      items: { path: string; name: string; isDir: boolean }[],
      concurrency?: number
    ): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpDownloadMany, sessionId, items, concurrency),
    downloadTo: (
      sessionId: string,
      items: { path: string; name: string; isDir: boolean }[],
      targetDir: string,
      concurrency?: number
    ): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpDownloadTo, sessionId, items, targetDir, concurrency),
    revealLocal: (target: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.sftpRevealLocal, target),
    upload: (sessionId: string, remoteDir: string, concurrency?: number): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpUpload, sessionId, remoteDir, concurrency),
    uploadDir: (sessionId: string, remoteDir: string, concurrency?: number): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpUploadDir, sessionId, remoteDir, concurrency),
    uploadPaths: (sessionId: string, remoteDir: string, paths: string[], concurrency?: number): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpUploadPaths, sessionId, remoteDir, paths, concurrency),
    packDownload: (
      sessionId: string,
      items: { path: string; name: string; isDir: boolean }[],
      archiveName?: string
    ): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpPackDownload, sessionId, items, archiveName),
    extract: (sessionId: string, remoteDir: string, archiveFileName: string): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpExtract, sessionId, remoteDir, archiveFileName),
    uploadExtract: (sessionId: string, remoteDir: string, concurrency?: number): Promise<SftpResult> =>
      ipcRenderer.invoke(IPC.sftpUploadExtract, sessionId, remoteDir, concurrency),
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
    onProgress: (cb: (p: SftpProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: SftpProgress): void => cb(p)
      ipcRenderer.on(IPC.sftpProgress, listener)
      return () => ipcRenderer.removeListener(IPC.sftpProgress, listener)
    }
  },
  settings: {
    get: <T = unknown>(key: string): Promise<T | undefined> =>
      ipcRenderer.invoke(IPC.settingsGet, key),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke(IPC.settingsSet, key, value)
  },
  /** Opens a terminal link in the default browser (http/https only). */
  openExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.openExternal, url),
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
    generate: (opts: { name: string; type?: string; passphrase?: string; bits?: number }): Promise<{ ok: boolean; key?: ManagedKey; error?: string }> =>
      ipcRenderer.invoke(IPC.keysGenerate, opts),
    import: (): Promise<{ ok: boolean; key?: ManagedKey; error?: string; canceled?: boolean }> =>
      ipcRenderer.invoke(IPC.keysImport),
    del: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.keysDelete, id)
  },
  /** Resolve a dropped File's absolute path (File.path was removed in Electron 32+). */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  zoom: {
    get: (): number => webFrame.getZoomLevel(),
    set: (level: number): void => webFrame.setZoomLevel(level)
  },
  clipboard: {
    readText: (): string => clipboard.readText(),
    writeText: (text: string): void => clipboard.writeText(text)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
