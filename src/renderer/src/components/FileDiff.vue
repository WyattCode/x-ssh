<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

const dialogEl = ref<HTMLDivElement>()
onMounted(() => nextTick(() => dialogEl.value?.focus()))
import { useI18n } from '../lib/i18n'
import { diffLines } from '../lib/diff'
import Icon from './Icon.vue'

const props = defineProps<{
  remoteName: string
  remoteContent: string
  localName: string
  localContent: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()

const result = computed(() => diffLines(props.remoteContent, props.localContent))
</script>

<template>
  <div class="fd-overlay" @mousedown.self="emit('close')">
    <div ref="dialogEl" tabindex="-1" class="fd-dialog" @keydown.esc="emit('close')">
      <div class="fd-head">
        <span class="fd-title" :title="`${t('fileDiff.remote')}: ${remoteName} · ${t('fileDiff.local')}: ${localName}`">
          {{ remoteName }} ↔ {{ localName }}
        </span>
        <span class="fd-stats" v-if="result.identical">{{ t('fileDiff.identical') }}</span>
        <span v-else class="fd-stats">
          <b>+{{ result.adds }}</b> / <b>-{{ result.dels }}</b>
        </span>
        <button class="fd-x" :title="t('fileDiff.close')" @click="emit('close')"><Icon name="close" :size="14" /></button>
      </div>
      <div class="fd-body">
        <div v-if="result.identical" class="fd-empty">{{ t('fileDiff.identical') }}</div>
        <table v-else>
          <tbody>
            <tr v-for="(l, i) in result.lines" :key="i" :class="l.kind">
              <td class="fd-old">{{ l.kind === 'add' ? '' : l.a }}</td>
              <td class="fd-new">{{ l.kind === 'del' ? '' : l.b }}</td>
              <td class="fd-glyph">{{ l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : '' }}</td>
              <td class="fd-text"><pre>{{ l.text || ' ' }}</pre></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fd-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.fd-dialog {
  width: min(760px, 92vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.fd-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.fd-title {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fd-stats {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-faint);
}
.fd-stats b {
  font-weight: 600;
}
.fd-x {
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
}
.fd-x:hover {
  color: var(--text);
}
.fd-body {
  overflow: auto;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}
.fd-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-faint);
}
.fd-body table {
  border-collapse: collapse;
  width: 100%;
}
.fd-body td {
  padding: 1px 6px;
  vertical-align: top;
  line-height: 1.4;
}
.fd-old,
.fd-new {
  width: 40px;
  text-align: right;
  color: var(--text-faint);
  user-select: none;
  border-right: 1px solid var(--border);
}
.fd-new {
  border-right: none;
}
.fd-glyph {
  width: 16px;
  text-align: center;
  user-select: none;
}
.fd-text pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.fd-body tr.add .fd-text {
  background: color-mix(in srgb, var(--ok) 14%, transparent);
}
.fd-body tr.del .fd-text {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}
.fd-body tr.add .fd-glyph {
  color: var(--ok);
}
.fd-body tr.del .fd-glyph {
  color: var(--danger);
}
</style>
