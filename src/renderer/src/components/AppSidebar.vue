<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessions, type AppPage } from '../stores/sessions'
import { useTheme } from '../composables/theme'
import { useI18n } from '../lib/i18n'
import Icon from './Icon.vue'
import logoLight from '../assets/logo-light.png'
import logoDark from '../assets/logo-dark.png'
import markLight from '../assets/mark-light.svg'
import markDark from '../assets/mark-dark.svg'

// `hidden`: the 终端 page's full-width mode (toggled from the tab bar).
defineProps<{ hidden?: boolean }>()
const store = useSessions()
const { pref, setPref } = useTheme()
const { t } = useI18n()

// Same number as the 端口转发 page's title: saved rules plus live temporary ones.
const forwardCount = computed(() => store.forwardGroups.reduce((n, g) => n + g.rows.length, 0))
const NAV = computed<{ id: AppPage; icon: string; label: string; count?: number }[]>(() => [
  { id: 'hosts', icon: 'server', label: t('nav.hosts'), count: store.hosts.length },
  { id: 'terminal', icon: 'terminal', label: t('nav.terminal'), count: store.tabs.length || undefined },
  { id: 'sftp', icon: 'folder', label: 'SFTP' },
  { id: 'forwards', icon: 'forward', label: t('nav.forwards'), count: forwardCount.value || undefined },
  { id: 'settings', icon: 'settings', label: t('nav.settings') }
])

// Same cycle and icons as the Android app (ThemeMode.next): follow system →
// light → dark → follow system.
const THEME_CYCLE = {
  system: { next: 'light', icon: 'auto' },
  light: { next: 'dark', icon: 'sun' },
  dark: { next: 'system', icon: 'moon' }
} as const
// ---- Drag the right edge to resize; remembered on release ----
const dragging = ref(false)
function onEdgeDown(e: PointerEvent): void {
  if (store.sidebarCollapsed) return
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

// Literal keys (not 'theme.' + id) so lint:i18n can check they exist.
const themeName = computed(
  () => ({ system: t('theme.system'), light: t('theme.light'), dark: t('theme.dark') })[pref.value]
)
</script>

<template>
  <aside
    class="sidebar"
    :class="{ collapsed: store.sidebarCollapsed, hidden, dragging, instant: store.page === 'terminal' }"
    :style="store.sidebarCollapsed ? undefined : { width: store.sidebarWidth + 'px' }"
  >
    <div v-if="!store.sidebarCollapsed" class="edge" @pointerdown.prevent="onEdgeDown" />
    <div class="brand">
      <template v-if="!store.sidebarCollapsed">
        <img class="lockup dark-only" :src="logoDark" alt="X-SSH" draggable="false" />
        <img class="lockup light-only" :src="logoLight" alt="X-SSH" draggable="false" />
      </template>
      <template v-else>
        <img class="mark dark-only" :src="markDark" alt="X-SSH" draggable="false" />
        <img class="mark light-only" :src="markLight" alt="X-SSH" draggable="false" />
      </template>
    </div>

    <nav class="nav">
      <button
        v-for="item in NAV"
        :key="item.id"
        class="nav-item"
        :class="{ on: store.page === item.id }"
        :title="store.sidebarCollapsed ? item.label : undefined"
        @click="store.setPage(item.id)"
      >
        <Icon :name="item.icon" :size="18" />
        <span class="label">{{ item.label }}</span>
        <span v-if="item.count" class="count">{{ item.count }}</span>
      </button>
    </nav>

    <div class="foot">
      <button class="foot-btn" :title="t('theme.current', { name: themeName })" @click="setPref(THEME_CYCLE[pref].next)">
        <Icon :name="THEME_CYCLE[pref].icon" :size="17" />
        <span class="label">{{ themeName }}</span>
      </button>
      <button
        class="foot-btn"
        :title="store.sidebarCollapsed ? t('nav.expand') : t('nav.collapse')"
        @click="store.setSidebarCollapsed(!store.sidebarCollapsed)"
      >
        <Icon name="sidebar" :size="17" />
        <span class="label">{{ t('nav.collapse') }}</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  width: 224px;
  padding: 18px 12px 12px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 70%, transparent), transparent 60%),
    color-mix(in srgb, var(--bg-elev) 55%, var(--bg));
  border-right: 1px solid var(--border);
  transition: width 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  /* Labels clip while collapsing, but the resize edge pokes 3px outside. */
  overflow: visible;
}
.nav,
.brand,
.foot {
  overflow: hidden;
}
.sidebar.collapsed {
  width: 64px;
}
.sidebar.dragging {
  transition: none;
  user-select: none;
}
/* On the 终端 page collapse / expand is instant: animating the width slides
   the terminal a fraction of a pixel per frame, and its WebGL text shimmers
   the whole way. */
.sidebar.instant {
  transition: none;
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
  background: color-mix(in srgb, var(--accent) 55%, transparent);
}
/* Gone at once, not animated: the terminal re-fits to the new width, and a
   width transition would send the server a burst of resizes (visible redraws). */
.sidebar.hidden {
  display: none;
}
.brand {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 8px;
  margin-bottom: 22px;
}
.collapsed .brand {
  justify-content: center;
  padding: 0;
}
.lockup {
  height: 30px;
  width: auto;
  user-select: none;
}
.mark {
  height: 26px;
  width: auto;
  user-select: none;
}
.light-only {
  display: none;
}
:root[data-theme='light'] .light-only {
  display: inline;
}
:root[data-theme='light'] .dark-only {
  display: none;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nav-item,
.foot-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 42px;
  padding: 0 12px;
  border-radius: 9px;
  font-size: 14px;
  color: var(--text-dim);
  white-space: nowrap;
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.nav-item:hover,
.foot-btn:hover {
  background: var(--hover);
  color: var(--text);
}
.nav-item:active,
.foot-btn:active {
  background: var(--selected);
}
/* macOS 27: the selected row is a soft fill and its icon takes the color —
   no marker bar. */
.nav-item.on {
  color: var(--text);
  background: var(--selected);
}
.nav-item.on :deep(svg) {
  color: var(--accent);
}
.label {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
}
.count {
  min-width: 22px;
  padding: 1px 7px;
  border-radius: var(--r-pill);
  font-size: 11.5px;
  text-align: center;
  color: var(--text-faint);
  background: var(--bg-elev-2);
  font-variant-numeric: tabular-nums;
}
.nav-item.on .count {
  color: var(--text-dim);
  background: var(--selected);
}
.collapsed .nav-item,
.collapsed .foot-btn {
  justify-content: center;
  padding: 0;
}
.collapsed .label,
.collapsed .count {
  display: none;
}
.foot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.foot-btn {
  height: 38px;
  font-size: 13px;
}
</style>
