import { contextBridge, clipboard, webFrame, webUtils, ipcRenderer } from "electron";
const IPC = {
  // Host store (invoke/handle)
  hostsList: "hosts:list",
  hostsSave: "hosts:save",
  hostsDelete: "hosts:delete",
  hostsImportSshConfig: "hosts:importSshConfig",
  hostsExportJson: "hosts:exportJson",
  hostsImportJson: "hosts:importJson",
  // SSH key library (invoke/handle)
  keysList: "keys:list",
  keysGenerate: "keys:generate",
  keysImport: "keys:import",
  keysDelete: "keys:delete",
  // SSH lifecycle (invoke/handle)
  sshConnect: "ssh:connect",
  sshDisconnect: "ssh:disconnect",
  sshForgetHostKey: "ssh:forgetHostKey",
  // Known-hosts management (invoke/handle)
  knownHostsList: "knownHosts:list",
  knownHostsForget: "knownHosts:forget",
  // Cross-session output history (invoke/handle)
  historyList: "history:list",
  // Local filesystem browsing (dual-panel SFTP) (invoke/handle)
  localList: "local:list",
  localHome: "local:home",
  localCreate: "local:create",
  localRename: "local:rename",
  localDelete: "local:delete",
  // Command snippets (invoke/handle)
  snippetsList: "snippets:list",
  snippetsSave: "snippets:save",
  snippetsDelete: "snippets:delete",
  // SFTP (invoke/handle)
  sftpList: "sftp:list",
  sftpDownload: "sftp:download",
  sftpDownloadMany: "sftp:downloadMany",
  sftpDownloadTo: "sftp:downloadTo",
  sftpUpload: "sftp:upload",
  sftpUploadDir: "sftp:uploadDir",
  sftpUploadPaths: "sftp:uploadPaths",
  sftpMkdir: "sftp:mkdir",
  sftpCreateFile: "sftp:createFile",
  sftpRename: "sftp:rename",
  sftpDelete: "sftp:delete",
  sftpChmod: "sftp:chmod",
  sftpCancel: "sftp:cancel",
  sftpReadText: "sftp:readText",
  sftpWriteText: "sftp:writeText",
  sftpEditExternal: "sftp:editExternal",
  sftpRevealLocal: "sftp:revealLocal",
  // show a finished download in the OS file manager
  sftpStartDrag: "sftp:startDrag",
  // renderer -> main (drag out)
  sftpPrefetchDrag: "sftp:prefetchDrag",
  // renderer -> main : pre-fetch for drag-out
  sftpProgress: "sftp:progress",
  // main -> renderer
  sftpPackDownload: "sftp:packDownload",
  // remote tar.zip -> download
  sftpExtract: "sftp:extract",
  // extract uploaded archive on remote
  sftpUploadExtract: "sftp:uploadExtract",
  // upload archive then extract on remote
  // SSH data stream (send, no reply)
  sshInput: "ssh:input",
  // renderer -> main : keystrokes
  sshResize: "ssh:resize",
  // renderer -> main : pty resize
  sshAttach: "ssh:attach",
  // renderer -> main : listener ready, flush buffered output
  sshData: "ssh:data",
  // main -> renderer : stdout/stderr
  sshEvent: "ssh:event",
  // main -> renderer : status changes
  // Settings (invoke/handle)
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  // Misc
  pickKeyFile: "dialog:pickKey",
  pickExecutable: "dialog:pickExecutable",
  openExternal: "shell:openExternal",
  notify: "notify"
};
const PREFS_ARG = "--x-ssh-prefs=";
function initialPrefs() {
  const arg = process.argv.find((a) => a.startsWith(PREFS_ARG));
  if (!arg) return {};
  try {
    return JSON.parse(arg.slice(PREFS_ARG.length));
  } catch {
    return {};
  }
}
function toPlain(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => toPlain(v));
  if (value instanceof Date) return new Date(value);
  const out = {};
  for (const key of Object.keys(value)) out[key] = toPlain(value[key]);
  return out;
}
const api = {
  prefs: initialPrefs(),
  hosts: {
    list: () => ipcRenderer.invoke(IPC.hostsList),
    save: (host, password, passphrase) => ipcRenderer.invoke(IPC.hostsSave, host, password, passphrase),
    delete: (id) => ipcRenderer.invoke(IPC.hostsDelete, id),
    importSshConfig: () => ipcRenderer.invoke(IPC.hostsImportSshConfig),
    exportJson: () => ipcRenderer.invoke(IPC.hostsExportJson),
    importJson: () => ipcRenderer.invoke(IPC.hostsImportJson)
  },
  knownHosts: {
    list: () => ipcRenderer.invoke(IPC.knownHostsList),
    forget: (host, port) => ipcRenderer.invoke(IPC.knownHostsForget, host, port)
  },
  snippets: {
    list: () => ipcRenderer.invoke(IPC.snippetsList),
    save: (snippet) => ipcRenderer.invoke(IPC.snippetsSave, snippet),
    delete: (id) => ipcRenderer.invoke(IPC.snippetsDelete, id)
  },
  history: {
    list: () => ipcRenderer.invoke(IPC.historyList)
  },
  local: {
    home: () => ipcRenderer.invoke(IPC.localHome),
    list: (dir) => ipcRenderer.invoke(IPC.localList, dir),
    create: (dir, name, kind) => ipcRenderer.invoke(IPC.localCreate, dir, name, kind),
    rename: (dir, oldName, newName) => ipcRenderer.invoke(IPC.localRename, dir, oldName, newName),
    del: (dir, name, isDir) => ipcRenderer.invoke(IPC.localDelete, dir, name, isDir)
  },
  ssh: {
    connect: (params) => ipcRenderer.invoke(IPC.sshConnect, params),
    disconnect: (sessionId) => ipcRenderer.invoke(IPC.sshDisconnect, sessionId),
    forgetHostKey: (host, port) => ipcRenderer.invoke(IPC.sshForgetHostKey, host, port),
    input: (sessionId, data) => ipcRenderer.send(IPC.sshInput, sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.sshResize, sessionId, cols, rows),
    /** Call right after onData(): main flushes the output buffered since the
     *  shell opened, which would otherwise have been dropped. */
    attach: (sessionId) => ipcRenderer.send(IPC.sshAttach, sessionId),
    onData: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on(IPC.sshData, listener);
      return () => ipcRenderer.removeListener(IPC.sshData, listener);
    },
    onEvent: (cb) => {
      const listener = (_e, event) => cb(event);
      ipcRenderer.on(IPC.sshEvent, listener);
      return () => ipcRenderer.removeListener(IPC.sshEvent, listener);
    }
  },
  sftp: {
    list: (sessionId, path) => ipcRenderer.invoke(IPC.sftpList, sessionId, path),
    download: (sessionId, remotePath, name, concurrency) => ipcRenderer.invoke(IPC.sftpDownload, sessionId, remotePath, name, concurrency),
    downloadMany: (sessionId, items, concurrency) => ipcRenderer.invoke(IPC.sftpDownloadMany, sessionId, items, concurrency),
    downloadTo: (sessionId, items, targetDir, concurrency) => ipcRenderer.invoke(IPC.sftpDownloadTo, sessionId, items, targetDir, concurrency),
    revealLocal: (target) => ipcRenderer.invoke(IPC.sftpRevealLocal, target),
    upload: (sessionId, remoteDir, concurrency) => ipcRenderer.invoke(IPC.sftpUpload, sessionId, remoteDir, concurrency),
    uploadDir: (sessionId, remoteDir, concurrency) => ipcRenderer.invoke(IPC.sftpUploadDir, sessionId, remoteDir, concurrency),
    uploadPaths: (sessionId, remoteDir, paths, concurrency) => ipcRenderer.invoke(IPC.sftpUploadPaths, sessionId, remoteDir, paths, concurrency),
    packDownload: (sessionId, items, archiveName) => ipcRenderer.invoke(IPC.sftpPackDownload, sessionId, items, archiveName),
    extract: (sessionId, remoteDir, archiveFileName) => ipcRenderer.invoke(IPC.sftpExtract, sessionId, remoteDir, archiveFileName),
    uploadExtract: (sessionId, remoteDir, concurrency) => ipcRenderer.invoke(IPC.sftpUploadExtract, sessionId, remoteDir, concurrency),
    mkdir: (sessionId, path) => ipcRenderer.invoke(IPC.sftpMkdir, sessionId, path),
    createFile: (sessionId, path) => ipcRenderer.invoke(IPC.sftpCreateFile, sessionId, path),
    rename: (sessionId, oldPath, newPath) => ipcRenderer.invoke(IPC.sftpRename, sessionId, oldPath, newPath),
    remove: (sessionId, path, isDir) => ipcRenderer.invoke(IPC.sftpDelete, sessionId, path, isDir),
    chmod: (sessionId, path, mode, recursive, isDir) => ipcRenderer.invoke(IPC.sftpChmod, sessionId, path, mode, recursive, isDir),
    readText: (sessionId, path) => ipcRenderer.invoke(IPC.sftpReadText, sessionId, path),
    writeText: (sessionId, path, content) => ipcRenderer.invoke(IPC.sftpWriteText, sessionId, path, content),
    editExternal: (sessionId, path, name) => ipcRenderer.invoke(IPC.sftpEditExternal, sessionId, path, name),
    startDrag: (sessionId, items) => ipcRenderer.send(IPC.sftpStartDrag, sessionId, items),
    prefetchDrag: (sessionId, items) => ipcRenderer.send(IPC.sftpPrefetchDrag, sessionId, items),
    cancel: (id) => ipcRenderer.send(IPC.sftpCancel, id),
    onProgress: (cb) => {
      const listener = (_e, p) => cb(p);
      ipcRenderer.on(IPC.sftpProgress, listener);
      return () => ipcRenderer.removeListener(IPC.sftpProgress, listener);
    }
  },
  settings: {
    get: (key) => ipcRenderer.invoke(IPC.settingsGet, key),
    set: (key, value) => ipcRenderer.invoke(IPC.settingsSet, key, toPlain(value))
  },
  /** Opens a terminal link in the default browser (http/https only). */
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  /** Shows a native notification (respects the user's notifications setting). */
  notify: (title, body) => ipcRenderer.send(IPC.notify, title, body),
  pickKeyFile: () => ipcRenderer.invoke(IPC.pickKeyFile),
  pickExecutable: () => ipcRenderer.invoke(IPC.pickExecutable),
  keys: {
    list: () => ipcRenderer.invoke(IPC.keysList),
    generate: (opts) => ipcRenderer.invoke(IPC.keysGenerate, opts),
    import: () => ipcRenderer.invoke(IPC.keysImport),
    del: (id) => ipcRenderer.invoke(IPC.keysDelete, id)
  },
  /** Resolve a dropped File's absolute path (File.path was removed in Electron 32+). */
  getPathForFile: (file) => webUtils.getPathForFile(file),
  zoom: {
    get: () => webFrame.getZoomLevel(),
    set: (level) => webFrame.setZoomLevel(level)
  },
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text)
  }
};
contextBridge.exposeInMainWorld("api", api);
