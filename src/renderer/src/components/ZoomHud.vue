<script setup lang="ts">
import { computed } from 'vue'
import { useZoom, zoomFactor, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '../composables/zoom'
import { useI18n } from '../lib/i18n'
import Icon from './Icon.vue'

// The zoom percentage pill: shows up on every user zoom (shortcut, Ctrl+wheel,
// its own buttons) and fades by itself. It is counter-scaled with CSS `zoom`,
// so it stays the same size while the whole UI grows and shrinks behind it —
// like a browser's own zoom bubble.
const { level, percent, hudOpen, bump, reset, setHover } = useZoom()
const { t } = useI18n()

const counterScale = computed(() => 1 / zoomFactor(level.value))
/** Position of the current level / of 100 % along the track, 0…100. */
const along = (l: number): number => ((l - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100
const fill = computed(() => along(level.value))
const home = along(0)
</script>

<template>
  <div class="zoom-hud-anchor">
    <Transition name="zhud">
      <div
        v-if="hudOpen"
        class="zoom-hud"
        :style="{ zoom: counterScale }"
        role="status"
        aria-live="polite"
        @mouseenter="setHover(true)"
        @mouseleave="setHover(false)"
      >
        <button class="zb" :disabled="level <= ZOOM_MIN" :title="t('zoom.out')" @click="bump(-ZOOM_STEP)">
          <Icon name="minus" :size="15" />
        </button>
        <div class="readout">
          <span class="value">{{ percent }}<span class="unit">%</span></span>
          <span class="track">
            <span class="fill" :style="{ width: fill + '%' }" />
            <span class="home" :style="{ left: home + '%' }" />
          </span>
        </div>
        <button class="zb" :disabled="level >= ZOOM_MAX" :title="t('zoom.in')" @click="bump(ZOOM_STEP)">
          <Icon name="plus" :size="15" />
        </button>
        <Transition name="zreset">
          <button v-if="level !== 0" class="reset" @click="reset">{{ t('zoom.reset') }}</button>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* The anchor is not counter-scaled, so it sits right under the (zoomed) tab
   bar at every level; only the pill inside keeps a constant size. */
.zoom-hud-anchor {
  position: fixed;
  top: 54px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 120;
}
.zoom-hud {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border-radius: 999px;
  background-color: color-mix(in srgb, var(--bg-elev) 86%, transparent);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow), inset 0 1px 0 color-mix(in srgb, #fff 6%, transparent);
  user-select: none;
}
.zb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  color: var(--text-dim);
  transition: background 0.13s, color 0.13s;
}
.zb:hover:not(:disabled) {
  background: var(--bg-elev-2);
  color: var(--text);
}
.zb:disabled {
  opacity: 0.35;
  cursor: default;
}
.readout {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 64px;
  padding: 2px 4px 3px;
}
.value {
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}
.unit {
  margin-left: 1px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-faint);
}
.track {
  position: relative;
  width: 56px;
  height: 3px;
  border-radius: 2px;
  background: var(--border-strong);
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}
/* The 100 % mark. */
.home {
  position: absolute;
  top: -2px;
  width: 1px;
  height: 7px;
  margin-left: -0.5px;
  border-radius: 1px;
  background: var(--text-faint);
}
.reset {
  height: 30px;
  padding: 0 12px;
  margin-left: 2px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--accent);
  background: var(--accent-soft);
  transition: filter 0.13s;
  white-space: nowrap;
}
.reset:hover {
  filter: brightness(1.15);
}

.zhud-enter-active,
.zhud-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.zhud-enter-from,
.zhud-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}
.zreset-enter-active,
.zreset-leave-active {
  transition: opacity 0.15s ease;
}
.zreset-enter-from,
.zreset-leave-to {
  opacity: 0;
}
</style>
