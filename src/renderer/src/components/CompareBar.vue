<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSessions, type CompareItem } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { isImeKey } from '../lib/ime'
import {
  DEFAULT_COMPARE_SERVICE,
  isValidService,
  inactiveNames,
  summarizeActive,
  summarizeCompare,
  summarizeMany,
  type CompareMetric
} from '../../../shared/compare'
import Icon from './Icon.vue'

/** Under the side-by-side panes: the two machines' answers to the last probe, and
 *  one sentence saying how they differ, next to which pane takes the keyboard. */
const store = useSessions()
const { t } = useI18n()

const tab = computed(() => store.active)
// An answer is only shown while every pane it came from is still in the tab: after
// a pane is closed and another opened, the old numbers would pass for the new pair.
const result = computed(() => {
  const r = tab.value ? store.compare[tab.value.id] : undefined
  return r && r.items.every((i) => tab.value!.panes.some((p) => p.id === i.paneId)) ? r : undefined
})
const focusedName = computed(() => {
  const p = tab.value?.panes.find((x) => x.id === tab.value?.activePaneId)
  if (!p) return ''
  const h = p.params.hostId ? store.hosts.find((x) => x.id === p.params.hostId) : undefined
  return h?.label ?? `${p.params.username}@${p.params.host}`
})

const summary = computed(() => {
  const r = result.value
  if (!r) return t('cmp.hint')
  if (r.items.length < 2) return t('cmp.needTwo')
  if (r.items.length > 2) return summaryMany(r)
  const [a, b] = r.items as [CompareItem, CompareItem]
  if (r.metric === 'disk') {
    const s = summarizeCompare('disk', a, b)
    if (s.kind === 'disk') return t('cmp.sumDiskDiff', { higher: s.higher, lower: s.lower, n: s.diff })
    if (s.kind === 'diskSame') return t('cmp.sumDiskSame')
    return t('cmp.sumIncomplete', { svc: '' })
  }
  const v = summarizeCompare('service', a, b)
  if (v.kind !== 'version') return t('cmp.sumIncomplete', { svc: r.service })
  const act = summarizeActive(a, b)
  const first = !v.a || !v.b
    ? t('cmp.sumVersionUnknown', { svc: r.service })
    : v.same
      ? t('cmp.sumVersionSame', { svc: r.service, v: v.a })
      : t('cmp.sumVersionDiff', { svc: r.service, a: v.nameA, va: v.a, b: v.nameB, vb: v.b })
  const second = act.kind === 'active' && act.bothActive
    ? t('cmp.sumActiveAll')
    : t('cmp.sumActiveSome', { names: act.kind === 'active' ? act.inactive.join('、') : '' })
  return `${first}${t('cmp.sumJoin')}${second}`
})

/** Three or more hosts: one sentence about the whole set. */
function summaryMany(r: NonNullable<typeof result.value>): string {
  const n = r.items.length
  const s = summarizeMany(r.metric, r.items)
  if (s.kind === 'incomplete') return t('cmp.sumIncomplete', { svc: r.metric === 'disk' ? '' : r.service })
  if (s.kind === 'disk') {
    return s.same
      ? t('cmp.sumManyDiskSame', { n, p: s.high.pct })
      : t('cmp.sumManyDisk', { high: s.high.name, hp: s.high.pct, low: s.low.name, lp: s.low.pct })
  }
  const first = s.same
    ? t('cmp.sumManyVersionSame', { n, svc: r.service, v: s.v ?? '' })
    : t('cmp.sumManyVersionDiff', { svc: r.service, list: s.items.map((i) => `${i.name} ${i.v ?? '?'}`).join('、') })
  const off = inactiveNames(r.items)
  const second = off.length ? t('cmp.sumActiveSome', { names: off.join('、') }) : t('cmp.sumManyActiveAll')
  return `${first}${t('cmp.sumJoin')}${second}`
}

/** Marks the part of an output line that carries the answer: the service probe's
 *  version number and state, the disk probe's percentages (its sizes like 12.8M
 *  are not answers, and would drown the one number that is). */
const HIT_SERVICE = /\d+\.\d+(?:\.\d+)*|\b(?:active|inactive|failed|activating)\b/g
const HIT_DISK = /\d+%/g
function parts(text: string | null, metric: CompareMetric): { t: string; hit: boolean }[] {
  if (text === null) return [{ t: t('cmp.failed'), hit: false }]
  if (!text.trim()) return [{ t: t('cmp.noOutput'), hit: false }]
  const out: { t: string; hit: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(metric === 'disk' ? HIT_DISK : HIT_SERVICE)) {
    if (m.index! > last) out.push({ t: text.slice(last, m.index), hit: false })
    out.push({ t: m[0], hit: true })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ t: text.slice(last), hit: false })
  return out
}

function sideKey(it: CompareItem): string {
  return it.paneId
}

// The results can be folded away to give the terminals the room back; a new
// answer opens them again.
const folded = ref(false)
watch(
  () => result.value?.at,
  () => (folded.value = false)
)

// ---- the probes ----
const metric = computed<CompareMetric>(() => result.value?.metric ?? 'service')
// Once the field has been typed in it keeps whatever is there, even empty: falling
// back to the last result's name while the box is empty would refill it mid-edit.
const serviceDraft = ref<string | null>(null)
const serviceName = computed({
  get: () => serviceDraft.value ?? result.value?.service ?? DEFAULT_COMPARE_SERVICE,
  set: (v: string) => (serviceDraft.value = v)
})
const serviceOk = computed(() => isValidService(serviceName.value.trim()))
const busy = computed(() => !!store.comparing)
const anyLive = computed(() => !!tab.value?.panes.some((p) => p.status === 'connected'))

function run(m: CompareMetric): void {
  if (!tab.value || busy.value || !anyLive.value) return
  if (m === 'service' && !serviceOk.value) return
  void store.runCompare(tab.value.id, m, serviceName.value.trim())
}
function onServiceEnter(e: KeyboardEvent): void {
  // The Enter that commits an IME candidate is the input method's, not ours.
  if (isImeKey(e)) return
  e.preventDefault()
  run('service')
}
</script>

<template>
  <section v-if="tab && tab.panes.length > 1" class="cmp" aria-live="polite">
    <div v-if="result && !folded" class="cmp-grid" :style="{ gridTemplateColumns: `repeat(${result.items.length}, minmax(200px, 1fr))` }">
      <article v-for="it in result.items" :key="sideKey(it)" class="cmp-col">
        <h4>{{ it.name }}</h4>
        <div v-for="(cmd, i) in it.commands" :key="i" class="cmp-run">
          <code>$ {{ cmd }}</code>
          <pre><template v-for="(seg, k) in parts(it.outputs[i], result.metric)" :key="k"><strong v-if="seg.hit">{{ seg.t }}</strong><template v-else>{{ seg.t }}</template></template></pre>
        </div>
      </article>
    </div>
    <div class="cmp-status">
      <span class="cmp-focus"><Icon name="focus" :size="14" />{{ t('cmp.focus') }} <strong>{{ focusedName }}</strong></span>
      <div class="cmp-tools" role="group" :aria-label="t('cmp.group')">
        <input
          v-show="metric === 'service'"
          v-model="serviceName"
          class="cmp-service"
          :class="{ bad: !serviceOk }"
          maxlength="48"
          spellcheck="false"
          autocomplete="off"
          :placeholder="t('cmp.servicePh')"
          :aria-label="t('cmp.servicePh')"
          @keydown.enter="onServiceEnter"
        />
        <button
          type="button"
          class="cmp-btn"
          :aria-pressed="metric === 'service' && !!result"
          :disabled="busy || !anyLive || (metric === 'service' && !serviceOk)"
          @click="run('service')"
        >{{ t('cmp.metricService') }}</button>
        <button
          type="button"
          class="cmp-btn"
          :aria-pressed="metric === 'disk' && !!result"
          :disabled="busy || !anyLive"
          @click="run('disk')"
        >{{ t('cmp.metricDisk') }}</button>
        <button
          v-if="result"
          type="button"
          class="cmp-btn"
          :aria-expanded="!folded"
          @click="folded = !folded"
        >{{ folded ? t('cmp.show') : t('cmp.hide') }}</button>
      </div>
      <span class="cmp-sum" :class="{ busy }">{{ busy ? t('cmp.running') : summary }}</span>
    </div>
  </section>
</template>

<style scoped>
/* Flat, like the rest of the terminal page: no boxes, hairlines only. */
.cmp {
  font-family: var(--font-chrome);
  background: var(--console);
  border-top: 1px solid var(--chrome-line);
}
.cmp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  /* One height for both probes: switching between them must not make the
     terminals above reflow. */
  height: min(188px, 30vh);
  overflow-x: auto;
  overflow-y: auto;
  border-bottom: 1px solid var(--chrome-line);
}
.cmp-col {
  min-width: 0;
  padding: 8px 16px 10px;
}
.cmp-col + .cmp-col {
  border-left: 1px solid var(--chrome-line);
}
.cmp-col h4 {
  margin: 0 0 4px;
  font-size: 12.5px;
  font-weight: 400;
  color: var(--text-faint);
}
.cmp-run {
  padding: 3px 0;
  font: 12px/1.6 var(--font-chrome);
}
.cmp-run code {
  color: var(--text-faint);
}
.cmp-run pre {
  margin: 2px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-dim);
  font: inherit;
}
.cmp-run pre strong {
  color: var(--ok);
  font-weight: 600;
}
.cmp-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 14px;
  min-height: 34px;
  padding: 0 16px;
  font-size: 12.5px;
  color: var(--text-faint);
}
.cmp-focus {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cmp-focus strong {
  color: var(--text);
  font-weight: 600;
}
.cmp-tools {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.cmp-service {
  width: 110px;
  height: 26px;
  padding: 0 8px;
  font: inherit;
  color: var(--text);
  background: var(--bg-elev-2);
  border: 1px solid transparent;
  border-radius: 5px;
  caret-color: var(--cursor);
  user-select: text;
}
.cmp-service:focus {
  border-color: var(--text);
}
.cmp-service.bad {
  border-color: var(--danger);
}
.cmp-btn {
  height: 26px;
  padding: 0 10px;
  font: inherit;
  color: var(--text-dim);
  border: 1px solid var(--border-strong);
  border-radius: 5px;
}
.cmp-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--hover);
}
.cmp-btn[aria-pressed='true'] {
  color: var(--text);
  background: var(--selected);
}
.cmp-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.cmp-sum {
  flex: 1 1 320px;
  min-width: 0;
  padding: 3px 0;
  text-align: right;
  color: var(--text-dim);
}
.cmp-sum.busy {
  color: var(--text-faint);
}
</style>