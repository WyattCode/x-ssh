import { spawn } from 'node:child_process'
import { Socket } from 'node:net'
import { join } from 'node:path'
import type { Host, Reachability } from '../shared/types'
import { isProbeableHost, pingArgs, pingVerdict } from '../shared/reachability'

type PingResult = 'reply' | 'proxied' | 'none'

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
 *  answering? Only data from the far end counts — a completed TCP handshake
 *  proves nothing while a TUN-mode proxy is running, since it accepts every
 *  connection locally and only then tries the real host. When the server's
 *  banner arrives we reply with our own version line before closing, so sshd
 *  logs an ordinary closed pre-auth connection rather than "did not receive
 *  identification string", which some fail2ban setups count against the client. */
function sshPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new Socket()
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      sock.destroy()
      resolve(ok)
    }
    // Whole budget, handshake included: sshd sends its banner right away.
    const timer = setTimeout(() => finish(false), 4000)
    sock.once('close', () => finish(false))
    sock.once('error', () => finish(false))
    sock.once('end', () => finish(false))
    sock.once('data', (d: Buffer) => {
      if (d.toString('latin1').startsWith('SSH-')) {
        sock.end('SSH-2.0-XSSH_probe\r\n', () => finish(true))
      } else finish(true)
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
  return (await sshPortOpen(h.host, h.port || 22)) ? 'online' : 'offline'
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
