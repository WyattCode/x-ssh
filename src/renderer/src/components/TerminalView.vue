<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, reactive, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import { useTheme } from '../composables/theme'
import { useFontSize } from '../composables/fontSize'
import { useConfirm } from '../composables/confirm'
import { themeFor } from '../lib/terminalThemes'
import { useI18n } from '../lib/i18n'
import { useSessions } from '../stores/sessions'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    sessionId: string
    visible: boolean
    /** Whether this pane holds focus (only one pane per tab does). */
    focused?: boolean
  }>(),
  { focused: true }
)
const emit = defineEmits<{ (e: 'cwd', payload: { sessionId: string; path: string }): void }>()

const { mode } = useTheme()
const { size: fontSize } = useFontSize()
const store = useSessions()
const { t } = useI18n()

const DEFAULT_FONT =
  "'SFMono-Regular','Cascadia Code','JetBrains Mono',Menlo,Consolas,monospace"
const fontFamilyFor = (f: string): string => (f.trim() ? `${f}, ${DEFAULT_FONT}` : DEFAULT_FONT)

// Rolling tail so an OSC 7 sequence split across data chunks is still caught.
let oscTail = ''
function scanCwd(data: string): void {
  if (!data.includes('\x1b]7;') && !oscTail) return
  oscTail = (oscTail + data).slice(-1024)
  const re = /\x1b\]7;([^\x07\x1b]*)(?:\x07|\x1b\\)/g
  let m: RegExpExecArray | null
  let last: string | undefined
  while ((m = re.exec(oscTail))) last = m[1]
  if (last === undefined) return
  oscTail = ''
  let p = last
  if (p.startsWith('file://')) {
    const slash = p.indexOf('/', 7)
    p = slash >= 0 ? p.slice(slash) : ''
  }
  try {
    p = decodeURIComponent(p)
  } catch {
    /* leave as-is if not valid percent-encoding */
  }
  if (p) emit('cwd', { sessionId: props.sessionId, path: p })
}

const el = ref<HTMLDivElement>()
let term: Terminal | null = null
let fit: FitAddon | null = null
let search: SearchAddon | null = null
let ro: ResizeObserver | null = null
let offData: (() => void) | null = null

// ---- Clipboard actions ----
const { confirm } = useConfirm()
async function copySelection(): Promise<void> {
  const sel = term?.getSelection()
  if (sel) window.api.clipboard.writeText(sel)
}
async function pasteClipboard(): Promise<void> {
  const text = window.api.clipboard.readText()
  if (!text || !term) return
  // Strip terminal control characters that could act on the shell beyond what
  // was copied (e.g. bracketed-paste markers, OSC sequences, other C0 controls
  // beyond tab/newline). Guarded by the sanitizePaste setting.
  const clean = store.sanitizePaste ? sanitizePasteText(text) : text
  // Multi-line paste into a shell can be destructive (a command runs per line
  // without waiting) — confirm before sending anything more than one line.
  const lineCount = clean.split('\n').length
  if (lineCount > 1 && store.confirmPaste) {
    const ok = await confirm(
      t('term.pasteConfirm', { n: lineCount }),
      { title: t('term.pasteConfirmTitle'), confirmText: t('term.pasteConfirmOk'), cancelText: t('term.cancel') }
    )
    if (!ok) {
      term.focus()
      return
    }
  }
  term.paste(clean)
  term.focus()
}

// Keep printable text and whitespace; drop any C0/C1 control sequence (ESC,
// bracketed-paste ESC[200~/201~, OSC, and other non-printing bytes). Tabs and
// newlines are legitimately part of a multi-line paste.
function sanitizePasteText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
}
function selectAll(): void {
  term?.selectAll()
}
function clearTerm(): void {
  term?.clear()
}

// ---- Right-click context menu ----
const menu = reactive({ open: false, x: 0, y: 0, hasSel: false })

function openMenu(e: MouseEvent): void {
  e.preventDefault()
  menu.hasSel = !!term?.hasSelection()
  const mw = 172
  const mh = 156
  menu.x = Math.min(e.clientX, window.innerWidth - mw - 8)
  menu.y = Math.min(e.clientY, window.innerHeight - mh - 8)
  menu.open = true
}
function runMenu(action: () => void): void {
  action()
  menu.open = false
  term?.focus()
}

// ---- In-terminal search ----
const searchBar = reactive({ open: false, query: '', caseSensitive: false })
const searchEl = ref<HTMLInputElement>()

function runSearch(forward: boolean): void {
  if (!search || !searchBar.query) return
  const opts = { caseSensitive: searchBar.caseSensitive }
  if (forward) search.findNext(searchBar.query, opts)
  else search.findPrevious(searchBar.query, opts)
}
function openSearch(): void {
  searchBar.open = true
  nextTick(() => searchEl.value?.select())
}
function closeSearch(): void {
  searchBar.open = false
  search?.clearDecorations?.()
  term?.focus()
}
function toggleCase(): void {
  searchBar.caseSensitive = !searchBar.caseSensitive
  runSearch(true)
}


function doFit(): void {
  if (!fit || !term || !props.visible) return
  try {
    fit.fit()
    window.api.ssh.resize(props.sessionId, term.cols, term.rows)
  } catch {
    /* container not measurable yet */
  }
}

/** Opens a link clicked in the output. Main restricts this to http/https, so a
 *  URL the remote host printed can't launch a local protocol handler. */
function openLink(uri: string): void {
  window.api.openExternal(uri).catch(() => undefined)
}

onMounted(() => {
  if (!el.value) return
  term = new Terminal({
    fontFamily: fontFamilyFor(store.terminalFontFamily),
    lineHeight: 1.25,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: store.terminalCursor,
    scrollback: 10000,
    fontSize: fontSize.value,
    theme: themeFor(mode.value, store.terminalTheme),
    allowProposedApi: true,
    // OSC 8 hyperlinks (what a program like Codex emits). Without this, xterm's
    // own default pops a native confirm() and then tries window.open(), which
    // the app denies — so the link asked scarily and then never opened.
    linkHandler: { activate: (_e, uri) => openLink(uri) }
  })

  fit = new FitAddon()
  term.loadAddon(fit)
  search = new SearchAddon()
  term.loadAddon(search)
  // Plain http(s) text in the output takes the same route.
  term.loadAddon(new WebLinksAddon((_e, uri) => openLink(uri)))
  term.open(el.value)

  try {
    term.loadAddon(new WebglAddon())
  } catch {
    /* WebGL unavailable — falls back to canvas/DOM renderer */
  }

  // Honor OSC 52 clipboard writes from remote programs (tmux, vim, nvim's
  // clipboard=osc52, Claude Code, etc.) so their "copy" lands on the local
  // system clipboard. Payload is "<selection>;<base64>" ('?' = query, ignored).
  term.parser.registerOscHandler(52, (data) => {
    const semi = data.indexOf(';')
    const payload = semi >= 0 ? data.slice(semi + 1) : data
    // Ignore queries ('?') and refuse absurdly large payloads.
    if (!payload || payload === '?' || payload.length > 2_000_000) return true
    try {
      const bytes = Uint8Array.from(atob(payload), (ch) => ch.charCodeAt(0))
      window.api.clipboard.writeText(new TextDecoder().decode(bytes))
    } catch {
      return false
    }
    return true
  })

  // Terminal-style copy/paste shortcuts. Ctrl+C only copies when text is
  // selected, otherwise it passes through as SIGINT.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const c = e.code
    if (e.ctrlKey && e.shiftKey && (c === 'KeyC' || c === 'KeyV')) {
      if (c === 'KeyC') copySelection()
      else {
        // preventDefault, not just `return false`: returning false only stops
        // xterm from handling the key, while the browser still runs its paste
        // accelerator and xterm's own paste listener fires — pasting twice.
        e.preventDefault()
        pasteClipboard()
      }
      return false
    }
    // Split / close-pane belong to the app; don't send them to the shell.
    // Accept Cmd (macOS) as well as Ctrl so the shortcut bubbles on both.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (c === 'KeyD' || c === 'KeyW')) {
      return false
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && c === 'KeyC' && term?.hasSelection()) {
      copySelection()
      term.clearSelection()
      return false
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && c === 'KeyV') {
      e.preventDefault() // see above: otherwise the browser pastes a second time
      pasteClipboard()
      return false
    }
    // Find (Ctrl+F and Ctrl+Shift+F both open the search bar).
    if (e.ctrlKey && !e.altKey && c === 'KeyF') {
      openSearch()
      return false
    }
    // Ctrl +/-/0 is handled globally as page zoom; keep the terminal from
    // swallowing these keys so the app-level handler runs.
    if (
      e.ctrlKey &&
      !e.altKey &&
      ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Digit0', 'Numpad0'].includes(c)
    ) {
      return false
    }
    // Reserve app navigation (Ctrl+K palette, Ctrl+T new tab) — let them bubble
    // to the app rather than going to the shell. Ctrl+W stays with the shell
    // (werase); the app handler ignores it while the terminal is focused.
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (c === 'KeyK' || c === 'KeyT')) {
      return false
    }
    // Ctrl+Tab / Ctrl+Shift+Tab cycle tabs. Without this xterm consumes them
    // (sending a literal tab to the shell) and the app handler never runs.
    if (e.ctrlKey && !e.altKey && c === 'Tab') {
      return false
    }
    // More app chords that must reach the window handler. Every one of these
    // was measured to send nothing to the shell today, so nothing is taken
    // away from remote programs: Ctrl+1..9 (tab N), Ctrl+, (settings),
    // Ctrl+Shift+E (file drawer), Ctrl+Shift+P (palette), Ctrl+Shift+O
    // (other pane).
    // Matched on e.key, exactly like the window handler — matching on e.code
    // here would let the two disagree: a numpad key with NumLock off reports
    // e.key "End" (so nothing would act on it) and a non-QWERTY layout puts
    // the letters elsewhere. Either way the key would be swallowed for
    // nothing, and the shell would lose it.
    if (
      e.ctrlKey &&
      !e.altKey &&
      (e.key === '/' || e.key === '?' || (!e.shiftKey && (e.key === ',' || (e.key >= '1' && e.key <= '9'))))
    ) {
      return false
    }
    if (e.ctrlKey && e.shiftKey && !e.altKey && ['e', 'p', 'o'].includes(e.key.toLowerCase())) {
      return false
    }
    return true
  })

  term.onData((data) => window.api.ssh.input(props.sessionId, data))

  offData = window.api.ssh.onData((payload) => {
    if (payload.sessionId === props.sessionId) {
      term?.write(payload.data)
      scanCwd(payload.data)
    }
  })
  // Now that the listener exists, let main release what the shell printed
  // before this component mounted (MOTD, first prompt).
  window.api.ssh.attach(props.sessionId)

  ro = new ResizeObserver(() => doFit())
  ro.observe(el.value)

  nextTick(() => {
    doFit()
    if (props.focused) term?.focus()
  })
})

watch(
  () => props.visible,
  (v) => {
    if (v) nextTick(() => { doFit(); if (props.focused) term?.focus() })
  }
)

// Clicking a sibling pane makes this one active → pull focus to it.
watch(
  () => props.focused,
  (f) => {
    if (f && props.visible) nextTick(() => term?.focus())
  }
)

// Restyle live terminals when the day/night theme changes.
watch(mode, (m) => {
  if (term) term.options.theme = themeFor(m, store.terminalTheme)
})

// Apply a user-selected terminal color scheme live.
watch(
  () => store.terminalTheme,
  (t) => {
    if (term) term.options.theme = themeFor(mode.value, t)
  }
)

// Keep every terminal's font size in sync with the shared setting.
watch(fontSize, (s) => {
  if (term) {
    term.options.fontSize = s
    doFit()
  }
})

// Live-apply terminal appearance settings.
watch(
  () => store.terminalFontFamily,
  (f) => {
    if (term) {
      term.options.fontFamily = fontFamilyFor(f)
      doFit()
    }
  }
)
watch(
  () => store.terminalCursor,
  (c) => {
    if (term) term.options.cursorStyle = c
  }
)

defineExpose({
  focus: () => term?.focus()
})

onBeforeUnmount(() => {
  offData?.()
  ro?.disconnect()
  term?.dispose()
  term = null
})
</script>

<template>
  <div class="term-wrap" @contextmenu="openMenu">
    <div ref="el" class="term" />

    <div v-if="searchBar.open" class="search-bar" @mousedown.stop>
      <input
        ref="searchEl"
        v-model="searchBar.query"
        class="sb-input"
        :placeholder="t('term.searchPlaceholder')"
        spellcheck="false"
        @keydown.enter.exact.prevent="runSearch(true)"
        @keydown.shift.enter.prevent="runSearch(false)"
        @keydown.esc.prevent="closeSearch"
        @input="runSearch(true)"
      />
      <button class="sb-btn case" :class="{ on: searchBar.caseSensitive }" :title="t('term.caseTip')" @click="toggleCase">Aa</button>
      <button class="sb-btn" :title="t('term.prevTip')" @click="runSearch(false)"><Icon name="chevron-up" :size="15" /></button>
      <button class="sb-btn" :title="t('term.nextTip')" @click="runSearch(true)"><Icon name="chevron-down" :size="15" /></button>
      <button class="sb-btn" :title="t('term.closeTip')" @click="closeSearch"><Icon name="close" :size="15" /></button>
    </div>

    <div v-if="menu.open" class="ctx-overlay" @mousedown="menu.open = false" @contextmenu.prevent="menu.open = false">
      <div class="ctx" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @mousedown.stop>
        <button :disabled="!menu.hasSel" @click="runMenu(copySelection)">
          <span>{{ t('term.copy') }}</span><span class="k">Ctrl+C</span>
        </button>
        <button @click="runMenu(pasteClipboard)">
          <span>{{ t('term.paste') }}</span><span class="k">Ctrl+V</span>
        </button>
        <div class="sep" />
        <button @click="runMenu(openSearch)"><span>{{ t('term.find') }}</span><span class="k">Ctrl+F</span></button>
        <button @click="runMenu(selectAll)"><span>{{ t('term.selectAll') }}</span></button>
        <button @click="runMenu(clearTerm)"><span>{{ t('term.clear') }}</span></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.term-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.term {
  width: 100%;
  height: 100%;
  padding: 8px 4px 8px 12px;
  background: var(--bg);
}
.search-bar {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 6px;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
}
.sb-input {
  width: 180px;
  height: 26px;
  padding: 0 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  outline: none;
  font-size: 12.5px;
}
.sb-input:focus {
  border-color: var(--accent);
}
.sb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--text-dim);
}
.sb-btn:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.sb-btn.on {
  background: var(--accent-soft);
  color: var(--accent);
}
.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
}
.ctx {
  position: fixed;
  min-width: 172px;
  padding: 5px;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
}
.ctx button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--text);
  text-align: left;
}
.ctx button:hover:not(:disabled) {
  background: var(--accent-soft);
}
.ctx button:disabled {
  color: var(--text-faint);
  cursor: default;
}
.ctx .k {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
}
.ctx .sep {
  height: 1px;
  margin: 5px 4px;
  background: var(--border);
}
</style>
