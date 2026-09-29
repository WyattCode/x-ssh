import type { HostOs } from './types'

/**
 * Read-only probe run once per host, on its own exec channel (never the
 * user's interactive shell). `/etc/os-release` names the distro; appliances
 * built on another distro only tell themselves apart by a file of their own —
 * DGX OS (Ubuntu) by `/etc/dgx-release`, Proxmox VE (Debian) by `/etc/pve`,
 * TrueNAS SCALE by its `midclt`, openmediavault by `/etc/openmediavault`,
 * Unraid (Slackware) by `/etc/unraid-version`, Synology DSM by
 * `/etc/synoinfo.conf`. Systems older than os-release (CentOS / RHEL 6) still
 * have `/etc/redhat-release`; uname covers the rest (macOS, the BSDs, ESXi). Wrapped in `sh -c` because sshd runs exec commands through the
 * account's login shell, and csh / tcsh have no `$(...)`. Ends with an echo so
 * the exit status is 0 even when os-release is missing.
 */
export const OS_PROBE_COMMAND =
  `sh -c 'cat /etc/os-release 2>/dev/null || cat /usr/lib/os-release 2>/dev/null;` +
  ` [ -e /etc/os-release ] || [ -e /usr/lib/os-release ] || head -n 1 /etc/redhat-release 2>/dev/null | sed s/^/XSSH_RELEASE=/;` +
  ` [ -e /etc/dgx-release ] && echo XSSH_DGX=1;` +
  ` [ -d /etc/pve ] && echo XSSH_PVE=1;` +
  ` [ -x /usr/bin/midclt ] && echo XSSH_TRUENAS=1;` +
  ` [ -d /etc/openmediavault ] && echo XSSH_OMV=1;` +
  ` [ -e /etc/unraid-version ] && echo XSSH_UNRAID=1;` +
  ` [ -e /etc/synoinfo.conf ] && echo XSSH_SYNO=1;` +
  ` echo "XSSH_UNAME=$(uname -s 2>/dev/null)"'`

/** Appliance markers, most specific first (a Proxmox box is also Debian). */
const MARKERS: [string, string][] = [
  ['XSSH_DGX', 'dgx'],
  ['XSSH_PVE', 'proxmox'],
  ['XSSH_TRUENAS', 'truenas'],
  ['XSSH_OMV', 'omv'],
  ['XSSH_UNRAID', 'unraid'],
  ['XSSH_SYNO', 'synology']
]

/** os-release `ID` (and `ID_LIKE` words) → the key the UI has an icon for. */
const ID_MAP: Record<string, string> = {
  ubuntu: 'ubuntu',
  debian: 'debian',
  centos: 'centos',
  rocky: 'rocky',
  almalinux: 'alma',
  rhel: 'rhel',
  fedora: 'fedora',
  arch: 'arch',
  archarm: 'arch',
  manjaro: 'manjaro',
  alpine: 'alpine',
  opensuse: 'opensuse',
  'opensuse-leap': 'opensuse',
  'opensuse-tumbleweed': 'opensuse',
  sles: 'suse',
  suse: 'suse',
  linuxmint: 'mint',
  raspbian: 'raspbian',
  kali: 'kali',
  gentoo: 'gentoo',
  nixos: 'nixos',
  openwrt: 'openwrt',
  deepin: 'deepin',
  uos: 'deepin',
  pop: 'popos',
  elementary: 'elementary',
  zorin: 'zorin',
  endeavouros: 'endeavouros',
  void: 'void',
  slackware: 'slackware',
  mx: 'mx',
  neon: 'kdeneon',
  garuda: 'garuda',
  solus: 'solus',
  parrot: 'parrot',
  nobara: 'nobara',
  artix: 'artix',
  cachyos: 'cachyos',
  photon: 'photon',
  rancheros: 'rancher',
  alinux: 'alibaba',
  euleros: 'huawei',
  openeuler: 'huawei',
  'fedora-asahi-remix': 'asahi',
  qubes: 'qubes',
  tails: 'tails'
}

const UNAME_MAP: Record<string, string> = {
  darwin: 'macos',
  freebsd: 'freebsd',
  openbsd: 'openbsd',
  netbsd: 'netbsd',
  vmkernel: 'vmware',
  linux: 'linux'
}

function unquote(v: string): string {
  const t = v.trim()
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t
}

/** Parses the output of OS_PROBE_COMMAND. `null` when nothing recognizable
 *  came back (e.g. a Windows server whose shell isn't POSIX). */
export function parseOsProbe(out: string): HostOs | null {
  const kv: Record<string, string> = {}
  for (const line of out.split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (m) kv[m[1]] = unquote(m[2])
  }
  const pretty = kv.PRETTY_NAME || kv.NAME || undefined
  for (const [marker, id] of MARKERS) if (kv[marker] === '1') return { id, pretty }

  const id = (kv.ID ?? '').toLowerCase()
  if (ID_MAP[id]) return { id: ID_MAP[id], pretty }
  // Only a distro's own ID gets its logo. A derivative is not its parent:
  // TencentOS says ID_LIKE="rhel fedora centos", and wearing Red Hat's mark
  // would be wrong — it falls through to generic Linux below.
  // Pre-os-release Red Hat family: "CentOS release 6.10 (Final)".
  const rel = kv.XSSH_RELEASE
  if (rel) {
    const fam = /centos/i.test(rel) ? 'centos' : /rocky/i.test(rel) ? 'rocky' : /alma/i.test(rel) ? 'alma' : /fedora/i.test(rel) ? 'fedora' : /red hat/i.test(rel) ? 'rhel' : 'linux'
    return { id: fam, pretty: rel }
  }
  const uname = (kv.XSSH_UNAME ?? '').toLowerCase()
  if (UNAME_MAP[uname]) return { id: UNAME_MAP[uname], pretty: pretty ?? kv.XSSH_UNAME }
  // An os-release we can't place is still some Linux.
  if (id) return { id: 'linux', pretty }
  return null
}
