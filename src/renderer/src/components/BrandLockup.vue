<script setup lang="ts">
// The X-SSH lockup, flat: the original two-bar X (horizontal-cut, round-cornered arms,
// one bar over the other, no gradients) followed by the original "SSH" lettering — wide,
// squared, very round-cornered bowls, vertical terminal cuts. The mark and the letters
// are the same height. The front bar and the letters take the text colour, the back bar
// the terminal green. build/icon-src/flat/lockup.cjs draws the PNGs (desktop, Android,
// iOS) from the same geometry.
const BACK =
  'M659.49,237.62 A63,63 0 0,1 703.71,219.5 L786.18,219.5 A63,63 0 0,1 830.39,327.38 L364.51,786.38 A63,63 0 0,1 320.29,804.5 L237.82,804.5 A63,63 0 0,1 193.61,696.62 Z'
const FRONT =
  'M193.61,327.38 A63,63 0 0,1 237.82,219.5 L320.29,219.5 A63,63 0 0,1 364.51,237.62 L830.39,696.62 A63,63 0 0,1 786.18,804.5 L703.71,804.5 A63,63 0 0,1 659.49,786.38 Z'

// "SSH" on a 100-unit cap height, measured from the original lettering.
const SW = 90 // S width
const HW = 110 // H width
const GAP = 21 // between letters
const ST = 22 // stroke
const R = 19.5 // bowl radius (centre line)
const h = ST / 2
const S_PATH =
  `M${SW * 0.955},${h} H${h + R} A${R},${R} 0 0 0 ${h},${h + R} V${50 - R} A${R},${R} 0 0 0 ${h + R},50 ` +
  `H${SW - h - R} A${R},${R} 0 0 1 ${SW - h},${50 + R} V${100 - h - R} A${R},${R} 0 0 1 ${SW - h - R},${100 - h} H${SW * 0.035}`
const H_PATH = `M0,0H${ST}V${50 - ST / 2}H${HW - ST}V0H${HW}V100H${HW - ST}V${50 + ST / 2}H${ST}V100H0Z`
const WORD_W = SW + GAP + SW + GAP + HW

// One SVG, 612 units tall. The mark's ink is 585 units tall (y 219.5…804.5 inside a 612 box), so the letters
// are scaled to 585 too (5.85×) and centred: mark and letters are exactly the same height.
const MARK_W = 664
const K = 5.85
const TEXT_Y = (612 - 585) / 2
const TEXT_X = MARK_W + 306 // the gap is half the height
const TOTAL_W = TEXT_X + WORD_W * K
withDefaults(defineProps<{ height?: number }>(), { height: 24 })
</script>

<template>
  <svg :height="height" :width="(height * TOTAL_W) / 612" :viewBox="`0 0 ${TOTAL_W} 612`" role="img" aria-label="X-SSH">
    <defs>
      <!-- A hairline cuts the front bar out of the back one (no background colour needed). -->
      <mask id="xssh-gap" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
        <rect width="1024" height="1024" fill="#fff" />
        <path :d="FRONT" fill="#000" stroke="#000" stroke-width="30" stroke-linejoin="round" />
      </mask>
    </defs>
    <g transform="translate(-180 -206)">
      <path :d="BACK" fill="var(--cursor)" mask="url(#xssh-gap)" />
      <path :d="FRONT" fill="currentColor" />
    </g>
    <g :transform="`translate(${TEXT_X} ${TEXT_Y}) scale(${K})`" fill="currentColor">
      <path :d="S_PATH" fill="none" stroke="currentColor" :stroke-width="ST" />
      <path :d="S_PATH" fill="none" stroke="currentColor" :stroke-width="ST" :transform="`translate(${SW + GAP} 0)`" />
      <path :d="H_PATH" :transform="`translate(${2 * (SW + GAP)} 0)`" />
    </g>
  </svg>
</template>
