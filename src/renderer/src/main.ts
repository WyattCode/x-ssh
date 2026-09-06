import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/global.css'
import '@xterm/xterm/css/xterm.css'

// Frosted-glass backdrop blur re-composites the whole window on every paint and
// is disproportionately costly on low-core / weak-iGPU machines. Detect those
// at startup and gate the blur off for a smooth experience.
if (typeof navigator !== 'undefined') {
  const cores = navigator.hardwareConcurrency ?? 8
  const lowMem =
    typeof (navigator as unknown as { deviceMemory?: number }).deviceMemory === 'number' &&
    (navigator as unknown as { deviceMemory?: number }).deviceMemory! <= 4
  const lowEnd =
    navigator.userAgent.includes('Intel Integrated') || // weak iGPU
    (cores <= 4 && lowMem)
  if (lowEnd) document.documentElement.classList.add('perf-no-blur')
}

createApp(App).use(createPinia()).mount('#app')
