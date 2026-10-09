<script setup lang="ts">
import { computed } from 'vue'
import {
  siAlibabacloud,
  siAlmalinux,
  siAlpinelinux,
  siApple,
  siArchlinux,
  siArtixlinux,
  siAsahilinux,
  siCachyos,
  siCentos,
  siDebian,
  siDeepin,
  siElementary,
  siEndeavouros,
  siFedora,
  siFreebsd,
  siGarudalinux,
  siGentoo,
  siHuawei,
  siKalilinux,
  siKdeneon,
  siLinux,
  siLinuxmint,
  siManjaro,
  siMxlinux,
  siNetbsd,
  siNixos,
  siNobaralinux,
  siNvidia,
  siOpenbsd,
  siOpenmediavault,
  siOpensuse,
  siOpenwrt,
  siParrotsecurity,
  siPhoton,
  siPopos,
  siProxmox,
  siQubesos,
  siRancher,
  siRaspberrypi,
  siRedhat,
  siRockylinux,
  siSlackware,
  siSolus,
  siSuse,
  siSynology,
  siTails,
  siTruenas,
  siUbuntu,
  siUnraid,
  siVmware,
  siVoidlinux,
  siZorin,
  type SimpleIcon
} from 'simple-icons'
import type { HostOs } from '../../../shared/types'
import Icon from './Icon.vue'

// The host card's OS tile: the distro's own mark (simple-icons, CC0) in its
// brand color on a wash of that color. Hosts never connected (os unknown) get
// the generic server glyph in the host's own color.
const props = withDefaults(defineProps<{ os?: HostOs; color?: string; size?: number }>(), { size: 44 })

const BY_ID: Record<string, SimpleIcon> = {
  ubuntu: siUbuntu,
  debian: siDebian,
  centos: siCentos,
  rocky: siRockylinux,
  alma: siAlmalinux,
  rhel: siRedhat,
  fedora: siFedora,
  arch: siArchlinux,
  manjaro: siManjaro,
  alpine: siAlpinelinux,
  opensuse: siOpensuse,
  suse: siSuse,
  mint: siLinuxmint,
  raspbian: siRaspberrypi,
  kali: siKalilinux,
  gentoo: siGentoo,
  nixos: siNixos,
  openwrt: siOpenwrt,
  deepin: siDeepin,
  popos: siPopos,
  elementary: siElementary,
  zorin: siZorin,
  endeavouros: siEndeavouros,
  void: siVoidlinux,
  slackware: siSlackware,
  mx: siMxlinux,
  kdeneon: siKdeneon,
  garuda: siGarudalinux,
  solus: siSolus,
  parrot: siParrotsecurity,
  nobara: siNobaralinux,
  artix: siArtixlinux,
  cachyos: siCachyos,
  photon: siPhoton,
  rancher: siRancher,
  alibaba: siAlibabacloud,
  huawei: siHuawei,
  asahi: siAsahilinux,
  qubes: siQubesos,
  tails: siTails,
  proxmox: siProxmox,
  truenas: siTruenas,
  omv: siOpenmediavault,
  unraid: siUnraid,
  synology: siSynology,
  vmware: siVmware,
  netbsd: siNetbsd,
  dgx: siNvidia,
  macos: siApple,
  freebsd: siFreebsd,
  openbsd: siOpenbsd,
  linux: siLinux
}

/** Family logos that the old ID_LIKE fallback also handed to derivatives. */
const FAMILY_NAME: Record<string, RegExp> = {
  rhel: /red hat|rhel/i,
  centos: /centos/i,
  fedora: /fedora/i,
  debian: /debian/i,
  ubuntu: /ubuntu/i,
  arch: /\barch\b/i,
  suse: /suse|sles/i,
  opensuse: /opensuse/i
}
const osId = computed(() => {
  const os = props.os
  if (!os) return undefined
  const fam = FAMILY_NAME[os.id]
  return fam && os.pretty && !fam.test(os.pretty) ? 'linux' : os.id
})
const icon = computed(() => (osId.value ? BY_ID[osId.value] : undefined))

/** Very dark brand colors (CentOS navy, Apple / AlmaLinux black) vanish on the
 *  dark theme; those draw in the text color instead. */
function tooDark(hex: string): boolean {
  const n = parseInt(hex, 16)
  const lin = (c: number): number => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return l < 0.06
}
const tint = computed(() => (icon.value ? `#${icon.value.hex}` : props.color || 'var(--accent)'))
const ink = computed(() => (icon.value && tooDark(icon.value.hex) ? 'var(--text)' : tint.value))
</script>

<template>
  <span
    class="os-tile"
    :style="{ '--tint': tint, '--ink': ink, width: size + 'px', height: size + 'px' }"
    :title="os?.pretty"
  >
    <svg v-if="icon" :width="Math.round(size * 0.52)" :height="Math.round(size * 0.52)" viewBox="0 0 24 24" aria-hidden="true">
      <path :d="icon.path" fill="currentColor" />
    </svg>
    <Icon v-else name="server" :size="Math.round(size * 0.46)" />
  </span>
</template>

<style scoped>
.os-tile {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Sits ~16px in from a --r-card corner: concentric would be ~0, so the
     fallback radius applies. */
  border-radius: var(--r-tile);
  color: var(--ink);
  background: color-mix(in srgb, var(--tint) 15%, var(--bg-elev-2));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tint) 22%, transparent);
}
</style>
