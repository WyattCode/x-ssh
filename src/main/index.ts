import { app, shell, BrowserWindow, ipcMain, dialog, nativeImage, screen, Menu, Notification, Tray, globalShortcut, powerMonitor } from 'electron'
import { join, dirname, basename, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir, homedir } from 'node:os'
import { mkdtemp, rm, readFile, stat, readdir, mkdir, unlink, rename, writeFile } from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'
import { spawn } from 'node:child_process'
import { IPC, PREFS_ARG } from '../shared/ipc'
import type { ConnectParams, Host, HostForward, ForwardMode, JumpConfig, LocalEntry, Snippet, UiPrefs, UploadOverwrite } from '../shared/types'
import { readLaunchTarget, targetFromUrl, PROTOCOL, compareVersions } from '../shared/launchTarget'
import { SshManager } from './ssh'
import { HostStore } from './store'
import { KnownHosts } from './knownHosts'
import { SettingsStore } from './settings'
import { friendlyError } from './friendlyError'
import { KeyManager } from './keyManager'
import { MasterLock } from './lock'

const store = new HostStore()
const knownHosts = new KnownHosts()
const settings = new SettingsStore()
const keyManager = new KeyManager(app.getPath('userData'))
const masterLock = new MasterLock(settings)
const activeEdits = new Set<string>()
// Cache of drag-out downloads keyed by session:paths, so files prefetched on
// mousedown are ready by the time the drag gesture reaches startDrag.
const dragCache = new Map<string, Promise<{ dir: string; local: string }>>()
let sshManager: SshManager | null = null

// ---- System tray ----
// A minimized/closed window can be tucked into the tray instead of quitting, so
// long-running transfers keep running. Controlled by the `minimizeToTray`
// setting and the tray's context menu. The menu is localized from the `lang`
// setting and rebuilt when it opens, so a language change takes effect live.
let tray: Tray | null = null
let quitting = false
// Windows toast notifications are attributed to the app via its AppUserModelID;
// it must be set as early as possible (before notifications are created) so
// toasts show under X-SSH's name and icon rather than a generic "Electron".
if (process.platform === 'win32') app.setAppUserModelId('com.x-ssh.app')
/** The currently-visible main window (single-window app), for tray balloon use. */
let mainWindow: BrowserWindow | null = null
/** Cached copy of the `minimizeToTray` setting, kept in sync by the setter. */
let minimizeToTray = false
async function buildTrayMenu(win: BrowserWindow): Promise<Electron.Menu> {
  const lang = await settings.get<'zh' | 'en'>('lang')
  const en = lang === 'en'
  return Menu.buildFromTemplate([
    {
      label: en ? 'Show X-SSH' : '显示 X-SSH',
      click: () => {
        win.show()
        win.focus()
      }
    },
    {
      label: en ? 'Hide' : '隐藏',
      click: () => win.hide()
    },
    { type: 'separator' },
    {
      label: en ? 'Open command palette' : '打开命令栏',
      click: () => {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        win.webContents.send(IPC.appOpenTarget, '')
      }
    },
    { type: 'separator' },
    {
      label: en ? 'Quit' : '退出',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
}
async function setupTray(win: BrowserWindow): Promise<void> {
  if (tray) return
  let image = nativeImage.createFromPath(join(__dirname, '../../build/icon.png'))
  if (image.isEmpty()) image = nativeImage.createFromDataURL(DRAG_ICON.toDataURL())
  tray = new Tray(image)
  tray.setToolTip('X-SSH')
  tray.setContextMenu(await buildTrayMenu(win))
  tray.on('click', () => {
    if (win.isVisible() && win.isFocused()) win.hide()
    else {
      win.show()
      win.focus()
    }
  })
  // Re-localize the context menu right before it's shown.
  tray.on('right-click', () => void buildTrayMenu(win).then((m) => tray?.setContextMenu(m)))
}

// ---- Launch targets (CLI `-c user@host` / `x-ssh://` URL) ----
// A connection spec the user passed at launch, handed to the renderer once its
// window is up (or immediately, if a target arrives after startup via the
// single-instance handler). The main side only parses-plausible targets out of
// the command line / URL; the renderer re-parses & opens the connection.
const pendingTargets: string[] = []
/** True once the current window has been created and the initial targets sent. */
let launchTargetFetchDone = false
/** The active window's webContents, used to push late-arriving targets. */
let targetSender: Electron.WebContents | null = null

/** Name of the CLI switch that carries a launch target (repeatable). */

/** Hand a resolved target to the renderer (queued until the window is up). */
function pushLaunchTarget(target: string): void {
  if (launchTargetFetchDone && targetSender && !targetSender.isDestroyed()) {
    targetSender.send(IPC.appOpenTarget, target)
  } else {
    pendingTargets.push(target)
  }
}

/** Flushes queued launch targets to the renderer once a window can receive them. */
function flushLaunchTargets(win: BrowserWindow): void {
  launchTargetFetchDone = true
  const targets = pendingTargets.splice(0)
  for (const t of targets) {
    if (!win.isDestroyed()) win.webContents.send(IPC.appOpenTarget, t)
  }
}

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

// Temp dirs we create under the OS temp dir for drag-out / edit / open-with.
// Those that have no timer (or whose timer didn't fire before the app closed)
// are swept on startup so they can't accumulate disk garbage across restarts.
const TMP_PREFIXES = ['xssh-drag-', 'xssh-edit-', 'xssh-open-']
async function sweepTempDirs(): Promise<void> {
  const base = tmpdir()
  try {
    const names = await readdir(base)
    await Promise.all(
      names
        .filter((n) => TMP_PREFIXES.some((p) => n.startsWith(p)))
        .map((n) => rm(join(base, n), { recursive: true, force: true }).catch(() => undefined))
    )
  } catch {
    /* temp dir unreadable — nothing we can do */
  }
}

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

/**
 * Before a download-to-folder overwrites existing local files, ask once. Returns
 * true to proceed (nothing exists, or the user confirms), false to cancel.
 * Only existing regular files trigger (a target folder merges its children, so
 * it isn't a destructive overwrite and shouldn't prompt).
 */
async function confirmOverwriteLocal(targets: string[]): Promise<boolean> {
  const existing = (await Promise.all(
    targets.map((p) =>
      stat(p)
        .then((s) => (s.isDirectory() ? null : p))
        .catch(() => null)
    )
  )).filter((p): p is string => !!p)
  if (!existing.length) return true
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['覆盖', '取消'],
    defaultId: 1,
    cancelId: 1,
    message: '以下本地文件已存在,下载将覆盖:',
    detail: existing.map((p) => basename(p)).join(', ')
  })
  return response === 0
}

async function notifyEnabled(): Promise<boolean> {
  return (await settings.get<boolean>('notifications')) !== false
}

/**
 * Asks how to handle an upload whose top-level files already exist at remoteDir.
 * Returns the policy, or 'cancel'. When nothing conflicts (or a policy was given
 * explicitly) it returns 'overwrite' without prompting.
 */
async function resolveUploadOverwrite(
  sessionId: string,
  remoteDir: string,
  names: string[],
  overwrite?: UploadOverwrite
): Promise<UploadOverwrite | 'cancel'> {
  if (overwrite) return overwrite
  if (!names.length) return 'overwrite'
  const conflicts = await sshManager!.remoteConflicts(sessionId, remoteDir, names)
  if (!conflicts.length) return 'overwrite'
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['覆盖', '跳过', '保留两者', '取消'],
    defaultId: 0,
    cancelId: 3,
    message: '以下远端文件已存在,请选择处理方式:',
    detail: conflicts.join(', ')
  })
  if (response === 0) return 'overwrite'
  if (response === 1) return 'skip'
  if (response === 2) return 'keep'
  return 'cancel'
}

async function notifySoundEnabled(): Promise<boolean> {
  return (await settings.get<boolean>('notifySound')) === true
}

/** Default per-transfer byte-rate cap (bytes/sec) from the user setting, or 0
 *  for unlimited. Applied to every new transfer job unless overridden per-job. */
async function defaultTransferRate(): Promise<number> {
  const kbps = await settings.get<number>('transferRateKbps')
  return typeof kbps === 'number' && kbps > 0 ? Math.round(kbps * 1024) : 0
}

async function verifyChecksumsEnabled(): Promise<boolean> {
  return (await settings.get<boolean>('verifyChecksums')) === true
}

function notify(title: string, body: string, sound = false): void {
  if (Notification.isSupported()) {
    const n = new Notification({
      title,
      body,
      silent: !sound,
      // Keep a toast visible long enough to be read, and let the action center
      // manage it like any other app toast.
      timeoutType: 'default'
    })
    // Clicking the toast brings the app forward — otherwise it's a dead-end.
    n.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })
    n.show()
  }
  // When the main window is hidden/minimized to the tray (or in the background),
  // also pop a balloon off the tray icon so the event isn't missed (Windows).
  const hidden =
    !mainWindow ||
    mainWindow.isDestroyed() ||
    (mainWindow.isMinimized() ? true : !mainWindow.isVisible())
  if (hidden && tray && process.platform === 'win32') {
    try {
      tray.displayBalloon({ title, content: body, iconType: 'info' })
    } catch {
      /* balloon unsupported (old Windows) — the system notification above covers it */
    }
  }
}

// ---- Scheduled automatic backups ----
// Writes a full data snapshot (hosts+secrets+snippets+snapshots+known hosts)
// to a chosen directory on a timer, so a deleted profile is never unrecoverable.
// Controlled by settings keys: autoBackup (bool), autoBackupDir (string),
// autoBackupEveryHours (number).
let backupTimer: NodeJS.Timeout | null = null

async function buildBackupPayload(): Promise<string> {
  await knownHosts.load()
  return JSON.stringify(
    {
      app: 'x-ssh',
      version: 2,
      exportedAt: new Date().toISOString(),
      hosts: await store.exportJson(),
      snippets: (await settings.get<Snippet[]>('snippets')) ?? [],
      snapshots: (await settings.get<unknown[]>('snapshots')) ?? [],
      transferHistory: (await settings.get<unknown[]>('sftpTransferHistory')) ?? [],
      knownHosts: await knownHosts.list()
    },
    null,
    2
  )
}

export async function writeAutoBackupSync(): Promise<boolean> {
  const enabled = (await settings.get<boolean>('autoBackup')) === true
  if (!enabled) return false
  const dir = await settings.get<string>('autoBackupDir')
  if (!dir) return false
  try {
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const target = join(dir, `x-ssh-backup-${stamp}.json`)
    await writeFile(target, await buildBackupPayload(), 'utf8')
    return true
  } catch {
    return false
  }
}

async function scheduleAutoBackup(): Promise<void> {
  if (backupTimer) clearInterval(backupTimer)
  backupTimer = null
  const enabled = (await settings.get<boolean>('autoBackup')) === true
  if (!enabled) return
  const hours = Math.max(1, (await settings.get<number>('autoBackupEveryHours')) || 24)
  backupTimer = setInterval(() => void writeAutoBackupSync(), hours * 60 * 60 * 1000)
  backupTimer.unref?.()
}

// ---- Connection audit log ----
interface ConnLogEntry {
  at: number
  event: 'connect' | 'disconnect' | 'error' | 'transfer' | 'forward'
  host: string
  port: number
  username: string
  /** Free-form detail (transfer name/direction, forward rule…). */
  detail?: string
  /** Byte count for transfer events. */
  bytes?: number
}
async function pushConnLog(e: ConnLogEntry): Promise<void> {
  const all = (await settings.get<ConnLogEntry[]>('connectionLog')) ?? []
  await settings.set('connectionLog', [e, ...all].slice(0, 200))
}

// ---- One-shot multi-host operations (publish / revoke a key) ----
// Connects to each saved host with its own credentials, runs `fn` on a
// one-shot session, tears that session down, and collects per-host results.
async function withTempHosts(
  hostIds: string[],
  fn: (sessionId: string, host: Host) => Promise<void>
): Promise<{ host: string; ok: boolean; error?: string }[]> {
  const results: { host: string; ok: boolean; error?: string }[] = []
  for (const hostId of hostIds) {
    const h = (await store.list()).find((x) => x.id === hostId)
    const hostLabel = h ? `${h.username}@${h.host}${h.port && h.port !== 22 ? `:${h.port}` : ''}` : hostId
    if (!h) {
      results.push({ host: hostLabel, ok: false, error: '主机不存在' })
      continue
    }
    const params: ConnectParams = {
      host: h.host,
      port: h.port,
      username: h.username,
      auth: h.auth,
      keyPath: h.keyPath,
      hostId: h.id,
      agentForward: h.agentForward
    }
    try {
      if (store.isLocked && !params.password && !params.passphrase) {
        results.push({ host: hostLabel, ok: false, error: '应用已锁定' })
        continue
      }
      if (h.auth === 'password' && !params.password) params.password = await store.getPassword(h.id)
      if (h.auth === 'key' && !params.passphrase) params.passphrase = await store.getPassphrase(h.id)
      if (h.portForwards?.length) params.portForwards = h.portForwards
      if (h.proxy) params.proxy = h.proxy
      params.multiplex = (await settings.get<boolean>('connectionMultiplex')) === true
      if (h.jumpHostId) {
        const jh = (await store.list()).find((x) => x.id === h.jumpHostId)
        if (jh) {
          const jump: JumpConfig = {
            host: jh.host,
            port: jh.port,
            username: jh.username,
            auth: jh.auth,
            keyPath: jh.keyPath
          }
          if (jh.auth === 'password') jump.password = store.isLocked ? undefined : await store.getPassword(jh.id)
          if (jh.auth === 'key') jump.passphrase = store.isLocked ? undefined : await store.getPassphrase(jh.id)
          params.jump = jump
        }
      }
      const r = await sshManager!.connect(params)
      if (!r.ok || !r.sessionId) {
        results.push({ host: hostLabel, ok: false, error: r.error ?? '连接失败' })
        continue
      }
      const sid = r.sessionId
      try {
        await fn(sid, h)
        results.push({ host: hostLabel, ok: true })
      } finally {
        try {
          sshManager!.disconnect(sid)
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      results.push({ host: hostLabel, ok: false, error: friendlyError((e as Error).message) })
    }
  }
  return results
}

// ---- Command snippets (stored in settings.json under 'snippets') ----
async function listSnippets(): Promise<Snippet[]> {
  return (await settings.get<Snippet[]>('snippets')) ?? []
}
async function saveSnippet(snippet: Snippet): Promise<Snippet[]> {
  const all = await listSnippets()
  const i = all.findIndex((s) => s.id === snippet.id)
  const clean: Snippet = {
    id: snippet.id,
    title: snippet.title,
    text: snippet.text,
    confirm: snippet.confirm,
    ...(snippet.group ? { group: snippet.group } : {}),
    ...(snippet.defaultVars && Object.keys(snippet.defaultVars).length ? { defaultVars: snippet.defaultVars } : {}),
    ...(snippet.hostId ? { hostId: snippet.hostId } : {})
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
  /** Conditional keywords forwarded/imported when present. */
  agentForward?: boolean
  forwards?: HostForward[]
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
      case 'forwardagent':
        // OpenSSH accepts "yes/no" (also optional host list); only a leading
        // `yes` enables it — `no`, `none` and a host list all disable.
        current.agentForward = /^yes/i.test(val)
        break
      case 'localforward':
        // "LocalForward [bind:]port host:port". The optional bind address is
        // ignored (we always listen on localhost for safety).
        {
          const parts = val.split(/\s+/)
          const listen = parts[0]
          const target = parts[1]
          if (!target) break
          const lp = Number(listen.split(':').pop()) || 0
          const tm = /^(.*?):(\d+)$/.exec(target)
          if (!lp || !tm) break
          current.forwards = current.forwards || []
          current.forwards.push({
            mode: 'local',
            localPort: lp,
            remoteHost: tm[1] || '',
            remotePort: Number(tm[2])
          })
        }
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

  // Resolve a `ProxyJump` alias to an imported Host id. The jump target may not
  // be a Host block of its own (e.g. a bare hostname), so create one lazily.
  let jumpCounter = 0
  async function jumpHostId(spec: string): Promise<string | undefined> {
    // "user@host" or "host" (a connect-time command string is not supported).
    const jm = /^(?:([^@]+)@)?([^:]+)(?::(\d+))?$/.exec(spec.trim())
    if (!jm) return undefined
    const jhost = jm[2]
    const jport = Number(jm[3]) || 22
    const juser = jm[1] || 'root'
    const existingJump = (await store.list()).find(
      (h) => h.host === jhost && h.port === jport && h.group === 'OpenSSH'
    )
    if (existingJump) return existingJump.id
    const jump: Host = {
      id: `host-jump-${Date.now()}-${jumpCounter++}`,
      label: jhost,
      host: jhost,
      port: jport,
      username: juser,
      auth: 'password',
      group: 'OpenSSH'
    }
    await store.save(jump)
    return jump.id
  }

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
      group: 'OpenSSH',
      agentForward: c.agentForward || undefined,
      portForwards: c.forwards?.length ? c.forwards : undefined
    }
    // Map ProxyJump to a jump host entry so the tunnel is actually established
    // (previously it was parsed but dropped).
    if (c.proxyJump) {
      const jid = await jumpHostId(c.proxyJump)
      if (jid) host.jumpHostId = jid
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
  mainWindow = win

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

  // Tuck a "minimized to tray" window away instead of letting it quit: with the
  // setting on, closing the window hides it (transfers keep running) rather
  // than exiting; the tray menu's Quit (or the platform's normal close path
  // when the setting is off) still exits for real.
  win.on('close', (e) => {
    if (quitting || minimizeToTray === false) return
    e.preventDefault()
    win.hide()
  })

  void setupTray(win).catch(() => undefined)

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
  targetSender = win.webContents

  // Flush any launch target (CLI `-c` / `x-ssh://`) once the renderer's listener
  // is ready — after the page loads and its onOpenTarget handler is registered.
  win.webContents.on('did-finish-load', () => flushLaunchTargets(win))

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
    targetSender = null
    mainWindow = null
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
  ipcMain.handle(IPC.hostsExportSshConfig, async () => {
    const res = await dialog.showSaveDialog({
      title: '导出 OpenSSH 配置',
      defaultPath: 'config',
      filters: [{ name: 'OpenSSH config', extensions: ['config'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    try {
      const text = await store.exportSshConfig()
      await writeFile(res.filePath, text, 'utf8')
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
  // ---- Full data backup (hosts + secrets + snippets + snapshots + history) ----
  ipcMain.handle(IPC.dataExportAll, async () => {
    const res = await dialog.showSaveDialog({
      title: '导出全部数据',
      defaultPath: `x-ssh-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    try {
      await knownHosts.load()
      const data = {
        app: 'x-ssh',
        version: 2,
        exportedAt: new Date().toISOString(),
      hosts: await store.exportJson(true),
        snippets: (await settings.get<Snippet[]>('snippets')) ?? [],
        snapshots: (await settings.get<unknown[]>('snapshots')) ?? [],
        transferHistory: (await settings.get<unknown[]>('sftpTransferHistory')) ?? [],
        knownHosts: await knownHosts.list()
      }
      await writeFile(res.filePath, JSON.stringify(data, null, 2), 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  ipcMain.handle(IPC.dataImportAll, async () => {
    const res = await dialog.showOpenDialog({
      title: '导入全部数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
    try {
      const buf = await readFile(res.filePaths[0], 'utf8')
      const data = JSON.parse(buf)
      if (!Array.isArray(data.hosts)) return { ok: false, error: '无效的备份文件' }
      await store.importJson(JSON.stringify(data.hosts))
      if (Array.isArray(data.snippets)) await settings.set('snippets', data.snippets)
      if (Array.isArray(data.snapshots)) await settings.set('snapshots', data.snapshots)
      if (Array.isArray(data.transferHistory)) await settings.set('sftpTransferHistory', data.transferHistory)
      // Restore the trusted host-key map too, so a full restore is symmetric
      // with the export instead of silently re-trusting every server.
      if (Array.isArray(data.knownHosts)) {
        await knownHosts.load()
        await knownHosts.importAll(data.knownHosts)
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  ipcMain.handle(IPC.dataBackupNow, async () => {
    const ok = await writeAutoBackupSync()
    return { ok, error: ok ? undefined : '自动备份未启用或未选择目标目录' }
  })
  ipcMain.handle(IPC.dataRescheduleBackup, async () => {
    await scheduleAutoBackup()
    return { ok: true }
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
  ipcMain.handle(IPC.historyExport, async (_e, text: string) => {
    const res = await dialog.showSaveDialog({
      title: '导出历史日志',
      defaultPath: `x-ssh-log-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    try {
      await writeFile(res.filePath, text, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
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
  // Read a local file's text (for comparing against a remote file).
  ipcMain.handle(IPC.localReadText, async (_e, p: string) => {
    try {
      const content = await readFile(p, 'utf8')
      return { ok: true, content }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  // Let the user pick a local file (for the "compare with local" action).
  ipcMain.handle(IPC.localPickFile, async () => {
    const res = await dialog.showOpenDialog({ properties: ['openFile'] })
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
    return { ok: true, path: res.filePaths[0] }
  })
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
    // Resolve a saved password when connecting to a stored host. When the app
    // is locked, don't auto-fill a saved secret — return a clear 'locked' error
    // so the renderer surfaces the unlock prompt instead of failing obscurely.
    if (store.isLocked && !params.password && !params.passphrase) {
      return { ok: false, code: 'locked', error: '应用已锁定，请先解锁' }
    }
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
        if (params.onConnectDelayMs === undefined) params.onConnectDelayMs = h.onConnectDelayMs
        if (!params.proxy && h.proxy) params.proxy = h.proxy
        if (params.multiplex === undefined) params.multiplex = (await settings.get<boolean>('connectionMultiplex')) === true
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
            if (jh.auth === 'password') jump.password = store.isLocked ? undefined : await store.getPassword(jh.id)
            if (jh.auth === 'key') jump.passphrase = store.isLocked ? undefined : await store.getPassphrase(jh.id)
            params.jump = jump
            // A password jump host with no usable secret would fail obscurely deep
            // in the handshake; surface it now with actionable guidance (the jump
            // host's saved password, or the host's own — set it in the profile).
            if (jh.auth === 'password' && !jump.password) {
              return {
                ok: false,
                code: 'jump_needs_password',
                error: `跳板机 ${jh.host} 需要密码,但没有已保存的密码。请在「主机」编辑页为 ${jh.label} 设置密码后重试,或更换认证方式。`
              }
            }
          }
        }
      }
    }
    if (params.multiplex === undefined) params.multiplex = (await settings.get<boolean>('connectionMultiplex')) === true
    const result = await sshManager.connect(params)
    if (result.ok && params.hostId) await store.touch(params.hostId)    // Audit the connection attempt (success or failure) for the security log.
    void pushConnLog({
      at: Date.now(),
      event: result.ok ? 'connect' : 'error',
      host: params.host,
      port: params.port,
      username: params.username
    }).catch(() => undefined)
    return result
  })
  ipcMain.handle(IPC.sshDisconnect, (_e, sessionId: string) => {
    const label = sshManager?.label(sessionId)
    sshManager?.disconnect(sessionId)
    if (label) {
      const m = /^(?:([^@]+)@)?([^:]+)(?::(\d+))?$/.exec(label)
      void pushConnLog({
        at: Date.now(),
        event: 'disconnect',
        host: m?.[2] ?? label,
        port: Number(m?.[3] ?? 22) || 22,
        username: m?.[1] ?? ''
      }).catch(() => undefined)
    }
  })
  ipcMain.handle(
    IPC.sshForgetHostKey,
    async (_e, host: string, port: number) => {
      await knownHosts.load()
      await knownHosts.forget(host, port)
    }
  )

  // ---- Session log-to-file ----
  // Start capturing a live session's output to a user-chosen log file.
  ipcMain.handle(
    IPC.sessionLogStart,
    async (e, sessionId: string) => {
      const res = await dialog.showSaveDialog({
        title: '保存会话日志',
        defaultPath: `session-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
        filters: [{ name: 'Log', extensions: ['log', 'txt'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      const ok = sshManager!.startLog(sessionId, res.filePath)
      return { ok, canceled: false, path: res.filePath }
    }
  )
  ipcMain.on(IPC.sessionLogStop, (_e, sessionId: string) => {
    sshManager!.stopLog(sessionId)
  })

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
  ipcMain.handle(IPC.sshTmuxList, async (_e, sessionId: string) => {
    if (!sshManager) return []
    return sshManager.tmuxListSessions(sessionId).catch(() => [])
  })
  ipcMain.handle(IPC.sshTmuxAttach, (_e, sessionId: string, name: string) => {
    if (!sshManager) return { ok: false }
    sshManager.tmuxAttachOrCreate(sessionId, name)
    return { ok: true }
  })
  ipcMain.handle(IPC.sshForwardAdd, (_e, sessionId: string, rule: HostForward) => {
    if (!sshManager) return { ok: false, error: '窗口未就绪' }
    return sshManager.addForward(sessionId, rule)
  })
  ipcMain.handle(IPC.sshForwardRemove, (_e, sessionId: string, rule: { mode?: ForwardMode; localPort: number }) => {
    if (!sshManager) return { ok: false, error: '窗口未就绪' }
    return sshManager.removeForward(sessionId, rule)
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
          concurrency,
          await defaultTransferRate(),
          await verifyChecksumsEnabled()
        )
        return { ok: true }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpUpload,
    async (_e, sessionId: string, remoteDir: string, concurrency?: number, overwrite?: UploadOverwrite) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪', count: 0 }
      const res = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections']
      })
      if (res.canceled) return { ok: false, canceled: true, count: 0 }
      try {
        const policy = await resolveUploadOverwrite(sessionId, remoteDir, res.filePaths.map((p) => basename(p)), overwrite)
        if (policy === 'cancel') return { ok: false, canceled: true, count: 0 }
        await sshManager.uploadJob(sessionId, res.filePaths, remoteDir, randomUUID(), concurrency, await defaultTransferRate(), policy)
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
      // Confirmation before overwriting existing local files in the target dir.
      if (!(await confirmOverwriteLocal(items.map((it) => join(res.filePaths[0], it.name))))) {
        return { ok: false, canceled: true }
      }
      try {
        await sshManager.downloadJob(sessionId, items, res.filePaths[0], randomUUID(), concurrency, await defaultTransferRate(), await verifyChecksumsEnabled())
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
      // Confirmation before overwriting existing local files in the target dir.
      if (!(await confirmOverwriteLocal(items.map((it) => join(targetDir, it.name))))) {
        return { ok: false, canceled: true }
      }
      try {
        await sshManager.downloadJob(sessionId, items, targetDir, randomUUID(), concurrency, await defaultTransferRate(), await verifyChecksumsEnabled())
        return { ok: true, count: items.length }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpUploadDir,
    async (_e, sessionId: string, remoteDir: string, concurrency?: number, overwrite?: UploadOverwrite) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪', count: 0 }
      const res = await dialog.showOpenDialog({
        title: '选择要上传的文件夹',
        properties: ['openDirectory', 'multiSelections']
      })
      if (res.canceled) return { ok: false, canceled: true, count: 0 }
      try {
        const policy = await resolveUploadOverwrite(sessionId, remoteDir, res.filePaths.map((p) => basename(p)), overwrite)
        if (policy === 'cancel') return { ok: false, canceled: true, count: 0 }
        await sshManager.uploadJob(sessionId, res.filePaths, remoteDir, randomUUID(), concurrency, await defaultTransferRate(), policy)
        return { ok: true, count: res.filePaths.length }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message), count: 0 }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpUploadPaths,
    async (_e, sessionId: string, remoteDir: string, paths: string[], concurrency?: number, overwrite?: UploadOverwrite) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪', count: 0 }
      try {
        const policy = await resolveUploadOverwrite(sessionId, remoteDir, paths.map((p) => basename(p)), overwrite)
        if (policy === 'cancel') return { ok: false, canceled: true, count: 0 }
        await sshManager.uploadJob(sessionId, paths, remoteDir, randomUUID(), concurrency, await defaultTransferRate(), policy)
        return { ok: true, count: paths.length }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message), count: 0 }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpSync,
    async (
      _e,
      sessionId: string,
      localDir: string,
      remoteDir: string,
      mode: 'up' | 'down' | 'both',
      deleteExtras: boolean,
      concurrency?: number
    ) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪', count: 0 }
      try {
        await sshManager.syncJob(sessionId, localDir, remoteDir, mode, deleteExtras, randomUUID(), concurrency, await defaultTransferRate())
        return { ok: true, count: 0 }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message), count: 0 }
      }
    }
  )
  ipcMain.handle(
    IPC.sftpWatchStart,
    async (
      _e,
      sessionId: string,
      localDir: string,
      remoteDir: string,
      mode: 'up' | 'down' | 'both',
      deleteExtras: boolean,
      intervalSec: number
    ) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪' }
      try {
        const watchId = await sshManager.startWatchSync(sessionId, localDir, remoteDir, mode, deleteExtras, intervalSec)
        return { ok: true, watchId }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
      }
    }
  )
  ipcMain.handle(IPC.sftpWatchStop, (_e, sessionId: string) => {
    sshManager?.stopWatchSyncsForSession(sessionId)
    return { ok: true }
  })
  ipcMain.handle(
    IPC.sftpDiffDirs,
    async (_e, sessionId: string, localDir: string, remoteDir: string) => {
      if (!sshManager) return { ok: false, error: '窗口未就绪' }
      try {
        const r = await sshManager.diffDirs(sessionId, localDir, remoteDir)
        return { ok: true, ...r }
      } catch (e) {
        return { ok: false, error: friendlyError((e as Error).message) }
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
    async (_e, sessionId: string, remoteDir: string, concurrency?: number, overwrite?: UploadOverwrite) => {
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
        const policy = await resolveUploadOverwrite(sessionId, remoteDir, res.filePaths.map((p) => basename(p)), overwrite)
        if (policy === 'cancel') return { ok: false, canceled: true }
        // Upload the archive into remoteDir, then extract it there.
        await sshManager.uploadJob(sessionId, res.filePaths, remoteDir, randomUUID(), concurrency, await defaultTransferRate(), policy)
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
  ipcMain.on(IPC.sftpPause, (_e, id: string, paused: boolean) => {
    sshManager?.pauseTransfer(id, paused)
  })
  ipcMain.on(IPC.sftpPauseAll, (_e, paused: boolean) => {
    sshManager?.pauseAll(paused)
  })
  ipcMain.on(IPC.sftpSetRate, (_e, id: string, bytesPerSec: number) => {
    sshManager?.setTransferRate(id, bytesPerSec)
  })
  ipcMain.handle(IPC.sftpReadText, async (_e, sessionId: string, path: string) => {
    try {
      return { ok: true, content: await sshManager!.readTextFile(sessionId, path) }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  ipcMain.handle(IPC.sftpReadBinary, async (_e, sessionId: string, path: string) => {
    try {
      const base64 = await sshManager!.readBinaryFile(sessionId, path)
      return { ok: true, base64 }
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
  ipcMain.handle(IPC.sftpOpenWith, async (_e, sessionId: string, path: string, name: string, program?: string) => {
    try {
      const remotePath = path
      const dir = await mkdtemp(join(tmpdir(), 'xssh-open-'))
      const local = join(dir, name)
      await sshManager!.downloadTree(sessionId, remotePath, dir, name, false)
      if (program) spawn(program, [local], { detached: true, stdio: 'ignore' }).unref()
      else await shell.openPath(local)
      setTimeout(() => void rm(dir, { recursive: true, force: true }).catch(() => undefined), 30 * 60 * 1000)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })

  // Drag out (dragstart): start the native drag with the (pre)downloaded file.
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
  ipcMain.handle(IPC.settingsSet, async (_e, key: string, value: unknown) => {
    if (key === 'minimizeToTray') minimizeToTray = Boolean(value)
    return settings.set(key, value)
  })
  ipcMain.handle(IPC.connLogList, async () => (await settings.get<ConnLogEntry[]>('connectionLog')) ?? [])
  ipcMain.handle(IPC.connLogPush, async (_e, entry: ConnLogEntry) => {
    await pushConnLog(entry)
    return { ok: true }
  })
  ipcMain.handle(IPC.connLogClear, async () => {
    await settings.set('connectionLog', [])
    return { ok: true }
  })

  // ---- App master-lock ----
  // Lock state lives in main; gating saved secrets is enforced in the HostStore
  // (getPassword/getPassphrase/exportJson) and in sshConnect below.
  ipcMain.handle(IPC.lockStatus, () => masterLock.status())
  ipcMain.handle(IPC.lockSetPassphrase, async (_e, passphrase: string) => {
    try {
      if (!passphrase) return { ok: false, error: '口令不能为空' }
      await masterLock.setPassphrase(passphrase)
      store.setLocked(masterLock.locked)
      return { ok: true, ...masterLock.status() }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  ipcMain.handle(IPC.lockDisable, async (_e, passphrase: string) => {
    const ok = await masterLock.disable(passphrase)
    store.setLocked(masterLock.locked)
    return { ok, ...masterLock.status() }
  })
  ipcMain.handle(IPC.lockUnlock, async (_e, passphrase: string) => {
    const ok = await masterLock.unlock(passphrase)
    store.setLocked(masterLock.locked)
    return { ok, ...masterLock.status() }
  })
  ipcMain.handle(IPC.lockLockNow, () => {
    masterLock.lock()
    store.setLocked(masterLock.locked)
    // Locking can also close any sessions that used saved secrets? No — leave
    // live sessions running; the door is just shut for new discovery.
    return masterLock.status()
  })
  ipcMain.handle(IPC.lockReset, async (_e, passphrase: string) => {
    const ok = await masterLock.reset(passphrase)
    store.setLocked(masterLock.locked)
    return { ok, ...masterLock.status() }
  })
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
  ipcMain.handle(IPC.pickDirectory, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择备份目录',
      properties: ['openDirectory', 'createDirectory']
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
  ipcMain.on(IPC.notify, async (_e, title: string, body: string, sound = false) => {
    if (await notifyEnabled()) notify(title, body, sound && (await notifySoundEnabled()))
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
  ipcMain.handle(IPC.keysPublicKey, async (_e, id: string) => {
    try {
      const text = await keyManager.publicKey(id)
      if (!text) return { ok: false, error: '该密钥没有可用的公钥' }
      return { ok: true, text }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  // Appends a public key to the authorized_keys of several saved hosts. Each is
  // connected with its own saved credentials, the key written via a shell
  // here-doc (safe from quoting), then the one-shot session is torn down.
  ipcMain.handle(IPC.keysPublish, async (_e, keyId: string, hostIds: string[]) => {
    let pub: string
    try {
      pub = (await keyManager.publicKey(keyId)).trim()
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
    if (!pub) return { ok: false, error: '该密钥没有可用的公钥' }
    if (!sshManager) return { ok: false, error: '窗口未就绪' }
    const results = await withTempHosts(hostIds, async (sid) => {
      const cmd = `umask 077; mkdir -p ~/.ssh && chmod 700 ~/.ssh\ncat >> ~/.ssh/authorized_keys <<'XSSH'\n${pub}\nXSSH\ntouch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
      await sshManager!.execCommand(sid, cmd)
    })
    return { ok: true, results }
  })

  // The inverse of publish: removes this key's line from authorized_keys on the
  // given hosts. Only the key type + base64 are used as the match (the comment
  // may contain arbitrary text that would break shell quoting). A host whose
  // authorized_keys doesn't contain the key is reported ok (nothing to do).
  ipcMain.handle(IPC.keysRevoke, async (_e, keyId: string, hostIds: string[]) => {
    let pub: string
    try {
      pub = (await keyManager.publicKey(keyId)).trim()
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
    if (!pub) return { ok: false, error: '该密钥没有可用的公钥' }
    if (!sshManager) return { ok: false, error: '窗口未就绪' }
    const keyPart = pub.split(/\s+/).slice(0, 2).join(' ')
    const results = await withTempHosts(hostIds, async (sid) => {
      // if/fi (not a bare &&-chain) so a host without authorized_keys exits 0
      // ("nothing to do") while a real failure (permissions, disk) exits non-zero.
      const cmd = `k=${JSON.stringify(keyPart)}; if [ -f "$HOME/.ssh/authorized_keys" ]; then awk -v k="$k" 'index($0,k)==0' "$HOME/.ssh/authorized_keys" > "$HOME/.ssh/authorized_keys.xssh" && cat "$HOME/.ssh/authorized_keys.xssh" > "$HOME/.ssh/authorized_keys" && rm -f "$HOME/.ssh/authorized_keys.xssh"; fi`
      await sshManager!.execCommand(sid, cmd)
    })
    return { ok: true, results }
  })

  // ---- Update check vs GitHub releases ----
  // Compares the running version against the newest published release and
  // returns the update info (or a "fresh" flag). Best-effort and offline-safe:
  // any failure (no network, rate limit, no repo) returns ok:false with a
  // friendly message rather than throwing.
  ipcMain.handle(IPC.appCheckUpdate, async () => {
    const current = app.getVersion()
    try {
      const res = await fetch('https://api.github.com/repos/WyattCode/x-ssh/releases/latest', {
        headers: { 'User-Agent': app.getName() }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as {
        tag_name?: string
        html_url?: string
        name?: string
        body?: string
      }
      const latest = (data.tag_name ?? '').replace(/^v/i, '')
      if (!latest) return { ok: false, error: '无法解析最新版本' }
      const fresh = compareVersions(current, latest) >= 0
      return {
        ok: true,
        fresh,
        current,
        latest,
        url: data.html_url,
        name: data.name ?? latest,
        notes: data.body?.slice(0, 1200)
      }
    } catch (e) {
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  })
  ipcMain.handle(IPC.appGlobalShortcut, (_e, accelerator: string) => setGlobalShowHide(accelerator))
}

// ---- Global (system-wide) show/hide hotkey ----
let globalAccel = ''
/** Toggles the main window: focused+visible -> hide, otherwise show+focus. */
function toggleMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide()
  else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}
/** Registers (or clears, with '') the global show/hide accelerator. */
function setGlobalShowHide(accel: string): { ok: boolean; error?: string } {
  const acc = accel.trim()
  if (globalAccel) {
    globalShortcut.unregister(globalAccel)
    globalAccel = ''
  }
  if (!acc) return { ok: true }
  try {
    const okReg = globalShortcut.register(acc, toggleMainWindow)
    if (!okReg) return { ok: false, error: '快捷键已被其他程序占用' }
    globalAccel = acc
    return { ok: true }
  } catch (e) {
    return { ok: false, error: friendlyError((e as Error).message) }
  }
}
async function applyGlobalShowHideFromSettings(): Promise<void> {
  const accel = (await settings.get<string>('globalShowHideAccel')) ?? ''
  if (accel) setGlobalShowHide(accel)
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
  // Register as the handler for x-ssh:// URLs so a link/`start x-ssh:…` can
  // launch the app straight into a connection. Kept best-effort: registration
  // needs a packaged exe path and may fail harmlessly in dev.
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]])
      }
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL)
    }
  } catch {
    /* protocol registration unsupported here — CLI -c still works */
  }
  // macOS delivers protocol URLs via open-url rather than argv.
  app.on('open-url', (_e, url) => {
    const t = targetFromUrl(url)
    if (t) pushLaunchTarget(t)
  })
  // macOS relaunches the app with a URL when already running.
  const initialTarget = readLaunchTarget(process.argv.slice(1))
  if (initialTarget) pendingTargets.push(initialTarget)
  // Load the master-lock state so a locked app stays locked across restarts;
  // store.setLocked() gates saved-secret discovery immediately.
  await masterLock.load()
  store.setLocked(masterLock.locked)
  minimizeToTray = (await settings.get<boolean>('minimizeToTray')) === true
  // Warm the hosts cache while the window is still being built, so the
  // renderer's first list() call answers from memory instead of the disk.
  void store.list().catch(() => undefined)
  // Kick off the auto-backup timer (no-op unless autoBackup is enabled).
  void scheduleAutoBackup().catch(() => undefined)
  void applyGlobalShowHideFromSettings().catch(() => undefined)
  // Sweep temp dirs left by drag-out / edit / open-with from a prior run.
  void sweepTempDirs()
  const [saved, prefs] = await Promise.all([
    settings.get<SavedBounds>('windowBounds'),
    readUiPrefs()
  ])
  createWindow(saved, prefs)

  // Finer network-health trigger: when the machine wakes from sleep the network
  // may have dropped while the app was suspended. Nudge every renderer to
  // re-evaluate connectivity so dropped sessions retry (mirrors the online/offline
  // listeners already wired in the renderer).
  powerMonitor.on('resume', () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(IPC.appOnlineChanged, true)
    }
  })
  powerMonitor.on('unlock-screen', () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(IPC.appOnlineChanged, true)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(saved, prefs)
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Flush pending settings writes (theme toggle, window bounds, …) before the
// process exits, so a setting changed right before quit isn't lost to an
// in-flight async write. Capped so a stuck write can never block quit.
let settingsFlushed = false
app.on('will-quit', (e) => {
  if (settingsFlushed) return
  settingsFlushed = true
  e.preventDefault()
  setTimeout(() => {
    Promise.race([settings.flush(), new Promise((r) => setTimeout(r, 800))]).finally(() =>
      app.quit()
    )
  }, 50)
})
