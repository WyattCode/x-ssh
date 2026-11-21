<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessions } from '../stores/sessions'
import { useTheme } from '../composables/theme'
import { useI18n } from '../lib/i18n'
import { isMac } from '../composables/platform'
import { useZoom } from '../composables/zoom'
import Icon from './Icon.vue'
import HostRail from './HostRail.vue'
import type { Host } from '../../../shared/types'

// The left column is the host rail, on every view: there is no page menu. Below
// the list sit the things that are not hosts — settings, port forwarding, theme,
// and folding the rail away.
// `hidden`: the rail folded away (toggled from the tab bar, Ctrl/⌘+B).
defineProps<{ hidden?: boolean }>()
const emit = defineEmits<{ (e: 'new-host'): void; (e: 'edit-host', h: Host): void }>()
const store = useSessions()
const { pref, setPref } = useTheme()
const { t } = useI18n()
const { factor } = useZoom()

// Same number as the port-forwarding sheet's title: saved rules plus live temporary ones.
const forwardCount = computed(() => store.forwardGroups.reduce((n, g) => n + g.rows.length, 0))

// Same cycle and icons as the Android app (ThemeMode.next): follow system →
// light → dark → follow system.
const THEME_CYCLE = {
  system: { next: 'light', icon: 'auto' },
  light: { next: 'dark', icon: 'sun' },
  dark: { next: 'system', icon: 'moon' }
} as const
const themeName = computed(
  () => ({ system: t('theme.system'), light: t('theme.light'), dark: t('theme.dark') })[pref.value]
)

// ---- Drag the right edge to resize; remembered on release ----
const dragging = ref(false)
function onEdgeDown(e: PointerEvent): void {
  const startX = e.clientX
  const startW = store.sidebarWidth
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  dragging.value = true
  const move = (ev: PointerEvent): void => store.setSidebarWidth(startW + ev.clientX - startX, false)
  const up = (): void => {
    dragging.value = false
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    store.setSidebarWidth(store.sidebarWidth)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}
</script>

<template>
  <aside
    class="sidebar"
    :class="{ mac: isMac, hidden, dragging }"
    :style="[{ width: store.sidebarWidth + 'px' }, isMac ? { '--zf': factor } : undefined]"
  >
    <div class="edge" @pointerdown.prevent="onEdgeDown" />
    <HostRail @new-host="emit('new-host')" @edit-host="(h) => emit('edit-host', h)" />
    <div class="rail-foot">
      <button class="rail-nav" :class="{ on: store.sheet === 'settings' }" :title="t('nav.settings')" :aria-label="t('nav.settings')" @click="store.toggleSettings()">
        <Icon name="settings" :ink="11.1" :weight="1.3" />
      </button>
      <button class="rail-nav" :class="{ on: store.sheet === 'forwards' }" :title="t('nav.forwards')" :aria-label="t('nav.forwards')" @click="store.openSheet(store.sheet === 'forwards' ? null : 'forwards')">
        <Icon name="forward" :ink="11.1" :weight="1.3" /><span v-if="forwardCount" class="n">{{ forwardCount }}</span>
      </button>
      <span class="grow" />
      <button class="rail-nav" :title="t('theme.current', { name: themeName })" :aria-label="themeName" @click="setPref(THEME_CYCLE[pref].next)">
        <Icon :name="THEME_CYCLE[pref].icon" :ink="11.1" :weight="1.3" />
      </button>
      <!-- Fold button: duplicated the rail toggle at the top left of the tab bar (TabBar.vue, Ctrl/⌘+B), so it is off here.
      <button class="rail-nav" :title="t('rail.fold')" :aria-label="t('rail.fold')" @click="store.setTermSidebarHidden(true)">
        <Icon name="sidebar" :size="18" />
      </button>
      -->
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  padding: 0 10px;
  background: var(--bg-elev);
  border-right: 1px solid var(--chrome-line);
  /* A big app zoom shrinks the window in CSS pixels: the rail may not eat more than
     two fifths of it (the terminal needs the rest). */
  max-width: 40vw;
  /* Collapsing is instant: animating the width slides the terminal a fraction of
     a pixel per frame, and its WebGL text shimmers the whole way. */
  overflow: visible;
}
.sidebar.dragging {
  user-select: none;
}
/* Gone at once, not animated: the terminal re-fits to the new width, and a
   width transition would send the server a burst of resizes. */
.sidebar.hidden {
  display: none;
}
/* Resize edge: a 6px strip over the border; the line lights up on hover / drag. */
.edge {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  z-index: 5;
  cursor: col-resize;
}
.edge::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  background: transparent;
  transition: background 0.16s var(--ease);
}
.edge:hover::after,
.dragging .edge::after {
  background: color-mix(in srgb, var(--cursor) 55%, transparent);
}
/* The foot is a band of the status line's height: its hairline and its icons sit on the
   same lines as the status line's (they end at the same bottom edge). */
.rail-foot {
  display: flex;
  align-items: center;
  flex: none;
  gap: 0;
  height: var(--band-bot);
  margin: 0 -10px;
  padding: 0 10px;
  border-top: 1px solid var(--chrome-line);
}
.rail-foot .grow {
  flex: 1;
}
.rail-nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 34px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  color: var(--text);
  transition: background 0.16s, color 0.16s, transform 0.3s cubic-bezier(0.3, 1.35, 0.5, 1);
}
.rail-nav:hover,
.rail-nav.on {
  color: var(--text);
  background: var(--hover);
}
.rail-nav.on {
  color: var(--cursor);
}
.rail-nav:active {
  transform: scale(0.92);
}
.rail-nav .n {
  font-family: var(--font-chrome);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
