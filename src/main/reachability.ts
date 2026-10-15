import { spawn } from 'node:child_process'
import { Socket } from 'node:net'
import { join } from 'node:path'
import type { Host, Reachability } from '../shared/types'
import {
  isProbeableHost,
  pingArgs,
  pingVerdict,
  sshProbeCoolingDown,
  sshProbeOutcome,
  type SshProbeMemo,
  type SshProbeOutcome,
} from '../shared/reachability'

type PingResult = 'reply' | 'proxied' | 'none'

/** Last SSH-port probe per host:port. A probe that *saw* sshd ('open') puts
 *  the host on a cooldown — see SSH_PROBE_COOLDOWN_MS for why feeding sshd's
 *  PerSourcePenalties score with extra pre-auth connects is exactly wrong. */
const sshProbeMemo = new Map<string, SshProbeMemo>()

// On Windows a bare "ping" is looked up in the working directory before PATH.
const PING_BIN =
  process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'PING.EXE') : 'ping'

/** One ICMP echo via the system `ping` (no shell; the host is validated by
 *  isProbeableHost so it can't pass as an option). Leaves no sshd log line. */
function ping(host: string): Promise<PingResult> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (ok: PingResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(ok)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(PING_BIN, pingArgs(process.platform, host), { windowsHide: true })
    } catch {
      resolve('none')
      return
    }
    const timer = setTimeout(() => {
      child.kill()
      finish('none')
    }, 4000)
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', () => finish('none'))
    child.on('close', (code) => finish(pingVerdict(process.platform, code, out)))
  })
}

/** Fallback for hosts that drop ICMP (common on cloud VPSes): is the SSH port
 *  answering? Any data from the far end counts — a completed TCP handshake
 *  proves nothing while a TUN-mode proxy is running, since it accepts every
 *  connection locally and only then tries the real host. When the server's
 *  banner arrives we reply with our own version line before closing, so sshd
 *  logs an ordinary closed pre-auth connection rather than "did not receive
 *  identification string", which some fail2ban setups count against the client.
 *
 *  Note the probe is itself a pre-auth connection, so it feeds OpenSSH ≥ 9.8
 *  PerSourcePenalties — that is why the caller cools hosts down after a probe
 *  that saw sshd instead of knocking every round. */
function sshPortOpen(host: string, port: number): Promise<SshProbeOutcome> {
  return new Promise((resolve) => {
    const sock = new Socket()
    let done = false
    const finish = (outcome: SshProbeOutcome): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      sock.destroy()
      resolve(outcome)
    }
    // Whole budget, handshake included: sshd sends its banner right away.
    const timer = setTimeout(() => finish('down'), 4000)
    sock.once('close', () => finish('down'))
    sock.once('error', (e: NodeJS.ErrnoException) =>
      finish(sshProbeOutcome(e.code === 'ECONNREFUSED' ? 'refused' : 'down')),
    )
    sock.once('data', (d: Buffer) => {
      // Either an SSH banner or a plain-text refusal ("Not allowed at this
      // time"): both mean the SSH port is alive and talking.
      if (d.toString('latin1').startsWith('SSH-')) {
        sock.end('SSH-2.0-XSSH_probe\r\n', () => finish('open'))
      } else finish('open')
    })
    sock.connect(port, host)
  })
}

async function probeOne(h: Host): Promise<Reachability> {
  // Reached through something else: a direct probe says nothing about it.
  if (h.jumpHostId || h.proxy) return 'unknown'
  if (!isProbeableHost(h.host)) return 'unknown'
  // A fake-ip proxy answering for the host ('proxied') falls through to the port check.
  if ((await ping(h.host)) === 'reply') return 'online'
  // Ping lost (or silently filtered): knocking on the SSH port is the only way
  // to tell offline from proxied, but each knock is a pre-auth connection —
  // after one that saw sshd, trust 'online' for a cooldown instead of feeding
  // the penalty score every round.
  const key = `${h.host}:${h.port || 22}`
  if (sshProbeCoolingDown(sshProbeMemo.get(key), Date.now())) return 'online'
  const outcome = await sshPortOpen(h.host, h.port || 22)
  sshProbeMemo.set(key, { at: Date.now(), outcome })
  return outcome === 'open' ? 'online' : 'offline'
}

/** Probes the given hosts, a few at a time. */
export async function probeHosts(hosts: Host[]): Promise<Record<string, Reachability>> {
  const result: Record<string, Reachability> = {}
  const queue = [...hosts]
  const worker = async (): Promise<void> => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      result[h.id] = await probeOne(h).catch((): Reachability => 'unknown')
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker))
  return result
}
