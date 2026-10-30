import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { useConfirm } from '../composables/confirm'
import { useSnippetVars } from '../composables/snippetVars'
import { clampConcurrency } from '../../../shared/fsUtils'
import { decideStatusEvent, retryDelayMs, shouldReviveOnOnline } from '../lib/reconnect'
import {
  buildFlatTree,
  buildGrid,
  collectPaneIds,
  plainLayout,
  splitLeaf,
  removePane,
  setPaneRatio
} from '../lib/paneLayout'
import type { LayoutNode, SplitDir } from '../lib/paneLayout'
import type {
  ConnectParams,
  Host,
  HostForward,
  ForwardMode,
  KnownHostEntry,
  SessionStatus,
  Snippet,
  SftpProgress,
  TransferHistoryItem,
  DownloadItem,
  Reachability,
  ForwardErrorCode
} from '../../../shared/types'

const { t } = useI18n()
const { toast } = useToast()
const { confirm } = useConfirm()

let counter = 0
const uid = (p: string): string => `${p}-${Date.now()}-${counter++}`

/** A live port-forward failure, in the UI language. */
function forwardError(r: { error?: string; code?: ForwardErrorCode }): string {
  switch (r.code) {
    case 'no-session':
      return t('app.needLiveSession')
    case 'bad-port':
      return t('fw.badPort')
    case 'already':
      return t('fw.errAlready')
    case 'in-use':
      return t('fw.errInUse')
    default:
      return r.error || t('fw.fail')
  }
}

// Background online probe: one full round at a time, and results from a round
// that started before a newer probe of the same host are dropped.
let probeRoundBusy = false
let lastFullProbe = 0
let probeSeq = 0
const probeSeqOf = new Map<string, number>()

export const forwardKey = (f: HostForward): string => `${f.mode ?? 'local'}:${f.localPort}`
export interface ForwardRow {
  rule: HostForward
  saved: boolean
  running: boolean
}
/** One host's (or one unsaved session's) port forwards on the 端口转发 page. */
export interface ForwardGroup {
  id: string
  host?: Host
  title: string
  sub: string
  /** A connected pane of this host, when there is one. */
  pane?: Pane
  rows: ForwardRow[]
}

/** Recursively unwraps Vue reactive proxies into a plain, cloneable object.
 *  Pinia wraps store arrays/objects (snapshots, transfer history, queues) in
 *  Proxies; Electron's IPC structured-clone rejects them with "An object could
 *  not be cloned", so they must be stripped before `settings.set`. */
function toPlain<T>(value: T): T {
  const raw = toRaw(value)
  if (raw === null || typeof raw !== 'object') return raw as T
  if (raw instanceof Date) return raw as T
  if (Array.isArray(raw)) return raw.map((v) => toPlain(v)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) out[key] = toPlain((raw as Record<string, unknown>)[key])
  return out as T
}

// Panes with a connect currently in flight. Guards against overlapping connects
// (double-clicked "reconnect", a manual retry racing a scheduled one) which
// would otherwise orphan a live SSH session by overwriting its id.
const inFlight = new Set<string>()

// Sessions the store has deliberately closed (a reconnect replacing a dead
// session, a tab being torn down). Main still emits their final error/closed
// event, which would otherwise be attributed to whatever pane now holds that
// id — or, worse, read as a fresh drop and restart the reconnect loop.
//
// Bounded: an id is normally removed when its event arrives, but a session that
// is gone without a word would accumulate forever. Only the most recent few
// matter — an event later than that belongs to a session nothing is waiting on.
const retiredSessions = new Set<string>()
const RETIRED_KEEP = 64

function retireSession(sessionId: string): void {
  retiredSessions.add(sessionId)
  while (retiredSessions.size > RETIRED_KEEP) {
    const oldest = retiredSessions.values().next().value
    if (oldest === undefined) break
    retiredSessions.delete(oldest)
  }
}

/**
 * The current tabs as the persisted shape: layout tree + panes in depth-first
 * order, with secrets stripped. Shared by `persistTabs` and `saveSnapshot`,
 * which had grown two identical copies.
 */
function serializeTabs(tabs: { title: string; layout: LayoutNode; panes: Pane[]; activePaneId: string }[]): PersistedTab[] {
  return tabs.map((t) => {
    const byId = new Map(t.panes.map((p) => [p.id, p]))
    // A predicate rather than `.filter(p => !!p)`: it drops the panes a stale
    // layout still refers to and tells the compiler they are gone, so nothing
    // below needs a non-null assertion.
    const ordered = collectPaneIds(t.layout)
      .map((id) => byId.get(id))
      .filter((p): p is Pane => p !== undefined)
    return {
      title: t.title,
      tree: plainLayout(t.layout),
      activeIndex: Math.max(0, ordered.findIndex((p) => p.id === t.activePaneId)),
      panes: ordered.map((p) => {
        const params = { ...toRaw(p.params) }
        delete params.password
        delete params.passphrase
        return { params, cwd: p.lastSftpPath }
      })
    }
  })
}

/** A job whose transfer has been cancelled in the main process. */
function isCancelled(t: Pick<SftpProgress, 'error'>): boolean {
  return t.error === '已取消'
}

// Guards the global sftp:progress subscription so it's registered exactly once
// regardless of how many components/actions request it.
let sftpProgressInit = false
const sftpSpeedMeta = new Map<string, { bytes: number; time: number }>()
// Timers that prune finished transfers from the live list.
const sftpCleanupTimers = new Set<number>()

/** One terminal session. A tab holds one or more panes (split view). */
export interface Pane {
  id: string
  status: SessionStatus
  /** ssh2 session id from the main process, set once connected. */
  sshSessionId?: string
  message?: string
  /** Machine-readable failure code from the last connect attempt. */
  errorCode?: string
  /** Fingerprint the last host-key rejection reported (to trust on confirm). */
  hostKey?: string
  /** Which host a host-key rejection concerns (jump hop — the target's own
   *  address is already in `params` and needs no copy). */
  hostKeyHost?: string
  hostKeyPort?: number
  /** Params used to open the session; retained in-memory for reconnect. */
  params: ConnectParams
  /** Auto-reconnect state (set while retrying after an unexpected drop). */
  reconnectAttempt?: number
  reconnectTimer?: number
  /** Last directory shown in the SFTP drawer, for path restore on reconnect. */
  lastSftpPath?: string
}

export interface Tab {
  id: string
  title: string
  hostId?: string
  /** Split layout tree of the panes (leaves are panes, branches are splits). */
  layout: LayoutNode
  panes: Pane[]
  activePaneId: string
}

export type CursorStyle = 'bar' | 'block' | 'underline'

/** A serializable tab layout (secrets stripped) used for persistence/snapshots. */
export interface PersistedTab {
  title: string
  /** Legacy flat direction (pre-nested builds). Superseded by `tree`. */
  layout?: 'row' | 'col'
  /** Nested split tree referencing pane indices (in the same DFS order as panes). */
  tree?: LayoutNode
  activeIndex: number
  panes: { params: ConnectParams; cwd?: string }[]
  /** Back-compat for pre-layout builds that stored a single pane's params. */
  params?: ConnectParams
}

/** A named, restorable capture of the whole tab layout. */
export interface Snapshot {
  id: string
  name: string
  savedAt: number
  tabs: PersistedTab[]
}

/** An interrupted upload queued for resume after a reconnect. */
export interface TransferOp {
  id: string
  remoteDir: string
  localPaths: string[]
  at: number
}

/** An interrupted download waiting to be resumed (fixed local destination). */
export interface DownloadQueueOp {
  id: string
  sessionId: string
  /** The host the download ran against. A reconnect replaces the session id,
   *  so resume maps through this instead — ops whose session is gone and that
   *  carry no hostId are kept (never dropped) until their host connects. */
  hostId?: string
  items: DownloadItem[]
  localDir: string
  at: number
}

export type SettingsTab = 'general' | 'terminal' | 'connection' | 'keys' | 'security'

/** The page the left sidebar shows. */
export type AppPage = 'hosts' | 'terminal' | 'sftp' | 'forwards' | 'settings'
export type HostsView = 'grid' | 'list'
export const SIDEBAR_DEFAULT_W = 224
export const SIDEBAR_MIN_W = 180
export const SIDEBAR_MAX_W = 360
export const clampSidebarWidth = (w: number): number =>
  Math.round(Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, w)))
export type HostsSort = 'recent' | 'name' | 'address'

/** Startup layout from main's launch prefs (read synchronously by the preload),
 *  so the first frame already has the saved sidebar / view — loading them
 *  later from settings painted the defaults first and then jumped. */
const bootPrefs = (typeof window !== 'undefined' ? window.api?.prefs : undefined) ?? {}
const bootWidth = Number(bootPrefs.sidebarWidth)
/** Last sidebar width known on disk (or the startup default). Drag/persist failures roll back here. */
let savedSidebarWidth = bootWidth > 0 ? clampSidebarWidth(bootWidth) : SIDEBAR_DEFAULT_W

interface State {
  hosts: Host[]
  tabs: Tab[]
  activeId: string | null
  /** Sidebar page. Terminals stay mounted (hidden) on every other page. */
  page: AppPage
  /** Where「设置」returns to when toggled off (Ctrl+, twice). */
  prevPage: AppPage
  sidebarCollapsed: boolean
  /** On the 终端 page the sidebar can be hidden entirely (terminal full width);
   *  remembered, so every session opens the way it was last left. */
  termSidebarHidden: boolean
  /** Sidebar width when expanded (dragged by its right edge). */
  sidebarWidth: number
  hostsView: HostsView
  hostsSort: HostsSort
  /** Background online probe results, by host id (see main/reachability.ts). */
  reach: Record<string, Reachability>
  /** Saved host being connected from 打开 SFTP (buttons show busy meanwhile). */
  sftpConnecting: string
  paletteOpen: boolean
  sftpOpen: boolean
  settingsOpen: boolean
  historyOpen: boolean
  /** Which settings section is showing. */
  settingsTab: SettingsTab
  externalEditor: string | null
  snippets: Snippet[]
  knownHosts: KnownHostEntry[]
  sftpBookmarks: string[]
  /** Recently-visited SFTP remote dirs (MRU, capped), persisted. */
  sftpRecent: string[]
  snapshots: Snapshot[]
  transferQueue: TransferOp[]
  /** Interrupted downloads waiting to be resumed into a fixed local dir. */
  downloadQueue: DownloadQueueOp[]
  /** Finished SFTP transfers, persisted across restarts (newest first). */
  transferHistory: TransferHistoryItem[]
  /** Live SFTP transfers (all sessions), tracked globally so they update and
   *  notify even when the drawer is closed or the window is minimized. */
  transfers: SftpProgress[]
  /** Smoothed transfer speed (bytes/sec) per job id. */
  transferSpeeds: Record<string, number>
  /** Whether the global transfers panel (overlays) is open. */
  transferPanelOpen: boolean
  // Preferences (persisted in settings.json).
  keepaliveSec: number
  connectTimeoutSec: number
  connectRetries: number
  transferConcurrency: number
  /** Verify each downloaded file's SHA-256 against the remote copy. */
  verifyChecksums: boolean
  /** Identify hosts' OS in the background (quiet read-only login). */
  autoDetectOs: boolean
  shellIntegration: boolean
  terminalFontFamily: string
  terminalCursor: CursorStyle
  terminalTheme: string
  restoreTabs: boolean
  autoReconnect: boolean
  /** Auto-reconnect restored tabs on launch (rather than showing them closed). */
  restoreConnect: boolean
  /** `cd` into the last-browsed directory on reconnect / restore. */
  restoreCwd: boolean
  notifications: boolean
  /** Play a system sound on desktop notifications (transfer done / disconnect). */
  notifySound: boolean
  /** Scheduled automatic backups (dir + interval hours). */
  autoBackup: boolean
  autoBackupDir: string | null
  autoBackupEveryHours: number
  /** Per-extension default opener program path (ext → executable). */
  fileOpeners: Record<string, string>
  /** Custom UI accent color ('' = default per theme). */
  accentColor: string
  /** User overrides for rebindable app shortcuts (action → chord). */
  keybindings: Record<string, string>
  /** Whether a master-lock passphrase has been configured. */
  lockEnabled: boolean
  /** Whether the app is currently locked (secrets gated until unlocked). */
  lockLocked: boolean
  /** True when tabs were restored while locked, so they reconnect after unlock. */
  restorePendingUnlock: boolean
  /** Pre-filled palette query (from a launch CLI/URL target), consumed on open. */
  paletteSeed: string | null
  /** With paletteSeed: jump straight to the seeded quick connect's password step. */
  paletteQuick: boolean
  /** Open the palette on this saved host's password step (no password saved). */
  palettePasswordFor: string | null
  confirmPaste: boolean
  /** Strip non-printing control characters from pasted text (default on). */
  sanitizePaste: boolean
  /** Auto-copy the terminal selection to the clipboard on select. */
  copyOnSelect: boolean
  /** Middle mouse button pastes the clipboard (default on). */
  middleClickPaste: boolean
  /** Right mouse button pastes the clipboard instead of the context menu. */
  rightClickPaste: boolean
  /** Confirm before closing a tab that still has a live session (default off). */
  confirmClose: boolean
  /** Default per-transfer rate cap (KiB/s; 0 = unlimited). */
  transferRateKbps: number
  /** Minimize to the system tray on close (instead of quitting), so transfers
   *  keep running (default off). */
  minimizeToTray: boolean
  /** Reuse a shared connection to the same host (ControlMaster-style
   *  multiplexing; default off). */
  connectionMultiplex: boolean
  /** Auto-attach-or-create a tmux session after connecting (default off). */
  tmuxOnConnect: boolean
  /** Name of the tmux session to auto-attach ('' = derive from the host). */
  tmuxSessionName: string
  /** Whether the tmux session-manager dialog is open. */
  tmuxOpen: boolean
  /** Whether the port-forward manager dialog is open. */
  forwardOpen: boolean
  /** Whether the "publish public key to hosts" dialog is open. */
  publishOpen: boolean
  /** Whether the session-recording replay dialog is open. */
  replayOpen: boolean
  /** Global show/hide hotkey (Electron accelerator, '' = disabled). */
  globalShowHide: string
  /** Whether the OS reports the network as online (drives an offline banner). */
  networkOnline: boolean
}

export const useSessions = defineStore('sessions', {
  state: (): State => ({
    hosts: [],
    tabs: [],
    activeId: null,
    page: 'hosts',
    prevPage: 'hosts',
    sidebarCollapsed: bootPrefs.sidebarCollapsed === true,
    termSidebarHidden: bootPrefs.termSidebarHidden === true,
    sidebarWidth: bootWidth > 0 ? clampSidebarWidth(bootWidth) : SIDEBAR_DEFAULT_W,
    hostsView: bootPrefs.hostsView === 'list' ? 'list' : 'grid',
    hostsSort: bootPrefs.hostsSort === 'name' || bootPrefs.hostsSort === 'address' ? bootPrefs.hostsSort : 'recent',
    reach: {},
    sftpConnecting: '',
    paletteOpen: false,
    sftpOpen: false,
    settingsOpen: false,
    historyOpen: false,
    settingsTab: 'general',
    externalEditor: null,
    snippets: [],
    knownHosts: [],
    sftpBookmarks: [],
    sftpRecent: [],
    snapshots: [],
    transferQueue: [],
    downloadQueue: [],
    transferHistory: [],
    transfers: [],
    transferSpeeds: {},
    transferPanelOpen: false,
    keepaliveSec: 20,
    connectTimeoutSec: 20,
    connectRetries: 6,
    transferConcurrency: 4,
    verifyChecksums: false,
    autoDetectOs: true,
    shellIntegration: true,
    terminalFontFamily: '',
    terminalCursor: 'bar',
    terminalTheme: '',
    restoreTabs: true,
    autoReconnect: true,
    restoreConnect: false,
    restoreCwd: true,
    notifications: true,
    notifySound: false,
    autoBackup: false,
    autoBackupDir: null,
    autoBackupEveryHours: 24,
    fileOpeners: {},
    accentColor: '',
    keybindings: {},
    lockEnabled: false,
    lockLocked: false,
    restorePendingUnlock: false,
    paletteSeed: null,
    paletteQuick: false,
    palettePasswordFor: null,
    confirmPaste: true,
    sanitizePaste: true,
    copyOnSelect: false,
    middleClickPaste: true,
    rightClickPaste: false,
    confirmClose: false,
    transferRateKbps: 0,
    minimizeToTray: false,
    connectionMultiplex: false,
    tmuxOnConnect: false,
    tmuxSessionName: '',
    tmuxOpen: false,
    forwardOpen: false,
    publishOpen: false,
    replayOpen: false,
    globalShowHide: '',
    networkOnline: true
  }),

  getters: {
    /** Saved rules per host plus the temporary ones added to any of its live
     *  sessions, then live sessions that aren't saved hosts. A saved rule is
     *  "running" while its host has a connected session (main opens saved rules
     *  on every connect). */
    forwardGroups(s): ForwardGroup[] {
      const panesByHost = new Map<string, Pane[]>()
      const loose: { pane: Pane; title: string }[] = []
      for (const tab of s.tabs) {
        for (const p of tab.panes) {
          if (p.status !== 'connected') continue
          const hid = p.params.hostId
          if (hid && s.hosts.some((h) => h.id === hid)) panesByHost.set(hid, [...(panesByHost.get(hid) ?? []), p])
          else loose.push({ pane: p, title: tab.title })
        }
      }
      const out: ForwardGroup[] = []
      for (const h of s.hosts) {
        const panes = panesByHost.get(h.id) ?? []
        const saved = h.portForwards ?? []
        const seen = new Set(saved.map(forwardKey))
        const temp: HostForward[] = []
        for (const p of panes) {
          for (const f of p.params.portForwards ?? []) {
            if (seen.has(forwardKey(f))) continue
            seen.add(forwardKey(f))
            temp.push(f)
          }
        }
        if (!saved.length && !temp.length) continue
        out.push({
          id: h.id,
          host: h,
          title: h.label,
          sub: `${h.username}@${h.host}${h.port && h.port !== 22 ? ':' + h.port : ''}`,
          pane: panes[0],
          rows: [
            ...saved.map((rule) => ({ rule, saved: true, running: panes.length > 0 })),
            ...temp.map((rule) => ({ rule, saved: false, running: true }))
          ]
        })
      }
      for (const { pane, title } of loose) {
        const temp = pane.params.portForwards ?? []
        if (!temp.length) continue
        out.push({
          id: pane.id,
          title,
          sub: `${pane.params.username}@${pane.params.host}`,
          pane,
          rows: temp.map((rule) => ({ rule, saved: false, running: true }))
        })
      }
      return out
    },
    active: (s): Tab | undefined => s.tabs.find((t) => t.id === s.activeId),
    activePane(s): Pane | undefined {
      const t = s.tabs.find((x) => x.id === s.activeId)
      if (!t) return undefined
      return t.panes.find((p) => p.id === t.activePaneId) ?? t.panes[0]
    }
  },

  actions: {
    /** Locates a pane (and its tab) by pane id. */
    findPane(paneId: string): { tab: Tab; pane: Pane } | null {
      for (const tab of this.tabs) {
        const pane = tab.panes.find((p) => p.id === paneId)
        if (pane) return { tab, pane }
      }
      return null
    },
    paneBySession(sessionId: string): Pane | undefined {
      for (const tab of this.tabs) {
        const pane = tab.panes.find((p) => p.sshSessionId === sessionId)
        if (pane) return pane
      }
      return undefined
    },

    async loadHosts(): Promise<void> {
      this.hosts = await window.api.hosts.list()
    },

    async loadSettings(): Promise<void> {
      const [editor, ka, ct, cr, tc, vcs, ados, si, ff, cur, thm, rt, ar, rcn, rcw, nt, ns, cp, sp, tq, dq, tfh, abk, abd, abh] = await Promise.all([
        window.api.settings.get<string>('externalEditor'),
        window.api.settings.get<number>('keepaliveSec'),
        window.api.settings.get<number>('connectTimeoutSec'),
        window.api.settings.get<number>('connectRetries'),
        window.api.settings.get<number>('transferConcurrency'),
        window.api.settings.get<boolean>('verifyChecksums'),
        window.api.settings.get<boolean>('autoDetectOs'),
        window.api.settings.get<boolean>('shellIntegration'),
        window.api.settings.get<string>('terminalFontFamily'),
        window.api.settings.get<CursorStyle>('terminalCursor'),
        window.api.settings.get<string>('terminalTheme'),
        window.api.settings.get<boolean>('restoreTabs'),
        window.api.settings.get<boolean>('autoReconnect'),
        window.api.settings.get<boolean>('restoreConnect'),
        window.api.settings.get<boolean>('restoreCwd'),
        window.api.settings.get<boolean>('notifications'),
        window.api.settings.get<boolean>('notifySound'),
        window.api.settings.get<boolean>('confirmPaste'),
        window.api.settings.get<boolean>('sanitizePaste'),
        window.api.settings.get<TransferOp[]>('transferQueue'),
        window.api.settings.get<DownloadQueueOp[]>('downloadQueue'),
        window.api.settings.get<TransferHistoryItem[]>('sftpTransferHistory'),
        window.api.settings.get<boolean>('autoBackup'),
        window.api.settings.get<string>('autoBackupDir'),
        window.api.settings.get<number>('autoBackupEveryHours')
      ])
      this.externalEditor = editor ?? null
      this.keepaliveSec = typeof ka === 'number' ? ka : 20
      this.connectTimeoutSec = typeof ct === 'number' && ct > 0 ? ct : 20
      this.connectRetries = typeof cr === 'number' && cr >= 0 ? cr : 6
      this.transferConcurrency = clampConcurrency(typeof tc === 'number' ? tc : 4, 4)
      this.verifyChecksums = vcs === true
      this.autoDetectOs = ados !== false
      this.shellIntegration = si !== false
      this.transferQueue = tq ?? []
      this.downloadQueue = dq ?? []
      this.transferHistory = tfh ?? []
      this.terminalFontFamily = ff ?? ''
      this.terminalCursor = cur ?? 'bar'
      this.terminalTheme = thm ?? ''
      this.restoreTabs = rt !== false
      this.autoReconnect = ar !== false
      this.restoreConnect = rcn === true
      this.restoreCwd = rcw !== false
      this.notifications = nt !== false
      this.notifySound = ns === true
      this.autoBackup = abk === true
      this.autoBackupDir = abd ?? null
      this.autoBackupEveryHours = typeof abh === 'number' && abh > 0 ? abh : 24
      this.fileOpeners = (await window.api.settings.get<Record<string, string>>('fileOpeners')) ?? {}
      this.accentColor = (await window.api.settings.get<string>('accentColor')) ?? ''
      this.keybindings = (await window.api.settings.get<Record<string, string>>('keybindings')) ?? {}
      this.confirmPaste = cp !== false
      this.sanitizePaste = sp !== false
      this.copyOnSelect = (await window.api.settings.get<boolean>('copyOnSelect')) === true
      this.middleClickPaste = (await window.api.settings.get<boolean>('middleClickPaste')) !== false
      this.rightClickPaste = (await window.api.settings.get<boolean>('rightClickPaste')) === true
      this.confirmClose = (await window.api.settings.get<boolean>('confirmClose')) === true
      // Sidebar collapsed / width / focus mode and the hosts view + sort start
      // from the launch prefs in state(), so the first frame is already right.
      // Re-read here only to catch up after a renderer reload (main reloads once
      // after a crash, and the launch prefs are from window creation): applied
      // only when the stored value exists and differs — on a normal launch they
      // match and nothing moves.
      const [sc, ts, swRaw, hv, hs] = await Promise.all([
        window.api.settings.get<boolean>('sidebarCollapsed'),
        window.api.settings.get<boolean>('termSidebarHidden'),
        window.api.settings.get<number>('sidebarWidth'),
        window.api.settings.get<string>('hostsView'),
        window.api.settings.get<string>('hostsSort')
      ])
      if (typeof sc === 'boolean' && sc !== this.sidebarCollapsed) this.sidebarCollapsed = sc
      if (typeof ts === 'boolean' && ts !== this.termSidebarHidden) this.termSidebarHidden = ts
      const sw = Number(swRaw)
      if (sw > 0 && clampSidebarWidth(sw) !== this.sidebarWidth) this.sidebarWidth = clampSidebarWidth(sw)
      if ((hv === 'grid' || hv === 'list') && hv !== this.hostsView) this.hostsView = hv
      if ((hs === 'recent' || hs === 'name' || hs === 'address') && hs !== this.hostsSort) this.hostsSort = hs
      this.transferRateKbps =
        (await window.api.settings.get<number>('transferRateKbps')) ?? 0
      this.minimizeToTray = (await window.api.settings.get<boolean>('minimizeToTray')) === true
      this.connectionMultiplex = (await window.api.settings.get<boolean>('connectionMultiplex')) === true
      this.tmuxOnConnect = (await window.api.settings.get<boolean>('tmuxOnConnect')) === true
      this.tmuxSessionName = (await window.api.settings.get<string>('tmuxSessionName')) ?? ''
      this.globalShowHide = (await window.api.settings.get<string>('globalShowHideAccel')) ?? ''
    },

    async loadSnippets(): Promise<void> {
      this.snippets = await window.api.snippets.list()
    },
    async saveSnippet(snippet: Snippet): Promise<void> {
      this.snippets = await window.api.snippets.save(snippet)
    },
    async deleteSnippet(id: string): Promise<void> {
      this.snippets = await window.api.snippets.delete(id)
    },
    /** Sends a snippet (+ trailing newline) to the focused terminal. If the
     *  snippet contains `{var}` placeholders, prompts for each before sending. */
    async sendSnippet(snippet: Snippet): Promise<void> {
      const sid = this.activePane?.sshSessionId
      if (!sid) {
        // The palette closes first, so with no live terminal the item used to
        // vanish without a word — it looked like the app ignored the click.
        toast(t('app.needLiveSession'), 'info')
        return
      }
      // Never type into a terminal that isn't on screen.
      this.setPage('terminal')
      if (snippet.confirm) {
        const ok = await confirm(
          t('snip.confirm', { title: snippet.title })
        )
        if (!ok) return
      }
      const text = await useSnippetVars().prompt(snippet)
      if (text == null) return
      const send = text.endsWith('\n') ? text : text + '\n'
      window.api.ssh.input(sid, send)
    },

    async loadKnownHosts(): Promise<void> {
      this.knownHosts = await window.api.knownHosts.list()
    },
    /** Whether a host:port key has ever been recorded (trusted once). */
    hostKeyKnown(host: string, port: number): boolean {
      return this.knownHosts.some((k) => k.host === host && (k.port || 22) === (port || 22))
    },

    async loadSftpBookmarks(): Promise<void> {
      this.sftpBookmarks = (await window.api.settings.get<string[]>('sftpBookmarks')) ?? []
    },
    async loadSftpRecent(): Promise<void> {
      this.sftpRecent = (await window.api.settings.get<string[]>('sftpRecent')) ?? []
    },
    /** Records a visited remote dir into the MRU list (capped at 10). */
    async addSftpRecent(path: string): Promise<void> {
      const next = [path, ...this.sftpRecent.filter((p) => p !== path)].slice(0, 10)
      if (JSON.stringify(next) === JSON.stringify(this.sftpRecent)) return
      this.sftpRecent = next
      await window.api.settings.set('sftpRecent', next)
    },
    /** Adds/removes a remote dir from the SFTP bookmarks (capped at 20). */
    async toggleSftpBookmark(path: string): Promise<void> {
      const i = this.sftpBookmarks.indexOf(path)
      let next: string[]
      if (i >= 0) {
        next = this.sftpBookmarks.slice()
        next.splice(i, 1)
      } else {
        next = [...this.sftpBookmarks, path].slice(-20)
      }
      this.sftpBookmarks = next
      await window.api.settings.set('sftpBookmarks', next)
    },

    async saveSetting(key: string, value: unknown): Promise<void> {
      // Main refuses keys outside its allowlist. Swallowing that would recreate
      // the "interface said it saved but nothing was written" bug class, so log
      // it loudly instead — a rejected key means the key list is out of date.
      const r = await window.api.settings.set(key, toPlain(value))
      if (r && r.ok === false) {
        console.error(`settings: not saved — main refused key "${key}": ${r.error ?? ''}`)
      }
    },

    /** Registers the global show/hide hotkey ('' = disable). Persists on success. */
    async setGlobalShowHide(accel: string): Promise<{ ok: boolean; error?: string }> {
      const r = await window.api.setGlobalShortcut(accel)
      if (!r.ok) return r
      this.globalShowHide = accel.trim()
      await this.saveSetting('globalShowHideAccel', this.globalShowHide)
      return { ok: true }
    },

    /** The OS network went offline: flag it (drives the offline banner). */
    handleNetworkOffline(): void {
      this.networkOnline = false
      toast(t('app.networkOffline'), 'info')
    },
    /** The OS network came back: drop the offline flag and retry dropped panes.
     *  The per-pane backoff already retries on a session drop, but that loop is
     *  blind to the network coming back while waiting — this gives a pane that
     *  gave up (or is mid-backoff) a fresh retry the moment the link returns. */
    handleNetworkOnline(): void {
      const wasOffline = !this.networkOnline
      this.networkOnline = true
      if (!wasOffline) return
      toast(t('app.networkOnline'), 'success')
      for (const tab of this.tabs) {
        for (const pane of tab.panes) {
          // Only revive genuinely-dropped sessions. A pane whose last attempt
          // returned a code (bad credentials, changed host key, locked app) is
          // skipped — but runConnect clears errorCode as a new attempt starts,
          // so one that has since been retried is eligible again.
          if (
            shouldReviveOnOnline({
              status: pane.status,
              errorCode: pane.errorCode,
              sessionId: pane.sshSessionId,
              autoReconnect: this.autoReconnect
            }) &&
            pane.params
          ) {
            this.cancelReconnect(pane)
            this.scheduleReconnect(pane.id)
          }
        }
      }
    },

    /** Machine woke from sleep / screen unlocked (main powerMonitor). The network
     *  may have dropped while suspended, but the OS usually stays "online", so
     *  handleNetworkOnline's wasOffline-gate would no-op here. Re-read the actual
     *  connectivity and force a fresh retry of any genuinely-dropped pane. */
    handleWake(): void {
      this.networkOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
      for (const tab of this.tabs) {
        for (const pane of tab.panes) {
          const dropped = pane.status === 'error' && !pane.errorCode && !pane.sshSessionId
          if (dropped && pane.params && this.autoReconnect) {
            this.cancelReconnect(pane)
            this.scheduleReconnect(pane.id)
          }
        }
      }
    },

    /** Re-reads auto-backup prefs in the main process and restarts its timer. */
    async rescheduleBackup(): Promise<void> {
      await window.api.data.rescheduleBackup()
    },

    // ---- App master-lock ----
    async loadLockStatus(): Promise<void> {
      const s = await window.api.lock.status()
      this.lockEnabled = s.enabled
      this.lockLocked = s.locked
    },
    async setMasterPassphrase(passphrase: string): Promise<{ ok: boolean; error?: string }> {
      const r = await window.api.lock.setPassphrase(passphrase)
      this.lockEnabled = r.enabled
      this.lockLocked = r.locked
      return { ok: r.ok, error: r.error }
    },
    async unlockApp(passphrase: string): Promise<boolean> {
      const r = await window.api.lock.unlock(passphrase)
      this.lockLocked = r.locked
      return r.ok
    },
    async disableMasterLock(passphrase: string): Promise<boolean> {
      const r = await window.api.lock.disable(passphrase)
      this.lockEnabled = r.enabled
      this.lockLocked = r.locked
      return r.ok
    },
    async lockNow(): Promise<void> {
      const r = await window.api.lock.lockNow()
      this.lockLocked = r.locked
      // Hide the hasSavedPassword flags in the in-memory host list while locked.
      if (this.lockLocked) await this.loadHosts()
    },
    async resetMasterLock(passphrase: string): Promise<boolean> {
      const r = await window.api.lock.reset(passphrase)
      this.lockEnabled = r.enabled
      this.lockLocked = r.locked
      return r.ok
    },

    /** Persists every tab (layout + panes, minus secrets) so it can be restored. */
    persistTabs(): void {
      if (!this.restoreTabs) return
      void window.api.settings.set('openTabs', serializeTabs(this.tabs))
    },

    /** Recreates last session's tabs (layout + splits). If `restoreConnect` is
     *  on, reconnects every restored pane in the background so the previous
     *  sessions come back to life on launch. */
    async restoreSavedTabs(): Promise<void> {
      if (!this.restoreTabs) return
      const list = await window.api.settings.get<PersistedTab[]>('openTabs')
      if (!list?.length) return
      this.restoreTabsFrom(list)
      if (this.restoreConnect) {
        // While the app is locked, don't reconnect (saved secrets are gated and
        // every attempt fails with code 'locked'). Defer to after unlock.
        if (this.lockLocked) {
          this.restorePendingUnlock = true
          return
        }
        for (const tab of this.tabs) {
          for (const pane of tab.panes) {
            // Mark as a background (non-user-initiated) attempt so a restore
            // failure doesn't spam a toast on launch; retried by auto-reconnect.
            pane.reconnectAttempt = 1
            void this.runConnect(pane.id)
          }
        }
      }
    },

    /** After unlocking, reconnect any tabs that were deferred while locked. */
    connectPendingAfterUnlock(): void {
      if (!this.restorePendingUnlock) return
      this.restorePendingUnlock = false
      if (!this.restoreConnect) return
      for (const tab of this.tabs) {
        for (const pane of tab.panes) {
          pane.reconnectAttempt = 1
          void this.runConnect(pane.id)
        }
      }
    },

    /** Builds tabs from a persisted layout (used by restore & openSnapshot). */
    restoreTabsFrom(list: PersistedTab[]): void {
      for (const item of list) {
        // Back-compat: older builds persisted a single `{ title, params }`
        // shape; treat it as a one-pane tab whose main pane is that params.
        const panesList: { params: ConnectParams; cwd?: string }[] = item.panes?.length
          ? item.panes
          : item.params
            ? [{ params: item.params }]
            : []
        if (!panesList.length) continue
        const tabId = uid('tab')
        // Fresh ids for every pane. A nested tree's leaves (in DFS order) map to
        // the persisted panes column one-for-one; a legacy flat layout lays all
        // panes in one direction.
        const paneIds = panesList.map(() => uid('pane'))
        let layout: LayoutNode
        if (item.tree && collectPaneIds(item.tree).length === paneIds.length) {
          let i = 0
          const reassign = (n: LayoutNode): LayoutNode =>
            n.kind === 'leaf'
              ? { kind: 'leaf', paneId: paneIds[i++] }
              : { ...n, children: n.children.map(reassign) }
          layout = reassign(item.tree)
        } else {
          const dir: SplitDir = item.layout === 'col' ? 'col' : 'row'
          layout = buildFlatTree(paneIds, dir)
        }
        const panes = panesList.map((p, i) => ({
          id: paneIds[i],
          status: 'closed' as const,
          params: p.params,
          lastSftpPath: p.cwd
        }))
        this.tabs.push({
          id: tabId,
          title: item.title,
          hostId: item.panes?.[0]?.params.hostId ?? panes[0].params.hostId,
          layout,
          panes,
          activePaneId: paneIds[item.activeIndex ?? 0] ?? paneIds[0]
        })
      }
      this.activeId = this.tabs[0]?.id ?? null
    },

    async loadSnapshots(): Promise<void> {
      this.snapshots = (await window.api.settings.get<Snapshot[]>('snapshots')) ?? []
    },
    /** Reloads the persisted transfer history (after a full import). */
    loadTransferHistory(): Promise<void> {
      return window.api.settings.get<TransferHistoryItem[]>('sftpTransferHistory').then((h) => {
        this.transferHistory = h ?? []
      })
    },
    /** Records an interrupted upload so it can be resumed after a reconnect. */
    async queueUpload(remoteDir: string, localPaths: string[]): Promise<void> {
      if (!localPaths.length) return
      this.transferQueue = [
        { id: uid('xfer'), remoteDir, localPaths, at: Date.now() },
        ...this.transferQueue
      ].slice(0, 20)
      await window.api.settings.set('transferQueue', toPlain(this.transferQueue))
    },
    async clearTransferQueue(): Promise<void> {
      this.transferQueue = []
      await window.api.settings.set('transferQueue', toPlain(this.transferQueue))
    },
    /** Records an interrupted download so it can be resumed into its local dir. */
    async queueDownload(sessionId: string, items: DownloadItem[], localDir: string, hostId?: string): Promise<void> {
      if (!items.length || !localDir) return
      this.downloadQueue = [
        { id: uid('xfer'), sessionId, hostId, items, localDir, at: Date.now() },
        ...this.downloadQueue
      ].slice(0, 20)
      await window.api.settings.set('downloadQueue', toPlain(this.downloadQueue))
    },
    /** Rewrites the queue minus the ops a resume consumed; failed / unmapped
     *  ops stay so a later resume (after the host reconnects) can take them. */
    async setDownloadQueue(ops: DownloadQueueOp[]): Promise<void> {
      this.downloadQueue = ops.slice(0, 20)
      await window.api.settings.set('downloadQueue', toPlain(this.downloadQueue))
    },
    async clearDownloadQueue(): Promise<void> {
      this.downloadQueue = []
      await window.api.settings.set('downloadQueue', toPlain(this.downloadQueue))
    },
    /** Records a finished transfer into the persisted history (newest first). */
    async pushTransferHistory(item: TransferHistoryItem): Promise<void> {
      this.transferHistory = [item, ...this.transferHistory].slice(0, 100)
      await window.api.settings.set('sftpTransferHistory', toPlain(this.transferHistory))
    },
    async clearTransferHistory(): Promise<void> {
      this.transferHistory = []
      await window.api.settings.set('sftpTransferHistory', toPlain(this.transferHistory))
    },
    /** Removes a single transfer entry from the persisted history. */
    async removeTransferHistory(id: string): Promise<void> {
      this.transferHistory = this.transferHistory.filter((h) => h.id !== id)
      await window.api.settings.set('sftpTransferHistory', toPlain(this.transferHistory))
    },

    /** Registers the single global sftp:progress listener. Transfers keep
     *  running in the main process regardless of the UI, so this tracks every
     *  job, notifies on completion, and records history even when the drawer is
     *  closed or the window is minimized. Idempotent. */
    initSftpProgress(): void {
      if (sftpProgressInit) return
      sftpProgressInit = true
      window.api.sftp.onProgress((p) => {
        const i = this.transfers.findIndex((t) => t.id === p.id)
        if (i >= 0) this.transfers[i] = { ...this.transfers[i], ...p }
        else this.transfers.push({ ...p })
        // Live speed: exponential moving average of the instantaneous rate.
        if (!p.done && !p.error) {
          const now = Date.now()
          const prev = sftpSpeedMeta.get(p.id)
          if (prev && now > prev.time) {
            const inst = ((p.transferred - prev.bytes) / (now - prev.time)) * 1000
            this.transferSpeeds[p.id] = this.transferSpeeds[p.id]
              ? this.transferSpeeds[p.id] * 0.6 + inst * 0.4
              : Math.max(0, inst)
          }
          sftpSpeedMeta.set(p.id, { bytes: p.transferred, time: now })
        } else {
          delete this.transferSpeeds[p.id]
          sftpSpeedMeta.delete(p.id)
        }
        const cancelled = isCancelled(p)
        // An upload that errored (usually a dropped session) is queued for
        // resume once the link returns.
        if (p.error && !cancelled && p.direction === 'up' && p.localPaths?.length) {
          void this.queueUpload(p.remoteDir ?? '', p.localPaths)
        }
        // A failed download is queued so it can be batch-resumed into the same
        // local destination once the link returns.
        if (p.error && !cancelled && p.direction === 'down' && p.items?.length) {
          void this.queueDownload(
            p.sessionId ?? '',
            p.items,
            p.localDir ?? '',
            this.paneBySession(p.sessionId ?? '')?.params.hostId
          )
        }
        // Audit the transfer for the security log (who moved what, if the pane
        // maps back to a host). Only terminal events (done/error) are recorded.
        if (p.done || p.error) {
          const owner = p.sessionId ? this.paneBySession(p.sessionId) : undefined
          if (owner) {
            void window.api.connLog.push({
              at: Date.now(),
              event: 'transfer',
              host: owner.params.host,
              port: owner.params.port || 22,
              username: owner.params.username,
              detail: p.error ? `${p.name} · ${p.error}` : p.name,
              bytes: p.transferred
            })
          }
        }
        if (p.done || p.error) {
          if (!cancelled) {
            window.api.notify(
              p.error ? t('sfp.notifyError') : t('sfp.notifyDone'),
              `${p.name}\n${p.direction === 'up' ? t('sfp.up') : t('sfp.down')}${p.error ? ` · ${p.error}` : ''}`,
              !p.error
            )
            toast(
              p.error ? `${p.name} · ${t('sfp.failed')}` : `${p.name} · ${t('sfp.done')}`,
              p.error ? 'error' : 'success'
            )
          }
          // Record into the persisted history (newest first, capped in store).
          void this.pushTransferHistory({
            id: p.id,
            sessionId: p.sessionId,
            name: p.name,
            direction: p.direction,
            bytes: p.transferred,
            count: p.count,
            status: cancelled ? 'cancelled' : p.error ? 'error' : 'done',
            error: p.error && !cancelled ? p.error : undefined,
            remoteDir: p.remoteDir,
            localDir: p.localDir,
            isDir: p.isDir,
            remotePath: p.remotePath,
            items: p.items,
            localPaths: p.localPaths,
            at: Date.now()
          })
          const id = p.id
          const tid = window.setTimeout(() => {
            sftpCleanupTimers.delete(tid)
            this.transfers = this.transfers.filter((t) => t.id !== id)
          }, p.error ? 4000 : 1200)
          sftpCleanupTimers.add(tid)
        }
      })
    },

    /** Cancels a running transfer by job id (from a panel row `x` button). */
    cancelTransfer(id: string): void {
      window.api.sftp.cancel(id)
    },
    toggleTransferPanel(open?: boolean): void {
      this.transferPanelOpen = open ?? !this.transferPanelOpen
    },    /** Captures the current tab layout (minus secrets) as a named snapshot. */
    async saveSnapshot(name: string): Promise<void> {
      const snap: Snapshot = {
        id: uid('snap'),
        name,
        savedAt: Date.now(),
        tabs: serializeTabs(this.tabs)
      }
      this.snapshots = [snap, ...this.snapshots].slice(0, 30)
      await window.api.settings.set('snapshots', toPlain(this.snapshots))
    },
    async deleteSnapshot(id: string): Promise<void> {
      this.snapshots = this.snapshots.filter((s) => s.id !== id)
      await window.api.settings.set('snapshots', toPlain(this.snapshots))
    },
    /** Replaces the current tabs with a saved snapshot (disconnected). */
    async openSnapshot(id: string): Promise<void> {
      const s = this.snapshots.find((x) => x.id === id)
      if (!s) return
      const ids = this.tabs.map((t) => t.id)
      ids.forEach((tid) => this.closeTab(tid))
      this.restoreTabsFrom(s.tabs)
      // closeTab persisted the emptied list along the way; without this the
      // snapshot workspace lives in memory only and the next start comes back
      // to zero tabs.
      this.persistTabs()
    },

    /** Records the SFTP drawer's current dir so a reconnect can reopen there.
     *  Kept in-memory only (and captured by persistTabs on tab mutations) so
     *  browsing directories doesn't spam the settings file. */
    setSftpPath(sessionId: string, path: string): void {
      const pane = this.paneBySession(sessionId)
      if (pane) pane.lastSftpPath = path
    },

    setActive(id: string): void {
      this.activeId = id
    },
    setActivePane(tabId: string, paneId: string): void {
      const tab = this.tabs.find((t) => t.id === tabId)
      if (tab && tab.panes.some((p) => p.id === paneId)) tab.activePaneId = paneId
    },

    togglePalette(open?: boolean): void {
      this.paletteOpen = open ?? !this.paletteOpen
    },
    /** A saved host needs its password typed: the palette opens right on it,
     *  instead of empty (where the host had to be found again). */
    askPasswordFor(host: Host): void {
      this.palettePasswordFor = host.id
      this.togglePalette(true)
    },
    toggleSftp(open?: boolean): void {
      this.sftpOpen = open ?? !this.sftpOpen
    },
    /** Settings is a sidebar page now; toggling it off goes back to where you were. */
    toggleSettings(open?: boolean, tab?: SettingsTab): void {
      if (tab) this.settingsTab = tab
      const want = open ?? this.page !== 'settings'
      if (want) this.setPage('settings')
      else if (this.page === 'settings') this.setPage(this.prevPage === 'settings' ? 'hosts' : this.prevPage)
    },
    setPage(page: AppPage): void {
      if (page === this.page) return
      if (page === 'settings') this.prevPage = this.page
      this.page = page
      this.settingsOpen = page === 'settings'
      this.paletteOpen = false
    },
    setSidebarCollapsed(v: boolean): void {
      const prev = this.sidebarCollapsed
      this.sidebarCollapsed = v
      void window.api.settings.set('sidebarCollapsed', v).then((r) => {
        if (r && r.ok === false) {
          this.sidebarCollapsed = prev
          toast(t('set.gen.writeFail'), 'error')
        }
      }).catch(() => {
        this.sidebarCollapsed = prev
        toast(t('set.gen.writeFail'), 'error')
      })
    },
    /** Live while dragging (`persist` false), saved on release. */
    setSidebarWidth(w: number, persist = true): void {
      this.sidebarWidth = clampSidebarWidth(w)
      if (!persist) return
      const next = this.sidebarWidth
      if (next === savedSidebarWidth) return
      // Keep settings.set('sidebarWidth' on one line for settingsKeys allowlist scan.
      void window.api.settings.set('sidebarWidth', next).then((r) => {
        if (r && r.ok === false) this.sidebarWidth = savedSidebarWidth
        else savedSidebarWidth = next
      }).catch(() => {
        this.sidebarWidth = savedSidebarWidth
      })
    },
    /** 设置 → 常规 → 重置边栏: default width, expanded, out of 专注模式. */
    resetSidebar(): void {
      this.setSidebarWidth(SIDEBAR_DEFAULT_W)
      this.setSidebarCollapsed(false)
      this.setTermSidebarHidden(false)
    },
    setTermSidebarHidden(v: boolean): void {
      const prev = this.termSidebarHidden
      this.termSidebarHidden = v
      void window.api.settings.set('termSidebarHidden', v).then((r) => {
        if (r && r.ok === false) {
          this.termSidebarHidden = prev
          toast(t('set.gen.writeFail'), 'error')
        }
      }).catch(() => {
        this.termSidebarHidden = prev
        toast(t('set.gen.writeFail'), 'error')
      })
    },
    setHostsView(v: HostsView): void {
      const prev = this.hostsView
      this.hostsView = v
      void window.api.settings.set('hostsView', v).then((r) => {
        if (r && r.ok === false) {
          this.hostsView = prev
          toast(t('set.gen.writeFail'), 'error')
        }
      }).catch(() => {
        this.hostsView = prev
        toast(t('set.gen.writeFail'), 'error')
      })
    },
    setHostsSort(v: HostsSort): void {
      const prev = this.hostsSort
      this.hostsSort = v
      void window.api.settings.set('hostsSort', v).then((r) => {
        if (r && r.ok === false) {
          this.hostsSort = prev
          toast(t('set.gen.writeFail'), 'error')
        }
      }).catch(() => {
        this.hostsSort = prev
        toast(t('set.gen.writeFail'), 'error')
      })
    },
    /** Probes the given saved hosts (all when omitted) and merges the results. */
    async probeReach(ids?: string[], opts: { maxAge?: number } = {}): Promise<void> {
      const full = !ids
      if (full) {
        // Coming back to 连接 shouldn't knock on every server again.
        if (probeRoundBusy || Date.now() - lastFullProbe < (opts.maxAge ?? 0)) return
        probeRoundBusy = true
        lastFullProbe = Date.now()
      }
      const seq = ++probeSeq
      for (const id of ids ?? this.hosts.map((h) => h.id)) probeSeqOf.set(id, seq)
      try {
        const r = await window.api.hosts.probe(ids)
        const fresh: Record<string, Reachability> = {}
        for (const [id, v] of Object.entries(r)) if ((probeSeqOf.get(id) ?? 0) <= seq) fresh[id] = v
        this.reach = { ...this.reach, ...fresh }
      } catch {
        /* keep what we had */
      } finally {
        if (full) probeRoundBusy = false
      }
    },
    /** 打开 SFTP for a saved host: its live session if there is one, else
     *  connect in the background and open the page only once it's up — a
     *  failed connect stays put (its error is already toasted) instead of
     *  showing some other host's files. */
    async openSftpFor(host: Host): Promise<void> {
      const live = this.tabs
        .flatMap((tab) => tab.panes.map((pane) => ({ tab, pane })))
        .find((x) => x.pane.status === 'connected' && x.pane.params.hostId === host.id)
      if (live) {
        this.setActive(live.tab.id)
        this.setActivePane(live.tab.id, live.pane.id)
        this.setPage('sftp')
        return
      }
      if (this.sftpConnecting) return
      this.sftpConnecting = host.id
      try {
        if ((await this.quickConnect(host, { stay: true })) === 'needs-password') {
          this.askPasswordFor(host)
          return
        }
      } finally {
        this.sftpConnecting = ''
      }
      const tab = [...this.tabs].reverse().find((x) => x.hostId === host.id)
      const pane = tab?.panes[0]
      if (tab && pane?.status === 'connected') {
        this.setActive(tab.id)
        this.setPage('sftp')
      }
    },
    /** Saves a host's profile fields (tags, forward rules…) without touching its secrets. */
    async saveHost(host: Host): Promise<void> {
      this.hosts = await window.api.hosts.save(toPlain(host) as Host)
    },
    async removeHost(id: string): Promise<void> {
      this.hosts = await window.api.hosts.delete(id)
    },
    /** A copy under a fresh id. Saved passwords stay with the original (they're
     *  keyed by id); the copy asks on first connect. */
    async duplicateHost(host: Host): Promise<void> {
      const { hasSavedPassword: _p, hasSavedPassphrase: _pp, lastUsedAt: _u, ...rest } = toPlain(host) as Host
      await this.saveHost({ ...rest, id: uid('host'), label: t('hosts.copyOf', { name: host.label }) })
    },
    toggleHistory(open?: boolean): void {
      this.historyOpen = open ?? !this.historyOpen
      this.paletteOpen = false
    },
    toggleTmux(open?: boolean): void {
      this.tmuxOpen = open ?? !this.tmuxOpen
      this.paletteOpen = false
    },
    toggleForwards(open?: boolean): void {
      this.forwardOpen = open ?? !this.forwardOpen
      this.paletteOpen = false
    },
    togglePublish(open?: boolean): void {
      this.publishOpen = open ?? !this.publishOpen
    },

    toggleReplay(open?: boolean): void {
      this.replayOpen = open ?? !this.replayOpen
    },
    /** Opens a port forward on the active session now, and records it on its
     *  pane so the status bar reflects it for the life of the session. */
    async addForward(rule: HostForward): Promise<{ ok: boolean; error?: string }> {
      return this.addForwardTo(this.activePane, rule)
    },
    /** Same, on a given pane's session (the 端口转发 page works on any session). */
    async addForwardTo(pane: Pane | undefined, rule: HostForward): Promise<{ ok: boolean; error?: string }> {
      const sid = pane?.sshSessionId
      if (!pane || !sid) return { ok: false, error: t('app.needLiveSession') }
      const r = await window.api.ssh.forwardAdd(sid, rule)
      if (!r.ok) return { ok: false, error: forwardError(r) }
      pane.params.portForwards = [...(pane.params.portForwards ?? []), rule]
      this.auditForward(pane, rule)
      return { ok: true }
    },
    /** Stops a port forward on the active session and drops it from its pane. */
    async removeForward(mode: ForwardMode | undefined, localPort: number): Promise<{ ok: boolean; error?: string }> {
      return this.removeForwardFrom(this.activePane, mode, localPort)
    },
    async removeForwardFrom(
      pane: Pane | undefined,
      mode: ForwardMode | undefined,
      localPort: number
    ): Promise<{ ok: boolean; error?: string }> {
      const sid = pane?.sshSessionId
      if (!pane || !sid) return { ok: false, error: t('app.needLiveSession') }
      const r = await window.api.ssh.forwardRemove(sid, { mode: mode ?? 'local', localPort })
      if (!r.ok) return { ok: false, error: forwardError(r) }
      const mm = mode ?? 'local'
      if (pane?.params.portForwards) {
        pane.params.portForwards = pane.params.portForwards.filter(
          (f) => !((f.mode ?? 'local') === mm && f.localPort === localPort)
        )
      }
      if (pane) {
        void window.api.connLog.push({
          at: Date.now(),
          event: 'forward',
          host: pane.params.host,
          port: pane.params.port || 22,
          username: pane.params.username,
          detail: `remove ${mm} ${localPort}`
        })
      }
      return { ok: true }
    },
    /** Records an add of a port forward into the security audit log. */
    auditForward(pane: Pane | undefined, rule: HostForward): void {
      if (!pane) return
      void window.api.connLog.push({
        at: Date.now(),
        event: 'forward',
        host: pane.params.host,
        port: pane.params.port || 22,
        username: pane.params.username,
        detail: `add ${rule.mode ?? 'local'} ${rule.localPort}`
      })
    },
    /** Focuses the tab/pane owning a live session id (history-result jump). */
    focusSession(sessionId: string): void {
      for (const tab of this.tabs) {
        const p = tab.panes.find((x) => x.sshSessionId === sessionId)
        if (p) {
          this.activeId = tab.id
          tab.activePaneId = p.id
          this.setPage('terminal')
          return
        }
      }
    },

    /** Opens a tab (single pane) and connects it. Returns the new tab id.
     *  Switches to the 终端 page unless `stay` (e.g. connecting from the SFTP page). */
    async openConnection(params: ConnectParams, title: string, opts: { stay?: boolean } = {}): Promise<string> {
      if (!opts.stay) this.setPage('terminal')
      const paneId = uid('pane')
      const tab: Tab = {
        id: uid('tab'),
        title,
        hostId: params.hostId,
        layout: buildFlatTree([paneId], 'row'),
        panes: [{ id: paneId, status: 'connecting', params }],
        activePaneId: paneId
      }
      this.tabs.push(tab)
      this.activeId = tab.id
      this.persistTabs()
      await this.runConnect(paneId)
      if (params.hostId) void this.loadHosts()
      return tab.id
    },

    /** Sets the split ratio between two adjacent panes while dragging a divider. */
    resizePane(tabId: string, path: number[], i: number, ratio: number): void {
      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab) return
      tab.layout = setPaneRatio(tab.layout, path, i, ratio)
    },

    /** Splits the active tab's focused pane, opening a new pane to the same
     *  target beside it. Splitting a pane repeatedly yields a 2×2 grid. */
    async splitPane(tabId: string, dir: SplitDir): Promise<void> {
      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab || tab.panes.length >= 8) return
      const src = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
      const paneId = uid('pane')
      tab.layout = splitLeaf(tab.layout, src.id, dir, paneId)
      tab.panes.push({ id: paneId, status: 'connecting', params: { ...toRaw(src.params) } })
      // Keep focus (and SFTP/editor binding) on the source pane while the new
      // one connects; hand focus over only once it's live.
      await this.runConnect(paneId)
      const t = this.tabs.find((x) => x.id === tabId)
      const p = t?.panes.find((x) => x.id === paneId)
      if (t && p?.status === 'connected') t.activePaneId = paneId
    },

    /** Sends a single command line to every connected pane across all tabs
     *  (broadcast). Silently skips panes that aren't live. */
    broadcastCommand(cmd: string): number {
      if (!cmd.trim()) return 0
      const text = cmd.endsWith('\n') ? cmd : cmd + '\n'
      let sent = 0
      for (const tab of this.tabs) {
        for (const pane of tab.panes) {
          if (pane.status === 'connected' && pane.sshSessionId) {
            window.api.ssh.input(pane.sshSessionId, text)
            sent++
          }
        }
      }
      return sent
    },

    /** Resets the active tab to a clean rows×cols grid of the same target. Any
     *  panes beyond the source are closed first, then new panes are opened to
     *  fill the grid — all identical to the focused pane. */
    async applyLayoutPreset(rows: number, cols: number): Promise<void> {
      const tab = this.tabs.find((t) => t.id === this.activeId)
      if (!tab) return
      const src = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
      if (!src) return
      const cells = Math.min(rows * cols, 8)
      if (cells <= 0) return
      // Close every pane except the source so the grid is clean.
      const keep = src.id
      for (const pane of [...tab.panes]) {
        if (pane.id === keep) continue
        if (pane.sshSessionId) void window.api.ssh.disconnect(pane.sshSessionId)
      }
      tab.panes = tab.panes.filter((p) => p.id === keep)
      // Open the remaining panes to fill the grid.
      const fillRows = Math.max(1, rows)
      const fillCols = Math.max(1, cells)
      const fills = [keep]
      while (fills.length < cells) {
        const paneId = uid('pane')
        fills.push(paneId)
        tab.panes.push({ id: paneId, status: 'connecting', params: { ...toRaw(src.params) } })
      }
      tab.layout = buildGrid(fills, fillRows, fillCols)
      tab.activePaneId = keep
      // Connect the new panes; keep source focus until each goes live.
      for (let i = 1; i < fills.length; i++) {
        await this.runConnect(fills[i])
        const t = this.tabs.find((x) => x.id === tab.id)
        const p = t?.panes.find((x) => x.id === fills[i])
        if (t && p?.status === 'connected') t.activePaneId = p.id
      }
      this.persistTabs()
    },

    /** (Re)connects a pane using its stored params. */
    async reconnect(paneId: string): Promise<void> {
      const found = this.findPane(paneId)
      if (!found) return
      this.cancelReconnect(found.pane)
      // Mark the session as deliberately retired *before* asking main to drop
      // it. Disconnecting is asynchronous: its `error`/`closed` event can land
      // after runConnect started, and if it were still attributed to a live
      // session it would tear down the replacement we just opened. Recording
      // the id here lets applyEvent recognise the stale event and ignore it.
      const retiring = found.pane.sshSessionId
      if (retiring) {
        retireSession(retiring)
        void window.api.ssh.disconnect(retiring)
        found.pane.sshSessionId = undefined
      }
      await this.runConnect(paneId)
    },

    /** Shared connect routine: sets connecting → connected/error on the pane. */
    async runConnect(paneId: string): Promise<void> {
      const found = this.findPane(paneId)
      if (!found || inFlight.has(paneId)) return // ignore overlapping connects
      found.pane.status = 'connecting'
      found.pane.message = undefined
      // Clear the previous failure's code as we start. Leaving it set kept
      // handleNetworkOnline's `!errorCode` guard permanently false for a pane
      // that had failed once (e.g. with 'locked'), so the automatic revivers
      // went blind to it even after the cause was gone. The outcome of *this*
      // attempt is what should decide the state, not the last one's.
      found.pane.errorCode = undefined

      inFlight.add(paneId)
      let result: Awaited<ReturnType<typeof window.api.ssh.connect>>
      try {
        // Pass a plain object: a Vue reactive proxy can't be structured-cloned
        // across the IPC boundary and would make invoke() reject.
        result = await window.api.ssh.connect({
          ...toRaw(found.pane.params),
          keepaliveMs: this.keepaliveSec > 0 ? this.keepaliveSec * 1000 : 0,
          readyTimeoutMs: this.connectTimeoutSec * 1000,
          shellIntegration: this.shellIntegration
        })
      } finally {
        inFlight.delete(paneId)
      }
      const live = this.findPane(paneId)
      if (!live) {
        // Pane was closed mid-connect — don't leak the session we just opened.
        if (result.ok && result.sessionId) void window.api.ssh.disconnect(result.sessionId)
        return
      }

      if (result.ok && result.sessionId) {
        live.pane.sshSessionId = result.sessionId
        live.pane.status = 'connected'
        live.pane.errorCode = undefined
        // A restore/unlock retry pre-set the attempt counter; leaving it set
        // would make the next real drop skip the 1s backoff tier.
        live.pane.reconnectAttempt = undefined
        // A rejected first/changed key may have been confirmed since the error
        // card was drawn: drop the stale trust payload.
        live.pane.hostKey = undefined
        live.pane.hostKeyHost = undefined
        live.pane.hostKeyPort = undefined
        // A first-ever connection may have just recorded the host key.
        void this.loadKnownHosts()
        // Return to the directory the pane last browsed (on restore / reconnect /
        // re-split), so the shell lands where the user left off. Safe single
        // quoted escape; no-op if shell integration / cwd unknown.
        const savedCwd = live.pane.lastSftpPath
        if (savedCwd && this.restoreCwd) {
          const quoted = `'${savedCwd.replace(/'/g, `'\\''`)}'`
          window.api.ssh.input(result.sessionId, `cd ${quoted}\n`)
        }
        // Auto-attach-or-create a tmux session (default off). Name falls back to
        // the host label so a reconnection re-joins the same window.
        if (this.tmuxOnConnect) {
          const name = this.tmuxSessionName.trim() || live.pane.params.host
          if (name) window.api.ssh.tmuxAttach(result.sessionId, name)
        }
      } else {
        live.pane.status = 'error'
        // Map the codes main uses to their own wording. Anything unmapped keeps
        // main's message, which is already user-facing (friendlyError).
        const keyCode = result.code === 'host_key_unknown' || result.code === 'host_key_changed'
        // A refused key names the machine it came from: the target, or the
        // jump host when keyHost differs from the pane's own address.
        const keyHost = result.keyHost ?? found.pane.params.host
        const keyPort = result.keyPort ?? (found.pane.params.port || 22)
        const viaJump = keyCode && keyHost !== found.pane.params.host
        const keyWhere = `${keyHost}${keyPort !== 22 ? ':' + keyPort : ''}`
        const msg =
          result.code === 'jump_needs_password'
            ? t('app.jumpNeedsPassword')
            : result.code === 'locked'
              ? t('app.locked')
              : result.code === 'host_key_unknown'
                ? viaJump
                  ? t('app.keyUnknownJumpMsg', { host: keyWhere })
                  : t('app.keyUnknownMsg', { host: keyWhere })
                : result.code === 'host_key_changed'
                  ? viaJump
                    ? t('app.keyChangedJumpMsg', { host: keyWhere })
                    : t('app.keyChangedMsg', { host: keyWhere })
                  : (result.error ?? t('app.connectFail'))
        live.pane.message = msg
        live.pane.errorCode = result.code
        // Host-key rejection: stash what the user is being asked to trust —
        // the presented fingerprint and which host it belongs to (a rejected
        // jump hop reports itself via keyHost; the target does not need one,
        // its address is the pane's own). trustAndReconnect uses these to
        // write the key back to the right entry.
        if (keyCode) {
          // All three together, so a key can never be paired with another host.
          live.pane.hostKey = result.key
          live.pane.hostKeyHost = keyHost
          live.pane.hostKeyPort = keyPort
        }
        // A locked app is not a connection failure — it needs the unlock screen.
        // Re-read the lock status so LockScreen (gated on `lockLocked`) appears
        // even if this pane was started before the app was locked.
        if (result.code === 'locked') void this.loadLockStatus()
        // Avoid stacking toasts during an auto-reconnect storm (each attempt
        // re-enters runConnect); only shout for the first, user-initiated try.
        // A refused host key already explains itself on the pane's card
        // (with the fingerprint); a toast would only repeat it.
        if (!live.pane.reconnectAttempt && !keyCode) {
          toast(msg, 'error')
          // A transient failure (reset / timeout / the server's rate limiting)
          // is worth riding out automatically even for the first, user-initiated
          // attempt — the reconnect loop only existed for established sessions.
          // The reconnectAttempt guard keeps the loop's own failures scheduling
          // themselves exactly once; a manual reconnect cancels the timer.
          if (result.transient && this.autoReconnect) {
            live.pane.message = msg + ' — ' + t('app.autoRetrySoon')
            this.scheduleReconnect(paneId, { minDelayMs: result.retryDelayMs, keepError: !!result.retryDelayMs })
          }
        }
      }
    },

    /** Connects a saved host directly. Returns 'needs-password' when it must be
     *  finished in the palette (password auth with no stored secret). */
    async quickConnect(host: Host, opts: { stay?: boolean } = {}): Promise<'connected' | 'needs-password'> {
      if (host.auth === 'password' && !host.hasSavedPassword) return 'needs-password'
      await this.openConnection(
        {
          host: host.host,
          port: host.port,
          username: host.username,
          auth: host.auth,
          keyPath: host.keyPath,
          hostId: host.id,
          agentForward: host.agentForward,
          onConnect: host.onConnect,
          onConnectDelayMs: host.onConnectDelayMs
        },
        host.label,
        opts
      )
      return 'connected'
    },

    /** Registers the host key the user just confirmed, then reconnects.
     *  Used for both an unrecognized key (first connect) and a changed one
     *  (trust the new key, overwriting the stale record). The fingerprint comes
     *  from the last rejection (result of connect), not from the saved host, so
     *  it lands on the right entry even when a jump hop is the one rejected. */
    async trustAndReconnect(paneId: string): Promise<void> {
      const found = this.findPane(paneId)
      if (!found) return
      const { hostKey, hostKeyHost, hostKeyPort } = found.pane
      // Main only accepts the key it just refused for that host:port; with no
      // fingerprint captured there is nothing to trust — reconnecting shows the
      // card again with the key the server presents.
      if (hostKey) {
        const host = hostKeyHost ?? found.pane.params.host
        const r = await window.api.ssh.trustHostKey(host, hostKeyPort ?? (found.pane.params.port || 22), hostKey)
        if (!r?.ok) {
          await this.reconnect(paneId)
          return
        }
      }
      await this.loadKnownHosts()
      await this.reconnect(paneId)
    },

    /** Reconnects a tab's currently-active pane (used by the tab context menu). */
    reconnectTab(tabId: string): void {
      const tab = this.tabs.find((t) => t.id === tabId)
      if (tab) void this.reconnect(tab.activePaneId)
    },

    /** Opens a fresh tab to the same target as an existing tab. */
    duplicate(tabId: string): void {
      const tab = this.tabs.find((t) => t.id === tabId)
      if (tab) void this.openConnection({ ...tab.panes[0].params }, tab.title)
    },

    /** Applies a status event coming from the main process. */
    applyEvent(sessionId: string, status: SessionStatus, message?: string): void {
      // A session this store retired on purpose (a reconnect replacing it, or its
      // tab closing). Its trailing event says nothing about whatever pane now holds
      // that id, and acting on it would cancel the replacement we just opened.
      if (retiredSessions.delete(sessionId)) return
      const pane = this.paneBySession(sessionId)
      if (!pane) return
      const action = decideStatusEvent({
        paneSessionId: pane.sshSessionId,
        status,
        autoReconnect: this.autoReconnect
      })
      if (action.kind === 'ignore') return
      if (action.kind === 'setStatus') {
        // A clean `closed` (e.g. the user typed `exit`) keeps sshSessionId set
        // so the "session closed · reconnect" banner shows; no auto-reconnect.
        pane.status = status
        if (message) pane.message = message
        return
      }
      // Drop the dead id so the terminal unmounts and the error / reconnect UI
      // shows — regardless of whether auto-reconnect is enabled. Clearing it
      // also makes any trailing `closed` for this session a no-op.
      pane.sshSessionId = undefined
      pane.status = 'error'
      if (message) pane.message = message
      // When auto-reconnect is on, the "reconnecting…" banner communicates the
      // drop without us flooding a toast per attempt.
      if (!this.autoReconnect) toast(message ?? t('app.sessionLost'), 'error')
      if (this.notifications) {
        window.api.notify(
          t('app.sessionDisconnected'),
          `${pane.params.username}@${pane.params.host}${pane.params.port !== 22 ? `:${pane.params.port}` : ''}\n${message ?? t('app.sessionLost')}`,
          true
        )
      }
      if (action.scheduleRetry) this.scheduleReconnect(pane.id)
    },

    cancelReconnect(pane: Pane): void {
      if (pane.reconnectTimer) clearTimeout(pane.reconnectTimer)
      pane.reconnectTimer = undefined
      pane.reconnectAttempt = undefined
    },

    /**
     * Retries a dropped connection with exponential backoff (1,2,4,8,16,20s).
     * `minDelayMs` raises the first wait — the rate-limit refusal needs ~30s
     * so the server's penalty decays (retrying sooner feeds it); `keepError`
     * keeps the failure card up during that wait instead of flashing
     * "reconnecting" over a wait the user cannot shorten.
     */
    scheduleReconnect(paneId: string, opts: { minDelayMs?: number; keepError?: boolean } = {}): void {
      const found = this.findPane(paneId)
      if (!found || !this.autoReconnect) return
      const { pane } = found
      const attempt = (pane.reconnectAttempt ?? 0) + 1
      if (attempt > this.connectRetries) {
        pane.reconnectAttempt = undefined
        pane.status = 'error'
        pane.message = t('app.reconnectFail')
        return
      }
      pane.reconnectAttempt = attempt
      if (!opts.keepError) {
        pane.status = 'connecting'
        pane.message = t('app.reconnecting', { attempt })
      }
      const base = Math.min(20000, 1000 * 2 ** (attempt - 1))
      // Add ~±20% jitter so simultaneous dropped sessions don't reconnect in
      // lockstep (which can hammer the network and stack server-side timeouts).
      const delay = retryDelayMs(attempt, Math.random, opts.minDelayMs ?? 0)
      pane.reconnectTimer = window.setTimeout(async () => {
        const cur = this.findPane(paneId)
        if (!cur) return
        cur.pane.reconnectTimer = undefined
        await this.runConnect(paneId)
        const after = this.findPane(paneId)
        if (!after) return
        if (after.pane.status === 'connected') after.pane.reconnectAttempt = undefined
        // A refused host key won't fix itself by retrying: stop, and leave the
        // card (with its fingerprint) for the user to decide.
        else if (after.pane.errorCode === 'host_key_unknown' || after.pane.errorCode === 'host_key_changed') {
          after.pane.reconnectAttempt = undefined
        } else this.scheduleReconnect(paneId, { minDelayMs: opts.minDelayMs })
      }, delay)
    },

    /** Closes a single pane; closes the whole tab if it was the last pane. */
    async closePane(paneId: string): Promise<void> {
      const found = this.findPane(paneId)
      if (!found) return
      const { tab, pane } = found
      // Closing the only pane of a live session is destructive; confirm first.
      if (tab.panes.length === 1 && this.confirmClose && pane.status === 'connected') {
        const ok = await confirm(t('app.closePaneConfirm', { title: tab.title }), {
          title: t('app.closeExitTitle'),
          confirmText: t('app.closeExitOk'),
          cancelText: t('confirm.cancel')
        })
        if (!ok) return
        // Let the remote shell wind down gracefully before dropping the link.
        // Re-read the id: `confirm` awaited, and the session may have dropped in
        // the meantime — asserting it here would send `undefined` over IPC.
        const live = pane.sshSessionId
        if (live) void window.api.ssh.input(live, 'exit\n')
      }
      this.cancelReconnect(pane)
      if (pane.sshSessionId) void window.api.ssh.disconnect(pane.sshSessionId)
      // Nearest pane in visual (layout DFS) order, so closing one focuses its
      // on-screen neighbour rather than an arbitrary insertion-order one.
      const order = collectPaneIds(tab.layout)
      const oi = order.indexOf(paneId)
      const neighbour = order[oi + 1] ?? order[oi - 1]
      const idx = tab.panes.findIndex((p) => p.id === paneId)
      tab.panes.splice(idx, 1)
      if (tab.panes.length === 0) {
        this.closeTab(tab.id)
        return
      }
      // Prune the pane from the layout tree, collapsing any single-child branch.
      const pruned = removePane(tab.layout, paneId)
      tab.layout = pruned ?? buildFlatTree(tab.panes.map((p) => p.id), 'row')
      if (tab.activePaneId === paneId) {
        tab.activePaneId = neighbour ?? tab.panes[0].id
      }
      this.persistTabs()
    },

    closeTab(id: string): void {
      const tab = this.tabs.find((t) => t.id === id)
      if (tab) {
        for (const pane of tab.panes) {
          this.cancelReconnect(pane)
          if (pane.sshSessionId) void window.api.ssh.disconnect(pane.sshSessionId)
        }
      }
      const idx = this.tabs.findIndex((t) => t.id === id)
      if (idx < 0) return
      this.tabs.splice(idx, 1)
      if (this.activeId === id) {
        const next = this.tabs[idx] ?? this.tabs[idx - 1]
        this.activeId = next?.id ?? null
      }
      this.persistTabs()
    },

    /** Confirms (when enabled) before closing a tab that has a live session,
     *  sending `exit` so the remote shell winds down gracefully. */
    async closeTabSafe(id: string): Promise<void> {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab) return
      const live = tab.panes.some((p) => p.status === 'connected')
      if (live && this.confirmClose) {
        const ok = await confirm(t('app.closeTabConfirm', { title: tab.title }), {
          title: t('app.closeExitTitle'),
          confirmText: t('app.closeExitOk'),
          cancelText: t('confirm.cancel')
        })
        if (!ok) return
        for (const p of tab.panes) {
          if (p.status === 'connected' && p.sshSessionId) void window.api.ssh.input(p.sshSessionId, 'exit\n')
        }
      }
      this.closeTab(id)
    },

    closeOthers(id: string): void {
      const others = this.tabs.filter((t) => t.id !== id).map((t) => t.id)
      others.forEach((oid) => this.closeTab(oid))
      this.activeId = id
    },

    /** Reorders a tab by dragging it onto another tab. */
    moveTab(fromId: string, toId: string): void {
      if (fromId === toId) return
      const from = this.tabs.findIndex((t) => t.id === fromId)
      const to = this.tabs.findIndex((t) => t.id === toId)
      if (from < 0 || to < 0) return
      const [tab] = this.tabs.splice(from, 1)
      this.tabs.splice(to, 0, tab)
      this.persistTabs()
    },

    /** Renames a tab (label only; does not touch the underlying host). */
    renameTab(id: string, title: string): void {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab) return
      const next = title.trim()
      tab.title = next || tab.title
      this.persistTabs()
    },

    nextTab(dir: 1 | -1): void {
      if (this.tabs.length < 2) return
      const idx = this.tabs.findIndex((t) => t.id === this.activeId)
      const next = (idx + dir + this.tabs.length) % this.tabs.length
      this.activeId = this.tabs[next].id
    }
  }
})
