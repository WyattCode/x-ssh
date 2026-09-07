import { app, shell, BrowserWindow, ipcMain, dialog, nativeImage, screen, Menu, Notification } from 'electron'
import { join, dirname, basename, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir, homedir } from 'node:os'
import { mkdtemp, rm, readFile, stat, readdir, mkdir, unlink, rename, writeFile } from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'
import { spawn } from 'node:child_process'
import { IPC, PREFS_ARG } from '../shared/ipc'
import type { ConnectParams, Host, JumpConfig, LocalEntry, Snippet, UiPrefs } from '../shared/types'
import { SshManager } from './ssh'
import { HostStore } from './store'
import { KnownHosts } from './knownHosts'
import { SettingsStore } from './settings'
import { friendlyError } from './friendlyError'
import { KeyManager } from './keyManager'

const store = new HostStore()
const knownHosts = new KnownHosts()
const settings = new SettingsStore()
const keyManager = new KeyManager(app.getPath('userData'))
const activeEdits = new Set<string>()
// Cache of drag-out downloads keyed by session:paths, so files prefetched on
// mousedown are ready by the time the drag gesture reaches startDrag.
const dragCache = new Map<string, Promise<{ dir: string; local: string }>>()
let sshManager: SshManager | null = null

export interface DragItem {
  remotePath: string
  name: string
  isDir: boolean
}

function prefetchDrag(sessionId: string, items: DragItem[]): Promise<{ dir: string; local: string }> {
  const key = `${sessionId}:${items.map((i) => i.remotePath).join('|')}`
  let p = dragCache.get(key)
  if (!p) {
    p = (async () => {
      const dir = await mkdtemp(join(tmpdir(), 'xssh-drag-'))
      for (const it of items) {
        await sshManager!.downloadTree(sessionId, it.remotePath, dir, it.name, it.isDir)
      }
      // A single file drags out as that file; multiple items (or a folder)
      // land in a temporary directory, which Explorer accepts as a drop.
      const local = items.length === 1 && !items[0].isDir
        ? join(dir, items[0].name)
        : dir
      return { dir, local }
    })()
    dragCache.set(key, p)
    // Expire the cache and delete the temp dir after a minute.
    const cached = p
    setTimeout(() => {
      dragCache.delete(key)
      void cached
        .then(({ dir }) => rm(dir, { recursive: true, force: true }))
        .catch(() => undefined)
    }, 60_000)
  }
  return p
}

// Tiny cursor image for native drag-out operations.
const DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
)

interface SavedBounds {
  width: number
  height: number
  maximized?: boolean
}

/** True for plain web URLs — the only thing we hand to the OS to open. */
function isWebUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

async function notifyEnabled(): Promise<boolean> {
  return (await settings.get<boolean>('notifications')) !== false
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body, silent: true }).show()
}

// ---- Command snippets (stored in settings.json under 'snippets') ----
async function listSnippets(): Promise<Snippet[]> {
  return (await settings.get<Snippet[]>('snippets')) ?? []
}
async function saveSnippet(snippet: Snippet): Promise<Snippet[]> {
  const all = await listSnippets()
  const i = all.findIndex((s) => s.id === snippet.id)
  const clean = {
    id: snippet.id,
    title: snippet.title,
    text: snippet.text
  }
  if (i >= 0) all[i] = clean
  else all.unshift(clean)
  await settings.set('snippets', all)
  return all
}
async function deleteSnippet(id: string): Promise<Snippet[]> {
  const all = (await listSnippets()).filter((s) => s.id !== id)
  await settings.set('snippets', all)
  return all
}

// ---- OpenSSH ~/.ssh/config import ----
interface SshConfigHost {
  host: string
  hostname?: string
  user?: string
  port?: number
  identityFile?: string
  proxyJump?: string
}
/** Minimal single-pass parser for the common OpenSSH `Host` blocks. */
function parseSshConfig(raw: string): SshConfigHost[] {
  const out: SshConfigHost[] = []
  let current: SshConfigHost | null = null
  let inHost = false
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const t = line.replace(/#.*$/, '').trim()
    if (!t) continue
    // Line-continuation is rare; treat a trailing backslash-wrapped line as part
    // of the previous (OpenSSH allows it, but we only need the common cases).
    const m = /^([\w]+)\s+(.*)$/.exec(t)
    if (!m) continue
    const [, key, rest] = m
    if (key.toLowerCase() === 'host') {
      if (current) out.push(current)
      // A Host line may name several patterns; we take the first literal name.
      const first = rest.split(/\s+/)[0]
      current = { host: first }
      inHost = !first.startsWith('!')
      continue
    }
    if (!current || !inHost) continue
    const val = rest.trim()
    switch (key.toLowerCase()) {
      case 'hostname':
        current.hostname = val
        break
      case 'user':
        current.user = val
        break
      case 'port':
        current.port = Number(val) || 22
        break
      case 'identityfile':
        current.identityFile = val.replace(/^~/, homedir())
        break
      case 'proxyjump':
        current.proxyJump = val.split(',')[0]
        break
    }
  }
  if (current) out.push(current)
  return out
}

/** Imports hosts from the user's OpenSSH config, skipping ones already present. */
async function importSshConfig(): Promise<{ ok: boolean; count: number; error?: string }> {
  const cfgPath = join(homedir(), '.ssh', 'config')
  let raw: string
  try {
    raw = await readFile(cfgPath, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, count: 0, error: '未找到 ~/.ssh/config' }
    return { ok: false, count: 0, error: friendlyError((e as Error).message) }
  }
  const parsed = parseSshConfig(raw)
  const existing = new Set((await store.list()).map((h) => `${h.host}:${h.port}:${h.username}`))
  let count = 0
  for (const c of parsed) {
    if (c.host.startsWith('!') || c.host === '*') continue
    const user = c.user || 'root'
    const port = c.port || 22
    const key = `${c.hostname || c.host}:${port}:${user}`
    if (existing.has(key)) continue
    const host: Host = {
      id: `host-import-${Date.now()}-${count}`,
      label: c.host,
      host: c.hostname || c.host,
      port,
      username: user,
      auth: c.identityFile ? 'key' : 'password',
      keyPath: c.identityFile,
      group: 'OpenSSH'
    }
    await store.save(host)
    existing.add(key)
    count++
  }
  return { ok: true, count }
}

/** Reads the handful of preferences the renderer needs before its first paint. */
async function readUiPrefs(): Promise<UiPrefs> {
  const [theme, fontSize, zoom, sftpShowHidden, sftpWidth, lang] = await Promise.all([
    settings.get<'light' | 'dark'>('theme'),
    settings.get<number>('fontSize'),
    settings.get<number>('zoom'),
    settings.get<boolean>('sftpShowHidden'),
    settings.get<number>('sftpWidth'),
    settings.get<'zh' | 'en'>('lang')
  ])
  return { theme, fontSize, zoom, sftpShowHidden, sftpWidth, lang }
}

function createWindow(saved?: SavedBounds, prefs: UiPrefs = {}): void {
  // Restore the last size (never the position — the window always opens
  // centered), on whichever display the pointer is on, so a second monitor
  // gets the window rather than always the primary one.
  const { x: dx, y: dy, width: sw, height: sh } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  ).workArea
  const useSaved = !!saved && saved.width >= 680 && saved.height >= 440
  // Whatever the source, the size is clamped to that display's work area: one
  // saved on a larger monitor (or before a scaling change) would otherwise
  // centre half off-screen, putting the title bar out of reach above the top
  // edge. The 1440/920 cap shapes only the first-run default — a size the user
  // picked themselves comes back as-is.
  // reqW/reqH: what we asked the OS for, kept for persistBounds() below.
  const reqW = Math.min(useSaved ? saved!.width : Math.min(1440, Math.round(sw * 0.66)), sw)
  const reqH = Math.min(useSaved ? saved!.height : Math.min(920, Math.round(sh * 0.8)), sh)
  const win = new BrowserWindow({
    width: reqW,
    height: reqH,
    // Centred by hand rather than with `center: true`, which would ignore this
    // and use the primary display. workArea x/y matter: a secondary monitor's
    // origin is offset (and can be negative when it sits left of the primary).
    x: dx + Math.round((sw - reqW) / 2),
    y: dy + Math.round((sh - reqH) / 2),
    minWidth: 680,
    minHeight: 440,
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../build/icon.ico'),
    backgroundColor: '#0e0f12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Hand the renderer its startup preferences as a launch argument: the
      // preload can read them synchronously, before any app code runs.
      additionalArguments: [`${PREFS_ARG}${JSON.stringify(prefs)}`]
    }
  })

  if (useSaved && saved!.maximized) win.maximize()

  // Remember the size (debounced) so it restores next launch. Position is
  // deliberately not saved: the window always opens centered.
  let saveTimer: NodeJS.Timeout | null = null
  const persistBounds = (): void => {
    const b = win.getNormalBounds()
    // On a fractional-scale display the OS hands back a slightly larger rect
    // than we asked for (measured +3w/+2h at 175%). Storing that verbatim grew
    // the window a few px on every single launch, so treat a difference within
    // rounding noise as "unchanged" and keep our own figure; a real resize is
    // always larger than that and passes through.
    const width = Math.abs(b.width - reqW) <= 8 ? reqW : b.width
    const height = Math.abs(b.height - reqH) <= 8 ? reqH : b.height
    void settings.set('windowBounds', { width, height, maximized: win.isMaximized() })
  }
  const schedulePersist = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistBounds, 400)
  }
  win.on('resize', schedulePersist)
  win.on('close', persistBounds)

  win.on('ready-to-show', () => win.show())

  // Recover from a one-off renderer/GPU process crash instead of showing a
  // blank window (can happen under RDP or with flaky GPU drivers).
  let reloadedOnce = false
  win.webContents.on('render-process-gone', (_e, details) => {
    if (!reloadedOnce && details.reason !== 'clean-exit') {
      reloadedOnce = true
      win.reload()
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Same restriction as the openExternal channel: never pass a non-web scheme
    // to the OS. (xterm's built-in link handling calls window.open() with no
    // URL, which lands here as about:blank — nothing to open.)
    if (isWebUrl(url)) shell.openExternal(url).catch(() => undefined)
    return { action: 'deny' }
  })

  sshManager = new SshManager(win.webContents, knownHosts)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    // Persist session output so history search still finds it after a restart.
    const live = sshManager?.historyList() ?? []
    if (live.length) {
      void settings
        .get<{ label: string; text: string }[]>('sessionHistory')
        .then((existing) => {
          const merged = [
            ...(existing ?? []),
            ...live.map((s) => ({ label: s.label, text: s.text }))
          ]
          void settings.set('sessionHistory', merged.slice(-300))
        })
    }
    for (const p of activeEdits) {
      unwatchFile(p)
      void rm(dirname(p), { recursive: true, force: true }).catch(() => undefined)
    }
    activeEdits.clear()
    sshManager?.disposeAll()
    sshManager = null
  })
}

function registerIpc(): void {
  // ---- Host store ----
  ipcMain.handle(IPC.hostsList, () => store.list())
  ipcMain.handle(
    IPC.hostsSave,
    (_e, host: Host, password?: string, passphrase?: string) =>
      store.save(host, password, passphrase)
  )
  ipcMain.handle(IPC.hostsDelete, (_e, id: string) => store.delete(id))
  ipcMain.handle(IPC.hostsImportSshConfig, () => importSshConfig())
  ipcMain.handle(IPC.hostsExportJson, async () => {
    const res = await dialog.showSaveDialog({
      title: '备份主机到 JSON',
      defaultPath: 'x-ssh-hosts.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    try {
      const json = await store.exportJson()
      await writeFile(res.filePath, json, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  ipcMain.handle(IPC.hostsImportJson, async () => {
    const res = await dialog.showOpenDialog({
      title: '从 JSON 恢复主机',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
    try {
      const json = await readFile(res.filePaths[0], 'utf8')
      const r = await store.importJson(json)
      return { ok: true, count: r.count }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })

  // ---- Known hosts (settings page) ----
  ipcMain.handle(IPC.knownHostsList, async () => {
    await knownHosts.load()
    return knownHosts.list()
  })
  ipcMain.handle(IPC.knownHostsForget, async (_e, host: string, port: number) => {
    await knownHosts.load()
    await knownHosts.forget(host, port)
  })

  // ---- Cross-session history search (live + persisted across restart) ----
  ipcMain.handle(IPC.historyList, async () => {
    const persisted = ((await settings.get<{ label: string; text: string }[]>(
      'sessionHistory'
    )) ?? []).map((x, i) => ({
      sessionId: `persisted-${i}`,
      label: x.label,
      text: x.text
    }))
    return [...persisted, ...(sshManager?.historyList() ?? [])]
  })

  // ---- Local FS browsing for the dual-panel SFTP drawer ----
  ipcMain.handle(IPC.localHome, () => homedir())
  ipcMain.handle(
    IPC.localList,
    async (_e, dir: string): Promise<{ path: string; entries: LocalEntry[] }> => {
      try {
        const resolved = join(dir)
        const st = await stat(resolved)
        if (!st.isDirectory()) return { path: resolved, entries: [] }
        const names = await readdir(resolved, { withFileTypes: true })
        const withMeta = await Promise.all(
          names.map(async (d) => {
            try {
              const s = await stat(join(resolved, d.name))
              return {
                name: d.name,
                isDir: d.isDirectory(),
                size: d.isDirectory() ? 0 : s.size,
                mtime: s.mtimeMs
              }
            } catch {
              return { name: d.name, isDir: d.isDirectory() }
            }
          })
        )
        const dirs = withMeta.filter((d) => d.isDir)
        const files = withMeta.filter((d) => !d.isDir)
        const sort = (a: LocalEntry, b: LocalEntry): number =>
          a.name.localeCompare(b.name, 'zh')
        const entries = dirs.sort(sort).concat(files.sort(sort))
        return { path: resolved, entries }
      } catch {
        return { path: dir, entries: [] }
      }
    }
  )
  // ---- Local FS mutations (create / rename / delete) for the local pane ----
  ipcMain.handle(
    IPC.localCreate,
    async (_e, dir: string, name: string, kind: 'file' | 'folder') => {
      try {
        const target = join(dir, name)
        if (kind === 'folder') await mkdir(target)
        else await writeFile(target, '')
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(
    IPC.localRename,
    async (_e, dir: string, oldName: string, newName: string) => {
      try {
        await rename(join(dir, oldName), join(dir, newName))
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(
    IPC.localDelete,
    async (_e, dir: string, name: string, isDir: boolean) => {
      try {
        await rm(join(dir, name), { recursive: isDir, force: isDir })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )

  // ---- Command snippets ----
  ipcMain.handle(IPC.snippetsList, () => listSnippets())
  ipcMain.handle(IPC.snippetsSave, (_e, snippet: Snippet) => saveSnippet(snippet))
  ipcMain.handle(IPC.snippetsDelete, (_e, id: string) => deleteSnippet(id))

  // ---- SSH lifecycle ----
  ipcMain.handle(IPC.sshConnect, async (_e, params: ConnectParams) => {
    if (!sshManager) return { ok: false, error: '窗口尚未就绪' }
    // Resolve a saved password when connecting to a stored host.
    if (params.hostId && params.auth === 'password' && !params.password) {
      params.password = await store.getPassword(params.hostId)
    }
    if (params.hostId && params.auth === 'key' && !params.passphrase) {
      params.passphrase = await store.getPassphrase(params.hostId)
    }
    // Pull port-forwards and jump-host spec from the saved profile when the
    // renderer didn't already supply them (quick connect / palette).
    if (params.hostId) {
      const h = (await store.list()).find((x) => x.id === params.hostId)
      if (h) {
        if (!params.portForwards && h.portForwards?.length) params.portForwards = h.portForwards
        if (params.agentForward === undefined) params.agentForward = h.agentForward
        if (params.onConnect === undefined) params.onConnect = h.onConnect
        const jumpId = params.jumpHostId ?? h.jumpHostId
        if (jumpId) {
          const jh = (await store.list()).find((x) => x.id === jumpId)
          if (jh) {
            const jump: JumpConfig = {
              host: jh.host,
              port: jh.port,
              username: jh.username,
              auth: jh.auth,
              keyPath: jh.keyPath
            }
            if (jh.auth === 'password') jump.password = await store.getPassword(jh.id)
            if (jh.auth === 'key') jump.passphrase = await store.getPassphrase(jh.id)
            params.jump = jump
          }
        }
      }
    }
    const result = await sshManager.connect(params)
    if (result.ok && params.hostId) await store.touch(params.hostId)
    return result
  })
  ipcMain.handle(IPC.sshDisconnect, (_e, sessionId: string) => {
    sshManager?.disconnect(sessionId)
  })
  ipcMain.handle(
    IPC.sshForgetHostKey,
    async (_e, host: string, port: number) => {
      await knownHosts.load()
      await knownHosts.forget(host, port)
    }
  )

  // ---- SSH stream (fire-and-forget) ----
  ipcMain.on(IPC.sshInput, (_e, sessionId: string, data: string) => {
    sshManager?.write(sessionId, data)
  })
  ipcMain.on(IPC.sshResize, (_e, sessionId: string, cols: number, rows: number) => {
    sshManager?.resize(sessionId, cols, rows)
  })
  ipcMain.on(IPC.sshAttach, (_e, sessionId: string) => {
    sshManager?.attach(sessionId)
  })

  // ---- SFTP ----
  ipcMain.handle(IPC.sftpList, (_e, sessionId: string, path?: string) => {
    if (!sshManager) throw new Error('窗口未就绪')
    return sshManager.listDir(sessionId, path)
  })
  ipcMain.handle(
    IPC.sftpDownload,
    async (_e, sessionId: string, remotePath: string, name: string, concurrency?: number) => {
      const res = await dialog.showSaveDialog({ defaultPath: name })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      try {
        // Save-As: one file into the chosen path (dir + chosen basename).
        await sshManager!.downloadJob(
          sessionId,
          [{ path: remotePath, name: basename(res.filePath), isDir: false }],
          dirname(res.filePath),
          randomUUID(),
          concurrency
        )
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpUpload,
    async (_e, sessionId: string, remoteDir: string, concurrency?: number) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪', count: 0 }
      const res = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections']
      })
      if (res.canceled) return { ok: false, canceled: true, count: 0 }
      try {
        await sshManager.uploadJob(sessionId, res.filePaths, remoteDir, randomUUID(), concurrency)
        return { ok: true, count: res.filePaths.length }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message), count: 0 }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpDownloadMany,
    async (
      _e,
      sessionId: string,
      items: { path: string; name: string; isDir: boolean }[],
      concurrency?: number
    ) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪' }
      const res = await dialog.showOpenDialog({
        title: '选择下载到的文件夹',
        properties: ['openDirectory']
      })
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
      try {
        await sshManager.downloadJob(sessionId, items, res.filePaths[0], randomUUID(), concurrency)
        return { ok: true, count: items.length }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  // Reveal a finished transfer's local path in the OS file manager.
  ipcMain.handle(
    IPC.sftpRevealLocal,
    (_e, target: string) => {
      try {
        if (!target || !isAbsolute(target)) return { ok: false, error: '路径不合法' }
        shell.showItemInFolder(target)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  // Download into a fixed local directory (no dialog) — used by dragging remote
  // entries onto the drawer's local pane.
  ipcMain.handle(
    IPC.sftpDownloadTo,
    async (
      _e,
      sessionId: string,
      items: { path: string; name: string; isDir: boolean }[],
      targetDir: string,
      concurrency?: number
    ) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪' }
      try {
        await sshManager.downloadJob(sessionId, items, targetDir, randomUUID(), concurrency)
        return { ok: true, count: items.length }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpUploadDir,
    async (_e, sessionId: string, remoteDir: string, concurrency?: number) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪', count: 0 }
      const res = await dialog.showOpenDialog({
        title: '选择要上传的文件夹',
        properties: ['openDirectory', 'multiSelections']
      })
      if (res.canceled) return { ok: false, canceled: true, count: 0 }
      try {
        await sshManager.uploadJob(sessionId, res.filePaths, remoteDir, randomUUID(), concurrency)
        return { ok: true, count: res.filePaths.length }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message), count: 0 }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpUploadPaths,
    async (_e, sessionId: string, remoteDir: string, paths: string[], concurrency?: number) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪', count: 0 }
      try {
        await sshManager.uploadJob(sessionId, paths, remoteDir, randomUUID(), concurrency)
        return { ok: true, count: paths.length }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message), count: 0 }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpPackDownload,
    async (
      _e,
      sessionId: string,
      items: { path: string; name: string; isDir: boolean }[],
      archiveName?: string
    ) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪' }
      const res = await dialog.showOpenDialog({
        title: '选择保存打包文件的文件夹',
        properties: ['openDirectory']
      })
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
      return sshManager.packAndDownload(sessionId, items, res.filePaths[0], archiveName)
    }
  )
  ipcMain.handle(
    IPC.sftpExtract,
    async (_e, sessionId: string, remoteDir: string, archiveFileName: string) => {
      try {
        const r = await sshManager!.extractArchive(sessionId, remoteDir, archiveFileName)
        return r
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpUploadExtract,
    async (_e, sessionId: string, remoteDir: string, concurrency?: number) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪' }
      const res = await dialog.showOpenDialog({
        title: '选择要上传并解压的归档文件',
        properties: ['openFile'],
        filters: [
          { name: '归档文件', extensions: ['zip', 'tar', 'gz', 'tgz', 'tar.gz'] }
        ]
      })
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
      try {
        // Upload the archive into remoteDir, then extract it there.
        await sshManager.uploadJob(sessionId, res.filePaths, remoteDir, randomUUID(), concurrency)
        const name = basename(res.filePaths[0])
        return await sshManager.extractArchive(sessionId, remoteDir, name)
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(IPC.sftpMkdir, async (_e, sessionId: string, path: string) => {
    try {
      await sshManager!.mkdir(sessionId, path)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  ipcMain.handle(IPC.sftpCreateFile, async (_e, sessionId: string, path: string) => {
    try {
      await sshManager!.createFile(sessionId, path)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  ipcMain.handle(
    IPC.sftpRename,
    async (_e, sessionId: string, oldPath: string, newPath: string) => {
      try {
        await sshManager!.rename(sessionId, oldPath, newPath)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpDelete,
    async (_e, sessionId: string, path: string, isDir: boolean) => {
      try {
        await sshManager!.deletePath(sessionId, path, isDir)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpChmod,
    async (
      _e,
      sessionId: string,
      path: string,
      mode: number,
      recursive: boolean,
      isDir: boolean
    ) => {
      try {
        await sshManager!.chmod(sessionId, path, mode, recursive, isDir)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.on(IPC.sftpCancel, (_e, id: string) => {
    sshManager?.cancelTransfer(id)
  })
  ipcMain.handle(IPC.sftpReadText, async (_e, sessionId: string, path: string) => {
    try {
      return { ok: true, content: await sshManager!.readTextFile(sessionId, path) }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  ipcMain.handle(
    IPC.sftpWriteText,
    async (_e, sessionId: string, path: string, content: string) => {
      try {
        await sshManager!.writeTextFile(sessionId, path, content)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  // Download to a temp file, open in the configured/system editor, and watch
  // for saves to push the file back to the server automatically.
  ipcMain.handle(
    IPC.sftpEditExternal,
    async (_e, sessionId: string, remotePath: string, name: string) => {
      try {
        const dir = await mkdtemp(join(tmpdir(), 'xssh-edit-'))
        const local = join(dir, name)
        await sshManager!.downloadTree(sessionId, remotePath, dir, name, false)

        const editor = await settings.get<string>('externalEditor')
        if (editor) spawn(editor, [local], { detached: true, stdio: 'ignore' }).unref()
        else await shell.openPath(local)

        const remoteDir = remotePath.slice(0, remotePath.lastIndexOf('/')) || '/'
        let timer: NodeJS.Timeout | null = null
        // watchFile polls mtime, so it also catches editors that save atomically
        // (write temp + rename), which fs.watch on the original path can miss.
        watchFile(local, { interval: 1000 }, (curr, prev) => {
          if (curr.mtimeMs === prev.mtimeMs) return
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            void sshManager
              ?.putFileSilent(sessionId, local, remoteDir, name)
              .catch(() => undefined)
          }, 300)
        })
        activeEdits.add(local)
        // Stop watching after 30 minutes to avoid leaking watchers, and drop
        // the temp dir.
        setTimeout(() => {
          unwatchFile(local)
          activeEdits.delete(local)
          void rm(dir, { recursive: true, force: true }).catch(() => undefined)
        }, 30 * 60 * 1000)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )

  // Drag out (dragstart): download to a temp dir, then startDrag.
  ipcMain.on(
    IPC.sftpStartDrag,
    async (e, sessionId: string, items: DragItem[]) => {
      try {
        const { local } = await prefetchDrag(sessionId, items)
        let icon = DRAG_ICON
        try {
          icon = await app.getFileIcon(local, { size: 'normal' })
        } catch {
          /* fall back to the placeholder icon */
        }
        e.sender.startDrag({ file: local, icon })
      } catch {
        /* download failed or the drag gesture already ended */
      }
    }
  )

  // Pre-fetch the drag-out download on mousedown so the (mostly asynchronous,
  // network-bound) download is ready by the time the drag gesture reaches
  // sftpStartDrag. startDrag must effectively run during the drag gesture, so
  // warming the cache here is what makes Alt+drag reliable for larger files.
  ipcMain.on(
    IPC.sftpPrefetchDrag,
    async (_e, sessionId: string, items: DragItem[]) => {
      try {
        await prefetchDrag(sessionId, items)
      } catch {
        /* download will just re-attempt at startDrag time */
      }
    }
  )

  // ---- Settings ----
  ipcMain.handle(IPC.settingsGet, (_e, key: string) => settings.get(key))
  ipcMain.handle(IPC.settingsSet, (_e, key: string, value: unknown) =>
    settings.set(key, value)
  )
  ipcMain.handle(IPC.pickExecutable, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择外部编辑器程序',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: '程序', extensions: ['exe', 'cmd', 'bat'] }]
          : []
    })
    return res.canceled ? undefined : res.filePaths[0]
  })

  // Opens a link from terminal output in the default browser. Restricted to
  // http/https on purpose: the URL comes from whatever the remote host printed,
  // and handing an arbitrary scheme to the OS would let it launch local
  // protocol handlers (file:, smb:, ms-*:).
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (!isWebUrl(url)) return false
    // openExternal REJECTS when the OS has no handler for the URL; an
    // unhandled rejection in main is fatal on current Node defaults.
    shell.openExternal(url).catch(() => undefined)
    return true
  })

  // Native notification (session drop, transfer completion…). The renderer
  // decides when; main just honors the user's toggle.
  ipcMain.on(IPC.notify, async (_e, title: string, body: string) => {
    if (await notifyEnabled()) notify(title, body)
  })

  // ---- Dialogs ----
  ipcMain.handle(IPC.pickKeyFile, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择私钥',
      properties: ['openFile', 'showHiddenFiles']
    })
    return res.canceled ? undefined : res.filePaths[0]
  })
  // ---- SSH key library ----
  ipcMain.handle(IPC.keysList, () => keyManager.list())
  ipcMain.handle(
    IPC.keysGenerate,
    async (_e, opts: { name: string; type?: string; passphrase?: string; bits?: number }) => {
      try {
        return { ok: true, key: await keyManager.generate(opts) }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(IPC.keysImport, async () => {
    const res = await dialog.showOpenDialog({
      title: '导入私钥',
      properties: ['openFile', 'showHiddenFiles']
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
    try {
      return { ok: true, key: await keyManager.import(res.filePaths[0]) }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  ipcMain.handle(IPC.keysDelete, async (_e, id: string) => {
    try {
      await keyManager.remove(id)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
}

// Several instances may run side by side, so nothing here may touch storage
// that Chromium locks to a single process (see UiPrefs in shared/types).
app.whenReady().then(async () => {
  // Windows/Linux: no native menu bar (Alt should not reveal File/Edit/View…).
  // macOS: keep a minimal role-based menu so Cmd+C/V/X/A/Z still work in DOM
  // inputs (on macOS those route through the application menu's key equivalents).
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    )
  } else {
    Menu.setApplicationMenu(null)
  }
  registerIpc()
  // Warm the hosts cache while the window is still being built, so the
  // renderer's first list() call answers from memory instead of the disk.
  void store.list().catch(() => undefined)
  const [saved, prefs] = await Promise.all([
    settings.get<SavedBounds>('windowBounds'),
    readUiPrefs()
  ])
  createWindow(saved, prefs)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(saved, prefs)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
