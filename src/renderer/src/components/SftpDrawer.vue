<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { FileEntry, LocalEntry, SftpProgress, TransferHistoryItem } from '../../../shared/types'
import { posixJoin, parentOf, localJoin, localParent } from '../../../shared/fsUtils'
import { canRetryHistory, buildRetryItems, canRevealHistory } from '../lib/transferHistory'
import {
  isCancelled,
  pct as pctOf,
  formatBytes,
  formatSpeed,
  formatAgo,
  transferStatusText
} from '../lib/transferFormat'
import { globMatch } from '../lib/glob'
import { isImeKey } from '../lib/ime'
import { pruneSelection } from '../lib/selectionPrune'
import { useFocusTrap } from '../composables/focusTrap'
import type { DownloadQueueOp, TransferOp } from '../stores/sessions'
import { useConfirm } from '../composables/confirm'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { useSessions } from '../stores/sessions'
import Icon from './Icon.vue'
import OsIcon from './OsIcon.vue'
import FileDiff from './FileDiff.vue'
import PermDialog from './PermDialog.vue'
import DirDiffDialog from './DirDiffDialog.vue'

const { confirm } = useConfirm()
const { t: tt } = useI18n()
const { toast } = useToast()
const store = useSessions()

// `page`: the SFTP sidebar page shows this full-size (no resize edge, no close)
// instead of as the drawer on the terminal page.
const props = defineProps<{ sessionId?: string; open: boolean; terminalCwd?: string; reloadKey?: number; page?: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'edit-file', payload: { path: string; name: string }): void
  (e: 'edit-external', payload: { path: string; name: string }): void
  (e: 'open-with', payload: { path: string; name: string; ext: string }): void
  (e: 'cd-terminal', path: string): void
}>()

const path = ref('')
const homePath = ref('')
const entries = ref<FileEntry[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const dragOver = ref(false)

// ---- inline image preview ----
const preview = ref<{ open: boolean; name: string; url: string; error: string }>({
  open: false,
  name: '',
  url: '',
  error: ''
})
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']
function fileExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}
function isImage(entry: FileEntry): boolean {
  return !entry.isDir && IMAGE_EXTS.includes(fileExt(entry.name))
}
function closePreview(): void {
  preview.value = { open: false, name: '', url: '', error: '' }
}
async function previewFile(entry: FileEntry): Promise<void> {
  if (!props.sessionId) return
  preview.value = { open: true, name: entry.name, url: '', error: '' }
  const r = await window.api.sftp.readBinary(props.sessionId, posixJoin(path.value, entry.name))
  if (r.ok && r.base64) preview.value.url = `data:image/${fileExt(entry.name)};base64,${r.base64}`
  else {
    const err = r.error
    preview.value.error =
      err === 'preview-too-large' ? tt('sfp.previewTooLarge') : (err ?? tt('sfp.previewFail'))
  }
}

// ---- local (dual-panel) pane: browse the machine's own filesystem ----
const localOpen = ref(false)
const localPath = ref('')
const localEntries = ref<LocalEntry[]>([])
const localLoading = ref(false)
const localError = ref('')
/** Bumped per local listing; see the guard in refreshLocal. */
let localSeq = 0
async function refreshLocal(dir?: string): Promise<void> {
  const prev = localPath.value
  if (dir) localPath.value = dir
  if (!localPath.value) return
  // Navigating to a different local directory invalidates the selection.
  if (dir && dir !== prev) {
    localSelSet.value = new Set()
    localAnchor.value = null
  }
  localLoading.value = true
  localError.value = ''
  // The remote pane already guards this: a slow reply from the directory the
  // user just left must not repaint over the one they are in now, or uploads
  // and deletes run against the wrong folder.
  const seq = ++localSeq
  const target = localPath.value
  try {
    const r = await window.api.local.list(target)
    if (seq !== localSeq) return
    localPath.value = r.path
    localEntries.value = r.entries
  } catch {
    if (seq !== localSeq) return
    localError.value = tt('sfp.localErr')
  } finally {
    if (seq === localSeq) localLoading.value = false
  }
}
function toggleLocal(): void {
  localOpen.value = !localOpen.value
  if (!localOpen.value) return
  if (!localPath.value) {
    void window.api.local.home().then((h) => {
      localPath.value = h
      void refreshLocal()
    })
  } else void refreshLocal()
}
function localEnter(entry: LocalEntry): void {
  if (entry.isDir) void refreshLocal(localJoin(localPath.value, entry.name))
}
function localGoUp(): void {
  void refreshLocal(localParent(localPath.value))
}
function localDragStart(e: DragEvent, entry: LocalEntry): void {
  // If the dragged row is part of a multi-selection, carry them all so the
  // remote pane can accept them all as upload targets.
  const names = localSelSet.value.has(entry.name) ? Array.from(localSelSet.value) : [entry.name]
  const paths = names.map((n) => localJoin(localPath.value, n))
  e.dataTransfer?.setData('application/x-ssh-local', JSON.stringify(paths))
  e.dataTransfer?.setData('text/plain', paths.join('\n'))
}
async function onLocalDrop(e: DragEvent): Promise<void> {
  endDrag()
  const custom = e.dataTransfer?.getData('application/x-ssh-remote')
  if (!custom || !props.sessionId || !localPath.value) return
  let items: { path: string; name: string; isDir: boolean }[]
  try {
    items = JSON.parse(custom)
  } catch {
    return
  }
  if (!items.length) return
  const r = await window.api.sftp.downloadTo(props.sessionId, items, localPath.value, store.transferConcurrency)
  if (!r.ok && !r.canceled) toast(tt('sfp.downloadFail'), 'error')
  else await refreshLocal()
}

// ---- local pane: selection, create / rename / delete ----
const localMenu = reactive({ open: false, x: 0, y: 0, target: null as LocalEntry | null })
const localModal = reactive({ open: false, kind: 'file' as 'file' | 'folder', action: 'new' as 'new' | 'rename', value: '', error: '', target: null as LocalEntry | null })
/** True while a local create / rename is in flight, so OK / Enter can't fire twice. */
const localSubmitting = ref(false)
// Whether the last interaction was in the local pane, so keyboard shortcuts
// route there (Ctrl+A / Delete / F2 / Enter / Backspace / Escape).
const localActive = ref(false)
const localSelSet = ref<Set<string>>(new Set())
const localAnchor = ref<string | null>(null)

/** "Select by pattern" input state (glob, e.g. *.log or *.{js,ts}). */
const localPattern = ref('')
const localPatternErr = ref('')

/** Selects the local entries matching a glob pattern (replacing the selection). */
function selectByPattern(e?: Event): void {
  // A glob pattern is often typed with an IME on (全角括号 and the like), where
  // the Enter that commits the candidate would otherwise select files mid-typing.
  if (isImeEnter(e)) return
  const pattern = localPattern.value.trim()
  if (!pattern) return
  const matched = localSorted.value
    .filter((e) => globMatch(pattern, e.name))
    .map((e) => e.name)
  if (!matched.length) {
    localPatternErr.value = tt('sfp.patternNoMatch', { pattern })
    return
  }
  localPatternErr.value = ''
  localSelSet.value = new Set(matched)
  localAnchor.value = matched[0] ?? null
}

function localSelectAll(): void {
  localSelSet.value = new Set(localSorted.value.map((e) => e.name))
}
const localSelCount = computed(() => localSelSet.value.size)
/** Selected local file names, in the pane's current sort order (stable). */
function localSelectedNames(): string[] {
  return localSorted.value.filter((e) => localSelSet.value.has(e.name)).map((e) => e.name)
}
function localSelect(entry: LocalEntry, e?: MouseEvent): void {
  localActive.value = true
  if (e?.ctrlKey || e?.metaKey) {
    const s = new Set(localSelSet.value)
    if (s.has(entry.name)) s.delete(entry.name)
    else s.add(entry.name)
    localSelSet.value = s
    localAnchor.value = entry.name
    return
  }
  if (e?.shiftKey && localAnchor.value) {
    const names = localSorted.value.map((x) => x.name)
    const a = names.indexOf(localAnchor.value)
    const b = names.indexOf(entry.name)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      const s = new Set(localSelSet.value)
      for (let i = lo; i <= hi; i++) s.add(names[i])
      localSelSet.value = s
      return
    }
  }
  localSelSet.value = new Set([entry.name])
  localAnchor.value = entry.name
}
function localMenuOpen(e: MouseEvent, entry: LocalEntry): void {
  if (!localSelSet.value.has(entry.name)) {
    localSelSet.value = new Set([entry.name])
    localAnchor.value = entry.name
  }
  localActive.value = true
  localMenu.target = entry
  localMenu.x = Math.max(8, Math.min(e.clientX, window.innerWidth - 180))
  localMenu.y = Math.max(8, Math.min(e.clientY, window.innerHeight - 120))
  localMenu.open = true
}
function localNew(kind: 'file' | 'folder'): void {
  localModal.kind = kind
  localModal.action = 'new'
  localModal.value = ''
  localModal.error = ''
  localModal.open = true
}
function localRename(): void {
  localRenameTarget(localMenu.target)
}
function localRenameTarget(t: LocalEntry | null): void {
  if (!t) return
  localModal.kind = t.isDir ? 'folder' : 'file'
  localModal.action = 'rename'
  localModal.value = t.name
  localModal.error = ''
  localModal.target = t
  localMenu.open = false
  localModal.open = true
}
async function localDelete(): Promise<void> {
  const t = localMenu.target
  if (!t || !localPath.value) return
  if (busy.value) return
  localMenu.open = false
  const ok = await confirm(tt('sfp.confirmDel', { name: t.name }))
  if (!ok) return
  busy.value = true
  try {
    const r = await window.api.local.del(localPath.value, t.name, t.isDir)
    if (!r.ok) toast(r.error ?? tt('sfp.delFail'), 'error')
    else await refreshLocal()
  } finally {
    busy.value = false
  }
}
async function localDelSelected(): Promise<void> {
  if (!localSelSet.value.size || !localPath.value) return
  if (busy.value) return
  const entries = localSorted.value.filter((e) => localSelSet.value.has(e.name))
  if (!entries.length) return
  const ok = await confirm(tt('sfp.delMany', { n: entries.length }))
  if (!ok) return
  busy.value = true
  try {
    let failed = false
    for (const e of entries) {
      const r = await window.api.local.del(localPath.value, e.name, e.isDir)
      if (!r.ok) {
        failed = true
        toast(r.error ?? tt('sfp.delFail'), 'error')
      }
    }
    localSelSet.value = new Set()
    localAnchor.value = null
    await refreshLocal()
    if (failed) toast(tt('sfp.delFail'), 'error')
  } finally {
    busy.value = false
  }
}
// Keyboard helpers: act on the single currently-selected local entry.
function localSelectedSingle(): LocalEntry | null {
  if (localSelSet.value.size !== 1) return null
  const n = Array.from(localSelSet.value)[0]
  return localSorted.value.find((e) => e.name === n) ?? null
}
function localRenameSelection(): void {
  const t = localSelectedSingle()
  if (!t) return
  localRenameTarget(t)
}
function localEnterSelection(): void {
  const t = localSelectedSingle()
  if (!t) return
  if (t.isDir) void refreshLocal(localJoin(localPath.value, t.name))
}
/** The Enter that commits an IME candidate (typing Chinese) belongs to the input
 *  method: running the handler there creates the folder under the text the
 *  candidate had not replaced yet, or closes the box and loses it. */
function isImeEnter(e?: Event): boolean {
  return isImeKey(e)
}

async function localSubmit(e?: Event): Promise<void> {
  if (isImeEnter(e)) return
  if (localSubmitting.value) return
  const name = localModal.value.trim()
  if (!name || !localPath.value) return
  localSubmitting.value = true
  try {
    if (localModal.action === 'new') {
      const r = await window.api.local.create(localPath.value, name, localModal.kind)
      if (!r.ok) {
        localModal.error = r.error ?? tt('sfp.createFail')
        return
      }
    } else {
      const t = localModal.target
      if (!t) return
      const r = await window.api.local.rename(localPath.value, t.name, name)
      if (!r.ok) {
        localModal.error = r.error ?? tt('sfp.renameFail')
        return
      }
    }
    localModal.open = false
    await refreshLocal()
  } finally {
    localSubmitting.value = false
  }
}
function fmtLocalTime(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---- interrupted-transfer resume queue ----
const showResume = ref(false)
async function resumePending(): Promise<void> {
  if (!props.sessionId) return
  const ops = [...store.transferQueue]
  const keep: TransferOp[] = []
  let failed = 0
  let lastErr = ''
  for (const op of ops) {
    const r = await window.api.sftp.uploadPaths(props.sessionId, op.remoteDir, op.localPaths, store.transferConcurrency)
    if (!r.ok && !r.canceled) {
      // Don't abort the whole resume on the first failure — skip this op and
      // keep trying the remaining queued uploads. Failed ops stay queued so a
      // later resume can retry (same policy as resumeDownloads).
      failed++
      lastErr = r.error ?? tt('sfp.uploadFail')
      keep.push(op)
      continue
    }
  }
  if (keep.length) await store.setTransferQueue(keep)
  else await store.clearTransferQueue()
  showResume.value = store.transferQueue.length > 0 || store.downloadQueue.length > 0
  if (failed > 0) {
    error.value = tt('sfp.resumePartial', { n: failed })
    if (lastErr) toast(lastErr, 'error')
  }
}
async function resumeDownloads(): Promise<void> {
  if (!props.sessionId) return
  const ops = [...store.downloadQueue]
  const keep: DownloadQueueOp[] = []
  let failed = 0
  // A reconnect gives the pane a new session id, so ops map through hostId to
  // whichever session that host has live now; ops whose host is still offline
  // stay queued instead of being silently dropped.
  const liveSidFor = (hostId?: string): string | undefined => {
    if (!hostId) return undefined
    for (const t of store.tabs) {
      const pane = t.panes.find((x) => x.params.hostId === hostId && x.sshSessionId)
      if (pane) return pane.sshSessionId
    }
    return undefined
  }
  for (const op of ops) {
    let sid = op.sessionId
    if (!store.paneBySession(sid)) {
      const mapped = liveSidFor(op.hostId)
      if (!mapped) {
        keep.push(op)
        continue
      }
      sid = mapped
    }
    // Resumes into the recorded local directory; partial files are picked up by
    // downloadJob. A per-op failure is skipped, not fatal to the rest. The user
    // already chose to download these, so a second overwrite prompt (which also
    // blocked the resume forever when nobody was at the keyboard) is skipped.
    const r = await window.api.sftp.downloadTo(sid, op.items, op.localDir, store.transferConcurrency, true)
    if (!r.ok && !r.canceled) {
      failed++
      keep.push(op)
    }
  }
  if (keep.length) await store.setDownloadQueue(keep)
  else await store.clearDownloadQueue()
  showResume.value = store.downloadQueue.length > 0
  if (failed > 0) toast(tt('sfp.resumeDownloadPartial', { n: failed }), 'error')
}
// dragenter/leave bubble from child rows; count depth so the drop highlight
// doesn't flicker off while the pointer crosses children.
let dragDepth = 0
function onDragEnter(e: DragEvent): void {
  const types = e.dataTransfer?.types ?? []
  if (!types.includes('Files') && !types.includes('application/x-ssh-local')) return
  dragDepth++
  dragOver.value = true
}
function endDrag(): void {
  dragDepth = 0
  dragOver.value = false
}
function onDragLeave(): void {
  if (!dragDepth) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragOver.value = false
}

const sort = reactive({ key: 'name' as 'name' | 'size' | 'mtime', asc: true })

// ---- local pane sorting (size / mtime columns) ----
const localSort = reactive({ key: 'name' as 'name' | 'size' | 'mtime', asc: true })
const localSorted = computed(() => {
  const arr = [...localEntries.value]
  const dir = localSort.asc ? 1 : -1
  arr.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    let r = 0
    if (localSort.key === 'name') r = a.name.localeCompare(b.name)
    else if (localSort.key === 'size') r = (a.size ?? 0) - (b.size ?? 0)
    else r = (a.mtime ?? 0) - (b.mtime ?? 0)
    return r * dir
  })
  return arr
})
function setLocalSort(key: 'name' | 'size' | 'mtime'): void {
  if (localSort.key === key) localSort.asc = !localSort.asc
  else {
    localSort.key = key
    localSort.asc = true
  }
}

// After a refresh in the same directory (upload/delete/external change) the
// selection can keep names that no longer exist, making the footer count lie.
// Prune it to what the pane actually shows, mirroring the remote pane.
watch(localSorted, (rows) => {
  if (!localSelSet.value.size) return
  const next = pruneSelection(localSelSet.value, rows.map((r) => r.name))
  if (next !== localSelSet.value) {
    localSelSet.value = next
    if (localAnchor.value && !next.has(localAnchor.value)) localAnchor.value = null
  }
})

const menu = reactive({ open: false, x: 0, y: 0, target: null as FileEntry | null })
const renamingName = ref<string | null>(null)
const renameInput = ref('')
const creatingKind = ref<'folder' | 'file' | null>(null)
const newName = ref('')
const editEl = ref<HTMLInputElement | HTMLInputElement[]>()
const localInput = ref<HTMLInputElement>()

// Selection (file-manager style). Names of selected entries in the current dir.
const selected = ref<Set<string>>(new Set())
const anchor = ref<string | null>(null)
const drawerEl = ref<HTMLElement>()
// The drawer's own dialogs (new / rename, sync, deploy, preview) are modals too:
// without a trap Tab walks into the file lists behind them.
const localDlgEl = ref<HTMLElement>()
const syncDlgEl = ref<HTMLElement>()
const deployDlgEl = ref<HTMLElement>()
const previewDlgEl = ref<HTMLElement>()
useFocusTrap(localDlgEl, () => localModal.open)
useFocusTrap(syncDlgEl, () => sync.open)
useFocusTrap(deployDlgEl, () => deploy.open)
useFocusTrap(previewDlgEl, () => preview.value.open)

function focusEdit(): void {
  nextTick(() => {
    const v = editEl.value
    const el = Array.isArray(v) ? v[v.length - 1] : v
    if (el && typeof el.select === 'function') el.select()
    else el?.focus()
  })
}

// Live transfer rows are tracked globally in the store (so a transfer that
// finishes while the drawer is closed is still recorded & notified); the drawer
// only filters that shared list to the pane it's showing.

// Recent finished transfers (newest first), kept for the history dropdown.
// The list is persisted through the store so it survives a restart; live
// entries (for the current session) are merged in as they complete.
type HistItem = TransferHistoryItem
const historyMenu = reactive({ open: false, x: 0, y: 0 })

const crumbs = computed(() => {
  const parts = path.value.split('/').filter(Boolean)
  const out: { label: string; full: string }[] = [{ label: '/', full: '/' }]
  let acc = ''
  for (const p of parts) {
    acc += '/' + p
    out.push({ label: p, full: acc })
  }
  return out
})

const showHidden = ref(window.api.prefs.sftpShowHidden === true)
function toggleHidden(): void {
  showHidden.value = !showHidden.value
  void window.api.settings.set('sftpShowHidden', showHidden.value)
}

/** The filter box in the remote pane's head: narrows the listing by name.
 *  Cleared when you move to another directory. */
const filterText = ref('')
const sorted = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  const arr = entries.value.filter(
    (e) => (showHidden.value || !e.name.startsWith('.')) && (!q || e.name.toLowerCase().includes(q))
  )
  const dir = sort.asc ? 1 : -1
  arr.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    let r = 0
    if (sort.key === 'name') r = a.name.localeCompare(b.name)
    else if (sort.key === 'size') r = a.size - b.size
    else r = a.mtime - b.mtime
    return r * dir
  })
  return arr
})

// Progress events for every session flow through the store; show only the
// active pane's, but keep the rest so a backgrounded transfer's completion
// (and its history entry) is never lost.
const activeTransfers = computed(() =>
  store.transfers.filter((t) => !t.done && !t.error && (!t.sessionId || t.sessionId === props.sessionId))
)
const activeHistory = computed(() => store.transferHistory)

// Refresh the listing once per upload that finished in this pane, debounced so a
// folder of N files triggers one reload instead of N. Driving it off a value
// getter (only the set of done-upload ids) rather than deep-watching the whole
// transfers array means it won't re-fire on every progress tick, and a
// backgrounded pane's upload never reloads the active one.
const doneUploadSig = computed(() =>
  store.transfers
    .filter(
      (x) =>
        x.done &&
        !x.error &&
        x.direction === 'up' &&
        (!x.sessionId || x.sessionId === props.sessionId)
    )
    .map((x) => x.id)
    .sort()
    .join('|')
)
watch(doneUploadSig, (sig) => {
  if (!sig) return
  if (uploadReloadTimer) clearTimeout(uploadReloadTimer)
  uploadReloadTimer = window.setTimeout(() => load(path.value), 500)
})

// Directory reads have no ordering guarantee once several are in flight
// (fast navigation, pane switching): a stale response landing last would
// rewrite path/entries to where the user just left. Each load takes a token
// and only the newest one may touch state.
let loadSeq = 0
async function load(p?: string): Promise<void> {
  if (!props.sessionId) return
  const sidAtCall = props.sessionId
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  creatingKind.value = null
  renamingName.value = null
  selected.value = new Set()
  anchor.value = null
  try {
    const res = await window.api.sftp.list(props.sessionId, p)
    if (seq !== loadSeq || sidAtCall !== props.sessionId) return
    if (res.path !== path.value) filterText.value = ''
    path.value = res.path
    if (!homePath.value) homePath.value = res.path
    if (props.sessionId) store.setSftpPath(props.sessionId, res.path)
    entries.value = res.entries
    if (res.path !== '/') void store.addSftpRecent(res.path)
  } catch (e) {
    if (seq !== loadSeq || sidAtCall !== props.sessionId) return
    error.value = (e as Error).message || tt('sfp.readDirFail')
  } finally {
    if (seq === loadSeq && sidAtCall === props.sessionId) loading.value = false
  }
}

watch(
  () => [props.sessionId, props.open] as const,
  (cur, old) => {
    const [sid, open] = cur
    // Session changed → this drawer now represents a different pane. Close any
    // open menu / chmod dialog that targets the old session so nothing acts on
    // it. Transfer rows and history are NOT cleared — they're tagged by session
    // and filtered at render, so a backgrounded transfer keeps updating and its
    // completion still lands in history.
    if (old && sid !== old[0]) {
      menu.open = moreMenu.open = historyMenu.open = bookmarksMenu.open = perm.open = false
      localMenu.open = false
      menu.target = null
      // Leave any continuous sync on the previous session.
      if (old[0]) void window.api.sftp.watchStop(old[0])
      watchActive.value = false
    }
    if (open && sid) {
      homePath.value = ''
      // Open at the terminal's current directory when shell integration knows
      // it; otherwise fall back to the last directory shown here, else ~.
      const last = store.paneBySession(sid)?.lastSftpPath
      load(props.terminalCwd || last || undefined)
      nextTick(() => drawerEl.value?.focus())
    }
  },
  { immediate: true }
)

let uploadReloadTimer: number | null = null
// A saved internal editor write should refresh the current listing (size/mtime
// may have changed), so App.bump reloadKey.
watch(
  () => props.reloadKey,
  (k, old) => {
    if (k && k !== old && props.sessionId) void load(path.value)
  }
)
watch(
  () => localModal.open,
  (open) => {
    if (open) nextTick(() => localInput.value?.focus())
  }
)
onMounted(() => {
  showResume.value = store.transferQueue.length > 0 || store.downloadQueue.length > 0
  // Tracking/notification/history are handled globally in the store so they run
  // even when this drawer is closed. Idempotent, so calling it here too is safe.
  store.initSftpProgress()
  window.addEventListener('resize', onWindowResize)
})
onBeforeUnmount(() => {
  if (uploadReloadTimer) clearTimeout(uploadReloadTimer)
  // A continuous sync (esp. with delete-extra-files) must not keep running
  // with the drawer gone — the watch state lives in main and would otherwise
  // poll and sync invisibly, with no UI left to stop it.
  if (props.sessionId && watchActive.value) void window.api.sftp.watchStop(props.sessionId)
  window.removeEventListener('mousemove', onMarqueeMove)
  window.removeEventListener('mouseup', onMarqueeUp)
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  window.removeEventListener('resize', onWindowResize)
  // If we unmount mid resize-drag (e.g. the session dropped), the mouseup that
  // would restore these never runs — clear them so the app isn't left with a
  // stuck ew-resize cursor and disabled text selection.
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

function setSort(key: 'name' | 'size' | 'mtime'): void {
  if (sort.key === key) sort.asc = !sort.asc
  else {
    sort.key = key
    sort.asc = true
  }
}

// ---- selection ----
const selCount = computed(() => selected.value.size)
// Prune against the directory listing, not the filtered view: typing in the
// filter box must not drop files that still exist (only a reload / delete does).
// A pruned anchor is cleared too, or shift-range would extend from a ghost.
watch(entries, (rows) => {
  if (!selected.value.size) return
  const next = pruneSelection(selected.value, rows.map((r) => r.name))
  if (next !== selected.value) {
    selected.value = next
    if (anchor.value && !next.has(anchor.value)) anchor.value = null
  }
})
// ---- What the page shows around the listing ----
/** Total size of the selected files (folders count as 0), for the footer. */
const selSize = computed(() => selectedEntries().reduce((n, e) => n + (e.isDir ? 0 : e.size), 0))
/** The session's saved host, for the remote pane's head (icon, name). */
const sessionPane = computed(() => (props.sessionId ? store.paneBySession(props.sessionId) : undefined))
const sessionHost = computed(() => store.hosts.find((h) => h.id === sessionPane.value?.params.hostId))

// File kinds: a glyph and a tone per type, so a listing reads at a glance.
type FileKind = 'dir' | 'image' | 'archive' | 'code' | 'text' | 'exec' | 'data' | 'file'
const KIND_BY_EXT: Record<string, FileKind> = {}
for (const [kind, exts] of Object.entries({
  image: 'png jpg jpeg gif webp svg bmp ico heic tiff avif',
  archive: 'zip tar gz tgz bz2 xz 7z rar zst deb rpm',
  code: 'js ts tsx jsx mjs cjs vue py go rs c h cpp hpp cc java kt swift rb php lua cs html css scss json yaml yml toml xml ini conf cfg sql',
  text: 'txt md log rst csv tsv pdf doc docx',
  exec: 'sh bash zsh fish ps1 bat cmd exe run appimage',
  data: 'safetensors ckpt pt pth onnx gguf bin h5 pkl npy npz parquet db sqlite iso img qcow2 vmdk'
})) {
  for (const ext of exts.split(' ')) KIND_BY_EXT[ext] = kind as FileKind
}
const KIND_ICON: Record<FileKind, string> = {
  dir: 'folder',
  image: 'image',
  archive: 'archive',
  code: 'code',
  text: 'file-text',
  exec: 'terminal',
  data: 'database',
  file: 'file'
}
function kindOf(e: { name: string; isDir: boolean; mode?: number }): FileKind {
  if (e.isDir) return 'dir'
  const dot = e.name.lastIndexOf('.')
  const k = dot > 0 ? KIND_BY_EXT[e.name.slice(dot + 1).toLowerCase()] : undefined
  if (k) return k
  return e.mode !== undefined && e.mode & 0o111 ? 'exec' : 'file'
}

// ---- The two arrows between the panes: send the selection across ----
async function uploadLocalSelection(): Promise<void> {
  if (!props.sessionId || !localSelCount.value) return
  if (busy.value) return
  busy.value = true
  try {
    const paths = localSelectedNames().map((n) => localJoin(localPath.value, n))
    const r = await window.api.sftp.uploadPaths(props.sessionId, path.value, paths, store.transferConcurrency)
    if (!r.ok && !r.canceled) error.value = r.error ?? tt('sfp.uploadFail')
  } finally {
    busy.value = false
  }
}
async function downloadSelectionToLocal(): Promise<void> {
  if (!props.sessionId || !localPath.value || !selected.value.size) return
  if (busy.value) return
  busy.value = true
  try {
    const items = selectedEntries().map((x) => ({ path: posixJoin(path.value, x.name), name: x.name, isDir: x.isDir }))
    const r = await window.api.sftp.downloadTo(props.sessionId, items, localPath.value, store.transferConcurrency)
    if (!r.ok && !r.canceled) toast(tt('sfp.downloadFail'), 'error')
    else await refreshLocal()
  } finally {
    busy.value = false
  }
}

function selectedEntries(): FileEntry[] {
  return sorted.value.filter((e) => selected.value.has(e.name))
}
function selectOne(name: string): void {
  selected.value = new Set([name])
  anchor.value = name
}
function toggleSel(name: string): void {
  const s = new Set(selected.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  selected.value = s
  anchor.value = name
}
function selectRange(name: string): void {
  const names = sorted.value.map((e) => e.name)
  const a = names.indexOf(anchor.value ?? name)
  const b = names.indexOf(name)
  if (a < 0 || b < 0) return selectOne(name)
  const [lo, hi] = a < b ? [a, b] : [b, a]
  const s = new Set(selected.value)
  for (let i = lo; i <= hi; i++) s.add(names[i])
  selected.value = s
}
function selectAll(): void {
  selected.value = new Set(sorted.value.map((e) => e.name))
}

// ---- rubber-band (marquee) selection ----
const bodyEl = ref<HTMLElement>()
const marquee = reactive({ active: false, x0: 0, y0: 0, x1: 0, y1: 0 })
const marqueeBase = ref<Set<string>>(new Set())

function onBodyMousedown(e: MouseEvent): void {
  if (e.button !== 0) return
  const t = e.target as HTMLElement
  if (t.closest('.row') || t.closest('input')) return // rows/inputs handle their own
  marqueeBase.value = e.ctrlKey || e.metaKey ? new Set(selected.value) : new Set()
  if (!(e.ctrlKey || e.metaKey)) selected.value = new Set()
  marquee.active = true
  marquee.x0 = marquee.x1 = e.clientX
  marquee.y0 = marquee.y1 = e.clientY
  window.addEventListener('mousemove', onMarqueeMove)
  window.addEventListener('mouseup', onMarqueeUp)
}
function onMarqueeMove(e: MouseEvent): void {
  marquee.x1 = e.clientX
  marquee.y1 = e.clientY
  const rx0 = Math.min(marquee.x0, marquee.x1)
  const rx1 = Math.max(marquee.x0, marquee.x1)
  const ry0 = Math.min(marquee.y0, marquee.y1)
  const ry1 = Math.max(marquee.y0, marquee.y1)
  const s = new Set(marqueeBase.value)
  bodyEl.value?.querySelectorAll<HTMLElement>('.row[data-name]').forEach((row) => {
    const r = row.getBoundingClientRect()
    if (r.left < rx1 && r.right > rx0 && r.top < ry1 && r.bottom > ry0) {
      s.add(row.dataset.name as string)
    }
  })
  selected.value = s
}
function onMarqueeUp(): void {
  marquee.active = false
  window.removeEventListener('mousemove', onMarqueeMove)
  window.removeEventListener('mouseup', onMarqueeUp)
}
const marqueeStyle = computed(() => {
  const b = bodyEl.value?.getBoundingClientRect()
  if (!b) return {}
  const scroll = bodyEl.value?.scrollTop ?? 0
  return {
    left: Math.min(marquee.x0, marquee.x1) - b.left + 'px',
    top: Math.min(marquee.y0, marquee.y1) - b.top + scroll + 'px',
    width: Math.abs(marquee.x1 - marquee.x0) + 'px',
    height: Math.abs(marquee.y1 - marquee.y0) + 'px'
  }
})

// ---- resizable width (drag the left edge) ----
const MIN_W = 260
const maxWidth = (): number => Math.round(window.innerWidth * 0.5)
function clampWidth(w: number): number {
  return Math.max(MIN_W, Math.min(maxWidth(), w))
}
const initW = Number(window.api.prefs.sftpWidth)
const width = ref(clampWidth(initW >= MIN_W ? initW : 340))
let dragX = 0
let dragW = 0
function onResizeStart(e: MouseEvent): void {
  if (e.button !== 0) return // left-button drags only
  dragX = e.clientX
  dragW = width.value
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}
function onResizeMove(e: MouseEvent): void {
  // Dragging the left edge to the left widens the panel.
  width.value = clampWidth(dragW + (dragX - e.clientX))
}
function onResizeEnd(): void {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  void window.api.settings.set('sftpWidth', width.value)
}
// Keep within the 50% cap when the window is resized smaller.
function onWindowResize(): void {
  width.value = clampWidth(width.value)
  // Dropdowns are anchored to fixed pixel coords captured on open; a resize /
  // maximize would leave them stranded, so dismiss them.
  menu.open = false
  moreMenu.open = false
  historyMenu.open = false
}

function onRowClick(entry: FileEntry, e: MouseEvent): void {
  if (renamingName.value) return
  localActive.value = false
  if (e.ctrlKey || e.metaKey) toggleSel(entry.name)
  else if (e.shiftKey && anchor.value) selectRange(entry.name)
  else selectOne(entry.name)
  // Keep the drawer focused so keyboard shortcuts keep working.
  drawerEl.value?.focus()
}
function onRowDblClick(entry: FileEntry): void {
  // Double-click: enter a directory, preview an image inline, or open a file in
  // the built-in editor (whose Save writes the edits straight back to remote).
  if (renamingName.value) return
  if (entry.isDir) load(posixJoin(path.value, entry.name))
  else if (isImage(entry)) void previewFile(entry)
  else editFile(entry, false)
}
function goUp(): void {
  load(parentOf(path.value))
}

// ---- keyboard (file-manager shortcuts) ----
function onKeydown(e: KeyboardEvent): void {
  if (renamingName.value || creatingKind.value) return
  // Ignore keys bubbling up from the rename/create inputs — commitRename/
  // commitCreate clear the editing flag synchronously before the event reaches
  // here, so the guard above can be stale on Enter/Esc.
  if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (sync.open || deploy.open || preview.value.open || localModal.open || perm.open || dirDiff.open || diff.open) return
  const mod = e.ctrlKey || e.metaKey
  if (localActive.value) {
    // Filter to local-pane file-manager shortcuts.
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      localSelectAll()
    } else if (e.key === 'Delete') {
      e.preventDefault()
      void localDelSelected()
    } else if (e.key === 'F2') {
      e.preventDefault()
      localRenameSelection()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      localEnterSelection()
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      localGoUp()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (localMenu.open) {
        localMenu.open = false
      } else if (localSelSet.value.size) {
        localSelSet.value = new Set()
        localAnchor.value = null
      }
    }
    return
  }
  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    selectAll()
  } else if (e.key === 'Delete') {
    e.preventDefault()
    void delSelected()
  } else if (e.key === 'F2') {
    e.preventDefault()
    const items = selectedEntries()
    if (items.length === 1) startRename(items[0])
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const items = selectedEntries()
    if (items.length === 1) onRowDblClick(items[0])
  } else if (e.key === 'Backspace') {
    e.preventDefault()
    if (path.value !== '/') goUp()
  } else if (e.key === 'Escape') {
    // Close an open dropdown first; only clear the selection if none was open.
    if (menu.open || moreMenu.open || historyMenu.open || bookmarksMenu.open) {
      menu.open = moreMenu.open = historyMenu.open = bookmarksMenu.open = false
    } else {
      selected.value = new Set()
    }
  }
}

// ---- context menu ----
function openMenu(e: MouseEvent, target: FileEntry | null): void {
  e.preventDefault()
  e.stopPropagation()
  // Right-clicking an unselected row selects just it; otherwise keep the set.
  if (target && !selected.value.has(target.name)) selectOne(target.name)
  menu.target = target
  menu.x = Math.min(e.clientX, window.innerWidth - 170)
  menu.y = Math.min(e.clientY, window.innerHeight - 210)
  menu.open = true
}
function closeMenu(): void {
  menu.open = false
}
function keepInView(m: { x: number; y: number }, sel: string): void {
  void nextTick(() => {
    const el = drawerEl.value?.querySelector<HTMLElement>(sel)
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth - 8) m.x = Math.max(8, window.innerWidth - 8 - r.width)
    if (r.bottom > window.innerHeight - 8) m.y = Math.max(8, window.innerHeight - 8 - r.height)
  })
}

// ---- operations ----
function editFile(entry: FileEntry, external: boolean): void {
  const payload = { path: posixJoin(path.value, entry.name), name: entry.name }
  if (external) emit('edit-external', payload)
  else emit('edit-file', payload)
}
// ---- Compare a remote file against a local file ----
const diff = reactive({ open: false, remoteName: '', remoteContent: '', localName: '', localContent: '' })
async function diffWithLocal(entry: FileEntry): Promise<void> {
  if (!props.sessionId) return
  const remote = await window.api.sftp.readText(props.sessionId, posixJoin(path.value, entry.name))
  if (!remote.ok) {
    error.value =
      remote.error === 'file-too-large' ? tt('sfp.fileTooLarge') : (remote.error ?? tt('sfp.diffFail'))
    return
  }
  const picked = await window.api.local.pickFile()
  if (!picked.ok || !picked.path) return
  const local = await window.api.local.readText(picked.path)
  if (!local.ok || local.content === undefined) {
    error.value =
      local.error === 'file-too-large' ? tt('sfp.fileTooLarge') : (local.error ?? tt('sfp.diffFail'))
    return
  }
  diff.remoteName = entry.name
  diff.remoteContent = remote.content ?? ''
  diff.localName = picked.path.split(/[\\/]/).pop() ?? picked.path
  diff.localContent = local.content
  diff.open = true
}
// ---- Deploy: upload selected local files then run a command ----
const deploy = reactive({ open: false, cmd: '', busy: false, error: '' })
function openDeploy(): void {
  if (!props.sessionId || !localSelCount.value) return
  deploy.cmd = ''
  deploy.error = ''
  deploy.open = true
}
/** Closing is refused while the upload runs: this dialog is the only progress
 *  UI, and dismissing it would leave the transfer going with nothing shown. */
function closeDeploy(): void {
  if (deploy.busy) return
  deploy.open = false
  deploy.error = ''
}
/** Enter runs the deploy (Shift+Enter keeps the newline); the Enter that
 *  commits an IME candidate belongs to the input method. */
function onDeployKey(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || e.shiftKey || isImeEnter(e)) return
  if (deploy.busy || !deploy.cmd.trim()) return
  e.preventDefault()
  void runDeploy()
}
async function runDeploy(): Promise<void> {
  if (!props.sessionId || !localSelCount.value || !deploy.cmd.trim() || deploy.busy) return
  deploy.busy = true
  deploy.error = ''
  try {
    const names = localSelectedNames()
    const paths = names.map((n) => localJoin(localPath.value, n))
    const up = await window.api.sftp.uploadPaths(props.sessionId, path.value, paths, store.transferConcurrency, 'overwrite')
    if (up.ok) {
      window.api.ssh.input(props.sessionId, deploy.cmd.endsWith('\n') ? deploy.cmd : deploy.cmd + '\n')
      toast(tt('sfp.deployDone'), 'success')
      deploy.open = false
    } else if (!up.canceled) {
      // The drawer's banner sits behind this dialog — report the failure here.
      deploy.error = up.error ?? tt('sfp.deployFail')
    }
  } finally {
    deploy.busy = false
  }
}
/** Opens with the per-extension program if configured, else OS default. */
function openWith(entry: FileEntry): void {
  const payload = { path: posixJoin(path.value, entry.name), name: entry.name, ext: fileExt(entry.name) }
  emit('open-with', payload)
}
function onRemoteMouseDown(e: MouseEvent, entry: FileEntry): void {
  // Alt+mousedown pre-fetches the drag-out download into the main-process cache
  // so that startDrag (called from onDragStart) can complete near-instantly and
  // actually drive the native OS drag gesture instead of missing it.
  if (!props.sessionId || !e.altKey) return
  const sel = selected.value.has(entry.name) ? selectedEntries() : [entry]
  const items = sel.map((x) => ({ remotePath: posixJoin(path.value, x.name), name: x.name, isDir: x.isDir }))
  window.api.sftp.prefetchDrag(props.sessionId, items)
}
function onDragStart(e: DragEvent, entry: FileEntry): void {
  if (!props.sessionId) return
  // Alt+drag initiates a native OS drag-out (to the desktop / Explorer).
  // If the dragged row is part of a multi-selection, all selected items are
  // carried; the main process downloads them (a single file drags out as that
  // file, multiple items / folders into a temp directory) and startDrags it.
  // Regular drag keeps carrying the in-app MIME for the dual-pane drop.
  if (e.altKey) {
    const sel = selected.value.has(entry.name) ? selectedEntries() : [entry]
    e.preventDefault()
    const items = sel.map((x) => ({ remotePath: posixJoin(path.value, x.name), name: x.name, isDir: x.isDir }))
    window.api.sftp.startDrag(props.sessionId, items)
    return
  }
  // In-app drag (dual-panel): carry the remote path(s) so the local pane can
  // accept them as a drop target and download into its current directory.
  // If the dragged row is part of a multi-selection, drag them all.
  const items = (selected.value.has(entry.name) ? selectedEntries() : [entry]).map((x) => ({
    path: posixJoin(path.value, x.name),
    name: x.name,
    isDir: x.isDir
  }))
  e.dataTransfer?.setData('application/x-ssh-remote', JSON.stringify(items))
  e.dataTransfer?.setData('text/plain', items.map((i) => i.path).join('\n'))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}
async function uploadPick(): Promise<void> {
  if (!props.sessionId || busy.value) return
  busy.value = true
  try {
    const r = await window.api.sftp.upload(props.sessionId, path.value, store.transferConcurrency)
    if (!r.ok && !r.canceled) error.value = r.error ?? tt('sfp.uploadFail')
  } finally {
    busy.value = false
  }
}
async function uploadDirPick(): Promise<void> {
  if (!props.sessionId || busy.value) return
  busy.value = true
  try {
    const r = await window.api.sftp.uploadDir(props.sessionId, path.value, store.transferConcurrency)
    if (!r.ok && !r.canceled) error.value = r.error ?? tt('sfp.uploadFail')
  } finally {
    busy.value = false
  }
}
async function onDrop(e: DragEvent): Promise<void> {
  dragDepth = 0
  dragOver.value = false
  if (!props.sessionId) return
  // A drag that originated in our own local pane carries its paths in a
  // custom MIME type; the "files" list is empty for those, so check it first.
  const custom = e.dataTransfer?.getData('application/x-ssh-local')
  let paths: string[]
  if (custom) {
    try {
      paths = JSON.parse(custom)
    } catch {
      paths = []
    }
    if (!paths.length) return
  } else {
    paths = Array.from(e.dataTransfer?.files ?? [])
      .map((f) => window.api.getPathForFile(f))
      // Ignore files that came from our own drag-out (dragging a file out and
      // releasing back over the panel) — they live in the xssh-drag temp dir.
      .filter((p): p is string => !!p && !p.includes('xssh-drag-'))
    if (!paths.length) return
  }
  // Don't gate on `busy` here — dropping a second folder mid-upload is fine —
  // but do surface failures, or a drop that never starts looks like a no-op.
  const r = await window.api.sftp.uploadPaths(props.sessionId, path.value, paths, store.transferConcurrency)
  if (!r.ok && !r.canceled) error.value = r.error ?? tt('sfp.uploadFail')
}
function startRename(entry: FileEntry): void {
  renamingName.value = entry.name
  renameInput.value = entry.name
  focusEdit()
}
async function commitRename(entry: FileEntry, e?: Event): Promise<void> {
  if (isImeEnter(e)) return
  // Esc clears renamingName first; the ensuing blur must not still rename.
  if (renamingName.value !== entry.name) return
  if (e) e.preventDefault()
  const next = renameInput.value.trim()
  renamingName.value = null
  if (!props.sessionId || !next || next === entry.name) return
  const r = await window.api.sftp.rename(
    props.sessionId,
    posixJoin(path.value, entry.name),
    posixJoin(path.value, next)
  )
  if (!r.ok) {
    // Keep the editor open with what the user typed: a failed rename (name
    // taken, permission denied) is fixed by editing the name, not by starting
    // over from the context menu.
    error.value = r.error ?? tt('sfp.renameFail')
    renameInput.value = next
    renamingName.value = entry.name
    focusEdit()
    return
  }
  await load(path.value)
}
function startCreate(kind: 'folder' | 'file'): void {
  creatingKind.value = kind
  newName.value = ''
  focusEdit()
}
async function commitCreate(e?: Event): Promise<void> {
  if (isImeEnter(e)) return
  if (e) e.preventDefault()
  const name = newName.value.trim()
  const kind = creatingKind.value
  creatingKind.value = null
  if (!props.sessionId || !name || !kind) return
  const target = posixJoin(path.value, name)
  const r =
    kind === 'folder'
      ? await window.api.sftp.mkdir(props.sessionId, target)
      : await window.api.sftp.createFile(props.sessionId, target)
  if (!r.ok) {
    // Same as rename: a failed mkdir/createFile (already exists, no write
    // permission) leaves the row in place with the typed name so it can be
    // corrected and retried, instead of vanishing into a banner.
    error.value = r.error ?? tt('sfp.createFail')
    newName.value = name
    creatingKind.value = kind
    focusEdit()
    return
  }
  await load(path.value)
}
// ---- selection-aware operations (used by menu + shortcuts) ----
function copySelectedPaths(): void {
  const items = selectedEntries()
  if (!items.length) return
  window.api.clipboard.writeText(
    items.map((e) => posixJoin(path.value, e.name)).join('\n')
  )
}
async function downloadSelected(): Promise<void> {
  if (!props.sessionId) return
  const items = selectedEntries()
  if (!items.length) return
  if (busy.value) return
  busy.value = true
  try {
    if (items.length === 1 && !items[0].isDir) {
      // Single file → Save-As dialog.
      await window.api.sftp.download(
        props.sessionId,
        posixJoin(path.value, items[0].name),
        items[0].name,
        store.transferConcurrency
      )
      return
    }
    // Multiple / folders → pick one target folder.
    const payload = items.map((e) => ({
      path: posixJoin(path.value, e.name),
      name: e.name,
      isDir: e.isDir
    }))
    const r = await window.api.sftp.downloadMany(props.sessionId, payload, store.transferConcurrency)
    if (!r.ok && !r.canceled) error.value = r.error ?? tt('sfp.downloadFail')
  } finally {
    busy.value = false
  }
}
async function packDownloadSelected(): Promise<void> {
  if (!props.sessionId) return
  const items = selectedEntries()
  if (!items.length) return
  if (busy.value) return
  const payload = items.map((e) => ({
    path: posixJoin(path.value, e.name),
    name: e.name,
    isDir: e.isDir
  }))
  busy.value = true
  try {
    const r = await window.api.sftp.packDownload(props.sessionId, payload)
    if (!r.ok && !r.canceled) error.value = r.error ?? tt('sfp.packFail')
    else if (r.ok) await load(path.value)
  } finally {
    busy.value = false
  }
}
async function uploadExtractPick(): Promise<void> {
  if (!props.sessionId || busy.value) return
  busy.value = true
  try {
    const r = await window.api.sftp.uploadExtract(props.sessionId, path.value, store.transferConcurrency)
    if (!r.ok && !r.canceled) error.value = r.error ?? tt('sfp.extractFail')
    else if (r.ok) await load(path.value)
  } finally {
    busy.value = false
  }
}
async function delSelected(): Promise<void> {
  if (!props.sessionId) return
  const items = selectedEntries()
  if (!items.length) return
  const msg =
    items.length === 1
    ? items[0].isDir ? tt('sfp.delOneDir', { name: items[0].name }) : tt('sfp.delOneFile', { name: items[0].name })
    : tt('sfp.delMany', { n: items.length })
  const ok = await confirm(msg, { title: tt('sfp.delTitle'), danger: true, confirmText: tt('sfp.delOk') })
  if (!ok) return
  if (busy.value) return
  busy.value = true
  try {
    for (const it of items) {
      const r = await window.api.sftp.remove(props.sessionId, posixJoin(path.value, it.name), it.isDir)
      if (!r.ok) error.value = r.error ?? tt('sfp.delFail')
    }
    selected.value = new Set()
    await load(path.value)
  } finally {
    busy.value = false
  }
}

function runMenu(fn: () => void): void {
  menu.open = false
  fn()
}

// ---- header "more" dropdown ----
const moreMenu = reactive({ open: false, x: 0, y: 0 })
function openMore(e: MouseEvent): void {
  const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
  moreMenu.x = Math.max(8, Math.min(b.right - 176, window.innerWidth - 184))
  moreMenu.y = b.bottom + 5
  moreMenu.open = true
}
function runMore(fn: () => void): void {
  moreMenu.open = false
  fn()
}
// ---- Incremental sync (rsync-style) ----
const sync = reactive({ open: false, local: '', remote: '', mode: 'both' as 'up' | 'down' | 'both', del: false, watch: false, interval: 5, busy: false, error: '' })
const watchActive = ref(false)
watch(
  () => sync.mode,
  (m) => {
    if (m === 'both') sync.del = false
    sync.error = ''
  }
)
// ---- Directory tree diff (rsync-style, read-only) ----
// The dialog itself lives in DirDiffDialog.vue; the drawer only seeds the two
// paths from the panes it is currently showing.
const dirDiff = reactive({ open: false, local: "", remote: "" })
function openDirDiff(): void {
  if (!props.sessionId) return
  dirDiff.local = localPath.value
  dirDiff.remote = path.value
  dirDiff.open = true
}
function openSyncDialog(): void {
  if (!props.sessionId) return
  sync.local = localPath.value
  sync.remote = path.value
  sync.mode = 'both'
  sync.del = false
  sync.watch = false
  sync.interval = 5
  sync.error = ''
  sync.busy = false
  sync.open = true
}
function closeSync(): void {
  if (sync.busy) return
  sync.open = false
  sync.error = ''
}
async function startSync(): Promise<void> {
  if (!props.sessionId || !sync.local || !sync.remote || sync.busy) return
  sync.error = ''
  sync.busy = true
  try {
    // Continuous mode keeps a background watcher alive on the session.
    if (sync.watch) {
      const r = await window.api.sftp.watchStart(
        props.sessionId, sync.local, sync.remote, sync.mode, sync.del, sync.interval
      )
      if (r.ok) {
        watchActive.value = true
        sync.open = false
      } else {
        sync.error = r.error ?? tt('sfp.syncFail')
      }
      return
    }
    const r = await window.api.sftp.sync(
      props.sessionId, sync.local, sync.remote, sync.mode, sync.del, store.transferConcurrency
    )
    if (r.ok) {
      sync.open = false
    } else {
      sync.error = r.error ?? tt('sfp.syncFail')
    }
  } finally {
    sync.busy = false
  }
}
function onSyncEnter(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || isImeEnter(e) || sync.busy || !sync.local || !sync.remote) return
  e.preventDefault()
  void startSync()
}
async function stopWatch(): Promise<void> {
  if (!props.sessionId) return
  await window.api.sftp.watchStop(props.sessionId)
  watchActive.value = false
}
function openHistory(): void {
  // The history menu is wider (300px) than the more-menu it inherits its anchor
  // from, so clamp it to keep the whole panel on-screen.
  historyMenu.x = Math.max(8, Math.min(moreMenu.x, window.innerWidth - 308))
  historyMenu.y = moreMenu.y
  historyMenu.open = true
}
async function clearHistory(): Promise<void> {
  const ok = await confirm(tt('sfp.clearHistConfirm'), {
    title: tt('sfp.clear'),
    confirmText: tt('sfp.clear'),
    danger: true
  })
  if (!ok) return
  await store.clearTransferHistory()
  historyMenu.open = false
}
function locateHistory(h: TransferHistoryItem): void {
  if (!h.remoteDir || !props.sessionId) return
  historyMenu.open = false
  load(h.remoteDir)
}
// A failed download (single item, folder, or multi-select) can be retried
// straight into its original local destination; partial files are resumed by
// downloadJob. The recorded item list is used when available so the exact
// remote paths (and any Save-As rename) survive a retry.
async function retryHistory(h: TransferHistoryItem): Promise<void> {
  if (!props.sessionId || !h.localDir || h.direction !== 'down') return
  historyMenu.open = false
  // Same destination the user already picked — skip the overwrite prompt
  // (mirrors resumeDownloads; partials resume inside downloadJob).
  const r = await window.api.sftp.downloadTo(
    props.sessionId,
    buildRetryItems(h),
    h.localDir,
    store.transferConcurrency,
    true
  )
  if (!r.ok && !r.canceled) toast(r.error ?? tt('sfp.retryFail'), 'error')
}
// Open a finished transfer in the OS file manager: a download reveals its local
// destination, an upload reveals its local source file.
async function revealHistory(h: TransferHistoryItem): Promise<void> {
  const target =
    h.direction === 'up'
      ? h.localPaths?.[0]
      : h.localDir
        ? localJoin(h.localDir, h.name)
        : undefined
  if (!target) return
  historyMenu.open = false
  const r = await window.api.sftp.revealLocal(target)
  if (!r.ok) toast(r.error ?? tt('sfp.revealFail'), 'error')
}
// Finished downloads reveal their dest; finished uploads reveal their source.
function canReveal(h: TransferHistoryItem): boolean {
  return canRevealHistory(h)
}
async function removeHistory(h: TransferHistoryItem): Promise<void> {
  historyMenu.open = false
  await store.removeTransferHistory(h.id)
}

// ---- bookmarks ----
const bookmarksMenu = reactive({ open: false, x: 0, y: 0 })
function openBookmarks(e: MouseEvent): void {
  const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
  bookmarksMenu.x = Math.max(8, Math.min(b.right - 220, window.innerWidth - 228))
  bookmarksMenu.y = b.bottom + 5
  bookmarksMenu.open = true
}
async function toggleBookmarkCurrent(): Promise<void> {
  bookmarksMenu.open = false
  if (props.sessionId) await store.toggleSftpBookmark(path.value)
}
async function jumpBookmark(p: string): Promise<void> {
  bookmarksMenu.open = false
  await load(p)
}
function fmtAgo(at: number): string {
  return formatAgo(at, tt)
}

// ---- terminal ↔ file panel linkage ----
const hasTermCwd = computed(() => !!props.terminalCwd)
function gotoTerminalDir(): void {
  if (props.terminalCwd) load(props.terminalCwd)
}
function cdTerminalTo(entry: FileEntry): void {
  emit('cd-terminal', posixJoin(path.value, entry.name))
}

// ---- editable path bar ----
const pathEditing = ref(false)
const pathInput = ref('')
const pathEl = ref<HTMLInputElement>()
function startPathEdit(): void {
  pathInput.value = path.value
  pathEditing.value = true
  nextTick(() => pathEl.value?.select())
}
function commitPathEdit(e?: Event): void {
  if (isImeEnter(e)) return
  // Esc sets pathEditing=false first; the ensuing blur must not still navigate.
  if (!pathEditing.value) return
  if (e) e.preventDefault()
  pathEditing.value = false
  const p = pathInput.value.trim()
  if (p && p !== path.value) load(p)
}

// ---- permission tooltip ----
function permTitle(entry: FileEntry): string {
  if (entry.mode === undefined) return entry.name
  const m = entry.mode
  const tri = (b: number): string =>
    (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-')
  const sym = tri((m >> 6) & 7) + tri((m >> 3) & 7) + tri(m & 7)
  return `${entry.name}\n${sym}  ${(m & 0o7777).toString(8).padStart(3, '0')}`
}

// ---- transfer cancel ----
function cancelTransfer(id: string): void {
  window.api.sftp.cancel(id)
}
function canRetry(h: TransferHistoryItem): boolean {
  return canRetryHistory(h) && !!props.sessionId
}
function fmtSpeed(id: string): string {
  return formatSpeed(store.transferSpeeds[id])
}
function statusText(t: SftpProgress): string {
  return transferStatusText(t, tt)
}

// ---- permissions (chmod) ----
// The dialog itself lives in PermDialog.vue; the drawer only tracks which
// entries it was opened for, and reloads the listing when it closes.
const perm = reactive({
  open: false,
  targets: [] as FileEntry[],
  initialMode: undefined as number | undefined
})

function openPerm(): void {
  const items = selectedEntries()
  if (!items.length) return
  perm.targets = items
  // Prefill from the right-clicked entry's current mode when known.
  perm.initialMode = menu.target?.mode ?? items[0].mode
  perm.open = true
}

function onPermClose(payload: { applied: boolean }): void {
  perm.open = false
  // Restore focus to the drawer so its shortcuts stay live.
  nextTick(() => drawerEl.value?.focus())
  if (payload.applied) void load(path.value)
}

function fmtSize(n: number): string {
  return formatBytes(n)
}
function fmtTime(sec: number): string {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const pct = (t: SftpProgress): number => pctOf(t)
// (after every menu's state exists)
watch(() => menu.open, (o) => o && keepInView(menu, '.ctx.file-menu'))
watch(() => moreMenu.open, (o) => o && keepInView(moreMenu, '.ctx.more-menu'))
watch(() => localMenu.open, (o) => o && keepInView(localMenu, '.ctx.loc-menu'))
watch(() => historyMenu.open, (o) => o && keepInView(historyMenu, '.ctx.hist-menu'))
watch(() => bookmarksMenu.open, (o) => o && keepInView(bookmarksMenu, '.ctx.bm-menu'))
</script>

<template>
  <!-- One file browser, two layouts: the SFTP page (toolbar on the page, remote
       and local side by side as cards) and the drawer on the terminal page
       (the same pieces stacked in a narrow column). -->
  <aside
    ref="drawerEl"
    class="sftp"
    :class="{ drag: dragOver, page, drawer: !page }"
    :style="page ? undefined : { width: width + 'px' }"
    tabindex="0"
    @keydown="onKeydown"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
    @dragend="endDrag"
  >
    <div v-if="!page" class="resize-handle" :title="tt('sfp.resizeTip')" @mousedown.prevent="onResizeStart" />

    <!-- ---- Toolbar: where you are (left), what you can do (right) ---- -->
    <header class="toolbar">
      <span v-if="!page" class="bar-title">{{ tt('sfp.files') }}</span>
      <div class="nav-grp">
        <button class="ib" :title="tt('sfp.upLevel')" :disabled="path === '/' || loading" @click="goUp"><Icon name="arrow-up" :size="15" /></button>
        <button class="ib" :title="tt('sfp.home')" :disabled="!homePath" @click="load(homePath)"><Icon name="home" :size="15" /></button>
        <div class="path-field" :class="{ editing: pathEditing }">
          <input
            v-if="pathEditing"
            ref="pathEl"
            v-model="pathInput"
            class="path-input"
            spellcheck="false"
            @keydown.enter="commitPathEdit($event)"
            @keydown.esc.prevent="pathEditing = false"
            @blur="commitPathEdit"
          />
          <div v-else class="crumbs" :title="tt('sfp.editPath')" @dblclick="startPathEdit">
            <template v-for="(c, i) in crumbs" :key="c.full">
              <button class="crumb" :class="{ last: i === crumbs.length - 1 }" @click="load(c.full)">{{ c.label }}</button>
              <Icon v-if="i < crumbs.length - 1" name="chevron-right" :size="12" class="sep" />
            </template>
          </div>
          <button v-if="!pathEditing" class="ib sm" :title="tt('sfp.editPath')" @click="startPathEdit"><Icon name="edit" :size="13" /></button>
          <button class="ib sm" :class="{ active: bookmarksMenu.open, starred: store.sftpBookmarks.includes(path) }" :title="tt('sfp.bookmarks')" @click.stop="openBookmarks">
            <Icon name="book" :size="13" />
          </button>
        </div>
      </div>
      <div class="tools">
        <button class="ib" :title="tt('sfp.refresh')" :disabled="loading" @click="load(path)"><Icon name="refresh" :size="15" /></button>
        <button class="ib" :title="tt('sfp.newFolder')" @click="startCreate('folder')"><Icon name="folder-plus" :size="15" /></button>
        <button class="ib" :class="{ active: localOpen }" :title="tt('sfp.local')" @click="toggleLocal"><Icon name="split" :size="15" /></button>
        <button class="ib" :class="{ active: moreMenu.open }" :title="tt('sfp.more')" @click.stop="openMore"><Icon name="more-horizontal" :size="15" /></button>
        <button v-if="page" class="btn btn-primary pill up-btn" :disabled="busy" @click="uploadPick"><Icon name="upload" :size="14" />{{ tt('sfp.upload') }}</button>
        <button v-else class="ib" :title="tt('sfp.upload')" :disabled="busy" @click="uploadPick"><Icon name="upload" :size="15" /></button>
        <button v-if="!page" class="ib" :title="tt('sfp.close')" @click="emit('close')"><Icon name="close" :size="15" /></button>
      </div>
    </header>

    <div v-if="showResume && (store.transferQueue.length || store.downloadQueue.length)" class="resume-bar">
      <template v-if="store.transferQueue.length">
        <Icon name="upload" :size="14" />
        <span class="grow">{{ tt('sfp.resumeHint', { n: store.transferQueue.length }) }}</span>
        <button class="btn sm btn-primary" @click="resumePending">{{ tt('sfp.resume') }}</button>
        <button class="btn sm" @click="store.clearTransferQueue(); showResume = store.downloadQueue.length > 0">{{ tt('sfp.discard') }}</button>
      </template>
      <template v-if="store.downloadQueue.length">
        <Icon name="download" :size="14" />
        <span class="grow">{{ tt('sfp.resumeDownloadHint', { n: store.downloadQueue.length }) }}</span>
        <button class="btn sm btn-primary" @click="resumeDownloads">{{ tt('sfp.resumeDownload') }}</button>
        <button class="btn sm" @click="store.clearDownloadQueue(); showResume = store.transferQueue.length > 0">{{ tt('sfp.discard') }}</button>
      </template>
    </div>

    <div class="panes">
      <!-- ---- 远程 ---- -->
      <section class="pane remote">
        <div class="pane-head">
          <OsIcon v-if="page" :os="sessionHost?.os" :color="sessionHost?.color" :size="26" />
          <div v-if="page" class="ph-text">
            <span class="ph-title">{{ sessionHost?.label || sessionPane?.params.host || tt('sfp.files') }}</span>
            <span v-if="sessionPane" class="ph-sub">{{ sessionPane.params.username }}@{{ sessionPane.params.host }}</span>
          </div>
          <label class="filter">
            <Icon name="search" :size="13" />
            <input v-model="filterText" :placeholder="tt('sfp.filterPh')" spellcheck="false" @keydown.esc.stop="filterText = ''" />
            <button v-if="filterText" class="filter-x" @click="filterText = ''"><Icon name="close" :size="10" /></button>
          </label>
        </div>
        <div v-if="dragOver" class="drop-veil">
          <span class="dv-icon"><Icon name="upload" :size="24" /></span>
          <span>{{ tt('sfp.dropTo', { path }) }}</span>
        </div>
        <div class="cols">
          <span class="c-ic" />
          <button class="col c-name" :class="{ on: sort.key === 'name' }" @click="setSort('name')">
            {{ tt('sfp.name') }}<Icon v-if="sort.key === 'name'" :name="sort.asc ? 'chevron-up' : 'chevron-down'" :size="12" />
          </button>
          <button class="col c-size" :class="{ on: sort.key === 'size' }" @click="setSort('size')">
            {{ tt('sfp.size') }}<Icon v-if="sort.key === 'size'" :name="sort.asc ? 'chevron-up' : 'chevron-down'" :size="12" />
          </button>
          <button class="col c-time" :class="{ on: sort.key === 'mtime' }" @click="setSort('mtime')">
            {{ tt('sfp.mtime') }}<Icon v-if="sort.key === 'mtime'" :name="sort.asc ? 'chevron-up' : 'chevron-down'" :size="12" />
          </button>
        </div>

        <div ref="bodyEl" class="body" @mousedown="onBodyMousedown" @contextmenu="openMenu($event, null)">
          <div v-if="error" class="msg err"><Icon name="alert-triangle" :size="18" /><span>{{ error }}</span></div>
          <div v-else-if="loading" class="msg"><span class="spinner" /></div>
          <template v-else>
            <div v-if="creatingKind" class="row editing">
              <span class="ic" :class="{ folder: creatingKind === 'folder' }"><Icon :name="creatingKind === 'folder' ? 'folder' : 'file'" :size="15" /></span>
              <input
                ref="editEl"
                v-model="newName"
                class="edit-input"
                :placeholder="creatingKind === 'folder' ? tt('sfp.folderName') : tt('sfp.fileName')"
                @keydown.enter="commitCreate($event)"
                @keydown.esc.prevent="creatingKind = null"
                @blur="commitCreate"
              />
            </div>
            <div
              v-for="entry in sorted"
              :key="entry.name"
              class="row"
              :class="{ dir: entry.isDir, sel: selected.has(entry.name) }"
              :data-name="entry.name"
              :title="permTitle(entry)"
              draggable="true"
              @mousedown="onRemoteMouseDown($event, entry)"
              @click="onRowClick(entry, $event)"
              @dblclick="onRowDblClick(entry)"
              @contextmenu="openMenu($event, entry)"
              @dragstart="onDragStart($event, entry)"
            >
              <span class="ic" :class="'k-' + kindOf(entry)"><Icon :name="KIND_ICON[kindOf(entry)]" :size="15" /></span>
              <input
                v-if="renamingName === entry.name"
                ref="editEl"
                v-model="renameInput"
                class="edit-input"
                @click.stop
                @keydown.enter="commitRename(entry, $event)"
                @keydown.esc.prevent="renamingName = null"
                @blur="commitRename(entry)"
              />
              <template v-else>
                <span class="name">{{ entry.name }}</span>
                <span class="size">{{ entry.isDir ? '' : fmtSize(entry.size) }}</span>
                <span class="mtime">{{ fmtTime(entry.mtime) }}</span>
                <!-- Hover shortcuts, so the common actions don't need the context menu. -->
                <span class="row-acts" @mousedown.stop @dblclick.stop>
                  <button :title="tt('sfp.download')" @click.stop="localActive = false; selectOne(entry.name); downloadSelected()"><Icon name="download" :size="13" /></button>
                  <button :title="tt('sfp.rename')" @click.stop="localActive = false; startRename(entry)"><Icon name="edit" :size="13" /></button>
                  <button class="danger" :title="tt('sfp.delete')" @click.stop="localActive = false; selectOne(entry.name); delSelected()"><Icon name="trash" :size="13" /></button>
                </span>
              </template>
            </div>
            <div v-if="!sorted.length && !creatingKind" class="msg"><Icon name="folder-open" :size="22" /><span>{{ tt('sfp.empty') }}</span></div>
          </template>
          <div v-if="marquee.active" class="marquee" :style="marqueeStyle" />
        </div>

        <div v-if="activeTransfers.length" class="transfers">
          <div v-for="t in activeTransfers" :key="t.id" class="tf" :class="{ err: !!t.error && !isCancelled(t), cancelled: isCancelled(t) }">
            <Icon :name="t.direction === 'up' ? 'upload' : 'download'" :size="14" class="tf-dir" />
            <div class="tf-main">
              <div class="tf-top">
                <span class="tf-name">{{ t.name }}</span>
                <span v-if="t.count && t.count > 1 && !t.done && !t.error" class="tf-count">{{ t.index }}/{{ t.count }}</span>
                <span class="tf-pct">{{ statusText(t) }}</span>
              </div>
              <div class="tf-bar"><div class="fill" :class="{ done: t.done }" :style="{ width: (t.done ? 100 : pct(t)) + '%' }" /></div>
              <div v-if="!t.done && !t.error && t.total > 0" class="tf-sub">
                <span>{{ fmtSize(t.transferred) }} / {{ fmtSize(t.total) }}</span>
                <span v-if="fmtSpeed(t.id)" class="tf-speed">{{ fmtSpeed(t.id) }}</span>
              </div>
            </div>
            <button v-if="!t.done && !t.error" class="ib sm" :title="tt('sfp.cancelTransfer')" @click="cancelTransfer(t.id)"><Icon name="close" :size="12" /></button>
          </div>
        </div>
        <div v-else class="foot">
          <span class="foot-count">
            {{ sorted.length }} {{ tt('sfp.items') }}<template v-if="selCount"> · {{ tt('sfp.selected', { n: selCount }) }}<template v-if="selSize"> · {{ fmtSize(selSize) }}</template></template>
          </span>
          <span class="foot-hint"><Icon name="upload" :size="12" />{{ tt('sfp.footDrop') }}</span>
        </div>
      </section>

      <!-- ---- Between the panes: send the selection across ---- -->
      <div v-if="page && localOpen" class="gutter">
        <button class="send" :disabled="!localSelCount || !props.sessionId" :title="tt('sfp.sendRight')" @click="uploadLocalSelection">
          <Icon name="arrow-right" :size="15" />
        </button>
        <button class="send" :disabled="!selCount || !props.sessionId" :title="tt('sfp.sendLeft')" @click="downloadSelectionToLocal">
          <Icon name="arrow-left" :size="15" />
        </button>
      </div>

      <!-- ---- 本机 ---- -->
      <section v-if="localOpen" class="pane local" @click="localActive = true" @dragover.prevent @drop.prevent.stop="onLocalDrop">
        <div class="pane-bar" @click="localActive = false">
          <!-- Page: the same head as the remote card (tile + name over path). -->
          <template v-if="page">
            <span class="local-tile"><Icon name="monitor" :size="15" /></span>
            <div class="ph-text">
              <span class="ph-title">{{ tt('sfp.localTitle') }}</span>
              <span class="ph-sub local-path" :title="localPath">{{ localPath }}</span>
            </div>
            <button class="ib sm" :title="tt('sfp.upLevel')" :disabled="localLoading" @click="localGoUp"><Icon name="arrow-up" :size="14" /></button>
          </template>
          <template v-else>
            <span class="pb-title">{{ tt('sfp.localTitle') }}</span>
            <button class="ib sm" :title="tt('sfp.upLevel')" :disabled="localLoading" @click="localGoUp"><Icon name="arrow-up" :size="14" /></button>
            <span class="local-path" :title="localPath">{{ localPath }}</span>
          </template>
          <label class="pattern" :class="{ bad: !!localPatternErr }" :title="localPatternErr || ''">
            <Icon name="search" :size="12" />
            <input v-model="localPattern" :placeholder="tt('sfp.patternPh')" spellcheck="false" @keyup.enter="selectByPattern($event)" />
          </label>
          <button class="ib sm" :title="tt('sfp.selectAll')" @click="localSelectAll"><Icon name="check-all" :size="14" /></button>
          <button class="ib sm" :title="tt('sfp.deploy')" :disabled="!localSelCount || !props.sessionId" @click="openDeploy"><Icon name="send" :size="14" /></button>
          <button class="ib sm" :title="tt('sfp.newFile')" @click="localNew('file')"><Icon name="plus" :size="14" /></button>
          <button class="ib sm" :title="tt('sfp.newFolder')" @click="localNew('folder')"><Icon name="folder-plus" :size="14" /></button>
          <button class="ib sm" :title="tt('sfp.refresh')" :disabled="localLoading" @click="refreshLocal()"><Icon name="refresh" :size="14" /></button>
        </div>
        <div class="cols">
          <span class="c-ic" />
          <!-- Same header as the remote pane: highlighted column + chevron. -->
          <button
            v-for="c in (['name', 'size', 'mtime'] as const)"
            :key="c"
            class="col"
            :class="[{ name: 'c-name', size: 'c-size', mtime: 'c-time' }[c], { on: localSort.key === c }]"
            @click="setLocalSort(c)"
          >
            {{ c === 'name' ? tt('sfp.name') : c === 'size' ? tt('sfp.size') : tt('sfp.mtime') }}<Icon
              v-if="localSort.key === c"
              :name="localSort.asc ? 'chevron-up' : 'chevron-down'"
              :size="12"
            />
          </button>
        </div>
        <div class="body localbody">
          <div v-if="localError" class="msg err"><Icon name="alert-triangle" :size="18" /><span>{{ localError }}</span></div>
          <div v-else-if="localLoading" class="msg"><span class="spinner" /></div>
          <template v-else>
            <div
              v-for="entry in localSorted"
              :key="entry.name"
              class="row"
              :class="{ dir: entry.isDir, sel: localSelSet.has(entry.name) }"
              draggable="true"
              @dragstart="localDragStart($event, entry)"
              @click.stop="localSelect(entry, $event)"
              @contextmenu.stop.prevent="localMenuOpen($event, entry)"
              @dblclick="localEnter(entry)"
            >
              <span class="ic" :class="'k-' + kindOf(entry)"><Icon :name="KIND_ICON[kindOf(entry)]" :size="15" /></span>
              <span class="name">{{ entry.name }}</span>
              <span class="size">{{ entry.isDir ? '' : fmtSize(entry.size ?? 0) }}</span>
              <span class="mtime">{{ fmtLocalTime(entry.mtime) }}</span>
            </div>
            <div v-if="!localEntries.length" class="msg"><Icon name="folder-open" :size="22" /><span>{{ tt('sfp.empty') }}</span></div>
            <button class="new-here" @click.prevent="localNew('folder')"><Icon name="folder-plus" :size="13" />{{ tt('sfp.newFolderHere') }}</button>
          </template>
        </div>
        <div class="foot">
          <span class="foot-count">
            {{ localSorted.length }} {{ tt('sfp.items') }}<template v-if="localSelCount"> · {{ tt('sfp.selected', { n: localSelCount }) }}</template>
          </span>
        </div>
      </section>
    </div>

    <!-- ================= Menus ================= -->
    <div v-if="moreMenu.open" class="ctx-overlay" @mousedown="moreMenu.open = false" @contextmenu.prevent="moreMenu.open = false">
      <div class="ctx more-menu" :style="{ left: moreMenu.x + 'px', top: moreMenu.y + 'px' }" @mousedown.stop>
        <button @click="runMore(() => startCreate('folder'))"><Icon name="folder-plus" :size="15" /><span>{{ tt('sfp.newFolder') }}</span></button>
        <button @click="runMore(() => startCreate('file'))"><Icon name="file" :size="15" /><span>{{ tt('sfp.newFile') }}</span></button>
        <div class="sep-line" />
        <button @click="runMore(uploadDirPick)"><Icon name="folder-up" :size="15" /><span>{{ tt('sfp.uploadDir') }}</span></button>
        <button @click="runMore(uploadExtractPick)"><Icon name="zip" :size="15" /><span>{{ tt('sfp.uploadExtract') }}</span></button>
        <button @click="runMore(packDownloadSelected)"><Icon name="archive" :size="15" /><span>{{ tt('sfp.packDownload') }}</span></button>
        <div class="sep-line" />
        <button @click="runMore(openSyncDialog)"><Icon name="sync" :size="15" /><span>{{ tt('sfp.sync') }}<template v-if="watchActive"> · {{ tt('sfp.syncOn') }}</template></span></button>
        <button v-if="watchActive" @click="runMore(stopWatch)"><Icon name="pause" :size="15" /><span>{{ tt('sfp.syncWatchStop') }}</span></button>
        <button @click="runMore(openDirDiff)"><Icon name="diff" :size="15" /><span>{{ tt('sfp.dirDiff') }}</span></button>
        <div class="sep-line" />
        <button @click="runMore(toggleHidden)"><Icon name="eye" :size="15" /><span>{{ showHidden ? tt('sfp.toggleHiddenHide') : tt('sfp.toggleHiddenShow') }}</span></button>
        <button v-if="hasTermCwd" @click="runMore(gotoTerminalDir)"><Icon name="terminal" :size="15" /><span>{{ tt('sfp.gotoTerminal') }}</span></button>
        <button @click="runMore(openHistory)"><Icon name="clock" :size="15" /><span>{{ tt('sfp.history') }}{{ activeHistory.length ? ` (${activeHistory.length})` : '' }}</span></button>
      </div>
    </div>

    <div v-if="historyMenu.open" class="ctx-overlay" @mousedown="historyMenu.open = false" @contextmenu.prevent="historyMenu.open = false">
      <div class="ctx hist-menu" :style="{ left: historyMenu.x + 'px', top: historyMenu.y + 'px' }" @mousedown.stop>
        <div class="menu-head">
          <span>{{ tt('sfp.history') }}</span>
          <button v-if="activeHistory.length" class="link" @click="clearHistory">{{ tt('sfp.clear') }}</button>
        </div>
        <div v-if="!activeHistory.length" class="menu-empty">{{ tt('sfp.histEmpty') }}</div>
        <div v-for="h in activeHistory" :key="h.id" class="hist-row">
          <Icon :name="h.direction === 'up' ? 'upload' : 'download'" :size="13" class="hist-dir" :class="h.status" />
          <span class="hist-name" :title="h.name">{{ h.name }}</span>
          <span class="hist-meta" :class="h.status">
            {{ h.status === 'done' ? fmtSize(h.bytes) : h.status === 'cancelled' ? tt('sfp.cancelled') : (h.error || tt('sfp.failed')) }}
          </span>
          <span class="hist-time">{{ fmtAgo(h.at) }}</span>
          <button v-if="h.remoteDir && props.sessionId" class="hist-act" :title="tt('sfp.locate')" @click.stop="locateHistory(h)"><Icon name="folder" :size="12" /></button>
          <button v-if="canReveal(h)" class="hist-act" :title="tt('sfp.reveal')" @click.stop="revealHistory(h)"><Icon name="folder-open" :size="12" /></button>
          <button v-if="canRetry(h)" class="hist-act" :title="tt('sfp.retry')" @click.stop="retryHistory(h)"><Icon name="refresh" :size="12" /></button>
          <button class="hist-act del" :title="tt('sfp.delHistory')" @click.stop="removeHistory(h)"><Icon name="trash" :size="12" /></button>
        </div>
      </div>
    </div>

    <div v-if="bookmarksMenu.open" class="ctx-overlay" @mousedown="bookmarksMenu.open = false" @contextmenu.prevent="bookmarksMenu.open = false">
      <div class="ctx bm-menu" :style="{ left: bookmarksMenu.x + 'px', top: bookmarksMenu.y + 'px' }" @mousedown.stop>
        <div class="menu-head">
          <span>{{ tt('sfp.bookmarks') }}</span>
          <button class="link" @click="toggleBookmarkCurrent">{{ store.sftpBookmarks.includes(path) ? tt('sfp.unbookmark') : tt('sfp.addBookmark') }}</button>
        </div>
        <div v-if="!store.sftpBookmarks.length" class="menu-empty">{{ tt('sfp.noBookmarks') }}</div>
        <button v-for="b in store.sftpBookmarks" :key="b" class="bm-item" @click="jumpBookmark(b)">
          <Icon name="folder" :size="13" />
          <span class="bm-path">{{ b }}</span>
          <Icon name="close" :size="12" class="rm" @click.stop="store.toggleSftpBookmark(b)" />
        </button>
        <template v-if="store.sftpRecent.length">
          <div class="menu-head sub">
            <span>{{ tt('sfp.recent') }}</span>
          </div>
          <button v-for="b in store.sftpRecent" :key="b" class="bm-item" @click="jumpBookmark(b)">
            <Icon name="clock" :size="13" />
            <span class="bm-path">{{ b }}</span>
          </button>
        </template>
      </div>
    </div>

    <div v-if="localMenu.open" class="ctx-overlay" @mousedown="localMenu.open = false" @contextmenu.prevent="localMenu.open = false">
      <div class="ctx loc-menu" :style="{ left: localMenu.x + 'px', top: localMenu.y + 'px' }" @mousedown.stop>
        <div class="menu-head"><span class="ellipsis">{{ localMenu.target?.name }}</span></div>
        <button @click="localRename"><Icon name="edit" :size="14" /><span>{{ tt('sfp.rename') }}</span></button>
        <button class="danger" @click="localDelete"><Icon name="trash" :size="14" /><span>{{ tt('sfp.delete') }}</span></button>
      </div>
    </div>

    <div v-if="menu.open" class="ctx-overlay" @mousedown="closeMenu" @contextmenu.prevent="closeMenu">
      <div class="ctx file-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @mousedown.stop>
        <template v-if="menu.target">
          <button @click="runMenu(downloadSelected)"><Icon name="download" :size="14" /><span>{{ tt('sfp.download') }}{{ selCount > 1 ? ` (${selCount})` : '' }}</span></button>
          <template v-if="selCount === 1 && !menu.target.isDir">
            <button v-if="isImage(menu.target as FileEntry)" @click="runMenu(() => previewFile(menu.target as FileEntry))"><Icon name="eye" :size="14" /><span>{{ tt('sfp.preview') }}</span></button>
            <button @click="runMenu(() => editFile(menu.target as FileEntry, false))"><Icon name="edit" :size="14" /><span>{{ tt('sfp.edit') }}</span></button>
            <button @click="runMenu(() => editFile(menu.target as FileEntry, true))"><Icon name="code" :size="14" /><span>{{ tt('sfp.openExternal') }}</span></button>
            <button @click="runMenu(() => openWith(menu.target as FileEntry))"><Icon name="folder-open" :size="14" /><span>{{ tt('sfp.openWith') }}</span></button>
            <button @click="runMenu(() => diffWithLocal(menu.target as FileEntry))"><Icon name="diff" :size="14" /><span>{{ tt('sfp.diffLocal') }}</span></button>
          </template>
          <button v-if="selCount === 1 && menu.target.isDir" @click="runMenu(() => cdTerminalTo(menu.target as FileEntry))"><Icon name="terminal" :size="14" /><span>{{ tt('sfp.openInTerminal') }}</span></button>
          <div class="sep-line" />
          <button @click="runMenu(copySelectedPaths)"><Icon name="copy" :size="14" /><span>{{ tt('sfp.copyPath') }}</span></button>
          <button @click="runMenu(openPerm)"><Icon name="lock" :size="14" /><span>{{ tt('sfp.perm') }}{{ selCount > 1 ? ` (${selCount})` : '' }}</span></button>
          <button v-if="selCount === 1" @click="runMenu(() => startRename(menu.target as FileEntry))"><Icon name="edit" :size="14" /><span>{{ tt('sfp.rename') }}</span></button>
          <div class="sep-line" />
          <button class="danger" @click="runMenu(delSelected)"><Icon name="trash" :size="14" /><span>{{ tt('sfp.delete') }}{{ selCount > 1 ? ` (${selCount})` : '' }}</span></button>
        </template>
        <template v-else>
          <button @click="runMenu(() => startCreate('folder'))"><Icon name="folder-plus" :size="14" /><span>{{ tt('sfp.newFolder') }}</span></button>
          <button @click="runMenu(() => startCreate('file'))"><Icon name="file" :size="14" /><span>{{ tt('sfp.newFile') }}</span></button>
          <div class="sep-line" />
          <button @click="runMenu(uploadPick)"><Icon name="upload" :size="14" /><span>{{ tt('sfp.upload') }}</span></button>
          <button @click="runMenu(uploadDirPick)"><Icon name="folder-up" :size="14" /><span>{{ tt('sfp.uploadDir') }}</span></button>
          <div class="sep-line" />
          <button @click="runMenu(() => load(path))"><Icon name="refresh" :size="14" /><span>{{ tt('sfp.refresh') }}</span></button>
        </template>
      </div>
    </div>

    <!-- ================= Dialogs ================= -->
    <div v-if="localModal.open" class="dlg-layer" @mousedown.self="localModal.open = false">
      <div ref="localDlgEl" class="dlg small" tabindex="-1">
        <h3>{{ localModal.action === 'new' ? (localModal.kind === 'folder' ? tt('sfp.newFolder') : tt('sfp.newFile')) : tt('sfp.rename') }}</h3>
        <input
          ref="localInput"
          v-model="localModal.value"
          class="box"
          :placeholder="localModal.kind === 'folder' ? tt('sfp.folderName') : tt('sfp.fileName')"
          @keydown.enter="localSubmit($event)"
          @keydown.esc="localModal.open = false"
        />
        <p v-if="localModal.error" class="dlg-err">{{ localModal.error }}</p>
        <div class="dlg-foot">
          <button class="btn" @click="localModal.open = false">{{ tt('sfp.cancel') }}</button>
          <button class="btn btn-primary" :disabled="localSubmitting" @click="localSubmit">{{ tt('sfp.ok') }}</button>
        </div>
      </div>
    </div>

    <PermDialog
      v-if="perm.open && props.sessionId"
      :session-id="props.sessionId"
      :dir="path"
      :targets="perm.targets"
      :initial-mode="perm.initialMode"
      @close="onPermClose"
    />

    <div v-if="sync.open" class="dlg-layer" @mousedown.self="closeSync">
      <div ref="syncDlgEl" class="dlg" tabindex="-1" @keydown.esc="closeSync" @keydown="onSyncEnter">
        <div class="dlg-head">
          <h3>{{ tt('sfp.sync') }}</h3>
          <button class="ib sm" :title="tt('sfp.close')" @click="closeSync"><Icon name="close" :size="14" /></button>
        </div>
        <div class="dlg-card">
          <label class="dlg-row">
            <span>{{ tt('sfp.syncLocal') }}</span>
            <input v-model="sync.local" class="box mono" spellcheck="false" />
          </label>
          <label class="dlg-row">
            <span>{{ tt('sfp.syncRemote') }}</span>
            <input v-model="sync.remote" class="box mono" spellcheck="false" />
          </label>
          <label class="dlg-row">
            <span>{{ tt('sfp.syncMode') }}</span>
            <select v-model="sync.mode" class="box">
              <option value="both">{{ tt('sfp.syncBoth') }}</option>
              <option value="up">{{ tt('sfp.syncUp') }}</option>
              <option value="down">{{ tt('sfp.syncDown') }}</option>
            </select>
          </label>
          <label class="dlg-check">
            <input v-model="sync.watch" type="checkbox" />
            <span>{{ tt('sfp.syncWatch') }}</span>
          </label>
          <label v-if="sync.watch" class="dlg-row">
            <span>{{ tt('sfp.syncWatchInterval') }}</span>
            <input v-model.number="sync.interval" class="box mono num" type="number" min="1" max="3600" />
          </label>
          <label v-if="sync.mode !== 'both'" class="dlg-check">
            <input v-model="sync.del" type="checkbox" />
            <span>{{ tt('sfp.syncDelete') }}</span>
          </label>
        </div>
        <p v-if="!sync.local || !sync.remote" class="dlg-err">{{ tt('sfp.syncPathsRequired') }}</p>
        <p v-if="sync.error" class="dlg-err">{{ sync.error }}</p>
        <div class="dlg-foot">
          <button class="btn" @click="closeSync">{{ tt('sfp.cancel') }}</button>
          <button class="btn btn-primary" :disabled="sync.busy || !sync.local || !sync.remote" @click="startSync">
            {{ sync.watch ? tt('sfp.syncWatchStart') : tt('sfp.syncStart') }}
          </button>
        </div>
      </div>
    </div>

    <DirDiffDialog
      v-if="dirDiff.open && props.sessionId"
      :session-id="props.sessionId"
      :local-path="dirDiff.local"
      :remote-path="dirDiff.remote"
      @close="dirDiff.open = false"
    />

    <div v-if="deploy.open" class="dlg-layer" @mousedown.self="closeDeploy">
      <div ref="deployDlgEl" class="dlg" tabindex="-1" @keydown.esc="closeDeploy">
        <div class="dlg-head">
          <h3>{{ tt('sfp.deploy') }}</h3>
          <button class="ib sm" :title="tt('sfp.close')" @click="closeDeploy"><Icon name="close" :size="14" /></button>
        </div>
        <div class="dlg-card">
          <label class="dlg-row">
            <span>{{ tt('sfp.deployLocal') }}</span>
            <input class="box mono" :value="`${localPath} · ${localSelCount} ${tt('sfp.items')}`" disabled spellcheck="false" />
          </label>
          <label class="dlg-row">
            <span>{{ tt('sfp.deployRemote') }}</span>
            <input class="box mono" :value="path" disabled spellcheck="false" />
          </label>
          <label class="dlg-row top">
            <span>{{ tt('sfp.deployCmd') }}</span>
            <textarea
              v-model="deploy.cmd"
              class="box mono ta"
              rows="3"
              spellcheck="false"
              :placeholder="tt('sfp.deployCmdPh')"
              @keydown="onDeployKey"
            />
          </label>
        </div>
        <p v-if="!deploy.cmd.trim()" class="dlg-err">{{ tt('sfp.deployCmdReq') }}</p>
        <p v-if="deploy.error" class="dlg-err">{{ deploy.error }}</p>
        <div class="dlg-foot">
          <button class="btn" @click="closeDeploy">{{ tt('sfp.cancel') }}</button>
          <button class="btn btn-primary" :disabled="deploy.busy || !deploy.cmd.trim()" @click="runDeploy">
            {{ deploy.busy ? tt('sfp.deploying') : tt('sfp.deployRun') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="preview.open" class="dlg-layer" @mousedown.self="closePreview">
      <div ref="previewDlgEl" class="dlg preview" tabindex="-1" @keydown.esc="closePreview">
        <div class="dlg-head">
          <h3 class="ellipsis">{{ preview.name }}</h3>
          <button class="ib sm" :title="tt('sfp.close')" @click="closePreview"><Icon name="close" :size="14" /></button>
        </div>
        <div class="pv-body">
          <img v-if="preview.url" :src="preview.url" class="pv-img" alt="" />
          <p v-else class="dlg-err">{{ preview.error }}</p>
        </div>
      </div>
    </div>

    <FileDiff
      v-if="diff.open"
      :remote-name="diff.remoteName"
      :remote-content="diff.remoteContent"
      :local-name="diff.localName"
      :local-content="diff.localContent"
      @close="diff.open = false"
    />
  </aside>
</template>

<style scoped>
/* ============ Frame ============ */
.sftp {
  display: flex;
  flex-direction: column;
  outline: none;
}
/* Page: toolbar on the page background, panes as cards. */
.sftp.page {
  position: relative;
  height: 100%;
  gap: 12px;
}
/* Drawer: a flat column on the right of the terminal page. */
.sftp.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  background: var(--bg-elev);
  border-left: 1px solid var(--border);
  box-shadow: -12px 0 34px -14px rgba(0, 0, 0, 0.45);
}
.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  z-index: 2;
  width: 6px;
  cursor: col-resize;
}
.resize-handle:hover {
  background: color-mix(in srgb, var(--accent) 45%, transparent);
}

/* ============ Toolbar ============ */
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.drawer .toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: 'title tools' 'nav nav';
  row-gap: 8px;
  padding: 10px 10px 10px 14px;
  border-bottom: 1px solid var(--border);
}
.bar-title {
  grid-area: title;
  font-size: 13px;
  font-weight: 600;
}
.nav-grp {
  grid-area: nav;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.tools {
  grid-area: tools;
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
}
/* Path: a filled field holding the breadcrumb (or the typed path while editing). */
.path-field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  margin-left: 4px;
  padding: 0 4px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  transition: border-color 0.16s var(--ease), box-shadow 0.16s var(--ease);
}
.drawer .path-field {
  height: 30px;
  background: var(--bg);
}
.path-field.editing {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}
.crumbs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
}
.crumb {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 180px;
  height: 26px;
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: var(--r-pill);
  font-size: 13px;
  color: var(--text-dim);
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.crumb:hover {
  background: var(--hover);
  color: var(--text);
}
.crumb.last {
  flex-shrink: 0;
  color: var(--text);
  font-weight: 600;
}
.crumbs .sep {
  flex: none;
  color: var(--text-faint);
}
.path-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 8px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text);
  background: none;
  border: none;
  outline: none;
}

/* Icon buttons: capsules, same hover / selected language as the sidebar. */
.ib {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r-pill);
  color: var(--text-dim);
  transition: background 0.16s var(--ease), color 0.16s var(--ease), transform 0.12s var(--ease);
}
.drawer .ib {
  width: 28px;
  height: 28px;
}
.ib.sm,
.drawer .ib.sm {
  width: 26px;
  height: 26px;
}
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.ib:active:not(:disabled) {
  background: var(--selected);
  transform: scale(0.94);
}
.ib.active {
  background: var(--selected);
  color: var(--accent);
}
.ib.starred {
  color: var(--accent);
}
.ib:disabled {
  opacity: 0.35;
  cursor: default;
}

/* Interrupted transfers from last time. */
.resume-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 14px;
  font-size: 12.5px;
  color: var(--text-dim);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: var(--r-menu);
}
.resume-bar :deep(svg) {
  flex: none;
  color: var(--accent);
}
.drawer .resume-bar {
  border-radius: 0;
  border-width: 0 0 1px;
}
.btn.sm {
  height: 28px;
  padding: 0 11px;
  font-size: 12.5px;
}

/* ============ Panes ============ */
.panes {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 16px;
}
.drawer .panes {
  flex-direction: column;
  gap: 0;
}
.pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  overflow: hidden;
  container-type: inline-size;
}
/* Local on the left, remote on the right (the usual two-pane order). */
.pane.local {
  order: -1;
}
.pane.remote {
  position: relative;
  order: 1;
}
/* Pane head: which machine (page) and the filter box. */
.pane-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}
.drawer .pane-head {
  height: 44px;
  padding: 0 10px;
}
.pane-head :deep(.os-tile) {
  border-radius: 8px;
}
.ph-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ph-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  font-weight: 600;
}
.ph-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-faint);
}
.filter {
  flex: 0 1 220px;
  min-width: 120px;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  margin-left: auto;
  padding: 0 10px;
  color: var(--text-faint);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  transition: border-color 0.16s var(--ease);
}
.drawer .filter {
  flex: 1;
}
.filter:focus-within {
  border-color: var(--accent);
}
.filter input {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--text);
  background: none;
  border: none;
  outline: none;
}
.filter-x {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--r-pill);
  color: var(--bg);
  background: var(--text-faint);
}
.local-tile {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: var(--text-dim);
  background: var(--selected);
}
/* Page: the local pattern box matches the remote filter box; the name / path
   keep at least 80px (the pattern box gives way first), and the path line
   reads like the remote card's user@host line. */
.page .pattern {
  height: 30px;
  flex: 0 1 150px;
  min-width: 60px;
}
.page .pane-bar .ph-text {
  flex: 1 1 120px;
  min-width: 80px;
}
.page .ph-sub.local-path {
  font-size: 11.5px;
  color: var(--text-faint);
}
.page .pane-bar {
  gap: 10px;
}
.pb-title {
  flex: none;
  margin-right: 2px;
  font-size: 13px;
  font-weight: 600;
}
.up-btn {
  margin-left: 6px;
}
/* Between the panes: two arrows that send the selection across. */
.gutter {
  flex: none;
  order: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  margin: 0 -6px;
}
.send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--r-pill);
  color: var(--text-dim);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  transition: color 0.16s var(--ease), background 0.16s var(--ease), border-color 0.16s var(--ease), transform 0.12s var(--ease);
}
.send:hover:not(:disabled) {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: var(--accent-soft);
}
.send:active:not(:disabled) {
  transform: scale(0.92);
}
.send:disabled {
  opacity: 0.35;
  cursor: default;
}
.drawer .pane {
  border: none;
  border-radius: 0;
  background: transparent;
}
.drawer .pane.local {
  flex: none;
  max-height: 45%;
  border-bottom: 1px solid var(--border);
}
.pane-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 52px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}
.drawer .pane-bar {
  height: 44px;
  padding: 0 10px;
}
.local-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-dim);
}
.pattern {
  flex: 0 1 150px;
  min-width: 90px;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  color: var(--text-faint);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  transition: border-color 0.16s var(--ease);
}
.pattern:focus-within {
  border-color: var(--accent);
}
.pattern.bad {
  border-color: var(--danger);
}
.pattern input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text);
  background: none;
  border: none;
  outline: none;
}

/* Column header and rows share one grid: icon · name · size · modified. */
.cols,
.row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 84px 148px;
  align-items: center;
  column-gap: 10px;
}
.cols {
  flex: none;
  height: 34px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}
.col {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  font-size: 11.5px;
  color: var(--text-faint);
  text-align: left;
  transition: color 0.16s var(--ease);
}
.col:hover,
.col.on {
  color: var(--text);
}
.c-size {
  justify-content: flex-end;
}
@container (max-width: 440px) {
  .cols,
  .row {
    grid-template-columns: 22px minmax(0, 1fr) 64px;
  }
  .c-time,
  .row .mtime {
    display: none;
  }
}

/* The remote body: scroll container and the marquee's positioning parent
   (the script hit-tests .row[data-name] inside it). */
.body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 6px;
}
.row {
  position: relative;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 13px;
  cursor: default;
  user-select: none;
  transition: background 0.1s;
}
.row:hover {
  background: var(--hover);
}
.row.sel {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}
.row.sel:hover {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
}
.ic {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
}
/* File-kind tones */
.ic.k-dir {
  color: var(--accent);
}
.ic.k-image {
  color: #3fb68b;
}
.ic.k-archive {
  color: #e0a43a;
}
.ic.k-code {
  color: #a78bfa;
}
.ic.k-exec {
  color: #4cc38a;
}
.ic.k-data {
  color: #38bdf8;
}
.ic.k-text {
  color: var(--text-dim);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.row.dir .name {
  font-weight: 500;
}
.size,
.mtime {
  overflow: hidden;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.size {
  text-align: right;
}
/* Hover shortcuts at the row's end (out of the grid flow). */
.row-acts {
  position: absolute;
  top: 50%;
  right: 6px;
  display: none;
  gap: 1px;
  padding: 2px;
  transform: translateY(-50%);
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  box-shadow: 0 4px 12px -6px rgba(0, 0, 0, 0.45);
}
.row:hover .row-acts {
  display: flex;
}
.row-acts button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  border-radius: var(--r-pill);
  color: var(--text-dim);
  transition: background 0.12s var(--ease), color 0.12s var(--ease);
}
.row-acts button:hover {
  color: var(--text);
  background: var(--hover);
}
.row-acts button.danger:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.edit-input {
  grid-column: 2 / -1;
  height: 26px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 6px;
  outline: none;
}
.row.editing {
  background: var(--hover);
}
.msg {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 56px 20px;
  font-size: 12.5px;
  text-align: center;
  color: var(--text-faint);
}
.msg.err {
  color: var(--danger);
}
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.marquee {
  position: absolute;
  pointer-events: none;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
  border-radius: 4px;
}
.new-here {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  margin: 6px 4px;
  padding: 0 10px;
  border-radius: var(--r-pill);
  font-size: 12px;
  color: var(--text-faint);
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.new-here:hover {
  color: var(--accent);
  background: var(--accent-soft);
}
/* Dropping files: the target pane lights up. */
.sftp.drag .pane.remote {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 60%, transparent);
  background: color-mix(in srgb, var(--accent) 4%, var(--bg-elev));
}

/* ============ Transfers ============ */
.transfers {
  flex: none;
  max-height: 40%;
  overflow-y: auto;
  padding: 6px;
  border-top: 1px solid var(--border);
}
.tf {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 10px;
  border-radius: 10px;
}
.tf + .tf {
  margin-top: 2px;
}
.tf-dir {
  flex: none;
  color: var(--accent);
}
.tf.err .tf-dir {
  color: var(--danger);
}
.tf-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tf-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
}
.tf-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tf-count,
.tf-pct {
  flex: none;
  font-size: 11.5px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.tf.err .tf-pct {
  color: var(--danger);
}
.tf-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.2s linear;
}
.fill.done {
  background: var(--ok);
}
.tf.err .fill {
  background: var(--danger);
}
.tf.cancelled {
  opacity: 0.6;
}
.tf-sub {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 34px;
  padding: 0 14px;
  font-size: 11.5px;
  color: var(--text-faint);
  border-top: 1px solid var(--border);
}
.foot-count {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.foot-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  white-space: nowrap;
}
/* Dragging files over: the whole remote pane becomes the drop target. */
.drop-veil {
  position: absolute;
  inset: 8px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 13px;
  color: var(--accent);
  background: color-mix(in srgb, var(--bg-elev) 88%, var(--accent));
  border: 2px dashed color-mix(in srgb, var(--accent) 60%, transparent);
  border-radius: 12px;
  pointer-events: none;
}
.dv-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: var(--r-pill);
  background: var(--accent-soft);
}

/* ============ Menus ============ */
.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
}
.ctx {
  position: fixed;
  min-width: 170px;
  max-width: 320px;
  padding: 5px;
  background-color: color-mix(in srgb, var(--bg-elev) 94%, transparent);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-menu);
  box-shadow: var(--shadow);
  animation: menu-in 0.12s var(--ease);
}
@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(-3px) scale(0.98);
  }
}
.ctx > button,
.bm-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--r-item);
  font-size: 13px;
  color: var(--text);
  text-align: left;
  white-space: nowrap;
  transition: background 0.12s var(--ease);
}
.ctx > button:hover,
.bm-item:hover {
  background: var(--accent-soft);
}
.ctx > button :deep(svg),
.bm-item > :deep(svg:first-child) {
  flex: none;
  color: var(--text-dim);
}
.ctx > button.danger,
.ctx > button.danger :deep(svg) {
  color: var(--danger);
}
.ctx > button.danger:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.sep-line {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
.more-menu {
  min-width: 176px;
}
.hist-menu {
  width: 300px;
  max-height: 60vh;
  overflow-y: auto;
}
.bm-menu {
  width: 220px;
  max-height: 60vh;
  overflow-y: auto;
}
.loc-menu {
  min-width: 170px;
}
.menu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 28px;
  padding: 0 6px 0 10px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-faint);
}
.menu-head.sub {
  margin-top: 4px;
  border-top: 1px solid var(--border);
  padding-top: 4px;
  height: 32px;
}
.link {
  height: 22px;
  padding: 0 8px;
  border-radius: var(--r-pill);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--accent);
}
.link:hover {
  background: var(--accent-soft);
}
.menu-empty {
  padding: 14px 10px;
  font-size: 12px;
  text-align: center;
  color: var(--text-faint);
}
.bm-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  font-size: 12px;
}
.bm-item .rm {
  flex: none;
  padding: 2px;
  border-radius: var(--r-pill);
  color: var(--text-faint);
  opacity: 0;
}
.bm-item:hover .rm {
  opacity: 1;
}
.bm-item .rm:hover {
  color: var(--danger);
}
.hist-row {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 6px 0 10px;
  border-radius: var(--r-item);
  font-size: 12px;
}
.hist-row:hover {
  background: var(--hover);
}
.hist-dir {
  flex: none;
  color: var(--ok);
}
.hist-dir.error,
.hist-dir.failed {
  color: var(--danger);
}
.hist-dir.cancelled {
  color: var(--text-faint);
}
.hist-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hist-meta {
  flex: none;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-faint);
}
.hist-meta.error,
.hist-meta.failed {
  color: var(--danger);
}
.hist-time {
  flex: none;
  font-size: 11px;
  color: var(--text-faint);
}
.hist-act {
  flex: none;
  display: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--r-pill);
  color: var(--text-faint);
}
.hist-row:hover .hist-act {
  display: flex;
}
.hist-act:hover {
  background: var(--hover);
  color: var(--text);
}
.hist-act.del:hover {
  color: var(--danger);
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grow {
  flex: 1;
  min-width: 0;
}
.mono {
  font-family: var(--font-mono);
}

/* ============ Dialogs ============ */
.dlg-layer {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.38);
}
.dlg {
  width: min(460px, 100%);
  padding: 18px;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.dlg.small {
  width: min(340px, 100%);
}
.dlg.preview {
  width: min(900px, 92vw);
}
.dlg h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}
.dlg.small h3 {
  margin-bottom: 12px;
}
.dlg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.dlg-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-menu);
}
.dlg-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  color: var(--text-dim);
}
.dlg-row.top {
  align-items: flex-start;
}
.dlg-row > span {
  flex: none;
  width: 92px;
}
.dlg-row.top > span {
  padding-top: 7px;
}
.dlg-row .box {
  flex: 1;
  min-width: 0;
}
.dlg-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 104px;
  font-size: 12.5px;
  color: var(--text-dim);
  cursor: pointer;
}
.dlg-check input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
}
.box {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  font-size: 12.5px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.16s var(--ease);
}
.box:focus {
  border-color: var(--accent);
}
.box:disabled {
  color: var(--text-dim);
  background: var(--bg-elev-2);
}
.box.num {
  flex: none !important;
  width: 96px;
}
.ta {
  height: auto;
  min-height: 72px;
  padding: 8px 10px;
  line-height: 1.5;
  resize: vertical;
}
.dlg-err {
  margin: 10px 2px 0;
  font-size: 12px;
  color: var(--danger);
}
.dlg-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.pv-body {
  display: flex;
  align-items: center;
  justify-content: center;
  max-height: 72vh;
  overflow: auto;
  padding: 8px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-menu);
}
.pv-img {
  max-width: 100%;
  max-height: 68vh;
  object-fit: contain;
}
</style>
