import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { useConfirm } from '../composables/confirm'
import { useSnippetVars } from '../composables/snippetVars'
import { clampConcurrency } from '../../../shared/fsUtils'
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
  DownloadItem
} from '../../../shared/types'

const { t } = useI18n()
const { toast } = useToast()
const { confirm } = useConfirm()

let counter = 0
const uid = (p: string): string => `${p}-${Date.now()}-${counter++}`

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
  items: DownloadItem[]
  localDir: string
  at: number
}

export type SettingsTab = 'general' | 'terminal' | 'connection' | 'keys' | 'security'

interface State {
  hosts: Host[]
  tabs: Tab[]
  activeId: string | null
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
      const [editor, ka, ct, cr, tc, si, ff, cur, thm, rt, ar, rcn, rcw, nt, ns, cp, sp, tq, dq, tfh, abk, abd, abh] = await Promise.all([
        window.api.settings.get<string>('externalEditor'),
        window.api.settings.get<number>('keepaliveSec'),
        window.api.settings.get<number>('connectTimeoutSec'),
        window.api.settings.get<number>('connectRetries'),
        window.api.settings.get<number>('transferConcurrency'),
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
      if (!sid) return
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
      await window.api.settings.set(key, toPlain(value))
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
          // Only revive genuinely-dropped sessions (errorCode is unset for a
          // drop; a never-connected host that failed auth/connect keeps it set),
          // so a network blip doesn't hammer a host that can't authenticate.
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
      const list = this.tabs.map((t) => {
        // Persist panes in the layout's depth-first order so the tree's indices
        // line up exactly with the panes column on restore.
        const ids = collectPaneIds(t.layout)
        const byId = new Map(t.panes.map((p) => [p.id, p]))
        const ordered = ids.map((id) => byId.get(id)).filter((p) => !!p)
        return {
          title: t.title,
          tree: plainLayout(t.layout),
          activeIndex: Math.max(0, ordered.findIndex((p) => p!.id === t.activePaneId)),
          panes: ordered.map((p) => {
            const params = { ...toRaw(p!.params) }
            delete params.password
            delete params.passphrase
            return { params, cwd: p!.lastSftpPath }
          })
        }
      })
      void window.api.settings.set('openTabs', list)
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
    async queueDownload(sessionId: string, items: DownloadItem[], localDir: string): Promise<void> {
      if (!items.length || !localDir) return
      this.downloadQueue = [
        { id: uid('xfer'), sessionId, items, localDir, at: Date.now() },
        ...this.downloadQueue
      ].slice(0, 20)
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
          void this.queueDownload(p.sessionId ?? '', p.items, p.localDir ?? '')
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
      const list = this.tabs.map((t) => {
        const ids = collectPaneIds(t.layout)
        const byId = new Map(t.panes.map((p) => [p.id, p]))
        const ordered = ids.map((id) => byId.get(id)).filter((p) => !!p)
        return {
          title: t.title,
          tree: plainLayout(t.layout),
          activeIndex: Math.max(0, ordered.findIndex((p) => p!.id === t.activePaneId)),
          panes: ordered.map((p) => {
            const params = { ...toRaw(p!.params) }
            delete params.password
            delete params.passphrase
            return { params, cwd: p!.lastSftpPath }
          })
        }
      }) as PersistedTab[]
      const snap: Snapshot = { id: uid('snap'), name, savedAt: Date.now(), tabs: list }
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
    toggleSftp(open?: boolean): void {
      this.sftpOpen = open ?? !this.sftpOpen
    },
    toggleSettings(open?: boolean, tab?: SettingsTab): void {
      if (tab) this.settingsTab = tab
      this.settingsOpen = open ?? !this.settingsOpen
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
      const sid = this.activePane?.sshSessionId
      if (!sid) return { ok: false, error: t('app.needLiveSession') }
      const r = await window.api.ssh.forwardAdd(sid, rule)
      if (!r.ok) return r
      const pane = this.activePane
      if (pane) pane.params.portForwards = [...(pane.params.portForwards ?? []), rule]
      this.auditForward(pane, rule)
      return { ok: true }
    },
    /** Stops a port forward on the active session and drops it from its pane. */
    async removeForward(mode: ForwardMode | undefined, localPort: number): Promise<{ ok: boolean; error?: string }> {
      const sid = this.activePane?.sshSessionId
      if (!sid) return { ok: false, error: t('app.needLiveSession') }
      const r = await window.api.ssh.forwardRemove(sid, { mode: mode ?? 'local', localPort })
      if (!r.ok) return r
      const pane = this.activePane
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
          return
        }
      }
    },

    /** Opens a tab (single pane) and connects it. Returns the new tab id. */
    async openConnection(params: ConnectParams, title: string): Promise<string> {
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
      if (found.pane.sshSessionId) {
        void window.api.ssh.disconnect(found.pane.sshSessionId)
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
        const msg =
          result.code === 'jump_needs_password'
            ? t('app.jumpNeedsPassword')
            : (result.error ?? t('app.connectFail'))
        live.pane.message = msg
        live.pane.errorCode = result.code
        // Avoid stacking toasts during an auto-reconnect storm (each attempt
        // re-enters runConnect); only shout for the first, user-initiated try.
        if (!live.pane.reconnectAttempt) toast(msg, 'error')
      }
    },

    /** Connects a saved host directly. Returns 'needs-password' when it must be
     *  finished in the palette (password auth with no stored secret). */
    async quickConnect(host: Host): Promise<'connected' | 'needs-password'> {
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
        host.label
      )
      return 'connected'
    },

    /** Forgets the stored host key, then reconnects (server was re-installed). */
    async trustAndReconnect(paneId: string): Promise<void> {
      const found = this.findPane(paneId)
      if (!found) return
      await window.api.ssh.forgetHostKey(found.pane.params.host, found.pane.params.port || 22)
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
      const pane = this.paneBySession(sessionId)
      if (!pane) return
      // The session was live iff its id is still set (only assigned on a
      // successful connect). We key on this rather than the live `status`
      // because a dropped session can emit `closed` before `error`, which would
      // otherwise flip status to 'closed' and defeat the reconnect trigger.
      const hadLiveSession = !!pane.sshSessionId
      if (status === 'error' && hadLiveSession) {
        // Drop the dead id so the terminal unmounts and the error / reconnect
        // UI shows — regardless of whether auto-reconnect is enabled. Clearing
        // it also makes any trailing `closed` for this session a no-op.
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
        if (this.autoReconnect) this.scheduleReconnect(pane.id)
        return
      }
      // A clean `closed` (e.g. the user typed `exit`) keeps sshSessionId set so
      // the "session closed · reconnect" banner shows; no auto-reconnect.
      pane.status = status
      if (message) pane.message = message
    },

    cancelReconnect(pane: Pane): void {
      if (pane.reconnectTimer) clearTimeout(pane.reconnectTimer)
      pane.reconnectTimer = undefined
      pane.reconnectAttempt = undefined
    },

    /** Retries a dropped connection with exponential backoff (1,2,4,8,16,20s). */
    scheduleReconnect(paneId: string): void {
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
      pane.status = 'connecting'
      pane.message = t('app.reconnecting', { attempt })
      const base = Math.min(20000, 1000 * 2 ** (attempt - 1))
      // Add ~±20% jitter so simultaneous dropped sessions don't reconnect in
      // lockstep (which can hammer the network and stack server-side timeouts).
      const delay = Math.round(base * (0.8 + Math.random() * 0.4))
      pane.reconnectTimer = window.setTimeout(async () => {
        const cur = this.findPane(paneId)
        if (!cur) return
        cur.pane.reconnectTimer = undefined
        await this.runConnect(paneId)
        const after = this.findPane(paneId)
        if (!after) return
        if (after.pane.status === 'connected') after.pane.reconnectAttempt = undefined
        else this.scheduleReconnect(paneId)
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
        void window.api.ssh.input(pane.sshSessionId!, 'exit\n')
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
