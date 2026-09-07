import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { useConfirm } from '../composables/confirm'
import { clampConcurrency } from '../../../shared/fsUtils'
import type {
  ConnectParams,
  Host,
  KnownHostEntry,
  SessionStatus,
  Snippet,
  TransferHistoryItem
} from '../../../shared/types'

const { t } = useI18n()
const { toast } = useToast()
const { confirm } = useConfirm()

let counter = 0
const uid = (p: string): string => `${p}-${Date.now()}-${counter++}`

// Panes with a connect currently in flight. Guards against overlapping connects
// (double-clicked "reconnect", a manual retry racing a scheduled one) which
// would otherwise orphan a live SSH session by overwriting its id.
const inFlight = new Set<string>()

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
  /** Split direction of the panes. */
  layout: 'row' | 'col'
  panes: Pane[]
  activePaneId: string
}

export type CursorStyle = 'bar' | 'block' | 'underline'

/** A serializable tab layout (secrets stripped) used for persistence/snapshots. */
export interface PersistedTab {
  title: string
  layout: 'row' | 'col'
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
  /** Finished SFTP transfers, persisted across restarts (newest first). */
  transferHistory: TransferHistoryItem[]
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
  notifications: boolean
  confirmPaste: boolean
  /** Strip non-printing control characters from pasted text (default on). */
  sanitizePaste: boolean
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
    transferHistory: [],
    keepaliveSec: 20,
    connectTimeoutSec: 20,
    connectRetries: 6,
    transferConcurrency: 4,
    shellIntegration: true,
    terminalFontFamily: '',
    terminalCursor: 'block',
    terminalTheme: '',
    restoreTabs: true,
    autoReconnect: true,
    notifications: true,
    confirmPaste: true,
    sanitizePaste: true
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
      const [editor, ka, ct, cr, tc, si, ff, cur, thm, rt, ar, nt, cp, sp, tq, tfh] = await Promise.all([
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
        window.api.settings.get<boolean>('notifications'),
        window.api.settings.get<boolean>('confirmPaste'),
        window.api.settings.get<boolean>('sanitizePaste'),
        window.api.settings.get<TransferOp[]>('transferQueue'),
        window.api.settings.get<TransferHistoryItem[]>('sftpTransferHistory')
      ])
      this.externalEditor = editor ?? null
      this.keepaliveSec = typeof ka === 'number' ? ka : 20
      this.connectTimeoutSec = typeof ct === 'number' && ct > 0 ? ct : 20
      this.connectRetries = typeof cr === 'number' && cr >= 0 ? cr : 6
      this.transferConcurrency = clampConcurrency(typeof tc === 'number' ? tc : 4, 4)
      this.shellIntegration = si !== false
      this.transferQueue = tq ?? []
      this.transferHistory = tfh ?? []
      this.terminalFontFamily = ff ?? ''
      this.terminalCursor = cur ?? 'block'
      this.terminalTheme = thm ?? ''
      this.restoreTabs = rt !== false
      this.autoReconnect = ar !== false
      this.notifications = nt !== false
      this.confirmPaste = cp !== false
      this.sanitizePaste = sp !== false
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
    /** Sends a snippet (+ trailing newline) to the focused terminal. */
    async sendSnippet(snippet: Snippet): Promise<void> {
      const sid = this.activePane?.sshSessionId
      if (!sid) return
      if (snippet.confirm) {
        const ok = await confirm(
          t('snip.confirm', { title: snippet.title })
        )
        if (!ok) return
      }
      const text = snippet.text.endsWith('\n') ? snippet.text : snippet.text + '\n'
      window.api.ssh.input(sid, text)
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
      await window.api.settings.set(key, value)
    },

    /** Persists every tab (layout + panes, minus secrets) so it can be restored. */
    persistTabs(): void {
      if (!this.restoreTabs) return
      const list = this.tabs.map((t) => ({
        title: t.title,
        layout: t.layout,
        activeIndex: Math.max(0, t.panes.findIndex((p) => p.id === t.activePaneId)),
        panes: t.panes.map((p) => {
          const params = { ...toRaw(p.params) }
          delete params.password
          delete params.passphrase
          return { params, cwd: p.lastSftpPath }
        })
      }))
      void window.api.settings.set('openTabs', list)
    },

    /** Recreates last session's tabs (layout + splits) in a disconnected state. */
    async restoreSavedTabs(): Promise<void> {
      if (!this.restoreTabs) return
      const list = await window.api.settings.get<
        {
          title: string
          layout: 'row' | 'col'
          activeIndex: number
          panes: { params: ConnectParams; cwd?: string }[]
          params?: ConnectParams
        }[]
      >('openTabs')
      if (!list?.length) return
      this.restoreTabsFrom(list as PersistedTab[])
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
        const panes = panesList.map((p) => {
          const paneId = uid('pane')
          return {
            id: paneId,
            status: 'closed' as const,
            params: p.params,
            lastSftpPath: p.cwd
          }
        })
        if (!panes.length) continue
        const tabId = uid('tab')
        this.tabs.push({
          id: tabId,
          title: item.title,
          hostId: item.panes?.[0]?.params.hostId ?? panes[0].params.hostId,
          layout: item.layout ?? 'row',
          panes,
          activePaneId: panes[item.activeIndex ?? 0]?.id ?? panes[0].id
        })
      }
      this.activeId = this.tabs[0]?.id ?? null
    },

    async loadSnapshots(): Promise<void> {
      this.snapshots = (await window.api.settings.get<Snapshot[]>('snapshots')) ?? []
    },
    /** Records an interrupted upload so it can be resumed after a reconnect. */
    async queueUpload(remoteDir: string, localPaths: string[]): Promise<void> {
      if (!localPaths.length) return
      this.transferQueue = [
        { id: uid('xfer'), remoteDir, localPaths, at: Date.now() },
        ...this.transferQueue
      ].slice(0, 20)
      await window.api.settings.set('transferQueue', this.transferQueue)
    },
    async clearTransferQueue(): Promise<void> {
      this.transferQueue = []
      await window.api.settings.set('transferQueue', this.transferQueue)
    },
    /** Records a finished transfer into the persisted history (newest first). */
    async pushTransferHistory(item: TransferHistoryItem): Promise<void> {
      this.transferHistory = [item, ...this.transferHistory].slice(0, 100)
      await window.api.settings.set('sftpTransferHistory', this.transferHistory)
    },
    async clearTransferHistory(): Promise<void> {
      this.transferHistory = []
      await window.api.settings.set('sftpTransferHistory', this.transferHistory)
    },    /** Captures the current tab layout (minus secrets) as a named snapshot. */
    async saveSnapshot(name: string): Promise<void> {
      const list = this.tabs.map((t) => ({
        title: t.title,
        layout: t.layout,
        activeIndex: Math.max(0, t.panes.findIndex((p) => p.id === t.activePaneId)),
        panes: t.panes.map((p) => {
          const params = { ...toRaw(p.params) }
          delete params.password
          delete params.passphrase
          return { params, cwd: p.lastSftpPath }
        })
      })) as PersistedTab[]
      const snap: Snapshot = { id: uid('snap'), name, savedAt: Date.now(), tabs: list }
      this.snapshots = [snap, ...this.snapshots].slice(0, 30)
      await window.api.settings.set('snapshots', this.snapshots)
    },
    async deleteSnapshot(id: string): Promise<void> {
      this.snapshots = this.snapshots.filter((s) => s.id !== id)
      await window.api.settings.set('snapshots', this.snapshots)
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
        layout: 'row',
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

    /** Splits the active tab: opens another pane to the same target. */
    async splitPane(tabId: string, dir: 'row' | 'col'): Promise<void> {
      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab || tab.panes.length >= 4) return
      const src = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
      tab.layout = dir
      const paneId = uid('pane')
      tab.panes.push({ id: paneId, status: 'connecting', params: { ...toRaw(src.params) } })
      // Keep focus (and SFTP/editor binding) on the source pane while the new
      // one connects; hand focus over only once it's live.
      await this.runConnect(paneId)
      const t = this.tabs.find((x) => x.id === tabId)
      const p = t?.panes.find((x) => x.id === paneId)
      if (t && p?.status === 'connected') t.activePaneId = paneId
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
      } else {
        live.pane.status = 'error'
        live.pane.message = result.error ?? t('app.connectFail')
        live.pane.errorCode = result.code
        // Avoid stacking toasts during an auto-reconnect storm (each attempt
        // re-enters runConnect); only shout for the first, user-initiated try.
        if (!live.pane.reconnectAttempt) toast(result.error ?? t('app.connectFail'), 'error')
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
          onConnect: host.onConnect
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
            `${pane.params.username}@${pane.params.host}${pane.params.port !== 22 ? `:${pane.params.port}` : ''} · ${message ?? t('app.sessionLost')}`
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
      const delay = Math.min(20000, 1000 * 2 ** (attempt - 1))
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
    closePane(paneId: string): void {
      const found = this.findPane(paneId)
      if (!found) return
      const { tab, pane } = found
      this.cancelReconnect(pane)
      if (pane.sshSessionId) void window.api.ssh.disconnect(pane.sshSessionId)
      const idx = tab.panes.findIndex((p) => p.id === paneId)
      tab.panes.splice(idx, 1)
      if (tab.panes.length === 0) {
        this.closeTab(tab.id)
        return
      }
      if (tab.activePaneId === paneId) {
        tab.activePaneId = (tab.panes[idx] ?? tab.panes[idx - 1]).id
      }
      // The persisted tab tracks its first pane; refresh if that one changed.
      if (idx === 0) this.persistTabs()
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

    nextTab(dir: 1 | -1): void {
      if (this.tabs.length < 2) return
      const idx = this.tabs.findIndex((t) => t.id === this.activeId)
      const next = (idx + dir + this.tabs.length) % this.tabs.length
      this.activeId = this.tabs[next].id
    }
  }
})
