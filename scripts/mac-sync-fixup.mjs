#!/usr/bin/env node
// Re-applies X-SSH's macOS-specific reconciliations after a full Windows→mac
// source sync (which overwrites the renderer with Ctrl-based, traffic-light-less
// code and drops the mac-only composables). Idempotent: safe to run repeatedly.
//
//   node scripts/mac-sync-fixup.mjs
//
// After a sync also run `npm ci` if node_modules came from Windows (win32 native
// binaries) — this script warns when it detects that.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const p = (...s) => join(root, ...s)
let changed = 0
const warns = []
const log = (s) => console.log(s)

// ---- 1. mac-only composables (authoritative: always written) ----------------
const PLATFORM_TS = `/**
 * Platform helpers. The app-level modifier differs by OS: ⌘ on macOS (leaving
 * every Ctrl combo free for the shell), Ctrl on Windows/Linux.
 */
export const isMac = window.api.platform === 'darwin'

/** True when the platform's app-level modifier is held: ⌘ on macOS, Ctrl elsewhere. */
export function appMod(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}
`

const ZOOM_TS = `import { ref, computed, type ComputedRef, type Ref } from 'vue'

/**
 * UI zoom, backed by Electron's webFrame zoom *level* (each step is ×1.2). A
 * reactive \`factor\` (1.2^level) is exposed so the macOS tab bar can
 * counter-scale itself and stay glued to the native (unscaled) traffic lights.
 * Persistence matches the app: restored from window.api.prefs.zoom, saved
 * (debounced) to settings.json.
 */
const MIN = -3
const MAX = 5
const clamp = (l: number): number => Math.max(MIN, Math.min(MAX, l))
const initial = Number(window.api.prefs?.zoom)
const level = ref(Number.isNaN(initial) ? 0 : clamp(initial))
let saveTimer: ReturnType<typeof setTimeout> | null = null

export interface ZoomApi {
  level: Ref<number>
  factor: ComputedRef<number>
  setLevel: (l: number) => void
  bump: (delta: number) => void
  reset: () => void
  apply: () => void
}

export function useZoom(): ZoomApi {
  const factor = computed(() => 1.2 ** level.value)
  function setLevel(l: number): void {
    level.value = clamp(l)
    window.api.zoom.set(level.value)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void window.api.settings.set('zoom', level.value), 300)
  }
  return {
    level,
    factor,
    setLevel,
    bump: (delta: number) => setLevel(level.value + delta),
    reset: () => setLevel(0),
    apply: () => window.api.zoom.set(level.value)
  }
}
`

function ensureFile(rel, content) {
  const abs = p(rel)
  mkdirSync(dirname(abs), { recursive: true })
  const cur = existsSync(abs) ? readFileSync(abs, 'utf8') : null
  if (cur === content) { log(`  = ${rel} (up to date)`); return }
  writeFileSync(abs, content)
  changed++
  log(`  ${cur === null ? '+ created' : '~ updated'} ${rel}`)
}

// ---- 2. guarded in-file patches ---------------------------------------------
// Each edit: { name, from, to, done } — skip if `done` marker already present;
// apply if `from` found; warn if neither (Windows base changed → reconcile by hand).
function patch(rel, edits) {
  const abs = p(rel)
  if (!existsSync(abs)) { warns.push(`${rel}: file missing`); return }
  let src = readFileSync(abs, 'utf8')
  let touched = false
  for (const e of edits) {
    if (e.done && src.includes(e.done)) { continue }
    if (src.includes(e.from)) {
      src = src.replace(e.from, e.to)
      touched = true
      log(`  ✓ ${rel}: ${e.name}`)
    } else {
      warns.push(`${rel}: could not apply "${e.name}" — pattern not found (reconcile manually)`)
    }
  }
  if (touched) { writeFileSync(abs, src); changed++ }
}

log('macOS sync fix-up:')
ensureFile('src/renderer/src/composables/platform.ts', PLATFORM_TS)
ensureFile('src/renderer/src/composables/zoom.ts', ZOOM_TS)

// preload: expose platform
patch('src/preload/index.ts', [{
  name: 'expose window.api.platform',
  done: 'platform: process.platform',
  from: `  getPathForFile: (file: File): string => webUtils.getPathForFile(file),\n  zoom: {`,
  to: `  getPathForFile: (file: File): string => webUtils.getPathForFile(file),\n  /** Host OS, so the renderer can pick the right modifier (⌘ on macOS, Ctrl elsewhere). */\n  platform: process.platform,\n  zoom: {`
}])

// App.vue
patch('src/renderer/src/App.vue', [
  {
    name: 'import platform + zoom composables',
    done: "composables/platform",
    from: `import { useSessions } from './stores/sessions'\nimport TabBar from './components/TabBar.vue'`,
    to: `import { useSessions } from './stores/sessions'\nimport { appMod, isMac } from './composables/platform'\nimport { useZoom } from './composables/zoom'\nimport TabBar from './components/TabBar.vue'`
  },
  {
    name: 'drop local navigator isMac',
    done: '// Modifier symbol shown in hints',
    from: `// Show the platform's real modifier key in hints (⌘ on macOS, Ctrl elsewhere).\nconst isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)\nconst modKey = isMac ? '⌘' : 'Ctrl'`,
    to: `// Modifier symbol shown in hints (⌘ on macOS, Ctrl elsewhere).\nconst modKey = isMac ? '⌘' : 'Ctrl'`
  },
  {
    name: 'route zoom through useZoom + appMod wheel',
    done: 'const { bump: bumpZoom, reset: resetZoom, apply: applyZoom } = useZoom()',
    from: `let zoomSaveTimer: ReturnType<typeof setTimeout> | null = null\nfunction setZoom(level: number): void {\n  const clamped = Math.max(-3, Math.min(5, level))\n  window.api.zoom.set(clamped)\n  // Apply immediately but debounce the persist: a Ctrl+wheel gesture fires many\n  // notches, and each write is a full re-read+rewrite of settings.json that a\n  // second instance could be reading at the same moment.\n  if (zoomSaveTimer) clearTimeout(zoomSaveTimer)\n  zoomSaveTimer = setTimeout(() => void window.api.settings.set('zoom', clamped), 300)\n}\nfunction bumpZoom(delta: number): void {\n  setZoom(window.api.zoom.get() + delta)\n}\n\nfunction onWheel(e: WheelEvent): void {\n  if (!(e.ctrlKey || e.metaKey)) return\n  // Ctrl + wheel zooms the whole UI; intercept before the terminal scrolls.\n  e.preventDefault()\n  e.stopPropagation()\n  bumpZoom(e.deltaY < 0 ? 0.5 : -0.5)\n}`,
    to: `const { bump: bumpZoom, reset: resetZoom, apply: applyZoom } = useZoom()\n\nfunction onWheel(e: WheelEvent): void {\n  // ⌘ (macOS) / Ctrl (elsewhere) + wheel zooms the whole UI. On macOS we require\n  // ⌘ specifically so Ctrl+wheel stays free for macOS's system screen zoom.\n  if (!appMod(e)) return\n  e.preventDefault()\n  e.stopPropagation()\n  bumpZoom(e.deltaY < 0 ? 0.5 : -0.5)\n}`
  },
  {
    name: 'global keys use appMod',
    done: 'const mod = appMod(e)',
    from: `  const mod = e.ctrlKey || e.metaKey\n  if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {`,
    to: `  // ⌘ on macOS, Ctrl elsewhere — leaves Ctrl+K/T/… free for the shell on macOS.\n  const mod = appMod(e)\n  if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {`
  },
  {
    name: '⌘W closes tab even in terminal on mac',
    done: '!isMac && inTerminal',
    from: `    // Ctrl+W is werase in a shell — never close the session tab from within\n    // the terminal.\n    if (inTerminal) return`,
    to: `    // On Windows/Linux Ctrl+W is werase — never close the tab from the terminal.\n    // On macOS ⌘W is unambiguous, so it always closes the tab.\n    if (!isMac && inTerminal) return`
  },
  {
    name: 'reset zoom via composable',
    done: 'resetZoom()',
    from: `    setZoom(0)`,
    to: `    resetZoom()`
  },
  {
    name: 'apply restored zoom on mount',
    done: 'applyZoom()',
    from: `  const savedZoom = Number(window.api.prefs.zoom)\n  if (!Number.isNaN(savedZoom) && savedZoom !== 0) window.api.zoom.set(savedZoom)`,
    to: `  applyZoom() // push the restored zoom level to webFrame`
  }
])

// TerminalView.vue
patch('src/renderer/src/components/TerminalView.vue', [
  {
    name: 'import isMac',
    done: "import { isMac } from '../composables/platform'",
    from: `import { useSessions } from '../stores/sessions'\nimport Icon from './Icon.vue'`,
    to: `import { useSessions } from '../stores/sessions'\nimport { isMac } from '../composables/platform'\nimport Icon from './Icon.vue'`
  },
  {
    name: 'platform-aware key handler',
    done: 'const mod = isMac ? e.metaKey : e.ctrlKey',
    from: `  // Terminal-style copy/paste shortcuts. Ctrl+C only copies when text is\n  // selected, otherwise it passes through as SIGINT.\n  term.attachCustomKeyEventHandler((e) => {\n    if (e.type !== 'keydown') return true\n    const c = e.code\n    if (e.ctrlKey && e.shiftKey && (c === 'KeyC' || c === 'KeyV')) {\n      if (c === 'KeyC') copySelection()\n      else pasteClipboard()\n      return false\n    }\n    // Split / close-pane belong to the app; don't send them to the shell.\n    // Accept Cmd (macOS) as well as Ctrl so the shortcut bubbles on both.\n    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (c === 'KeyD' || c === 'KeyW')) {\n      return false\n    }\n    if (e.ctrlKey && !e.shiftKey && !e.altKey && c === 'KeyC' && term?.hasSelection()) {\n      copySelection()\n      term.clearSelection()\n      return false\n    }\n    if (e.ctrlKey && !e.shiftKey && !e.altKey && c === 'KeyV') {\n      pasteClipboard()\n      return false\n    }\n    // Find\n    if (e.ctrlKey && !e.shiftKey && !e.altKey && c === 'KeyF') {\n      openSearch()\n      return false\n    }\n    // Ctrl +/-/0 is handled globally as page zoom; keep the terminal from\n    // swallowing these keys so the app-level handler runs.\n    if (\n      e.ctrlKey &&\n      !e.altKey &&\n      ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Digit0', 'Numpad0'].includes(c)\n    ) {\n      return false\n    }\n    // Reserve app navigation (Ctrl+K palette, Ctrl+T new tab) — let them bubble\n    // to the app rather than going to the shell. Ctrl+W stays with the shell\n    // (werase); the app handler ignores it while the terminal is focused.\n    if (e.ctrlKey && !e.shiftKey && !e.altKey && (c === 'KeyK' || c === 'KeyT')) {\n      return false\n    }\n    return true\n  })`,
    to: `  // Copy/paste/find use the platform's app modifier (⌘ on macOS, Ctrl elsewhere).\n  // On macOS every Ctrl combo stays with the shell (Ctrl+C → SIGINT).\n  term.attachCustomKeyEventHandler((e) => {\n    if (e.type !== 'keydown') return true\n    const c = e.code\n    const mod = isMac ? e.metaKey : e.ctrlKey\n    const otherMod = isMac ? e.ctrlKey : e.metaKey\n\n    if (!isMac && e.ctrlKey && e.shiftKey && (c === 'KeyC' || c === 'KeyV')) {\n      if (c === 'KeyC') copySelection()\n      else pasteClipboard()\n      return false\n    }\n    if (mod && e.shiftKey && !e.altKey && (c === 'KeyD' || c === 'KeyW')) {\n      return false\n    }\n    if (mod && !otherMod && !e.shiftKey && !e.altKey) {\n      if (c === 'KeyC') {\n        if (term?.hasSelection()) {\n          copySelection()\n          term.clearSelection()\n          return false\n        }\n        if (isMac) return false\n      } else if (c === 'KeyV') {\n        pasteClipboard()\n        return false\n      } else if (c === 'KeyF') {\n        openSearch()\n        return false\n      } else if (\n        ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Digit0', 'Numpad0', 'KeyK', 'KeyT'].includes(c) ||\n        (isMac && c === 'KeyW')\n      ) {\n        return false\n      }\n    }\n    return true\n  })`
  },
  {
    name: 'keep a WebglAddon ref',
    done: 'let webgl: WebglAddon | null = null',
    from: `let fit: FitAddon | null = null\nlet search: SearchAddon | null = null`,
    to: `let fit: FitAddon | null = null\nlet search: SearchAddon | null = null\nlet webgl: WebglAddon | null = null`
  },
  {
    name: 'load WebGL with a ref',
    done: 'webgl = new WebglAddon()',
    from: `  try {\n    term.loadAddon(new WebglAddon())\n  } catch {\n    /* WebGL unavailable — falls back to canvas/DOM renderer */\n  }`,
    to: `  try {\n    webgl = new WebglAddon()\n    term.loadAddon(webgl)\n    webgl.onContextLoss(() => {\n      webgl?.dispose()\n      webgl = null\n    })\n  } catch {\n    webgl = null\n    /* WebGL unavailable — falls back to canvas/DOM renderer */\n  }`
  },
  {
    name: 'clear WebGL glyph atlas on font-size / font-family change',
    done: 'webgl?.clearTextureAtlas()',
    from: `// Keep every terminal's font size in sync with the shared setting.\nwatch(fontSize, (s) => {\n  if (term) {\n    term.options.fontSize = s\n    doFit()\n  }\n})\n\n// Live-apply terminal appearance settings.\nwatch(\n  () => store.terminalFontFamily,\n  (f) => {\n    if (term) {\n      term.options.fontFamily = fontFamilyFor(f)\n      doFit()\n    }\n  }\n)`,
    to: `// Keep every terminal's font size in sync with the shared setting.\nwatch(fontSize, (s) => {\n  if (term) {\n    term.options.fontSize = s\n    webgl?.clearTextureAtlas()\n    doFit()\n  }\n})\n\n// Live-apply terminal appearance settings. The WebGL renderer caches glyphs in a\n// texture atlas; a font-family change at the same size leaves stale glyphs unless\n// we clear it, so the switch would otherwise appear to do nothing.\nwatch(\n  () => store.terminalFontFamily,\n  (f) => {\n    if (term) {\n      term.options.fontFamily = fontFamilyFor(f)\n      webgl?.clearTextureAtlas()\n      doFit()\n    }\n  }\n)`
  },
  {
    name: 'null the WebglAddon ref on unmount',
    done: `  term = null\n  webgl = null`,
    from: `  term?.dispose()\n  term = null\n})`,
    to: `  term?.dispose()\n  term = null\n  webgl = null\n})`
  }
])

// TabBar.vue
patch('src/renderer/src/components/TabBar.vue', [
  {
    name: 'imports + barStyle (traffic-light counter-scale)',
    done: "import { isMac } from '../composables/platform'",
    from: `import { reactive } from 'vue'\nimport { useSessions, type Tab } from '../stores/sessions'\nimport { useTheme } from '../composables/theme'\nimport Icon from './Icon.vue'\n\nconst store = useSessions()\nconst { mode, toggle } = useTheme()`,
    to: `import { reactive, computed } from 'vue'\nimport { useSessions, type Tab } from '../stores/sessions'\nimport { useTheme } from '../composables/theme'\nimport { useZoom } from '../composables/zoom'\nimport { isMac } from '../composables/platform'\nimport Icon from './Icon.vue'\n\nconst store = useSessions()\nconst { mode, toggle } = useTheme()\nconst { factor } = useZoom()\nconst modKey = isMac ? '⌘' : 'Ctrl'\n// Counter-scale the bar on macOS so it stays a constant physical size and\n// aligned with the native (zoom-independent) traffic lights.\nconst barStyle = computed(() => (isMac ? { zoom: 1 / factor.value } : {}))`
  },
  {
    name: 'tabbar mac class + style binding',
    done: ':class="{ mac: isMac }" :style="barStyle"',
    from: `  <div class="tabbar">`,
    to: `  <div class="tabbar" :class="{ mac: isMac }" :style="barStyle">`
  },
  {
    name: 'mac traffic-light CSS',
    done: '.tabbar.mac {',
    from: `.tabbar {\n  display: flex;\n  align-items: center;\n  height: 40px;\n  padding: 0 8px;\n  gap: 6px;\n  background: var(--bg-elev);\n  border-bottom: 1px solid var(--border);\n  -webkit-app-region: drag;\n}`,
    to: `.tabbar {\n  display: flex;\n  align-items: center;\n  height: 40px;\n  padding: 0 8px;\n  gap: 6px;\n  background: var(--bg-elev);\n  border-bottom: 1px solid var(--border);\n  -webkit-app-region: drag;\n}\n/* Reserve room for the native macOS traffic lights (hiddenInset title bar). */\n.tabbar.mac {\n  padding-left: 72px;\n}\n.tabbar.mac > * {\n  position: relative;\n  top: 1px;\n}`
  }
])

// CommandPalette.vue: submit the password on Enter from the palette level, so a
// press still connects when focus is on the "remember password" checkbox (not
// just the field). Also removes the field's own handler to avoid a double submit.
patch('src/renderer/src/components/CommandPalette.vue', [
  {
    name: 'Enter submits password from palette level',
    done: "e.key === 'Enter' && !e.isComposing",
    from: `  if (pending.value) {\n    if (e.key === 'Escape') {\n      pending.value = null\n      nextTick(() => inputEl.value?.focus())\n    }\n    return\n  }`,
    to: `  if (pending.value) {\n    // Handle Enter at the palette level (not just on the password <input>): the\n    // prompt also has a "remember password" checkbox, and if focus lands there\n    // (or anywhere but the field) Enter must still submit and connect.\n    if (e.key === 'Enter' && !e.isComposing) {\n      e.preventDefault()\n      void submitPassword()\n    } else if (e.key === 'Escape') {\n      pending.value = null\n      nextTick(() => inputEl.value?.focus())\n    }\n    return\n  }`
  }
])

// main/index.ts: center in the work area (Electron center:true ignores the Dock)
patch('src/main/index.ts', [{
  name: 'flush settings on quit',
  done: "app.on('will-quit'",
  from: `app.on('window-all-closed', () => {\n  if (process.platform !== 'darwin') app.quit()\n})`,
  to: `app.on('window-all-closed', () => {\n  if (process.platform !== 'darwin') app.quit()\n})\n\n// Flush pending settings writes (theme toggle, window bounds, …) before the\n// process exits, so a setting changed right before quit isn't lost to an\n// in-flight async write. Capped so a stuck write can never block quit.\nlet settingsFlushed = false\napp.on('will-quit', (e) => {\n  if (settingsFlushed) return\n  settingsFlushed = true\n  e.preventDefault()\n  setTimeout(() => {\n    Promise.race([settings.flush(), new Promise((r) => setTimeout(r, 800))]).finally(() =>\n      app.quit()\n    )\n  }, 50)\n})`
}])

// settings.ts: durable writes — flush() to drain on quit, atomic temp+rename on
// macOS/Linux so a crash/quit mid-write can't blank settings.json (theme et al).
patch('src/main/settings.ts', [
  {
    name: 'import rename',
    done: 'mkdir, rename }',
    from: `import { readFile, writeFile, mkdir } from 'node:fs/promises'`,
    to: `import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'`
  },
  {
    name: 'flush() method',
    done: 'async flush(): Promise<void>',
    from: `    this.writes = this.writes.then(() => this.write(key, value)).catch(() => undefined)\n    return this.writes\n  }`,
    to: `    this.writes = this.writes.then(() => this.write(key, value)).catch(() => undefined)\n    return this.writes\n  }\n\n  /** Wait for all queued writes to hit disk. Call on quit so a just-changed\n   *  setting (e.g. the theme toggle) isn't lost when the process exits. */\n  async flush(): Promise<void> {\n    await this.writes.catch(() => undefined)\n  }`
  },
  {
    name: 'atomic write on macOS/Linux',
    done: 'const tmp =',
    from: `    await mkdir(this.dir, { recursive: true })\n    // Plain writeFile, deliberately not write-temp-then-rename: on Windows a\n    // rename-replace fails with EPERM whenever another instance has the file\n    // momentarily open (measured ~97% of the time under contention), and set()\n    // swallows errors, so that would silently drop writes. writeFile opens\n    // shared and never throws here; a reader catching the brief truncation\n    // window is handled by readData()'s retry. Two processes writing different\n    // keys at the same instant is still last-writer-wins, but these are\n    // low-frequency UI prefs, so that's acceptable.\n    await writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8')\n  }`,
    to: `    await mkdir(this.dir, { recursive: true })\n    const json = JSON.stringify(this.data, null, 2)\n    if (process.platform === 'win32') {\n      // Windows: rename-replace EPERMs under multi-instance contention and set()\n      // swallows errors, so write in place; readData()'s retry tolerates the\n      // brief truncation window a concurrent reader may see.\n      await writeFile(this.file, json, 'utf8')\n    } else {\n      // macOS/Linux: temp file + atomic rename, so a crash/quit mid-write can\n      // never leave settings.json empty/truncated (blanking every setting).\n      const tmp = \`\${this.file}.\${process.pid}.tmp\`\n      await writeFile(tmp, json, 'utf8')\n      await rename(tmp, this.file)\n    }\n  }`
  }
])

// package.json: mac LAN usage description
patch('package.json', [{
  name: 'NSLocalNetworkUsageDescription',
  done: 'NSLocalNetworkUsageDescription',
  from: `    "mac": {\n      "icon": "build/icon.png"\n    },`,
  to: `    "mac": {\n      "icon": "build/icon.png",\n      "extendInfo": {\n        "NSLocalNetworkUsageDescription": "X-SSH 需要访问本地网络,以便连接局域网内的 SSH 服务器。"\n      }\n    },`
}])

// HostEditor.vue: plain Enter (not only ⌘/Ctrl+Enter) saves the host.
patch('src/renderer/src/components/HostEditor.vue', [
  {
    name: 'onEnter save handler',
    done: 'function onEnter(e: KeyboardEvent)',
    from: `  store.hosts = await window.api.hosts.save(host, pw, pp)\n  emit('close')\n}`,
    to: `  store.hosts = await window.api.hosts.save(host, pw, pp)\n  emit('close')\n}\n\n// Enter saves: plain Enter while a text field is focused, or ⌘/Ctrl+Enter\n// anywhere. Enter on the auth-method buttons is left to select the method.\nfunction onEnter(e: KeyboardEvent): void {\n  if (e.isComposing) return\n  const inField = (e.target as HTMLElement).tagName === 'INPUT'\n  if (inField || e.metaKey || e.ctrlKey) {\n    e.preventDefault()\n    if (canSave()) void save()\n  }\n}`
  },
  {
    name: 'editor keydown → onEnter',
    done: `@keydown.enter="onEnter"`,
    from: `    <div class="editor" @keydown.esc="emit('close')" @keydown.meta.enter="save" @keydown.ctrl.enter="save">`,
    to: `    <div class="editor" @keydown.esc="emit('close')" @keydown.enter="onEnter">`
  }
])

// shared/ipc.ts: the prefetch channel.
patch('src/shared/ipc.ts', [{
  name: 'sftpPrefetchDrag channel',
  done: 'sftpPrefetchDrag:',
  from: `  sftpStartDrag: 'sftp:startDrag', // renderer -> main (drag out)`,
  to: `  sftpPrefetchDrag: 'sftp:prefetchDrag', // renderer -> main (warm the drag-out download on mousedown)\n  sftpStartDrag: 'sftp:startDrag', // renderer -> main (drag out)`
}])

// preload: the prefetchDrag method.
patch('src/preload/index.ts', [{
  name: 'sftp.prefetchDrag',
  done: 'prefetchDrag: (sessionId',
  from: `    startDrag: (sessionId: string, remotePath: string, name: string, isDir: boolean): void =>\n      ipcRenderer.send(IPC.sftpStartDrag, sessionId, remotePath, name, isDir),`,
  to: `    prefetchDrag: (sessionId: string, remotePath: string, name: string, isDir: boolean): void =>\n      ipcRenderer.send(IPC.sftpPrefetchDrag, sessionId, remotePath, name, isDir),\n    startDrag: (sessionId: string, remotePath: string, name: string, isDir: boolean): void =>\n      ipcRenderer.send(IPC.sftpStartDrag, sessionId, remotePath, name, isDir),`
}])

// main/index.ts: cache the icon in the prefetch and drop the getFileIcon await
// from startDrag (an async hop there can push it past macOS's drag window); add
// the prefetch IPC handler.
patch('src/main/index.ts', [
  {
    name: 'dragCache holds icon',
    done: 'local: string; icon: Electron.NativeImage }>>',
    from: `const dragCache = new Map<string, Promise<{ dir: string; local: string }>>()`,
    to: `const dragCache = new Map<string, Promise<{ dir: string; local: string; icon: Electron.NativeImage }>>()`
  },
  {
    name: 'prefetchDrag return type',
    done: 'local: string; icon: Electron.NativeImage }> {',
    from: `): Promise<{ dir: string; local: string }> {`,
    to: `): Promise<{ dir: string; local: string; icon: Electron.NativeImage }> {`
  },
  {
    name: 'prefetch fetches the icon',
    done: 'return { dir, local, icon }',
    from: `      const local = await sshManager!.downloadTree(sessionId, remotePath, dir, name, isDir)\n      return { dir, local }\n    })()`,
    to: `      const local = await sshManager!.downloadTree(sessionId, remotePath, dir, name, isDir)\n      let icon = DRAG_ICON\n      try {\n        icon = await app.getFileIcon(local, { size: 'normal' })\n      } catch {\n        /* keep the placeholder */\n      }\n      return { dir, local, icon }\n    })()`
  },
  {
    name: 'prefetch IPC + prompt startDrag',
    done: 'IPC.sftpPrefetchDrag',
    from: `  // Drag out (dragstart): download to a temp dir, then startDrag.\n  ipcMain.on(\n    IPC.sftpStartDrag,\n    async (\n      e,\n      sessionId: string,\n      remotePath: string,\n      name: string,\n      isDir: boolean\n    ) => {\n      try {\n        const { local } = await prefetchDrag(sessionId, remotePath, name, isDir)\n        let icon = DRAG_ICON\n        try {\n          icon = await app.getFileIcon(local, { size: 'normal' })\n        } catch {\n          /* fall back to the placeholder icon */\n        }\n        e.sender.startDrag({ file: local, icon })\n      } catch {\n        /* download failed or the drag gesture already ended */\n      }\n    }\n  )`,
    to: `  // Warm the drag-out download the moment a row is pressed (mousedown), so the\n  // file is already on disk (with its icon) by the time the drag starts.\n  ipcMain.on(\n    IPC.sftpPrefetchDrag,\n    (_e, sessionId: string, remotePath: string, name: string, isDir: boolean) => {\n      void prefetchDrag(sessionId, remotePath, name, isDir).catch(() => undefined)\n    }\n  )\n\n  // Drag out (dragstart): start the native drag with the (pre)downloaded file.\n  ipcMain.on(\n    IPC.sftpStartDrag,\n    async (\n      e,\n      sessionId: string,\n      remotePath: string,\n      name: string,\n      isDir: boolean\n    ) => {\n      try {\n        const { local, icon } = await prefetchDrag(sessionId, remotePath, name, isDir)\n        e.sender.startDrag({ file: local, icon })\n      } catch {\n        /* download failed or the drag gesture already ended */\n      }\n    }\n  )`
  }
])

// ---- 3. node_modules platform check -----------------------------------------
try {
  const rollup = readdirSync(p('node_modules/@rollup')).join(',')
  if (rollup.includes('win32') && !rollup.includes('darwin')) {
    warns.push('node_modules holds win32 native binaries (rollup/esbuild). Run: rm -rf node_modules && npm ci')
  }
} catch { /* @rollup not present */ }

// ---- summary ----------------------------------------------------------------
log('')
if (warns.length) {
  log('⚠ attention:')
  for (const w of warns) log('   - ' + w)
}
log(changed ? `Done — ${changed} file(s) changed. Run: npm run typecheck && npm run build`
            : 'Done — everything already reconciled (no changes).')
