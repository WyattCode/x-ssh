<script setup lang="ts">
/**
 * Unified thin-line icon set (feather-style: 24×24, currentColor stroke,
 * round caps/joins) for a consistent, refined look.
 */
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 })

const P: Record<string, string> = {
  plus: 'M12 5v14 M5 12h14',
  close: 'M18 6 6 18 M6 6l12 12',
  keyboard:
    'M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z M6 9h.01 M10 9h.01 M14 9h.01 M18 9h.01 M6 13h.01 M18 13h.01 M9.5 13h5',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  'folder-open': 'M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
  'folder-up': 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z|M12 17.5V12 M9.6 14 12 11.5 14.4 14',
  'folder-plus': 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z|M12 10v6 M9 13h6',
  zip: 'M10 2h4l1 2h3a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4z|M12 2v2 M12 4v2 M12 6v2 M12 8v2 M9 13h6 M10 17h4',
  archive: 'M4 5h16v3H4z M6 8v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8 M10 12h4',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
  home: 'M3 10.2 12 3l9 7.2 M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5 M10 21v-6h4v6',
  refresh: 'M21 4v6h-6 M20.49 15A9 9 0 1 1 18.36 5.64L21 8',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  'arrow-up': 'M12 19V5 M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14 M5 12l7 7 7-7',
  sync: 'M17 2l4 4-4 4 M21 6H8 M3 22l-4-4 4-4 M0 18h13 M16 8v8 M8 8v8',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  edit: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  'arrow-right': 'M5 12h14 M13 6l6 6-6 6',
  'chevron-up': 'M18 15l-6-6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  server:
    'M4 4h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 13h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z M7 7.5h.01 M7 16.5h.01',
  code: 'M8 6l-6 6 6 6 M16 6l6 6-6 6',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  settings: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z|M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  'corner-down-right': 'M15 10l5 5-5 5 M4 4v7a4 4 0 0 0 4 4h12',
  'alert-triangle':
    'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z|M12 9v4|M12 17h.01',
  'more-horizontal': 'M5 12h.01|M12 12h.01|M19 12h.01',
  clock: 'M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0|M12 6.5V12l4 2',
  split:
    'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z|M12 4v16',
  rows: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z|M4 12h16',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  check: 'M20 6 9 17l-5-5',
  'check-all': 'M18 7a7 7 0 1 0 1.5 8 M14.5 12 11 15.5 8 12.5 M22 6l-8.2 8.2',
  info: 'M12 8h.01 M11 12h1v4h1',
  copy: 'M9 9h10v12H9z M6 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2',
  trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6',
  lock: 'M5 11h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z M8 11V7a4 4 0 0 1 8 0v4 M12 15v3',
  unlock: 'M5 11h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z M8 11V7a4 4 0 0 1 7.9-1 M12 15v3',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14 M16 5v14',
   send: 'M22 2 11 13 M22 2 15 22 11 13 2 9z',
   layout: 'M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z M3 9h18 M9 21V9',
   grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z'
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, i) in (P[name] || '').split('|')" :key="i" :d="d" />
  </svg>
</template>
