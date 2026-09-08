<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { FileEntry, LocalEntry, SftpProgress, TransferHistoryItem } from '../../../shared/types'
import { posixJoin, parentOf } from '../../../shared/fsUtils'
import { canRetryHistory, buildRetryItems, canRevealHistory } from '../lib/transferHistory'
import { useConfirm } from '../composables/confirm'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { useSessions } from '../stores/sessions'
import Icon from './Icon.vue'

const { confirm } = useConfirm()
const { t: tt } = useI18n()
const { toast } = useToast()
const store = useSessions()

const props = defineProps<{ sessionId?: string; open: boolean; terminalCwd?: string; reloadKey?: number }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'edit-file', payload: { path: string; name: string }): void
  (e: 'edit-external', payload: { path: string; name: string }): void
  (e: 'cd-terminal', path: string): void
}>()

const path = ref('')
const homePath = ref('')
const entries = ref<FileEntry[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const dragOver = ref(false)

// ---- local (dual-panel) pane: browse the machine's own filesystem ----
const localOpen = ref(false)
const localPath = ref('')
const localEntries = ref<LocalEntry[]>([])
const localLoading = ref(false)
const localError = ref('')
function localJoin(a: string, b: string): string {
  return a.replace(/[\\/]+$/, '') + '\\' + b
}
function localParent(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  if (!norm) return p
  const idx = Math.max(norm.lastIndexOf('\\'), norm.lastIndexOf('/'))
  return idx > 0 ? norm.slice(0, idx) : norm
}
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
  try {
    const r = await window.api.local.list(localPath.value)
    localPath.value = r.path
    localEntries.value = r.entries
  } catch {
    localError.value = tt('sfp.localErr')
  } finally {
    localLoading.value = false
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
// Whether the last interaction was in the local pane, so keyboard shortcuts
// route there (Ctrl+A / Delete / F2 / Enter / Backspace / Escape).
const localActive = ref(false)
const localSelSet = ref<Set<string>>(new Set())
const localAnchor = ref<string | null>(null)
function localSelectAll(): void {
  localSelSet.value = new Set(localSorted.value.map((e) => e.name))
}
const localSelCount = computed(() => localSelSet.value.size)
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
  localMenu.open = false
  const ok = await confirm(tt('sfp.confirmDel', { name: t.name }))
  if (!ok) return
  const r = await window.api.local.del(localPath.value, t.name, t.isDir)
  if (!r.ok) toast(r.error ?? tt('sfp.delFail'), 'error')
  else await refreshLocal()
}
async function localDelSelected(): Promise<void> {
  if (!localSelSet.value.size || !localPath.value) return
  const entries = localSorted.value.filter((e) => localSelSet.value.has(e.name))
  if (!entries.length) return
  const ok = await confirm(tt('sfp.delMany', { n: entries.length }))
  if (!ok) return
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
async function localSubmit(): Promise<void> {
  const name = localModal.value.trim()
  if (!name || !localPath.value) return
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
}
function fmtLocalTime(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---- interrupted-transfer resume queue ----
const runningUpload = ref<{ remoteDir: string; localPaths: string[] } | null>(null)
const showResume = ref(false)
async function resumePending(): Promise<void> {
  if (!props.sessionId) return
  const ops = [...store.transferQueue]
  let failed = 0
  let lastErr = ''
  for (const op of ops) {
    const r = await window.api.sftp.uploadPaths(props.sessionId, op.remoteDir, op.localPaths, store.transferConcurrency)
    if (!r.ok && !r.canceled) {
      // Don't abort the whole resume on the first failure — skip this op and
      // keep trying the remaining queued uploads.
      failed++
      lastErr = r.error ?? tt('sfp.uploadFail')
      continue
    }
  }
  await store.clearTransferQueue()
  showResume.value = store.downloadQueue.length > 0
  if (failed > 0) {
    error.value = tt('sfp.resumePartial', { n: failed })
    if (lastErr) toast(lastErr, 'error')
  }
}
async function resumeDownloads(): Promise<void> {
  if (!props.sessionId) return
  const ops = [...store.downloadQueue]
  let failed = 0
  for (const op of ops) {
    // Resumes into the recorded local directory; partial files are picked up by
    // downloadJob. A per-op failure is skipped, not fatal to the rest.
    const r = await window.api.sftp.downloadTo(op.sessionId, op.items, op.localDir, store.transferConcurrency)
    if (!r.ok && !r.canceled) failed++
  }
  await store.clearDownloadQueue()
  showResume.value = store.transferQueue.length > 0
  if (failed > 0) toast(tt('sfp.resumeDownloadPartial', { n: failed }), 'error')
}
// dragenter/leave bubble from child rows; count depth so the drop highlight
// doesn't flicker off while the pointer crosses children.
let dragDepth = 0
function onDragEnter(): void {
  dragDepth++
  dragOver.value = true
}
function onDragLeave(): void {
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
function caret(key: 'name' | 'size' | 'mtime'): string {
  if (localSort.key !== key) return ''
  return localSort.asc ? ' ▴' : ' ▾'
}

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

const sorted = computed(() => {
  const arr = entries.value.filter((e) => showHidden.value || !e.name.startsWith('.'))
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

async function load(p?: string): Promise<void> {
  if (!props.sessionId) return
  loading.value = true
  error.value = ''
  creatingKind.value = null
  renamingName.value = null
  selected.value = new Set()
  anchor.value = null
  try {
    const res = await window.api.sftp.list(props.sessionId, p)
    path.value = res.path
    if (!homePath.value) homePath.value = res.path
    if (props.sessionId) store.setSftpPath(props.sessionId, res.path)
    entries.value = res.entries
    if (res.path !== '/') void store.addSftpRecent(res.path)
  } catch (e) {
    error.value = (e as Error).message || tt('sfp.readDirFail')
  } finally {
    loading.value = false
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
// Upload jobs already acted on by the listing-reload watcher.
const reloadedDoneIds = new Set<string>()
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
  // Refresh the listing after an upload that finished in this pane, debounced so
  // a folder of N files triggers one reload instead of N. A backgrounded pane's
  // upload must not reload the active one.
  watch(
    () => store.transfers,
    (list) => {
      const doneUp = list.find(
        (x) =>
          x.done &&
          !x.error &&
          x.direction === 'up' &&
          (!x.sessionId || x.sessionId === props.sessionId) &&
          !reloadedDoneIds.has(x.id)
      )
      if (doneUp) {
        reloadedDoneIds.add(doneUp.id)
        runningUpload.value = null
        if (uploadReloadTimer) clearTimeout(uploadReloadTimer)
        uploadReloadTimer = window.setTimeout(() => load(path.value), 500)
      }
    },
    { deep: true }
  )
  window.addEventListener('resize', onWindowResize)
})
onBeforeUnmount(() => {
  if (uploadReloadTimer) clearTimeout(uploadReloadTimer)
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
  // Double-click: enter a directory, or open a file in the built-in editor
  // (whose Save writes the edits straight back to the remote).
  if (renamingName.value) return
  if (entry.isDir) load(posixJoin(path.value, entry.name))
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
  if ((e.target as HTMLElement | null)?.closest('input')) return
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

// ---- operations ----
function editFile(entry: FileEntry, external: boolean): void {
  const payload = { path: posixJoin(path.value, entry.name), name: entry.name }
  if (external) emit('edit-external', payload)
  else emit('edit-file', payload)
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
  runningUpload.value = { remoteDir: path.value, localPaths: paths }
  const r = await window.api.sftp.uploadPaths(props.sessionId, path.value, paths, store.transferConcurrency)
  if (!r.ok && !r.canceled) error.value = r.error ?? tt('sfp.uploadFail')
}
function startRename(entry: FileEntry): void {
  renamingName.value = entry.name
  renameInput.value = entry.name
  focusEdit()
}
async function commitRename(entry: FileEntry): Promise<void> {
  // Esc clears renamingName first; the ensuing blur must not still rename.
  if (renamingName.value !== entry.name) return
  const next = renameInput.value.trim()
  renamingName.value = null
  if (!props.sessionId || !next || next === entry.name) return
  const r = await window.api.sftp.rename(
    props.sessionId,
    posixJoin(path.value, entry.name),
    posixJoin(path.value, next)
  )
  if (!r.ok) error.value = r.error ?? tt('sfp.renameFail')
  await load(path.value)
}
function startCreate(kind: 'folder' | 'file'): void {
  creatingKind.value = kind
  newName.value = ''
  focusEdit()
}
async function commitCreate(): Promise<void> {
  const name = newName.value.trim()
  const kind = creatingKind.value
  creatingKind.value = null
  if (!props.sessionId || !name || !kind) return
  const target = posixJoin(path.value, name)
  const r =
    kind === 'folder'
      ? await window.api.sftp.mkdir(props.sessionId, target)
      : await window.api.sftp.createFile(props.sessionId, target)
  if (!r.ok) error.value = r.error ?? tt('sfp.createFail')
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
}
async function packDownloadSelected(): Promise<void> {
  if (!props.sessionId) return
  const items = selectedEntries()
  if (!items.length) return
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
  for (const it of items) {
    const r = await window.api.sftp.remove(props.sessionId, posixJoin(path.value, it.name), it.isDir)
    if (!r.ok) error.value = r.error ?? tt('sfp.delFail')
  }
  selected.value = new Set()
  await load(path.value)
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
function openHistory(): void {
  // The history menu is wider (300px) than the more-menu it inherits its anchor
  // from, so clamp it to keep the whole panel on-screen.
  historyMenu.x = Math.max(8, Math.min(moreMenu.x, window.innerWidth - 308))
  historyMenu.y = moreMenu.y
  historyMenu.open = true
}
function clearHistory(): void {
  void store.clearTransferHistory()
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
  const r = await window.api.sftp.downloadTo(
    props.sessionId,
    buildRetryItems(h),
    h.localDir,
    store.transferConcurrency
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
  const s = Math.floor((Date.now() - at) / 1000)
  if (s < 60) return tt('sfp.justNow')
  if (s < 3600) return tt('sfp.minAgo', { n: Math.floor(s / 60) })
  if (s < 86400) return tt('sfp.hrAgo', { n: Math.floor(s / 3600) })
  return tt('sfp.dayAgo', { n: Math.floor(s / 86400) })
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
function commitPathEdit(): void {
  // Esc sets pathEditing=false first; the ensuing blur must not still navigate.
  if (!pathEditing.value) return
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
function isCancelled(t: SftpProgress): boolean {
  return t.error === '已取消'
}
function fmtSpeed(id: string): string {
  const s = store.transferSpeeds[id]
  return s && s > 0.5 ? `${fmtSize(s)}/s` : ''
}
function statusText(t: SftpProgress): string {
  if (isCancelled(t)) return tt('sfp.cancelled')
  if (t.error) return t.error
  if (t.done) return tt('sfp.done')
  return pct(t) + '%'
}

// ---- permissions (chmod) ----
const perm = reactive({
  open: false,
  targets: [] as FileEntry[],
  bits: 0o755,
  recursive: false,
  busy: false,
  error: ''
})
const permDialogEl = ref<HTMLElement>()
const octalText = ref('755')
const permGroups = computed(() => [
  { label: tt('sfp.permOwner'), bits: [{ l: tt('sfp.read'), m: 0o400 }, { l: tt('sfp.write'), m: 0o200 }, { l: tt('sfp.execute'), m: 0o100 }] },
  { label: tt('sfp.permGroup'), bits: [{ l: tt('sfp.read'), m: 0o040 }, { l: tt('sfp.write'), m: 0o020 }, { l: tt('sfp.execute'), m: 0o010 }] },
  { label: tt('sfp.permOther'), bits: [{ l: tt('sfp.read'), m: 0o004 }, { l: tt('sfp.write'), m: 0o002 }, { l: tt('sfp.execute'), m: 0o001 }] }
])
const permHasDir = computed(() => perm.targets.some((t) => t.isDir))
// Live "rwxr-xr-x" preview of the current bits.
const permSymbolic = computed(() => {
  const tri = (b: number): string =>
    (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-')
  const m = perm.bits
  return tri((m >> 6) & 7) + tri((m >> 3) & 7) + tri(m & 7)
})

function syncOctal(): void {
  octalText.value = perm.bits.toString(8).padStart(3, '0')
}
function toggleBit(mask: number): void {
  perm.bits ^= mask
  syncOctal()
}
function onOctalInput(e: Event): void {
  const el = e.target as HTMLInputElement
  const v = el.value.replace(/[^0-7]/g, '').slice(0, 4)
  // Force the field back to the sanitized text; without this a rejected char
  // (e.g. "8") stays visible while state silently ignores it.
  if (el.value !== v) el.value = v
  octalText.value = v
  perm.bits = v ? parseInt(v, 8) & 0o7777 : 0
}
function openPerm(): void {
  const items = selectedEntries()
  if (!items.length) return
  perm.targets = items
  // Prefill from the right-clicked entry's current mode when known, else 755.
  const base = menu.target?.mode ?? items[0].mode ?? 0o755
  perm.bits = base & 0o7777
  perm.recursive = false
  perm.error = ''
  syncOctal()
  perm.open = true
  nextTick(() => permDialogEl.value?.focus())
}
async function applyPerm(): Promise<void> {
  if (!props.sessionId || !perm.targets.length || perm.busy) return
  if (!octalText.value) {
    perm.error = tt('sfp.permInput')
    return
  }
  perm.busy = true
  perm.error = ''
  const mode = perm.bits & 0o7777
  const failed: string[] = []
  try {
    // Apply to every target; don't abort on the first failure so one bad item
    // doesn't hide the outcome of the rest.
    for (const it of perm.targets) {
      const r = await window.api.sftp.chmod(
        props.sessionId,
        posixJoin(path.value, it.name),
        mode,
        perm.recursive,
        it.isDir
      )
      if (!r.ok) failed.push(it.name)
    }
    if (failed.length) {
      perm.error =
        failed.length === perm.targets.length
          ? tt('sfp.permFail')
          : tt('sfp.permFailMany', { n: failed.length, list: failed.join('、') })
    } else {
      perm.open = false
    }
  } catch (e) {
    perm.error = (e as Error).message
  } finally {
    perm.busy = false
    // Reload regardless so the listing reflects whatever did change.
    await load(path.value)
  }
}
function onPermKey(e: KeyboardEvent): void {
  e.stopPropagation() // don't let the drawer's global shortcuts fire while the dialog is open
  if (e.key === 'Escape') perm.open = false
  else if (e.key === 'Enter') applyPerm()
}
// Restore focus to the drawer when the dialog closes so shortcuts stay live.
watch(
  () => perm.open,
  (open) => {
    if (!open) nextTick(() => drawerEl.value?.focus())
  }
)

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} K`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} M`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} G`
}
function fmtTime(sec: number): string {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const pct = (t: SftpProgress): number =>
  t.total > 0 ? Math.min(100, Math.round((t.transferred / t.total) * 100)) : 0
</script>

<template>
  <aside
    ref="drawerEl"
    class="drawer"
    :class="{ drag: dragOver }"
    :style="{ width: width + 'px' }"
    tabindex="0"
    @keydown="onKeydown"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="resize-handle" :title="tt('sfp.resizeTip')" @mousedown.prevent="onResizeStart" />
    <div class="head">
      <span class="title">{{ tt('sfp.files') }}<span v-if="selCount > 1" class="selcount">{{ tt('sfp.selected', { n: selCount }) }}</span></span>
      <div class="head-actions">
        <button class="icon-btn" :title="tt('sfp.home')" :disabled="!homePath" @click="load(homePath)"><Icon name="home" /></button>
        <button class="icon-btn" :title="tt('sfp.refresh')" :disabled="loading" @click="load(path)"><Icon name="refresh" /></button>
        <button class="icon-btn" :class="{ active: localOpen }" :title="tt('sfp.local')" @click="toggleLocal"><Icon name="folder" /></button>
        <button class="icon-btn" :title="tt('sfp.upload')" :disabled="busy" @click="uploadPick"><Icon name="upload" /></button>
        <button class="icon-btn" :class="{ active: moreMenu.open }" :title="tt('sfp.more')" @click.stop="openMore"><Icon name="more-horizontal" /></button>
        <button class="icon-btn" :title="tt('sfp.close')" @click="emit('close')"><Icon name="close" /></button>
      </div>
    </div>

    <div v-if="moreMenu.open" class="ctx-overlay" @mousedown="moreMenu.open = false" @contextmenu.prevent="moreMenu.open = false">
      <div class="ctx more-menu" :style="{ left: moreMenu.x + 'px', top: moreMenu.y + 'px' }" @mousedown.stop>
        <button @click="runMore(() => startCreate('folder'))"><Icon name="folder" :size="15" /><span>{{ tt('sfp.newFolder') }}</span></button>
        <button @click="runMore(() => startCreate('file'))"><Icon name="file" :size="15" /><span>{{ tt('sfp.newFile') }}</span></button>
        <button @click="runMore(uploadDirPick)"><Icon name="folder-up" :size="15" /><span>{{ tt('sfp.uploadDir') }}</span></button>
        <button @click="runMore(uploadExtractPick)"><Icon name="zip" :size="15" /><span>{{ tt('sfp.uploadExtract') }}</span></button>
        <button @click="runMore(packDownloadSelected)"><Icon name="archive" :size="15" /><span>{{ tt('sfp.packDownload') }}</span></button>
        <button @click="runMore(toggleHidden)"><Icon name="eye" :size="15" /><span>{{ showHidden ? tt('sfp.toggleHiddenHide') : tt('sfp.toggleHiddenShow') }}</span></button>
        <button v-if="hasTermCwd" @click="runMore(gotoTerminalDir)"><Icon name="terminal" :size="15" /><span>{{ tt('sfp.gotoTerminal') }}</span></button>
        <button @click="runMore(openHistory)"><Icon name="clock" :size="15" /><span>{{ tt('sfp.history') }}{{ activeHistory.length ? ` (${activeHistory.length})` : '' }}</span></button>
      </div>
    </div>

    <div v-if="historyMenu.open" class="ctx-overlay" @mousedown="historyMenu.open = false" @contextmenu.prevent="historyMenu.open = false">
      <div class="ctx hist-menu" :style="{ left: historyMenu.x + 'px', top: historyMenu.y + 'px' }" @mousedown.stop>
        <div class="hist-head">
          <span>{{ tt('sfp.history') }}</span>
          <button v-if="activeHistory.length" class="hist-clear" @click="clearHistory">{{ tt('sfp.clear') }}</button>
        </div>
        <div v-if="!activeHistory.length" class="hist-empty">{{ tt('sfp.histEmpty') }}</div>
        <div v-for="h in activeHistory" :key="h.id" class="hist-row">
          <Icon :name="h.direction === 'up' ? 'upload' : 'download'" :size="13" class="hist-dir" :class="h.status" />
          <span class="hist-name" :title="h.name">{{ h.name }}</span>
          <span class="hist-meta" :class="h.status">
            {{ h.status === 'done' ? fmtSize(h.bytes) : h.status === 'cancelled' ? tt('sfp.cancelled') : (h.error || tt('sfp.failed')) }}
          </span>
          <span class="hist-time">{{ fmtAgo(h.at) }}</span>
          <button v-if="h.remoteDir && props.sessionId" class="hist-locate" :title="tt('sfp.locate')" @click.stop="locateHistory(h)"><Icon name="folder" :size="12" /></button>
          <button v-if="canReveal(h)" class="hist-locate" :title="tt('sfp.reveal')" @click.stop="revealHistory(h)"><Icon name="folder-open" :size="12" /></button>
          <button v-if="canRetry(h)" class="hist-locate hist-retry" :title="tt('sfp.retry')" @click.stop="retryHistory(h)"><Icon name="refresh" :size="12" /></button>
          <button class="hist-locate hist-del" :title="tt('sfp.delHistory')" @click.stop="removeHistory(h)"><Icon name="trash" :size="12" /></button>
        </div>
      </div>
    </div>

    <div v-if="showResume && (store.transferQueue.length || store.downloadQueue.length)" class="resume-bar">
      <template v-if="store.transferQueue.length">
        <span>{{ tt('sfp.resumeHint', { n: store.transferQueue.length }) }}</span>
        <button class="mini primary" @click="resumePending">{{ tt('sfp.resume') }}</button>
        <button class="mini" @click="store.clearTransferQueue(); showResume = store.downloadQueue.length > 0">{{ tt('sfp.discard') }}</button>
      </template>
      <template v-if="store.downloadQueue.length">
        <span>{{ tt('sfp.resumeDownloadHint', { n: store.downloadQueue.length }) }}</span>
        <button class="mini primary" @click="resumeDownloads">{{ tt('sfp.resumeDownload') }}</button>
        <button class="mini" @click="store.clearDownloadQueue(); showResume = store.transferQueue.length > 0">{{ tt('sfp.discard') }}</button>
      </template>
    </div>

    <div v-if="localOpen" class="localpane" @click="localActive = true" @dragover.prevent @drop.prevent.stop="onLocalDrop">
    <div class="pathbar" @click="localActive = false">
        <button class="up" :title="tt('sfp.upLevel')" :disabled="localLoading" @click="localGoUp"><Icon name="arrow-up" :size="15" /></button>
        <span class="local-path" :title="localPath">{{ localPath }}</span>
        <span v-if="localSelCount" class="loc-selcount">{{ tt('sfp.selected', { n: localSelCount }) }}</span>
        <button class="mini new" :title="tt('sfp.selectAll')" @click="localSelectAll"><Icon name="check-all" :size="14" /></button>
        <button class="mini new" :title="tt('sfp.newFile')" @click="localNew('file')"><Icon name="plus" :size="14" /></button>
        <button class="mini new" :title="tt('sfp.newFolder')" @click="localNew('folder')"><Icon name="folder-plus" :size="14" /></button>
        <button class="up" :title="tt('sfp.refresh')" :disabled="localLoading" @click="refreshLocal()"><Icon name="refresh" :size="14" /></button>
      </div>
      <div class="loc-head">
        <span class="ic-sp"></span>
        <span class="lc-name" @click="setLocalSort('name')">{{ tt('sfp.name') }}{{ caret('name') }}</span>
        <span class="lc-size" @click="setLocalSort('size')">{{ tt('sfp.size') }}{{ caret('size') }}</span>
        <span class="lc-time" @click="setLocalSort('mtime')">{{ tt('sfp.mtime') }}{{ caret('mtime') }}</span>
      </div>
      <div class="body localbody">
        <div v-if="localError" class="msg err">{{ localError }}</div>
        <div v-else-if="localLoading" class="msg">{{ tt('sfp.loading') }}</div>
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
            <span class="ic" :class="{ folder: entry.isDir }"><Icon :name="entry.isDir ? 'folder' : 'file'" /></span>
            <span class="name">{{ entry.name }}</span>
            <span class="lc-lsize">{{ entry.isDir ? '' : fmtSize(entry.size ?? 0) }}</span>
            <span class="lc-ltime">{{ fmtLocalTime(entry.mtime) }}</span>
          </div>
          <div class="table-row" @click.prevent="localNew('folder')"><span class="table-row-label"><Icon name="folder-plus" :size="14" />{{ tt('sfp.newFolderHere') }}</span></div>
          <div v-if="!localEntries.length" class="msg">{{ tt('sfp.empty') }}</div>
        </template>
      </div>
    </div>

    <div v-if="localMenu.open" class="ctx-overlay" @mousedown="localMenu.open = false" @contextmenu.prevent="localMenu.open = false">
      <div class="ctx loc-menu" :style="{ left: localMenu.x + 'px', top: localMenu.y + 'px' }" @mousedown.stop>
        <h3>{{ localMenu.target?.name }}</h3>
        <button @click="localRename">{{ tt('sfp.rename') }}</button>
        <button class="danger" @click="localDelete">{{ tt('sfp.delete') }}</button>
      </div>
    </div>

    <div v-if="localModal.open" class="ctx-overlay" @mousedown.self="localModal.open = false">
      <div class="modal local-modal">
        <h3>{{ localModal.action === 'new' ? (localModal.kind === 'folder' ? tt('sfp.newFolder') : tt('sfp.newFile')) : tt('sfp.rename') }}</h3>
        <input
          ref="localInput"
          class="name-in"
          :placeholder="localModal.kind === 'folder' ? tt('sfp.folderName') : tt('sfp.fileName')"
          v-model="localModal.value"
          @keydown.enter="localSubmit"
          @keydown.esc="localModal.open = false"
        />
        <div v-if="localModal.error" class="err">{{ localModal.error }}</div>
        <div class="modal-actions">
          <button class="mini" @click="localModal.open = false">{{ tt('sfp.cancel') }}</button>
          <button class="mini primary" @click="localSubmit">{{ tt('sfp.ok') }}</button>
        </div>
      </div>
    </div>

    <div class="pathbar">
      <button class="up" :title="tt('sfp.upLevel')" :disabled="path === '/' || loading" @click="goUp"><Icon name="arrow-up" :size="15" /></button>
      <input
        v-if="pathEditing"
        ref="pathEl"
        v-model="pathInput"
        class="path-input"
        spellcheck="false"
        @keydown.enter.prevent="commitPathEdit"
        @keydown.esc.prevent="pathEditing = false"
        @blur="commitPathEdit"
      />
      <template v-else>
        <div class="crumbs" :title="tt('sfp.editPath')" @dblclick="startPathEdit">
          <template v-for="(c, i) in crumbs" :key="c.full">
            <button class="crumb" @click="load(c.full)">{{ c.label }}</button>
            <span v-if="i < crumbs.length - 1 && c.full !== '/'" class="sep">/</span>
          </template>
        </div>
        <button class="up" :title="tt('sfp.editPath')" @click="startPathEdit"><Icon name="edit" :size="14" /></button>
        <button class="up" :class="{ active: bookmarksMenu.open }" :title="tt('sfp.bookmarks')" @click.stop="openBookmarks"><Icon name="book" :size="14" /></button>
      </template>
    </div>

    <div v-if="bookmarksMenu.open" class="ctx-overlay" @mousedown="bookmarksMenu.open = false" @contextmenu.prevent="bookmarksMenu.open = false">
      <div class="ctx bm-menu" :style="{ left: bookmarksMenu.x + 'px', top: bookmarksMenu.y + 'px' }" @mousedown.stop>
        <div class="bm-head">
          <span>{{ tt('sfp.bookmarks') }}</span>
          <button class="mini" @click="toggleBookmarkCurrent">{{ store.sftpBookmarks.includes(path) ? tt('sfp.unbookmark') : tt('sfp.addBookmark') }}</button>
        </div>
        <div v-if="!store.sftpBookmarks.length" class="bm-empty">{{ tt('sfp.noBookmarks') }}</div>
        <button v-for="b in store.sftpBookmarks" :key="b" class="bm-item" @click="jumpBookmark(b)">
          <Icon name="folder" :size="13" />
          <span class="bm-path">{{ b }}</span>
          <Icon name="close" :size="12" class="rm" @click.stop="store.toggleSftpBookmark(b)" />
        </button>
        <template v-if="store.sftpRecent.length">
          <div class="bm-head recent">
            <span>{{ tt('sfp.recent') }}</span>
          </div>
          <button v-for="b in store.sftpRecent" :key="b" class="bm-item" @click="jumpBookmark(b)">
            <Icon name="clock" :size="13" />
            <span class="bm-path">{{ b }}</span>
          </button>
        </template>
      </div>
    </div>

    <div class="sortbar">
      <button :class="{ on: sort.key === 'name' }" @click="setSort('name')">
        {{ tt('sfp.name') }}<span v-if="sort.key === 'name'">{{ sort.asc ? ' ↑' : ' ↓' }}</span>
      </button>
      <button :class="{ on: sort.key === 'size' }" @click="setSort('size')">
        {{ tt('sfp.size') }}<span v-if="sort.key === 'size'">{{ sort.asc ? ' ↑' : ' ↓' }}</span>
      </button>
      <button :class="{ on: sort.key === 'mtime' }" @click="setSort('mtime')">
        {{ tt('sfp.time') }}<span v-if="sort.key === 'mtime'">{{ sort.asc ? ' ↑' : ' ↓' }}</span>
      </button>
    </div>

    <div ref="bodyEl" class="body" @mousedown="onBodyMousedown" @contextmenu="openMenu($event, null)">
      <div v-if="error" class="msg err">{{ error }}</div>
      <div v-else-if="loading" class="msg">{{ tt('sfp.loading') }}</div>
      <template v-else>
        <div v-if="creatingKind" class="row editing">
          <span class="ic"><Icon :name="creatingKind === 'folder' ? 'folder' : 'file'" /></span>
          <input
            ref="editEl"
            v-model="newName"
            class="edit-input"
            :placeholder="creatingKind === 'folder' ? tt('sfp.folderName') : tt('sfp.fileName')"
            @keydown.enter.prevent="commitCreate"
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
          <span class="ic" :class="{ folder: entry.isDir }"><Icon :name="entry.isDir ? 'folder' : 'file'" /></span>
          <input
            v-if="renamingName === entry.name"
            ref="editEl"
            v-model="renameInput"
            class="edit-input"
            @click.stop
            @keydown.enter.prevent="commitRename(entry)"
            @keydown.esc.prevent="renamingName = null"
            @blur="commitRename(entry)"
          />
          <template v-else>
            <span class="name">{{ entry.name }}</span>
            <span class="mtime">{{ fmtTime(entry.mtime) }}</span>
            <span v-if="!entry.isDir" class="size">{{ fmtSize(entry.size) }}</span>
          </template>
        </div>
        <div v-if="!sorted.length && !creatingKind" class="msg">{{ tt('sfp.empty') }}</div>
      </template>
      <div v-if="marquee.active" class="marquee" :style="marqueeStyle" />
    </div>

    <div v-if="activeTransfers.length" class="transfers">
      <div
        v-for="t in activeTransfers"
        :key="t.id"
        class="tf"
        :class="{ err: !!t.error && !isCancelled(t), cancelled: isCancelled(t) }"
      >
        <div class="tf-top">
          <Icon :name="t.direction === 'up' ? 'upload' : 'download'" :size="13" class="tf-dir" />
          <span class="tf-name">{{ t.name }}</span>
          <span v-if="t.count && t.count > 1 && !t.done && !t.error" class="tf-count">{{ t.index }}/{{ t.count }}</span>
          <span class="tf-pct">{{ statusText(t) }}</span>
          <button
            v-if="!t.done && !t.error"
            class="tf-x"
            :title="tt('sfp.cancelTransfer')"
            @click="cancelTransfer(t.id)"
          ><Icon name="close" :size="12" /></button>
        </div>
        <div class="bar"><div class="fill" :class="{ done: t.done }" :style="{ width: (t.done ? 100 : pct(t)) + '%' }" /></div>
        <div v-if="!t.done && !t.error && t.total > 0" class="tf-sub">
          <span>{{ fmtSize(t.transferred) }} / {{ fmtSize(t.total) }}</span>
          <span v-if="fmtSpeed(t.id)" class="tf-speed">{{ fmtSpeed(t.id) }}</span>
        </div>
      </div>
    </div>
    <div v-else class="foot">{{ tt('sfp.footDrop') }}</div>

    <div v-if="menu.open" class="ctx-overlay" @mousedown="closeMenu" @contextmenu.prevent="closeMenu">
      <div class="ctx" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @mousedown.stop>
        <template v-if="menu.target">
          <button @click="runMenu(downloadSelected)">{{ tt('sfp.download') }}{{ selCount > 1 ? ` (${selCount})` : '' }}</button>
          <template v-if="selCount === 1 && !menu.target.isDir">
            <button @click="runMenu(() => editFile(menu.target as FileEntry, false))">{{ tt('sfp.edit') }}</button>
            <button @click="runMenu(() => editFile(menu.target as FileEntry, true))">{{ tt('sfp.openExternal') }}</button>
          </template>
          <button
            v-if="selCount === 1 && menu.target.isDir"
            @click="runMenu(() => cdTerminalTo(menu.target as FileEntry))"
          >{{ tt('sfp.openInTerminal') }}</button>
          <button @click="runMenu(copySelectedPaths)">{{ tt('sfp.copyPath') }}</button>
          <button @click="runMenu(openPerm)">{{ tt('sfp.perm') }}{{ selCount > 1 ? ` (${selCount})` : '' }}</button>
          <button v-if="selCount === 1" @click="runMenu(() => startRename(menu.target as FileEntry))">{{ tt('sfp.rename') }}</button>
          <button class="danger" @click="runMenu(delSelected)">{{ tt('sfp.delete') }}{{ selCount > 1 ? ` (${selCount})` : '' }}</button>
        </template>
        <template v-else>
          <button @click="runMenu(() => startCreate('folder'))">{{ tt('sfp.newFolder') }}</button>
          <button @click="runMenu(() => startCreate('file'))">{{ tt('sfp.newFile') }}</button>
          <button @click="runMenu(uploadPick)">{{ tt('sfp.upload') }}</button>
          <button @click="runMenu(uploadDirPick)">{{ tt('sfp.uploadDir') }}</button>
          <button @click="runMenu(() => load(path))">{{ tt('sfp.refresh') }}</button>
        </template>
      </div>
    </div>

    <div v-if="perm.open" class="pm-overlay" @mousedown.self="perm.open = false">
      <div ref="permDialogEl" class="pm-dialog" tabindex="-1" @keydown="onPermKey">
        <div class="pm-head">
          <span>{{ tt('sfp.perm') }}</span>
          <button class="pm-x" :title="tt('sfp.close')" @click="perm.open = false"><Icon name="close" /></button>
        </div>
        <p class="pm-target">
          {{ perm.targets.length === 1 ? perm.targets[0].name : tt('sfp.permSelected', { n: perm.targets.length }) }}
        </p>
        <div class="pm-grid">
          <div v-for="g in permGroups" :key="g.label" class="pm-col">
            <div class="pm-col-h">{{ g.label }}</div>
            <label v-for="b in g.bits" :key="b.m" class="pm-check">
              <input type="checkbox" :checked="(perm.bits & b.m) !== 0" @change="toggleBit(b.m)" />
              <span>{{ b.l }}</span>
            </label>
          </div>
        </div>
        <div class="pm-oct">
          <span class="pm-oct-l">{{ tt('sfp.permValue') }}</span>
          <input
            class="pm-oct-i"
            :value="octalText"
            spellcheck="false"
            maxlength="4"
            @input="onOctalInput"
          />
          <span class="pm-sym">{{ permSymbolic }}</span>
        </div>
        <label v-if="permHasDir" class="pm-recur">
          <input v-model="perm.recursive" type="checkbox" />
          <span>{{ tt('sfp.permRecursive') }}</span>
        </label>
        <p v-if="perm.error" class="pm-err">{{ perm.error }}</p>
        <div class="pm-foot">
          <button class="pm-btn ghost" @click="perm.open = false">{{ tt('sfp.cancel') }}</button>
          <button class="pm-btn primary" :disabled="perm.busy" @click="applyPerm">
            {{ perm.busy ? tt('sfp.applying') : tt('sfp.ok') }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border-left: 1px solid var(--border);
  box-shadow: -12px 0 34px -10px rgba(0, 0, 0, 0.4);
}
.resize-handle {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 7px;
  z-index: 60;
  cursor: ew-resize;
}
.resize-handle:hover {
  background: var(--accent-soft);
}
.drawer.drag {
  outline: 2px dashed var(--accent);
  outline-offset: -6px;
}
.drawer:focus {
  outline: none;
}
.selcount {
  flex: none;
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--accent);
  background: var(--accent-soft);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.title {
  display: inline-flex;
  align-items: center;
  flex: none;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}
.head-actions {
  display: flex;
  flex: none;
  gap: 1px;
}
.more-menu {
  min-width: 176px;
}
.more-menu button {
  align-items: center;
  gap: 9px;
}
.more-menu :deep(svg) {
  color: var(--text-dim);
  flex: none;
}
.hist-menu {
  width: 300px;
  max-width: 84vw;
  max-height: 340px;
  overflow-y: auto;
  padding: 0;
}
.hist-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
}
.hist-head > span {
  white-space: nowrap;
}
/* Override `.ctx button { width: 100% }` — the clear button must hug its label,
   otherwise it fills the row and wraps the title. */
.hist-head .hist-clear {
  flex: none;
  width: auto;
  font-size: 11px;
  color: var(--text-faint);
  padding: 2px 7px;
  border-radius: 4px;
}
.hist-head .hist-clear:hover {
  color: var(--danger);
  background: var(--bg-elev-2);
}
.hist-empty {
  padding: 22px;
  text-align: center;
  font-size: 12px;
  color: var(--text-faint);
}
.hist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 11.5px;
}
.hist-row:hover {
  background: var(--bg-elev-2);
}
.hist-dir {
  flex: none;
  color: var(--text-dim);
}
.hist-dir.done {
  color: var(--ok);
}
.hist-dir.error {
  color: var(--danger);
}
.hist-name {
  flex: 1;
  min-width: 0;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hist-meta {
  flex: none;
  font-family: var(--font-mono);
  color: var(--text-faint);
}
.hist-meta.error {
  color: var(--danger);
}
.hist-time {
  flex: none;
  min-width: 46px;
  text-align: right;
  font-size: 10.5px;
  color: var(--text-faint);
}
.hist-locate {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  color: var(--text-faint);
  background: transparent;
  border: none;
  cursor: pointer;
}
.hist-locate:hover {
  background: var(--bg-elev-2);
  color: var(--accent);
}
.hist-retry {
  color: var(--accent);
}
.hist-del {
  color: var(--text-faint);
}
.hist-del:hover {
  color: var(--danger);
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 27px;
  height: 27px;
  border-radius: 6px;
  color: var(--text-dim);
  transition: background 0.14s, color 0.14s;
}
.icon-btn:hover:not(:disabled) {
  background: var(--bg-elev-2);
  color: var(--text);
}
.icon-btn:disabled {
  opacity: 0.4;
}
.icon-btn.active {
  color: var(--accent);
  background: var(--accent-soft);
}
.path-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 9px;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 5px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11.5px;
  outline: none;
}
.pathbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--border);
}
.localpane {
  display: flex;
  flex-direction: column;
  max-height: 45%;
  min-height: 0;
  border-bottom: 1px solid var(--border);
}
.localbody {
  flex: 1;
  overflow: auto;
}
.local-path {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.loc-selcount {
  flex: none;
  margin: 0 6px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 999px;
}
.loc-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 3px 8px 2px;
  font-size: 10px;
  color: var(--text-faint);
  border-bottom: 1px solid var(--border);
}
.loc-head .ic-sp {
  flex: none;
  width: 16px;
}
.loc-head .lc-name,
.loc-head .lc-size,
.loc-head .lc-time {
  cursor: pointer;
  user-select: none;
}
.loc-head .lc-name {
  text-align: left;
}
.loc-head .lc-size,
.loc-head .lc-time {
  text-align: right;
}
.loc-head .lc-name:hover,
.loc-head .lc-size:hover,
.loc-head .lc-time:hover {
  color: var(--text);
}
.loc-head .lc-name,
.localbody .row .name {
  flex: 1;
  min-width: 0;
}
.loc-head .lc-size,
.localbody .row .lc-lsize {
  flex: none;
  width: 62px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 10.5px;
}
.loc-head .lc-time,
.localbody .row .lc-ltime {
  flex: none;
  width: 70px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 10.5px;
}
.localbody .row .lc-lsize,
.localbody .row .lc-ltime {
  color: var(--text-faint);
}
.localbody .row {
  padding-right: 8px;
}
.table-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  margin: 2px 0;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 12px;
}
.table-row:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.loc-menu {
  min-width: 170px;
}
.loc-menu h3 {
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0 0 4px;
}
.local-modal {
  width: 280px;
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.local-modal h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.local-modal .name-in {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
}
.local-modal .name-in:focus {
  border-color: var(--accent);
  outline: none;
}
.local-modal .err {
  font-size: 11.5px;
  color: var(--danger, #e5534b);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.resume-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-elev-2);
  border-left: 3px solid var(--warn);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--warn);
}
.resume-bar span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.up {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  flex: none;
  border-radius: 5px;
  color: var(--text-dim);
  transition: background 0.14s, color 0.14s;
}
.up:hover:not(:disabled) {
  background: var(--bg-elev-2);
  color: var(--text);
}
.up:disabled {
  opacity: 0.3;
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 1px;
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;
}
.crumbs::-webkit-scrollbar {
  display: none;
}
.crumb {
  padding: 2px 4px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-dim);
}
.crumb:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.sep {
  color: var(--text-faint);
  font-size: 11px;
}
.sortbar {
  display: flex;
  gap: 2px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
}
.sortbar button {
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.sortbar button.on {
  color: var(--accent);
}
.sortbar button:hover {
  background: var(--bg-elev-2);
}
.body {
  position: relative;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px;
  user-select: none;
}
.marquee {
  position: absolute;
  z-index: 5;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 2px;
  pointer-events: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 6px 8px;
  margin-bottom: 2px;
  border-radius: 6px;
  cursor: default;
  transition: background 0.12s;
}
.row:hover {
  background: var(--bg-elev-2);
}
.row.sel {
  background: var(--row-sel);
  box-shadow: inset 0 0 0 1px var(--row-sel-ring);
}
.row.sel:hover {
  background: var(--row-sel);
}
.row.sel .name {
  color: var(--text);
}
.ic {
  flex: none;
  display: inline-flex;
  color: var(--text-faint);
}
.ic.folder {
  color: var(--accent);
}
.name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mtime {
  font-size: 10.5px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  flex: none;
}
.size {
  font-size: 11px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  min-width: 46px;
  text-align: right;
  flex: none;
}
.edit-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  outline: none;
  font-size: 12.5px;
}
.msg {
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--text-faint);
}
.msg.err {
  color: var(--danger);
  font-family: var(--font-mono);
  font-size: 11.5px;
  word-break: break-all;
}
.transfers {
  border-top: 1px solid var(--border);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 34%;
  overflow-y: auto;
}
.tf-top {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
}
.tf-dir {
  flex: none;
  color: var(--accent);
}
.tf.err .tf-dir,
.tf.cancelled .tf-dir {
  color: var(--text-faint);
}
.tf-name {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tf-count {
  flex: none;
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--accent);
  background: var(--accent-soft);
  padding: 0 5px;
  border-radius: 999px;
}
.tf-pct {
  font-size: 11px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  flex: none;
}
.tf.err .tf-pct {
  color: var(--danger);
}
.tf-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 4px;
  color: var(--text-faint);
}
.tf-x:hover {
  background: var(--bg-elev-2);
  color: var(--danger);
}
.bar {
  height: 4px;
  background: var(--bg-elev-2);
  border-radius: 3px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.2s ease;
}
.fill.done {
  background: var(--ok);
}
.tf.err .fill {
  background: var(--danger);
}
.tf.cancelled .fill {
  background: var(--text-faint);
}
.tf-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-faint);
}
.tf-speed {
  flex: none;
  color: var(--accent);
}
.foot {
  padding: 8px;
  text-align: center;
  font-size: 11px;
  color: var(--text-faint);
  border-top: 1px solid var(--border);
}
.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
}
.ctx {
  position: fixed;
  min-width: 150px;
  padding: 5px;
  background-color: color-mix(in srgb, var(--bg-elev) 92%, transparent);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
}
.ctx button {
  display: flex;
  width: 100%;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--text);
  text-align: left;
}
.ctx button:hover {
  background: var(--accent-soft);
}
.ctx button.danger {
  color: var(--danger);
}
.ctx button.danger:hover {
  background: rgba(255, 107, 107, 0.12);
}

/* ---- permission (chmod) dialog ---- */
.pm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 16vh;
  z-index: 120;
}
.pm-dialog {
  width: min(380px, 92vw);
  background-color: color-mix(in srgb, var(--bg-elev) 92%, transparent);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  padding: 16px 18px 18px;
  outline: none;
}
.pm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
}
.pm-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  color: var(--text-dim);
}
.pm-x:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.pm-target {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pm-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 14px;
}
.pm-col {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 9px 10px;
}
.pm-col-h {
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 7px;
}
.pm-check {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 0;
  font-size: 12.5px;
  color: var(--text);
  cursor: pointer;
}
.pm-check input,
.pm-recur input {
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
  cursor: pointer;
}
.pm-oct {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.pm-oct-l {
  font-size: 12.5px;
  color: var(--text-dim);
}
.pm-oct-i {
  width: 84px;
  height: 32px;
  padding: 0 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 15px;
  letter-spacing: 0.14em;
  outline: none;
}
.pm-oct-i:focus {
  border-color: var(--accent);
}
.pm-sym {
  flex: 1;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
.pm-recur {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--text-dim);
  cursor: pointer;
}
.pm-err {
  margin-top: 12px;
  font-size: 12px;
  color: var(--danger);
}
.pm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
.pm-btn {
  height: 32px;
  padding: 0 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.pm-btn.ghost {
  color: var(--text-dim);
  border: 1px solid var(--border);
}
.pm-btn.ghost:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.pm-btn.primary {
  background: var(--accent);
  color: #fff;
  font-weight: 500;
}
.pm-btn.primary:hover {
  filter: brightness(1.08);
}
.pm-btn.primary:disabled {
  opacity: 0.55;
}
.bm-menu {
  width: 220px;
  max-height: 320px;
  overflow-y: auto;
}
.bm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}
.bm-head.recent {
  margin-top: 5px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-faint);
}
.bm-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-faint);
  font-size: 12px;
}
.bm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  text-align: left;
  color: var(--text);
  font-size: 12.5px;
}
.bm-item:hover {
  background: var(--bg-elev-2);
}
.bm-path {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono, monospace);
}
.bm-item .rm {
  color: var(--text-faint);
}
.bm-item .rm:hover {
  color: var(--danger);
}
</style>
