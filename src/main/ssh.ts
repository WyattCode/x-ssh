import { readFile, stat, readdir, mkdir, unlink } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createServer, createConnection, type Server, Socket } from 'node:net'
import { Duplex } from 'node:stream'
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import type { Readable, Writable } from 'node:stream'
import type { WriteStream } from 'node:fs'
import type { WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  ConnectParams,
  ConnectResult,
  HostForward,
  ForwardMode,
  ForwardErrorCode,
  JumpConfig,
  ProxyConfig,
  SessionEvent,
  SftpList,
  SftpProgress,
  UploadOverwrite
} from '../shared/types'
import { KnownHosts } from './knownHosts'
import { friendlyError, isTransientConnectError, penaltyRetryDelayMs } from './friendlyError'
import { posixJoin, parentOf, clampConcurrency, buildPackCommand, buildExtractCommand, treeDirMode } from '../shared/fsUtils'

/** Streams a local file through SHA-256 and resolves its lowercase hex digest. */
function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(p)
    s.on('data', (d: Buffer | string) => h.update(d))
    s.on('end', () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}

interface Session {
  id: string
  client: Client
  stream?: ClientChannel
  sftp?: SFTPWrapper
  sftpPromise?: Promise<SFTPWrapper>
  /** While true, stdout is held back until the shell-integration clear marker
   *  appears, so the injected setup line never reaches the terminal (no flash). */
  suppressing?: boolean
  suppressBuf?: string
  suppressTimer?: NodeJS.Timeout
  /** Set once the renderer says it is listening for this session (sshAttach).
   *  Until then output is parked in pendingBuf — an sshData sent before the
   *  renderer's listener exists is silently dropped by ipcRenderer. */
  attached?: boolean
  pendingBuf?: string
  /** Active local port-forward servers, torn down on disconnect. */
  forwardServers?: Server[]
  /** Remote (-R) forwards: remote-listen port → handler for an accepted socket. */
  remoteForwards?: Map<number, (socket: Duplex) => void>
  /** Port forwards added at runtime (keyed `mode:localPort`), so they can be
   *  tracked and removed; also lets us tell runtime from host-configured rules. */
  runtimeRules?: Map<string, { mode: ForwardMode; localPort: number; remoteHost: string; remotePort: number; servers: Server[] }>
  /** Human label for history results (user@host[:port]). */
  label?: string
  /** Recent raw output, capped, for cross-session history search. */
  history?: string
  /** Set once the shell channel closes normally (e.g. the user typed `exit`),
   *  so a subsequent client close is classified as intentional, not a drop. */
  shellExit?: boolean
  /** Append-only stream writing this session's output to a local log file. */
  logWrite?: WriteStream
  /** Whether output is currently being captured to the log file. */
  logging?: boolean
}

/** A running continuous-sync watcher (polls both trees for changes). */
interface WatchSyncState {
  sessionId: string
  localDir: string
  remoteDir: string
  mode: 'up' | 'down' | 'both'
  deleteExtras: boolean
  /** Baseline snapshots (rel → {size, mtimeMs}) from the last completed pass. */
  baselineLocal: Map<string, { size: number; mtimeMs: number }>
  baselineRemote: Map<string, { size: number; mtimeMs: number }>
  timer: ReturnType<typeof setTimeout> | null
  busy: boolean
}

/** A connect() failure caused by a host-key rejection. Carries the machine
 *  code and fingerprint (plus which hop, for jumps) so connect() can pass
 *  them on in ConnectResult. */
export class KeyError extends Error {
  code?: string
  key?: string
  keyHost?: string
  keyPort?: number
  constructor(message: string, opts?: { code?: string; key?: string; keyHost?: string; keyPort?: number }) {
    super(message)
    Object.assign(this, opts)
  }
}

/**
 * Owns all live SSH connections. One shell channel per session.
 * Data flows: renderer keystroke -> write(); server output -> IPC sshData.
 */
export class SshManager {
  private sessions = new Map<string, Session>()
  /** In-flight file aborts per job id (a job may transfer several files at once). */
  private jobAborts = new Map<string, Set<() => void>>()
  /** Job ids the user asked to cancel; workers stop between files. */
  private cancelledJobs = new Set<string>()
  /** Job ids the user asked to pause; their streams are held mid-file. */
  private pausedJobs = new Set<string>()
  /** jobId → bytes/sec cap (0 = unlimited), applied via a leaky-bucket. */
  private jobRate = new Map<string, number>()
  /** jobId → sessionId, so progress events can be tagged for the right pane. */
  private jobSession = new Map<string, string>()
  /** Jobs that run silently (continuous sync) — progress is not sent to the UI. */
  private quietJobs = new Set<string>()
  /** Active continuous-sync watchers keyed by watch id. */
  private watchSyncs = new Map<string, WatchSyncState>()
  /** Connection multiplexing: one shared ssh2 Client per host-key, opened on
   *  demand (opt-in via the `multiplex` param). refs counts live sessions. */
  private masters = new Map<string, { client: Client; refs: number; sessions: Set<string>; jumpClient: Client | null; sock?: Duplex }>()
  /** Files transferred concurrently within one job. */
  private static readonly CONCURRENCY = 4
  /** How far a job's tree walk may run ahead of its transfer workers. */
  private static readonly QUEUE_MAX = 2000

  private masterKey(params: ConnectParams): string {
    const port = params.port || 22
    return `${params.username}@${params.host}:${port}`
  }

  /** Pauses/resumes a single transfer job (held mid-file). */
  pauseTransfer(id: string, paused: boolean): void {
    if (paused) this.pausedJobs.add(id)
    else this.pausedJobs.delete(id)
  }
  /** Pauses/resumes every live transfer job at once. Bulk mutation of the same
   *  paused set (not an independent flag) so an individual resume after a
   *  pause-all still works — a separate `pausedAll` mask would pin everything
   *  paused and silently swallow per-job resumes. */
  pauseAll(paused: boolean): void {
    if (paused) for (const id of this.jobSession.keys()) this.pausedJobs.add(id)
    else this.pausedJobs.clear()
  }
  /** Sets the byte-rate cap (bytes/sec) for a job; 0 removes the cap. */
  setTransferRate(id: string, bytesPerSec: number): void {
    if (bytesPerSec > 0) this.jobRate.set(id, bytesPerSec)
    else this.jobRate.delete(id)
  }
  /** True when a job is currently paused (globally or individually). Only live,
   *  panel-tracked jobs are pausable — silent helper transfers (drag-out,
   *  editor save-back) use throwaway ids outside jobSession and must never be
   *  affected by a global pause or a stray pauseAll. */
  private isPaused(id: string): boolean {
    if (!this.jobSession.has(id)) return false
    return this.pausedJobs.has(id)
  }

  /** Cancels a transfer job: stops its loop and aborts every in-flight file. */
  cancelTransfer(id: string): void {
    // Only mark live jobs (jobSession holds an entry for the job's lifetime);
    // a cancel for an already-finished job would otherwise leak a set entry.
    if (!this.jobSession.has(id)) return
    this.cancelledJobs.add(id)
    this.jobAborts.get(id)?.forEach((abort) => abort())
  }

  constructor(
    private readonly sender: WebContents,
    private readonly knownHosts: KnownHosts
  ) {}

  private emit(event: SessionEvent): void {
    if (!this.sender.isDestroyed()) {
      this.sender.send(IPC.sshEvent, event)
    }
  }

  /** Largest buffer any single session may hold back (suppress + pre-attach). */
  private static readonly MAX_BUF = 65536
  /** Cap of retained output per session for cross-session history search. */
  private static readonly HISTORY_MAX = 256 * 1024

  private sendData(id: string, chunk: string): void {
    const session = this.sessions.get(id)
    if (session) session.history = ((session.history ?? '') + chunk).slice(-SshManager.HISTORY_MAX)
    // Live log-to-file: append every byte to the session's log if enabled.
    if (session?.logWrite && session.logging) {
      session.logWrite.write(chunk)
    }
    // The renderer only subscribes to sshData after connect() resolves and the
    // pane has rendered its terminal, so everything the shell emits before that
    // (MOTD, first prompt) would be dropped. Park it until sshAttach arrives.
    if (session && !session.attached) {
      const buf = (session.pendingBuf ?? '') + chunk
      // Cap like the suppress path does, keeping the tail: if a shell floods
      // before anyone is listening, the freshest output is what's worth showing.
      session.pendingBuf = buf.length > SshManager.MAX_BUF ? buf.slice(-SshManager.MAX_BUF) : buf
      return
    }
    if (!this.sender.isDestroyed()) {
      this.sender.send(IPC.sshData, { sessionId: id, data: chunk })
    }
  }

  /** The renderer's terminal for this session is now listening: stop parking
   *  output and flush what arrived since the shell opened. */
  attach(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.attached) return
    session.attached = true
    const buf = session.pendingBuf
    session.pendingBuf = undefined
    if (buf) this.sendData(sessionId, buf)
  }

  /** The human label (user@host[:port]) for a session, if still live. */
  label(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.label
  }

  /** Begins appending a session's live output to a local log file (that file's
   *  dir must exist). Returns false if the session is gone or already logging. */
  startLog(sessionId: string, path: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.logWrite) return false
    try {
      const ws = createWriteStream(path, { flags: 'a' })
      session.logWrite = ws
      session.logging = true
      ws.on('error', () => {
        // A failed write (dir removed / disk full) shouldn't crash the session;
        // just stop logging quietly.
        session.logging = false
      })
      return true
    } catch {
      return false
    }
  }

  /** Stops logging a session and flushes/closes its log stream. */
  stopLog(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session?.logWrite) return
    session.logging = false
    session.logWrite.end()
    session.logWrite = undefined
  }

  /** stdout path: while suppressing, buffer until the shell-integration clear
   *  marker, then forward only from that clear onward (drops the echoed setup). */
  private emitData(id: string, chunk: string): void {
    const session = this.sessions.get(id)
    if (session?.suppressing) {
      session.suppressBuf = (session.suppressBuf ?? '') + chunk
      const CLR = '\x1b[2J'
      const mi = session.suppressBuf.indexOf(CLR)
      if (mi === -1) {
        // Cap the buffer so a shell that never emits the marker can't grow it forever.
        if (session.suppressBuf.length > SshManager.MAX_BUF) this.stopSuppress(id, true)
        return
      }
      const after = session.suppressBuf.slice(mi + CLR.length)
      this.stopSuppress(id, false)
      this.sendData(id, '\x1b[2J\x1b[H' + after)
      return
    }
    this.sendData(id, chunk)
  }

  private stopSuppress(id: string, flush: boolean): void {
    const session = this.sessions.get(id)
    if (!session?.suppressing) return
    if (session.suppressTimer) {
      clearTimeout(session.suppressTimer)
      session.suppressTimer = undefined
    }
    session.suppressing = false
    const buf = session.suppressBuf ?? ''
    session.suppressBuf = ''
    if (flush && buf) this.sendData(id, buf)
  }

  /** Base ssh2 config shared by the target and any jump hop. */
  private static baseConfig(
    host: string,
    port: number,
    username: string,
    keepaliveMs: number | undefined,
    readyTimeoutMs?: number
  ): Record<string, unknown> {
    return {
      host,
      port,
      username,
      keepaliveInterval: keepaliveMs ?? 20_000,
      readyTimeout: readyTimeoutMs ?? 20_000,
      hostHash: 'sha256'
    }
  }

  /** Builds the authentication fields of an ssh2 config for a given auth scheme. */
  private async authConfig(
    auth: ConnectParams['auth'],
    keyPath: string | undefined,
    passphrase: string | undefined,
    password: string | undefined
  ): Promise<Record<string, unknown>> {
    if (auth === 'key') {
      if (!keyPath) throw new Error('未选择私钥文件')
      const cfg: Record<string, unknown> = { privateKey: await readFile(keyPath) }
      if (passphrase) cfg.passphrase = passphrase
      return cfg
    }
    if (auth === 'password') return { password: password ?? '' }
    return {
      agent:
        process.env.SSH_AUTH_SOCK ||
        (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined)
    }
  }

  /** Pipes a Multiplexed 'read channel' into a stream ssh2's `sock` option can use. */
  private static makeSocketBridge(channel: ClientChannel): Duplex {
    let closed = false
    const bridge = new Duplex({
      read() {
        channel.resume()
      },
      write(chunk, enc, cb) {
        if (closed) return cb(new Error('已关闭'))
        const ok = channel.write(chunk, enc as BufferEncoding)
        if (ok) cb()
        else channel.once('drain', () => cb())
      },
      final(cb) {
        channel.end()
        cb()
      },
      destroy(err, cb) {
        if (!closed) {
          closed = true
          channel.destroy()
        }
        cb(err)
      }
    })
    channel.on('data', (d: Buffer) => {
      if (!bridge.push(d)) channel.pause()
    })
    channel.on('end', () => bridge.push(null))
    channel.on('error', (e: Error) => bridge.destroy(e))
    channel.on('close', () => {
      if (!bridge.destroyed) bridge.destroy()
    })
    return bridge
  }

  /** Connects to a jump host, authenticates, and returns a tunneled `sock` for
   *  the target ssh2 Client to connect through (ProxyJump).
   *  The jump's host key is verified the same way as the target's: an unknown
   *  or changed key refuses to send the user's credential through a tunnel, and
   *  the reason travels back as {@link KeyError} so connect() surfaces it with a
   *  code + fingerprint. (The verifier here does not record a first key.) */
  private connectJump(
    jump: JumpConfig,
    targetHost: string,
    targetPort: number
  ): Promise<{ sock: Duplex; client: Client }> {
    return new Promise((res, rej) => {
      const client = new Client()
      const config = SshManager.baseConfig(jump.host, jump.port, jump.username, undefined)
      let keyRejected = false
      let keyUnknown = false
      let lastKey = ''
      // Same normalization as the target verifier.
      config.hostVerifier = (
        keyOrHash: string | Buffer,
        cb: (valid: boolean) => void
      ): void => {
        // Same normalization as the target's verifier in connect().
        const hashedKey = Buffer.isBuffer(keyOrHash)
          ? createHash('sha256').update(keyOrHash).digest('hex')
          : keyOrHash
        const known = this.knownHosts.get(jump.host, jump.port)
        if (!known) {
          keyRejected = true
          keyUnknown = true
          lastKey = hashedKey
          this.noteRejected(jump.host, jump.port, hashedKey)
          return cb(false)
        }
        if (known === hashedKey) return cb(true)
        this.noteRejected(jump.host, jump.port, hashedKey)
        keyRejected = true
        lastKey = hashedKey
        cb(false)
      }
      let settled = false
      const fail = (
        msg: string,
        keyErr?: { code?: string; key?: string; keyHost?: string; keyPort?: number }
      ): void => {
        if (settled) return
        settled = true
        client.end()
        rej(new KeyError(msg, keyErr))
      }
      this.authConfig(jump.auth, jump.keyPath, jump.passphrase, jump.password)
        .then((auth) => {
          Object.assign(config, auth)
          client.connect(config)
        })
        .catch((e) => fail(friendlyError((e as Error).message)))
      client.on('error', (err) => {
        if (!keyRejected) return fail(friendlyError(err.message))
        fail('跳板机主机密钥未获信任,连接已中止', {
          code: keyUnknown ? 'host_key_unknown' : 'host_key_changed',
          key: lastKey,
          keyHost: jump.host,
          keyPort: jump.port || 22
        })
      })
      client.on('ready', () => {
        // The hop can accept the SSH connection yet never answer the channel
        // open — a firewall dropping the target is the usual cause — and ssh2
        // has no timeout of its own, so connect() would never settle.
        const timer = setTimeout(() => fail('跳板机没有回应到目标的连接请求'), this.jumpForwardTimeoutMs)
        timer.unref?.()
        client.forwardOut(
          '127.0.0.1',
          0,
          targetHost,
          targetPort,
          (err, channel) => {
            clearTimeout(timer)
            if (err) return fail('无法通过跳板机连通目标: ' + friendlyError(err.message))
            if (settled) {
              channel.close()
              client.end()
              return
            }
            settled = true
            const sock = SshManager.makeSocketBridge(channel)
            // When the tunnel dies, make sure the hop connection goes with it.
            sock.on('close', () => {
              if (!sock.destroyed) client.end()
            })
            res({ sock, client })
          }
        )
      })
    })
  }

  /** Establishes a tunneled socket to the SSH target through an HTTP/SOCKS5
   *  proxy, for ssh2's `sock` option. Handles both handshake protocols and
   *  optional proxy auth. */
  private connectProxy(
    proxy: ProxyConfig,
    targetHost: string,
    targetPort: number,
    /** Handed the socket at once, so a caller can close it mid-handshake. */
    track?: (sock: Socket) => void
  ): Promise<Socket> {
    return new Promise((res, rej) => {
      const sock = createConnection({ host: proxy.host, port: proxy.port })
      track?.(sock)
      let settled = false
      // A proxy that accepts the connection but never answers the handshake
      // must not hang the connect forever.
      const handshakeTimer = setTimeout(() => fail('代理握手超时'), 15_000)
      const fail = (msg: string): void => {
        if (settled) return
        settled = true
        clearTimeout(handshakeTimer)
        sock.destroy()
        rej(new Error(msg))
      }
      sock.on('error', (e) => fail(friendlyError(e.message)))
      sock.on('connect', () => {
        const ok = (): void => {
          if (settled) return
          settled = true
          clearTimeout(handshakeTimer)
          res(sock)
        }
        if (proxy.type === 'socks5') this.socks5Handshake(sock, proxy, targetHost, targetPort)
          .then(ok)
          .catch((e) => fail((e as Error).message))
        else this.httpConnectHandshake(sock, proxy, targetHost, targetPort)
          .then(ok)
          .catch((e) => fail((e as Error).message))
      })
    })
  }

  /** SOCKS5: greeting + method negotiation, then CONNECT to the target.
   *  Buffers across TCP fragments and re-injects any tunnel bytes that arrive
   *  bundled with the CONNECT reply (via unshift) so none are dropped. */
  private socks5Handshake(
    sock: Socket,
    proxy: ProxyConfig,
    targetHost: string,
    targetPort: number
  ): Promise<void> {
    return new Promise((res, rej) => {
      const methods = proxy.username ? [0, 2] : [0]
      sock.write(Buffer.from([5, methods.length, ...methods]))
      // 0 = greeting reply, 1 = auth reply, 2 = CONNECT reply.
      let phase = 0
      let buf = Buffer.alloc(0)
      const cleanup = (): void => { sock.removeListener('data', onData) }
      const fail = (msg: string): void => { cleanup(); rej(new Error(msg)) }
      const sendConnect = (): void => {
        const addr = Buffer.from(targetHost, 'utf8')
        const req = Buffer.alloc(6 + addr.length + 1)
        req[0] = 5
        req[1] = 1
        req[2] = 0
        req[3] = 3 // domain
        req[4] = addr.length
        addr.copy(req, 5)
        req.writeUInt16BE(targetPort, 5 + addr.length)
        sock.write(req)
      }
      const onData = (d: Buffer): void => {
        buf = Buffer.concat([buf, d])
        try {
          if (phase === 0) {
            // Method-selection reply: [ver, method].
            if (buf.length < 2) return
            if (buf[0] !== 5) return fail('SOCKS5 代理版本不符')
            const method = buf[1]
            buf = buf.slice(2)
            if (method === 2) {
              const u = Buffer.from(proxy.username ?? '')
              const p = Buffer.from(proxy.password ?? '')
              sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]))
              phase = 1
              return
            }
            if (method === 0) {
              phase = 2
              sendConnect()
              return
            }
            return fail('SOCKS5 代理要求认证,但未配置用户名密码')
          }
          if (phase === 1) {
            // Auth reply: [ver, status].
            if (buf.length < 2) return
            if (buf[1] !== 0) return fail('SOCKS5 代理认证失败')
            buf = buf.slice(2)
            phase = 2
            sendConnect()
            return
          }
          // CONNECT reply: [ver, rep, rsv, atyp, ...] — variable length.
          if (buf.length < 4) return
          const rep = buf[1]
          if (rep !== 0) return fail(`SOCKS5 代理连接失败 (0x${rep.toString(16)})`)
          const atyp = buf[3]
          let hdrLen = 4
          if (atyp === 1) hdrLen += 4
          else if (atyp === 3) hdrLen += 1 + buf[4]
          else if (atyp === 4) hdrLen += 16
          else return fail('SOCKS5 代理响应地址类型无效')
          if (buf.length < hdrLen + 2) return
          const leftover = buf.slice(hdrLen + 2)
          cleanup()
          if (leftover.length) sock.unshift(leftover)
          res()
        } catch (e) {
          fail((e as Error).message)
        }
      }
      sock.on('data', onData)
    })
  }

  /** HTTP CONNECT: request the proxy to open a tunnel to the target host:port.
   *  Buffers fragmented headers and forwards any bytes after the header terminator
   *  (which belong to the tunnel) via unshift so nothing is lost. */
  private httpConnectHandshake(
    sock: Socket,
    proxy: ProxyConfig,
    targetHost: string,
    targetPort: number
  ): Promise<void> {
    return new Promise((res, rej) => {
      const auth = proxy.username
        ? 'Proxy-Authorization: Basic ' + Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64') + '\r\n'
        : ''
      sock.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        auth +
        '\r\n'
      )
      let buf = Buffer.alloc(0)
      const cleanup = (): void => { sock.removeListener('data', onData) }
      const onData = (d: Buffer): void => {
        buf = Buffer.concat([buf, d])
        const idx = buf.indexOf('\r\n\r\n')
        if (idx < 0) return
        const head = buf.slice(0, idx + 4).toString('utf8')
        const leftover = buf.slice(idx + 4)
        cleanup()
        const status = /^HTTP\/1\.[01]\s+(\d+)/.exec(head)
        const code = status ? Number(status[1]) : 0
        if (leftover.length) sock.unshift(leftover)
        if (code === 200) res()
        else rej(new Error(`HTTP 代理隧道失败 (${code})`))
      }
      sock.on('data', onData)
    })
  }

  /** Opens a single port forward per rule mode (local -L, remote -R, dynamic
   *  SOCKS -D) and returns the local servers it created (none for remote). */
  private openRule(session: Session, rule: HostForward): Server[] {
    if (!rule.localPort) return []
    const mode = rule.mode ?? 'local'
    // Remote forwards are attached to the client's 'tcp connection' handler
    // (one shared listener), which openRemoteForward wires up on first use.
    if (mode === 'remote') {
      this.openRemoteForward(session, rule)
      return []
    }
    if (mode === 'dynamic') {
      const server = createServer((socket: Socket) => this.handleSocks(session, socket))
      server.on('error', () => {
        /* local port busy — skip silently */
      })
      server.listen(rule.localPort, '127.0.0.1')
      return [server]
    }
    // Local forward (-L): listen here, tunnel to remoteHost:remotePort.
    const lp = rule.localPort
    const rh = rule.remoteHost || '127.0.0.1'
    const rp = rule.remotePort
    const server = createServer((socket: Socket) => {
      session.client.forwardOut('127.0.0.1', lp, rh, rp, (err, channel) => {
        if (err) {
          socket.end()
          return
        }
        socket.on('error', () => channel.destroy())
        channel.on('error', () => socket.destroy())
        socket.pipe(channel).pipe(socket)
      })
    })
    server.on('error', () => {
      /* local port busy or not permitted — skip silently */
    })
    server.listen(lp, '127.0.0.1')
    return [server]
  }

  /** Opens port forwards per rule mode (used at connect time). */
  private openForwards(session: Session, rules: HostForward[]): void {
    const servers: Server[] = []
    for (const rule of rules) servers.push(...this.openRule(session, rule))
    if (servers.length) {
      session.forwardServers = (session.forwardServers ?? []).concat(servers)
    }
  }

  /** Adds a port forward to a live session at runtime. Returns ok/error.
   *  Unlike connect-time forwards, the bind is awaited so a port already in use
   *  (EADDRINUSE) is reported instead of silently appearing to have succeeded. */
  async addForward(sessionId: string, rule: HostForward): Promise<{ ok: boolean; error?: string; code?: ForwardErrorCode }> {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, code: 'no-session', error: 'session not found' }
    if (!rule.localPort) return { ok: false, code: 'bad-port', error: 'missing local port' }
    const mode = rule.mode ?? 'local'
    if (mode !== 'dynamic' && !rule.remotePort) return { ok: false, code: 'bad-port', error: 'missing remote port' }
    const key = `${mode}:${rule.localPort}`
    if (session.runtimeRules?.has(key)) return { ok: false, code: 'already', error: 'already forwarding' }
    const servers = this.openRule(session, rule)
    if (servers.length) {
      // A failed bind surfaces as an async 'error' after listen(); wait for all
      // servers to actually start listening (or roll back the ones that didn't).
      const bound = await Promise.all(servers.map((s) => this.waitForListen(s)))
      if (bound.some((b) => !b)) {
        servers.forEach((s) => s.close())
        return { ok: false, code: 'in-use', error: `local port ${rule.localPort} in use` }
      }
      session.forwardServers = (session.forwardServers ?? []).concat(servers)
    }
    if (!session.runtimeRules) session.runtimeRules = new Map()
    session.runtimeRules.set(key, { mode, localPort: rule.localPort, remoteHost: rule.remoteHost || '127.0.0.1', remotePort: rule.remotePort || 0, servers })
    return { ok: true }
  }

  /** Resolves once a server is listening (true) or failed to bind (false). */
  private waitForListen(server: Server): Promise<boolean> {
    return new Promise((resolve) => {
      if (server.listening) return resolve(true)
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve(true)
      }
      const onError = (): void => {
        server.removeListener('listening', onListening)
        resolve(false)
      }
      server.once('listening', onListening)
      server.once('error', onError)
    })
  }

  /** Removes a port forward from a live session. Handles both runtime-added and
   *  host-configured rules by matching the local listener port. */
  removeForward(sessionId: string, rule: { mode?: ForwardMode; localPort: number }): { ok: boolean; error?: string; code?: ForwardErrorCode } {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, code: 'no-session', error: 'session not found' }
    const mode = rule.mode ?? 'local'
    const key = `${mode}:${rule.localPort}`
    // Close any local/dynamic listener bound to this port (static or runtime).
    const owned = session.runtimeRules?.get(key)?.servers ?? []
    const port = rule.localPort
    const toClose = session.forwardServers?.filter((s) => {
      const addr = s.address()
      const boundPort = addr && typeof addr !== 'string' ? addr.port : -1
      return owned.includes(s) || boundPort === port
    }) ?? []
    toClose.forEach((s) => s.close())
    if (toClose.length) {
      session.forwardServers = (session.forwardServers ?? []).filter((s) => !toClose.includes(s))
    }
    if (mode === 'remote') {
      try {
        session.client.unforwardIn('127.0.0.1', port, () => {})
      } catch {
        /* already gone */
      }
      session.remoteForwards?.delete(port)
    }
    session.runtimeRules?.delete(key)
    return { ok: true }
  }

  /** Remote forward (-R): listen on the server; each inbound connection is
   *  piped to the local destination. ssh2 reports these via a single client
   *  'tcp connection' event, keyed by the remote listen port. */
  private openRemoteForward(session: Session, rule: HostForward): void {
    if (!session.remoteForwards) {
      session.remoteForwards = new Map()
      session.client.on('tcp connection', (info, accept, reject) => {
        const handler = session.remoteForwards?.get(info.destPort)
        if (!handler) {
          reject()
          return
        }
        const inSock = accept()
        handler(inSock)
      })
    }
    const destHost = rule.remoteHost || '127.0.0.1'
    const destPort = rule.remotePort
    session.remoteForwards.set(rule.localPort, (inSock) => {
      const dest = new Socket()
      dest.connect(destPort, destHost)
      dest.on('error', () => inSock.destroy())
      inSock.on('error', () => dest.destroy())
      dest.on('connect', () => inSock.pipe(dest).pipe(inSock))
    })
    session.client.forwardIn('127.0.0.1', rule.localPort, (err) => {
      if (err) session.remoteForwards?.delete(rule.localPort)
    })
  }

  /** Minimal SOCKS5 server for dynamic forwarding (-D). Supports the standard
   *  handshake: version/method negotiation, then a CONNECT request whose
   *  destination is tunneled via forwardOut. NOAUTH only. */
  private handleSocks(session: Session, socket: Socket): void {
    let buf = Buffer.alloc(0)
    let greeted = false
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk])

      // Greeting: VER(0x05) NMETHODS METHODS…
      if (!greeted) {
        if (buf.length < 2) return
        const nmethods = buf[1]
        if (buf.length < 2 + nmethods) return
        socket.write(Buffer.from([0x05, 0x00]))
        greeted = true
        buf = buf.subarray(2 + nmethods)
      }

      // Request: VER CMD RSV ATYP ADDR PORT (CONNECT only).
      const req = parseSocksRequest(buf)
      if (!req) return
      socket.removeListener('data', onData)
      session.client.forwardOut('127.0.0.1', 0, req.host, req.port, (err, channel) => {
        if (err) {
          socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
          socket.end()
          return
        }
        // Success reply (ATYP IPv4, bound 0.0.0.0:0).
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        socket.on('error', () => channel.destroy())
        channel.on('error', () => socket.destroy())
        // After the handshake, raw bytes flow both ways.
        socket.pipe(channel).pipe(socket)
      })
    }
    socket.on('data', onData)
    socket.on('error', () => socket.destroy())
  }

  private closeForwards(session: Session): void {
    session.forwardServers?.forEach((s) => s.close())
    session.forwardServers = undefined
    session.remoteForwards?.clear()
    session.remoteForwards = undefined
  }

  async connect(params: ConnectParams): Promise<ConnectResult> {
    const id = randomUUID()

    // Connection multiplexing (opt-in): reuse an already-established link to
    // the same user@host:port instead of a full re-handshake.
    if (params.multiplex) {
      const key = this.masterKey(params)
      const m = this.masters.get(key)
      if (m) {
        m.refs++
        m.sessions.add(id)
        const session: Session = { id, client: m.client }
        this.sessions.set(id, session)
        const port = params.port || 22
        session.label = `${params.username}@${params.host}${port !== 22 ? `:${port}` : ''}`
        return this.openReuseShell(id, m.client, params)
      }
    }

    const client = new Client()
    this.sessions.set(id, { id, client })

    const port = params.port || 22
    this.sessions.get(id)!.label =
      `${params.username}@${params.host}${port !== 22 ? `:${port}` : ''}`
    const config = SshManager.baseConfig(params.host, port, params.username, params.keepaliveMs, params.readyTimeoutMs)

    // Host-key verification: an unrecognized key is never trusted silently —
    // refuse the handshake and hand the fingerprint to the renderer, which asks
    // the user before the user's credential goes anywhere. A changed key does
    // the same with the 'host_key_changed' code.
    await this.knownHosts.load()
    let keyRejected = false
    let keyUnknown = false
    let lastKey = ''
    config.hostVerifier = (
      keyOrHash: string | Buffer,
      cb: (valid: boolean) => void
    ): void => {
      // Should ssh2 ever hand over the raw wire-format key instead of the hash,
      // normalize it so the verifier always reasons about the same sha256 hex
      // it is asked to compare and later trust.
      const hashedKey = Buffer.isBuffer(keyOrHash)
        ? createHash('sha256').update(keyOrHash).digest('hex')
        : keyOrHash
      const known = this.knownHosts.get(params.host, port)
      if (!known) {
        keyRejected = true
        keyUnknown = true
        lastKey = hashedKey
        this.noteRejected(params.host, port, hashedKey)
        return cb(false)
      }
      if (known === hashedKey) return cb(true)
      this.noteRejected(params.host, port, hashedKey)
      keyRejected = true
      lastKey = hashedKey
      cb(false)
    }

    // ProxyJump: tunnel the target connection through a jump host first.
    let jumpClient: Client | null = null
    if (params.jump) {
      try {
        const { sock, client: jc } = await this.connectJump(params.jump, params.host, port)
        config.sock = sock
        sock.on('error', () => undefined)
        jumpClient = jc
      } catch (err) {
        this.sessions.delete(id)
        const e = err as Error & { code?: string; key?: string; keyHost?: string; keyPort?: number }
        return { ok: false, error: e.message, code: e.code, key: e.key, keyHost: e.keyHost, keyPort: e.keyPort }
      }
    }

    // HTTP/SOCKS5 proxy: if no jump tunnel is in use, route the direct link
    // through the proxy so the target reachable only via it can be connected.
    if (params.proxy && !config.sock) {
      try {
        const psock = await this.connectProxy(params.proxy, params.host, port)
        psock.on('error', () => undefined)
        config.sock = psock
      } catch (err) {
        this.sessions.delete(id)
        return { ok: false, error: (err as Error).message }
      }
    }

    try {
      Object.assign(
        config,
        await this.authConfig(params.auth, params.keyPath, params.passphrase, params.password)
      )
    } catch (err) {
      jumpClient?.end()
      ;(config.sock as Duplex | Socket | undefined)?.destroy()
      this.sessions.delete(id)
      return { ok: false, error: friendlyError((err as Error).message) }
    }

    // -A: forward the local agent so the remote host (and any hosts it jumps
    // to) can use our loaded identities. Requires an agent socket to forward.
    if (params.agentForward) {
      config.agentForward = true
      if (!config.agent) {
        config.agent =
          process.env.SSH_AUTH_SOCK ||
          (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined)
      }
    }

    return new Promise<ConnectResult>((resolve) => {
      let settled = false
      const settle = (result: ConnectResult): void => {
        if (settled) return
        settled = true
        resolve(result)
      }

      this.emit({ sessionId: id, status: 'connecting' })

      client.on('ready', () => {
        // Multiplex (opt-in): register this fresh link as the master so later
        // sessions to the same host can reuse it. Attach a teardown that, on a
        // drop, closes every session sharing this connection.
        if (params.multiplex && !this.masters.has(this.masterKey(params))) {
          const m = { client, refs: 1, sessions: new Set<string>([id]), jumpClient, sock: config.sock as Duplex | undefined }
          this.masters.set(this.masterKey(params), m)
          client.on('close', () => this.teardownMaster(this.masterKey(params)))
          client.on('error', () => this.teardownMaster(this.masterKey(params)))
        }
        client.shell(
          { term: 'xterm-256color', cols: params.cols ?? 80, rows: params.rows ?? 24 },
          (err, stream) => {
            if (err) {
              const message = friendlyError(err.message)
              this.emit({ sessionId: id, status: 'error', message })
              client.end()
              return settle({ ok: false, error: message })
            }
            const session = this.sessions.get(id)
            if (session) session.stream = stream

            stream.on('data', (data: Buffer) => this.emitData(id, data.toString('utf8')))
            stream.stderr.on('data', (data: Buffer) => this.sendData(id, data.toString('utf8')))
            stream.on('close', () => {
              // Mark a clean shell close (the remote shell ended) so the client
              // 'close' that follows is treated as an intentional exit. The
              // actual status is emitted once, from client 'close', based on it.
              const sess = this.sessions.get(id)
              if (sess) sess.shellExit = true
              // If this session opened the shared multiplex link and peers are
              // using it, ending the client would drop them too — release a ref
              // instead and let the master live for its other sessions.
              if (params.multiplex && sess && this.masters.has(this.masterKey(params))) {
                const m = this.masters.get(this.masterKey(params))!
                if (m.refs > 1) {
                  this.closeForwards(sess)
                  this.emit({ sessionId: id, status: 'closed' })
                  this.releaseMaster(this.masterKey(params), id)
                  this.sessions.delete(id)
                  return
                }
              }
              client.end()
            })

            // Opt-in shell integration: append a PROMPT_COMMAND that emits an
            // OSC 7 sequence with $PWD after every prompt, so the renderer can
            // track the shell's working directory. Preserves any existing
            // PROMPT_COMMAND; session-scoped only (never written to disk).
            if (params.shellIntegration && session) {
              // Hold back stdout until the trailing clear marker arrives, so the
              // echoed setup line is dropped before it ever reaches the terminal
              // (prevents the flash of showing-then-clearing).
              session.suppressing = true
              session.suppressBuf = ''
              session.suppressTimer = setTimeout(() => this.stopSuppress(id, true), 2500)
              // Only bash honors PROMPT_COMMAND, so gate the export on
              // $BASH_VERSION (other POSIX shells skip it). The printf clears
              // screen + scrollback (renderer only sees output from there on).
              // bash records a command in history AFTER it runs, so we delete this
              // line on PROMPT_COMMAND's first run instead: `history 1` gives the
              // last entry's displayed number (the offset `history -d` wants on
              // both bash 4.2 and 5.x — unlike HISTCMD), then the __xsi flag
              // disarms it. The `case *__xsi*` guard deletes ONLY when that last
              // entry is actually our setup line, never a real command. So
              // Up-arrow never recalls this setup line.
              stream.write(
                "[ -n \"$BASH_VERSION\" ] && { export PROMPT_COMMAND='printf \"\\033]7;%s\\a\" \"$PWD\"; [ \"$__xsi\" ] && { read -r __n __r < <(history 1); case \"$__r\" in *__xsi*) history -d \"$__n\" 2>/dev/null;; esac; unset __xsi __n __r; }'\"${PROMPT_COMMAND:+;$PROMPT_COMMAND}\"; __xsi=1; }; printf '\\033[3J\\033[2J\\033[H'\n"
              )
            }

            // Open the session's local port forwards once the shell is up.
            if (session && params.portForwards?.length) {
              this.openForwards(session, params.portForwards)
            }

            // Send the per-host startup command(s) after the shell is ready. An
            // optional delay lets a slow login shell/MOTD finish first (values
            // up to a few seconds are typical for `wait`-style startup hooks).
            if (params.onConnect) {
              const sendStartup = (): boolean => stream.write(params.onConnect + '\n')
              const delay = params.onConnectDelayMs ?? 0
              if (delay > 0) setTimeout(() => void sendStartup(), delay)
              else sendStartup()
            }

            this.emit({ sessionId: id, status: 'connected' })
            settle({ ok: true, sessionId: id })
          }
        )
      })

      client.on('error', (err) => {
        const raw = err.message
        const message = keyRejected
          ? keyUnknown
            ? '主机密钥未获信任,连接已中止;若此服务器是你自己的,可确认其身份后信任'
            : '主机密钥与首次连接时记录的不一致,连接已中止;这可能是中间人攻击,若你确认服务器已重装或更换,可选择“信任新密钥并重连”'
          : friendlyError(raw)
        this.emit({ sessionId: id, status: 'error', message })
        this.stopLog(id)
        if (jumpClient) jumpClient.end()
        this.sessions.delete(id)
        settle({
          ok: false,
          error: message,
          transient: !keyRejected && isTransientConnectError(raw),
          retryDelayMs: penaltyRetryDelayMs(raw),
          code: keyRejected ? (keyUnknown ? 'host_key_unknown' : 'host_key_changed') : undefined,
          key: keyRejected ? lastKey : undefined,
          keyHost: keyRejected ? params.host : undefined,
          keyPort: keyRejected ? port : undefined
        })
      })

      client.on('close', () => {
        // Distinguish an intentional exit (shell closed first) from an
        // unexpected network drop. A drop is surfaced as `error` so the
        // renderer's auto-reconnect triggers; a clean exit stays `closed`.
        const session = this.sessions.get(id)
        if (session) {
          if (session.shellExit) this.emit({ sessionId: id, status: 'closed' })
          else this.emit({ sessionId: id, status: 'error', message: '连接已断开' })
        }
        if (jumpClient) jumpClient.end()
        this.stopLog(id)
        this.sessions.delete(id)
      })

      try {
        client.connect(config)
      } catch (err) {
        if (jumpClient) jumpClient.end()
        this.sessions.delete(id)
        settle({ ok: false, error: friendlyError((err as Error).message) })
      }
    })
  }

  /** Opens a shell on an existing (multiplexed) master link for a new session,
   *  wiring output exactly like the fresh-connect path. Does not end the shared
   *  client when this session's shell closes — the master stays for its peers. */
  private openReuseShell(id: string, client: Client, params: ConnectParams): Promise<ConnectResult> {
    const key = this.masterKey(params)
    return new Promise<ConnectResult>((resolve) => {
      let settled = false
      const settle = (r: ConnectResult): void => {
        if (settled) return
        settled = true
        resolve(r)
      }
      this.emit({ sessionId: id, status: 'connecting' })
      client.shell(
        { term: 'xterm-256color', cols: params.cols ?? 80, rows: params.rows ?? 24 },
        (err, stream) => {
          if (err) {
            const message = friendlyError(err.message)
            this.emit({ sessionId: id, status: 'error', message })
            this.releaseMaster(key, id)
            this.sessions.delete(id)
            return settle({ ok: false, error: message })
          }
          const session = this.sessions.get(id)
          if (session) session.stream = stream
          stream.on('data', (d: Buffer) => this.emitData(id, d.toString('utf8')))
          stream.stderr.on('data', (d: Buffer) => this.sendData(id, d.toString('utf8')))
          stream.on('close', () => {
            const sess = this.sessions.get(id)
            if (sess) {
              sess.shellExit = true
              this.closeForwards(sess)
              this.emit({ sessionId: id, status: 'closed' })
            }
            this.releaseMaster(key, id)
            this.sessions.delete(id)
          })
          if (params.shellIntegration && session) {
            session.suppressing = true
            session.suppressBuf = ''
            session.suppressTimer = setTimeout(() => this.stopSuppress(id, true), 2500)
            stream.write(
              "[ -n \"$BASH_VERSION\" ] && { export PROMPT_COMMAND='printf \"\\033]7;%s\\a\" \"$PWD\"; [ \"$__xsi\" ] && { read -r __n __r < <(history 1); case \"$__r\" in *__xsi*) history -d \"$__n\" 2>/dev/null;; esac; unset __xsi __n __r; }'\"${PROMPT_COMMAND:+;$PROMPT_COMMAND}\"; __xsi=1; }; printf '\\033[3J\\033[2J\\033[H'\n"
            )
          }
          if (session && params.portForwards?.length) this.openForwards(session, params.portForwards)
          if (params.onConnect) {
            const delay = params.onConnectDelayMs ?? 0
            if (delay > 0) setTimeout(() => stream.write(params.onConnect + '\n'), delay)
            else stream.write(params.onConnect + '\n')
          }
          this.emit({ sessionId: id, status: 'connected' })
          settle({ ok: true, sessionId: id })
        }
      )
    })
  }

  /** Removes a session from a master's refcount; destroys the master when the
   *  last session goes away. */
  private releaseMaster(key: string, id: string): void {
    const m = this.masters.get(key)
    if (!m) return
    m.sessions.delete(id)
    m.refs--
    if (m.refs <= 0) this.destroyMaster(key)
  }

  /** Closes every session on a leap that just dropped (network error/close). */
  private teardownMaster(key: string): void {
    const m = this.masters.get(key)
    if (!m) return
    for (const sid of [...m.sessions]) {
      const s = this.sessions.get(sid)
      if (s) {
        this.emit({ sessionId: sid, status: 'error', message: '连接已断开' })
        this.stopLog(sid)
        this.closeForwards(s)
        s.stream?.end()
        this.sessions.delete(sid)
      }
    }
    m.jumpClient?.end()
    m.sock?.destroy()
    this.masters.delete(key)
  }

  /** Releases resources of a master whose last session disconnected. */
  private destroyMaster(key: string): void {
    const m = this.masters.get(key)
    if (!m) return
    const { client, jumpClient, sock } = m
    this.masters.delete(key)
    for (const sid of [...m.sessions]) {
      const s = this.sessions.get(sid)
      if (s) {
        this.emit({ sessionId: sid, status: 'closed' })
        this.stopLog(sid)
        this.closeForwards(s)
        s.stream?.end()
        this.sessions.delete(sid)
      }
    }
    jumpClient?.end()
    sock?.destroy()
    client.end()
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.stream?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.stream?.setWindow(rows, cols, 0, 0)
  }

  // ---- SFTP ----
  private getSftp(sessionId: string): Promise<SFTPWrapper> {
    const session = this.sessions.get(sessionId)
    if (!session) return Promise.reject(new Error('会话不存在'))
    if (session.sftp) return Promise.resolve(session.sftp)
    // Reuse an in-flight sftp() so concurrent callers don't open extra channels.
    if (session.sftpPromise) return session.sftpPromise
    session.sftpPromise = new Promise<SFTPWrapper>((res, rej) => {
      session.client.sftp((err, sftp) => {
        if (err) {
          session.sftpPromise = undefined
          return rej(err)
        }
        // Drop the cache if the channel dies so the next call opens a fresh one
        // instead of reusing a dead wrapper that would hang forever.
        const invalidate = (): void => {
          // Only clear if this exact channel is still the cached one; a late
          // event from a superseded channel must not wipe a newer one's state.
          if (session.sftp === sftp) {
            session.sftp = undefined
            session.sftpPromise = undefined
          }
        }
        sftp.on('close', invalidate)
        sftp.on('end', invalidate)
        session.sftp = sftp
        res(sftp)
      })
    })
    return session.sftpPromise
  }

  private posixJoin(dir: string, name: string): string {
    return posixJoin(dir, name)
  }

  /** Parent directory of a remote POSIX path. */
  private parentOf(p: string): string {
    return parentOf(p)
  }

  /** Joins a remote-supplied name into localBase, rejecting path traversal. */
  private safeLocalJoin(localBase: string, name: string): string {
    const base = resolve(localBase)
    const p = resolve(base, name)
    // Reject path traversal. relative() handles drive roots correctly (a naive
    // `base + sep` prefix check wrongly rejects "D:\"). Only a leading path
    // segment that is exactly ".." is traversal — a name merely starting with
    // ".." (e.g. "..cache") is a legitimate file and must be allowed.
    const rel = relative(base, p)
    if (isAbsolute(rel) || rel.split(/[\\/]/)[0] === '..') {
      throw new Error(`不安全的文件名: ${name}`)
    }
    return p
  }

  async listDir(sessionId: string, path?: string): Promise<SftpList> {
    const sftp = await this.getSftp(sessionId)
    const real =
      path && path.trim()
        ? path
        : await new Promise<string>((res, rej) =>
            sftp.realpath('.', (e, p) => (e ? rej(e) : res(p)))
          )
    const list = await new Promise<
      {
        filename: string
        attrs: { size: number; mtime: number; mode: number; isDirectory(): boolean }
      }[]
    >((res, rej) => sftp.readdir(real, (e, l) => (e ? rej(e) : res(l as never))))

    const entries = list
      .map((it) => ({
        name: it.filename,
        isDir: it.attrs.isDirectory(),
        size: it.attrs.size,
        mtime: it.attrs.mtime,
        // Low 12 bits are the permission + setuid/setgid/sticky bits.
        mode: it.attrs.mode & 0o7777
      }))
      .sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
      )
    return { path: real, entries }
  }

  /** Last non-terminal progress send per job, for coalescing. */
  private lastProgressAt = new Map<string, number>()
  private static readonly PROGRESS_INTERVAL = 100

  /** The `error` text used for a cancelled job. Kept as a constant so the
   *  progress event can recognise it when stamping the `cancelled` flag; the
   *  renderer must not depend on this string. */
  private static readonly CANCELLED_TEXT = '已取消'

  /** Limit for one-shot remote commands (tar / unzip / sha256sum). A stuck mount
   *  or a command waiting on stdin must not hang the caller forever. Exposed as
   *  a field so tests can shorten it. */
  execTimeoutMs = 5 * 60_000

  /** How long the jump host may take to answer a channel open towards the
   *  target. ssh2 imposes no limit, and a firewall dropping the target on the
   *  hop's side leaves connect() unsettled for good. */
  jumpForwardTimeoutMs = 30_000

  private emitProgress(p: SftpProgress): void {
    // Continuous-sync jobs run silently: no per-file progress, no UI toasts.
    if (this.quietJobs.has(p.id)) return
    // A big folder produces a progress tick per chunk per file — tens of
    // thousands of IPC messages that would starve the renderer for no visible
    // gain. Rate-limit the running updates; done/error always go through.
    if (p.done || p.error) {
      this.lastProgressAt.delete(p.id)
    } else {
      const now = Date.now()
      const last = this.lastProgressAt.get(p.id)
      if (last !== undefined && now - last < SshManager.PROGRESS_INTERVAL) return
      this.lastProgressAt.set(p.id, now)
    }
    // Stamp the owning session so the renderer can route the event to the right
    // pane. The mapping is torn down in each job's finally, not here, so a job
    // that throws before its terminal event still cleans up.
    const sessionId = this.jobSession.get(p.id)
    // Mark cancellation structurally rather than leaving the renderer to match
    // on the message text. It used to compare against the Chinese literal, so
    // an English UI read a cancelled transfer as a failure — and moving the
    // wording into i18n would have broken it for every language at once.
    const cancelled = this.cancelledJobs.has(p.id) && p.error === SshManager.CANCELLED_TEXT
    if (!this.sender.isDestroyed()) this.sender.send(IPC.sftpProgress, { ...p, sessionId, cancelled })
  }

  private readdirFull(
    sftp: SFTPWrapper,
    dir: string
  ): Promise<{ filename: string; attrs: { size: number; isDirectory(): boolean } }[]> {
    return new Promise((res, rej) => sftp.readdir(dir, (e, l) => (e ? rej(e) : res(l as never))))
  }

  /** Downloads this process interrupted. A retry may only continue one of these:
   *  a local file that merely happens to be smaller is often an older copy, and
   *  appending the remote tail to it produces a corrupt file. Key is
   *  `${sessionId}\0${remotePath}`. */
  private partialDownloads = new Map<
    string,
    { localSize: number; remoteSize: number; remoteMtimeMs: number }
  >()

  private statSize(sftp: SFTPWrapper, path: string): Promise<number> {
    return new Promise((res, rej) =>
      sftp.stat(path, (e, s) => (e ? rej(e) : res((s as { size: number }).size)))
    )
  }

  /** Size plus mtime (ms), or null when the file is not there. Uploads use the
   *  mtime to tell "already the same file" from "same length, different
   *  content" — a one-character edit keeps the size. */
  private statFile(sftp: SFTPWrapper, path: string): Promise<{ size: number; mtimeMs: number } | null> {
    return new Promise((res) =>
      sftp.stat(path, (e, s) => {
        if (e || !s) return res(null)
        const st = s as { size: number; mtime?: number }
        res({ size: st.size, mtimeMs: (st.mtime ?? 0) * 1000 })
      })
    )
  }

  /** Names at `dir` that already exist (used to ask the user how to handle an
   *  upload that would overwrite them). Empty if the dir can't be read. */
  async remoteConflicts(sessionId: string, dir: string, names: string[]): Promise<string[]> {
    try {
      const sftp = await this.getSftp(sessionId)
      const list = await this.readdirFull(sftp, dir)
      const existing = new Set(list.map((i) => i.filename))
      return names.filter((n) => existing.has(n))
    } catch {
      return []
    }
  }

  /** Finds an unused remote path next to `path` by appending " (n)" before the
   *  extension ("report.txt" → "report (1).txt"), for the "keep both" policy. */
  private async uniqueRemote(sftp: SFTPWrapper, path: string): Promise<string> {
    const dir = this.parentOf(path)
    const base = basename(path)
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    for (let i = 1; i < 1000; i++) {
      const candidate = this.posixJoin(dir, `${stem} (${i})${ext}`)
      const size = await this.statSize(sftp, candidate).catch(() => -1)
      if (size < 0) return candidate
    }
    return this.posixJoin(dir, `${stem} (${Date.now()})${ext}`)
  }

  /** Full stat incl. mtime, or null on error. ssh2 Stats exposes mtime (sec)
   *  and mtimeMs (ms); convert to ms uniformly for cross-side comparison. */
  private statFull(sftp: SFTPWrapper, path: string): Promise<{ size: number; mtimeMs: number } | null> {
    return new Promise((res) =>
      sftp.stat(path, (e, s) => {
        if (e) return res(null)
        const attrs = s as { size: number; mtime?: number; mtimeMs?: number }
        res({ size: attrs.size, mtimeMs: attrs.mtimeMs ?? (attrs.mtime ?? 0) * 1000 })
      })
    )
  }

  /** Recursively enumerates a local directory into rel-path → {size, mtime}.
   *  Returns false when the directory can't be read (or a file can't be
   *  stat'ed) — the caller must then treat the map as unusable: a partial
   *  snapshot makes "absent on this side" mean "unreadable", which would turn
   *  `deleteExtras` into mass deletion of real files. */
  private async walkLocalTree(dir: string, base: string, map: Map<string, { size: number; mtimeMs: number }>): Promise<boolean> {
    let items: import('node:fs').Dirent[]
    try {
      items = await readdir(this.longPath(dir), { withFileTypes: true })
    } catch {
      return false
    }
    for (const it of items) {
      const abs = join(dir, it.name)
      const rel = this.posixJoin(base, it.name)
      if (it.isDirectory()) {
        if (!(await this.walkLocalTree(abs, rel, map))) return false
      } else if (it.isFile()) {
        try {
          const st = await stat(this.longPath(abs))
          map.set(rel, { size: st.size, mtimeMs: st.mtimeMs })
        } catch {
          return false
        }
      }
    }
    return true
  }

  /** Recursively enumerates a remote directory into rel-path → {size, mtime}.
   *  Returns false when anything can't be read — see walkLocalTree for why a
   *  partial snapshot must never be trusted. */
  private async walkRemoteTree(sftp: SFTPWrapper, dir: string, base: string, map: Map<string, { size: number; mtimeMs: number }>): Promise<boolean> {
    let list: { filename: string; attrs: { size: number; isDirectory(): boolean } }[]
    try {
      list = await this.readdirFull(sftp, dir)
    } catch {
      return false
    }
    for (const it of list) {
      const rel = this.posixJoin(base, it.filename)
      if (it.attrs.isDirectory()) {
        if (!(await this.walkRemoteTree(sftp, this.posixJoin(dir, it.filename), rel, map))) return false
      } else {
        const st = await this.statFull(sftp, this.posixJoin(dir, it.filename))
        if (!st) return false
        map.set(rel, st)
      }
    }
    return true
  }

  /** Mirrors a local <-> remote directory tree, transferring only the files
   *  that differ (size or mtime) — an rsync-style incremental sync. `mode`:
   *   - 'up':   local is the source of truth (newer/different local files win).
   *   - 'down': remote is the source of truth.
   *   - 'both': the newer of the two sides wins per file.
   *  When `deleteExtras` is on for a one-way mode, files absent from the source
   *  are removed at the destination. `keepNewer` (both) avoids deleting. */
  async syncJob(
    sessionId: string,
    localDir: string,
    remoteDir: string,
    mode: 'up' | 'down' | 'both',
    deleteExtras: boolean,
    jobId: string,
    concurrency?: number,
    rateBytesPerSec = 0,
    quiet = false
  ): Promise<void> {
    this.jobSession.set(jobId, sessionId)
    if (quiet) this.quietJobs.add(jobId)
    if (rateBytesPerSec > 0) this.jobRate.set(jobId, rateBytesPerSec)
    const conc = clampConcurrency(concurrency ?? SshManager.CONCURRENCY, SshManager.CONCURRENCY)
    const sftp = await this.getSftp(sessionId).catch((e) => {
      this.jobSession.delete(jobId)
      throw e
    })

    const localMap = new Map<string, { size: number; mtimeMs: number }>()
    const remoteMap = new Map<string, { size: number; mtimeMs: number }>()
    const [localOk, remoteOk] = await Promise.all([
      this.walkLocalTree(localDir, '', localMap),
      this.walkRemoteTree(sftp, remoteDir, '', remoteMap)
    ])
    // A partial snapshot (unreadable dir / file) would turn "absent on this
    // side" into a deletion — refuse to run the sync off one at all.
    if (!localOk || !remoteOk) {
      this.cancelledJobs.delete(jobId)
      this.pausedJobs.delete(jobId)
      throw new Error('目录枚举失败，本次同步已中止（源目录可能暂时不可读）')
    }
    // Plan: each entry is a transfer (dir up/down) or a deletion.
    interface FilePlan { dir: 'up' | 'down'; local: string; remote: string; rel: string; size: number }
    const plan: FilePlan[] = []
    const deletions: { rel: string; dir: 'up' | 'down' }[] = []
    const all = new Set<string>([...localMap.keys(), ...remoteMap.keys()])
    for (const rel of all) {
      const L = localMap.get(rel)
      const R = remoteMap.get(rel)
      const lp = this.safeLocalJoin(localDir, rel)
      const rp = this.posixJoin(remoteDir, rel)
      const newer = (a: { mtimeMs: number }, b: { mtimeMs: number }): boolean => a.mtimeMs > b.mtimeMs
      if (mode === 'up') {
        // Local is the source of truth: push local when it's absent/mismatched/newer.
        if (L && (!R || L.size !== R.size || newer(L, R))) plan.push({ dir: 'up', local: lp, remote: rp, rel, size: L.size })
        if (deleteExtras && !L && R) deletions.push({ rel, dir: 'up' })
      } else if (mode === 'down') {
        // Remote is the source of truth.
        if (R && (!L || R.size !== L.size || newer(R, L))) plan.push({ dir: 'down', local: lp, remote: rp, rel, size: R.size })
        if (deleteExtras && !R && L) deletions.push({ rel, dir: 'down' })
      } else if (mode === 'both') {
        // Newer side wins per file; equal mtime (with different size) falls back
        // to the local side, so a divergent file isn't left silently in sync.
        if (L && !R) plan.push({ dir: 'up', local: lp, remote: rp, rel, size: L.size })
        else if (!L && R) plan.push({ dir: 'down', local: lp, remote: rp, rel, size: R.size })
        else if (L && R) {
          if (newer(L, R)) plan.push({ dir: 'up', local: lp, remote: rp, rel, size: L.size })
          else if (newer(R, L)) plan.push({ dir: 'down', local: lp, remote: rp, rel, size: R.size })
          else if (L.size !== R.size) plan.push({ dir: 'up', local: lp, remote: rp, rel, size: L.size })
        }
      }
    }

    let bytesDone = 0
    let filesDone = 0
    let errors = 0
    const knownTotal = plan.reduce((a, p) => a + p.size, 0)
    const totalPlanned = plan.length + deletions.length
    const emit = (rel: string, dir: 'up' | 'down' = 'up', done?: boolean, error?: string): void =>
      this.emitProgress({
        id: jobId,
        name: rel,
        direction: dir,
        transferred: bytesDone,
        total: knownTotal,
        count: totalPlanned,
        index: filesDone,
        localDir,
        remoteDir,
        done,
        error
      })

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.cancelledJobs.has(jobId)) return
        const item = plan.shift()
        if (!item) return
        let read: Readable | undefined
        let write: Writable | undefined
        try {
          emit(item.rel, item.dir)
          // Ensure the destination directory exists (files are shuffled, so a
          // deep file may be picked before its parents were created).
          const destDir = item.dir === 'up' ? this.parentOf(item.remote) : this.parentOf(item.local)
          if (item.dir === 'up') await this.ensureRemoteDir(sftp, destDir)
          else await mkdir(this.longPath(destDir), { recursive: true })
          if (item.dir === 'up') {
            write = sftp.createWriteStream(item.remote)
            read = createReadStream(this.longPath(item.local))
          } else {
            write = createWriteStream(this.longPath(item.local))
            read = sftp.createReadStream(item.remote)
          }
          await this.pipeStream(jobId, read, write, (n) => {
            bytesDone += n
            emit(item.rel, item.dir)
          })
          filesDone++
        } catch {
          read?.destroy()
          write?.destroy()
          if (this.cancelledJobs.has(jobId)) return
          errors++
        }
      }
    }

    emit('', 'up')
    const workers = Promise.all(Array.from({ length: conc }, () => worker()))
    await workers

    // Apply deletions (asymptotic, after transfers) for one-way + deleteExtras.
    for (const d of deletions) {
      if (this.cancelledJobs.has(jobId)) break
      try {
        if (d.dir === 'up') await this.deletePath(sessionId, this.posixJoin(remoteDir, d.rel), false)
        else await unlink(this.longPath(this.safeLocalJoin(localDir, d.rel)))
      } catch {
        errors++
      }
    }

    if (this.cancelledJobs.has(jobId)) emit('', 'up', false, SshManager.CANCELLED_TEXT)
    else if (errors) emit('', 'up', false, `${errors} 项失败`)
    else {
      const t = bytesDone || 1
      this.emitProgress({ id: jobId, name: '同步', direction: 'up', transferred: t, total: t, count: totalPlanned, done: true })
    }
    this.cancelledJobs.delete(jobId)
    this.pausedJobs.delete(jobId)
    this.jobRate.delete(jobId)
    this.lastProgressAt.delete(jobId)
    this.jobSession.delete(jobId)
    this.quietJobs.delete(jobId)
  }

  // ---- Continuous sync (watch) ----
  /** Compares two map snapshots for any membership/size/mtime difference. */
  private static mapsDiffer(
    a: Map<string, { size: number; mtimeMs: number }>,
    b: Map<string, { size: number; mtimeMs: number }>
  ): boolean {
    if (a.size !== b.size) return true
    for (const [k, va] of a) {
      const vb = b.get(k)
      if (!vb || va.size !== vb.size || va.mtimeMs !== vb.mtimeMs) return true
    }
    return false
  }

  /** Refreshes a watch state's baseline snapshot from both trees. */
  private async refreshWatchBaseline(state: WatchSyncState): Promise<void> {
    const local = new Map<string, { size: number; mtimeMs: number }>()
    const remote = new Map<string, { size: number; mtimeMs: number }>()
    try {
      const sftp = await this.getSftp(state.sessionId)
      const [localOk, remoteOk] = await Promise.all([
        this.walkLocalTree(state.localDir, '', local),
        this.walkRemoteTree(sftp, state.remoteDir, '', remote)
      ])
      // A partial snapshot would make the next pass think everything missing
      // from it "changed" — keep the previous baseline and retry instead.
      if (!localOk || !remoteOk) return
      state.baselineLocal = local
      state.baselineRemote = remote
    } catch {
      /* link down or dir missing; a later pass will retry */
    }
  }

  /** Starts a background watcher that auto-syncs a local↔remote dir pair
   *  whenever either side changes (polling both trees at `intervalSec`). */
  async startWatchSync(
    sessionId: string,
    localDir: string,
    remoteDir: string,
    mode: 'up' | 'down' | 'both',
    deleteExtras: boolean,
    intervalSec: number
  ): Promise<string> {
    // One watcher per session keeps the UI state unambiguous.
    this.stopWatchSyncsForSession(sessionId)
    const watchId = randomUUID()
    const state: WatchSyncState = {
      sessionId,
      localDir,
      remoteDir,
      mode,
      deleteExtras,
      baselineLocal: new Map(),
      baselineRemote: new Map(),
      timer: null,
      busy: false
    }
    this.watchSyncs.set(watchId, state)
    await this.refreshWatchBaseline(state)
    if (!this.watchSyncs.get(watchId)) return watchId // stopped while priming
    const interval = Math.max(1000, (intervalSec > 0 ? intervalSec : 5) * 1000)
    state.timer = setInterval(() => void this.runWatchPass(watchId), interval)
    return watchId
  }

  stopWatchSync(watchId: string): void {
    const state = this.watchSyncs.get(watchId)
    if (!state) return
    if (state.timer) clearInterval(state.timer)
    this.watchSyncs.delete(watchId)
  }

  /** Stops every watcher bound to a session (called on disconnect/quit). */
  stopWatchSyncsForSession(sessionId: string): void {
    for (const [id, s] of this.watchSyncs) {
      if (s.sessionId === sessionId) {
        if (s.timer) clearInterval(s.timer)
        this.watchSyncs.delete(id)
      }
    }
  }

  /** One polling pass: if either tree changed, run a silent sync of the pair. */
  private async runWatchPass(watchId: string): Promise<void> {
    const state = this.watchSyncs.get(watchId)
    if (!state || state.busy) return
    state.busy = true
    try {
      const local = new Map<string, { size: number; mtimeMs: number }>()
      const remote = new Map<string, { size: number; mtimeMs: number }>()
      try {
        const sftp = await this.getSftp(state.sessionId)
        const [localOk, remoteOk] = await Promise.all([
          this.walkLocalTree(state.localDir, '', local),
          this.walkRemoteTree(sftp, state.remoteDir, '', remote)
        ])
        // A partial snapshot makes mapsDiffer see phantom changes; skip the
        // pass (and never run a sync from one) instead.
        if (!localOk || !remoteOk) return
      } catch {
        return // link down or dir missing; retry next pass
      }
      const changed =
        SshManager.mapsDiffer(state.baselineLocal, local) ||
        SshManager.mapsDiffer(state.baselineRemote, remote)
      if (changed) {
        // Run silently (quiet): no progress/toasts for automatic syncs.
        await this.syncJob(
          state.sessionId,
          state.localDir,
          state.remoteDir,
          state.mode,
          state.deleteExtras,
          randomUUID(),
          undefined,
          0,
          true
        ).catch(() => undefined)
        // Re-baseline AFTER the sync, not from the stale pre-transfer snapshot.
        // SFTP uploads stamp the destination mtime with the transfer time, so a
        // pre-sync snapshot would report that file as "changed" on the next pass
        // and re-sync it forever.
        await this.refreshWatchBaseline(state)
      } else {
        state.baselineLocal = local
        state.baselineRemote = remote
      }
    } finally {
      state.busy = false
    }
  }


  /** Pipes readable→writable, reporting byte deltas; abortable via the job id
   *  (its abort is one of possibly several registered under that job). Honors
   *  pause and a per-job byte rate (leaky bucket) so a transfer can be stopped
   *  mid-file and resumed, or throttled to keep uplink/downlink sane. */
  private pipeStream(
    jobId: string,
    readable: Readable,
    writable: Writable,
    onDelta: (n: number) => void,
    cleanupOnError?: string
  ): Promise<void> {
    return new Promise<void>((res, rej) => {
      let settled = false
      let set = this.jobAborts.get(jobId)
      if (!set) {
        set = new Set()
        this.jobAborts.set(jobId, set)
      }
      const finish = (err?: Error): void => {
        if (settled) return
        settled = true
        set!.delete(abort)
        if (set!.size === 0) this.jobAborts.delete(jobId)
        readable.destroy()
        // Delete a half-written local file only AFTER its write fd has closed;
        // on Windows unlinking a still-open handle fails with EPERM and would
        // leave the partial file behind.
        if (err && cleanupOnError) {
          const rm = (): void => void unlink(cleanupOnError).catch(() => undefined)
          if ((writable as { closed?: boolean }).closed) rm()
          else writable.once('close', rm)
        }
        writable.destroy()
        if (err) rej(err)
        else res()
      }
      const abort = (): void => finish(new Error(SshManager.CANCELLED_TEXT))
      set.add(abort)

      // Waits (with cancellation) until the job is no longer paused.
      const waitUnpaused = async (): Promise<void> => {
        while (!settled && this.isPaused(jobId)) await new Promise((r) => setTimeout(r, 150))
        if (settled) throw new Error(SshManager.CANCELLED_TEXT)
      }
      // Leaky-bucket rate budget: allow `rate` bytes/sec with a small burst.
      const rate = this.jobRate.get(jobId) ?? 0
      let windowStart = Date.now()
      let windowBytes = 0
      const throttle = async (n: number): Promise<void> => {
        if (rate <= 0) return
        windowBytes += n
        const elapsed = Date.now() - windowStart
        const budget = (rate * elapsed) / 1000
        if (windowBytes <= budget) return
        // Sleep just long enough to stay on budget, then re-anchor the window.
        const wait = Math.min(5000, ((windowBytes - budget) / rate) * 1000 + 10)
        await new Promise((r) => setTimeout(r, wait))
        windowStart = Date.now()
        windowBytes = 0
      }

      ;(async () => {
        try {
          readable.on('error', (e: Error) => finish(e))
          writable.on('error', (e: Error) => finish(e))
          writable.on('finish', () => finish())
          writable.on('close', () => finish())
          for await (const chunk of readable) {
            if (settled) return
            await waitUnpaused()
            await throttle((chunk as Buffer).length)
            if (settled) return
            onDelta((chunk as Buffer).length)
            if (!writable.write(chunk)) {
              await new Promise<void>((r) => writable.once('drain', r))
            }
          }
          // The readable ended: signal EOF to the writable so it flushes and
          // emits 'finish' (which finishes the pipe). Without this the promise
          // would hang, since 'finish'/'close' never fire on an open stream.
          if (!settled) writable.end()
        } catch (e) {
          if (!settled) finish(e as Error)
        }
      })()
    })
  }

  /** Downloads files/folders into localBase, streaming: files are downloaded as
   *  the tree is walked (no full pre-scan), so a huge/deep folder starts
   *  immediately instead of hanging on "scanning". knownTotal grows as sizes are
   *  discovered via readdir attrs, giving a moving percentage. Depth-capped
   *  against symlink loops and resilient to unreadable entries. */
  async downloadJob(
    sessionId: string,
    items: { path: string; name: string; isDir: boolean }[],
    localBase: string,
    jobId: string,
    concurrency?: number,
    rateBytesPerSec = 0,
    verifyChecksums = false
  ): Promise<{ files: number; failures: number; cancelled: boolean }> {
    this.jobSession.set(jobId, sessionId)
    if (rateBytesPerSec > 0) this.jobRate.set(jobId, rateBytesPerSec)
    // If the SFTP channel can't be opened the job never emits a terminal event,
    // so drop the mapping here to avoid leaking it.
    const sftp = await this.getSftp(sessionId).catch((e) => {
      this.jobSession.delete(jobId)
      throw e
    })
    const conc = clampConcurrency(concurrency ?? SshManager.CONCURRENCY, SshManager.CONCURRENCY)
    const label = items.length === 1 ? items[0].name : `${items.length} 项`
    // The target folder is not guaranteed to exist: a resumed queue may point at
    // a directory the user deleted, and dragging onto a new folder passes one
    // that was never made. Without this every write failed with ENOENT and the
    // job still reported success, having written nothing.
    await mkdir(this.longPath(localBase), { recursive: true }).catch(() => undefined)
    let bytesDone = 0
    let filesDone = 0
    let discovered = 0
    let knownTotal = 0
    const failures: string[] = []
    // Files that copied fine but whose SHA-256 didn't match the remote — a
    // silent-corruption signal, kept apart from copy failures (different cause).
    const sumFails: string[] = []
    // A producer (walk) fills this queue; a pool of workers drains it in
    // parallel — streaming (downloads start as files are found) AND concurrent.
    const queue: { remote: string; local: string; name: string }[] = []
    let walkDone = false
    const emit = (name: string, done?: boolean, error?: string, withItems = false): void =>
      this.emitProgress({ id: jobId, name, direction: 'down', transferred: bytesDone, total: knownTotal, count: discovered, index: filesDone, remoteDir: items[0]?.path ? this.parentOf(items[0].path) : undefined, localDir: localBase, isDir: items.length === 1 ? items[0].isDir : undefined, remotePath: items.length === 1 ? items[0].path : undefined, items: withItems ? items : undefined, done, error })

    const walk = async (remote: string, base: string, name: string, isDir: boolean, depth: number): Promise<void> => {
      if (this.cancelledJobs.has(jobId) || depth > 64) return
      const local = this.safeLocalJoin(base, name)
      if (isDir) {
        await mkdir(local, { recursive: true })
        let list: { filename: string; attrs: { size: number; isDirectory(): boolean } }[]
        try {
          list = await this.readdirFull(sftp, remote)
        } catch {
          return // skip unreadable directory
        }
        for (const it of list) if (!it.attrs.isDirectory()) knownTotal += it.attrs.size
        for (const it of list) {
          try {
            await walk(this.posixJoin(remote, it.filename), local, it.filename, it.attrs.isDirectory(), depth + 1)
          } catch {
            /* skip an entry we can't process */
          }
        }
      } else {
        discovered++
        queue.push({ remote, local, name: basename(local) })
      }
    }

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.cancelledJobs.has(jobId)) return
        const item = queue.shift()
        if (!item) {
          if (walkDone) return
          await new Promise((r) => setTimeout(r, 15))
          continue
        }
        let read: Readable | undefined
        let write: Writable | undefined
        let remoteInfo: { size: number; mtimeMs: number } | null = null
        const partialKey = `${sessionId}\u0000${item.remote}`
        try {
          emit(item.name)
          // Both streams are built here so a throwing constructor can't leave
          // the other one orphaned (a stream nobody listens to turns its
          // 'error' into an uncaught exception).
          // Resume: only a transfer this process interrupted of the *same* remote
          // version continues where it stopped (append); anything else in the
          // local path — an older copy, a different build of the file — is
          // replaced from the start. On error/cancel the partial is kept so the
          // next attempt can pick up from it.
          let offset = 0
          try {
            const localSize = (await stat(this.longPath(item.local))).size
            if (localSize > 0) {
              const remote = await this.statFile(sftp, item.remote)
              remoteInfo = remote
              const prior = this.partialDownloads.get(partialKey)
              const resumable =
                !!remote &&
                !!prior &&
                prior.localSize === localSize &&
                prior.remoteSize === remote.size &&
                prior.remoteMtimeMs === remote.mtimeMs
              if (resumable) offset = localSize
              else await unlink(item.local)
            }
          } catch {
            /* no existing local file — start fresh */
          }
          read = offset ? sftp.createReadStream(item.remote, { start: offset }) : sftp.createReadStream(item.remote)
          write = createWriteStream(item.local, offset ? { flags: 'a' } : undefined)
          await this.pipeStream(
            jobId,
            read,
            write,
            (n) => {
              bytesDone += n
              emit(item.name)
            }
          )
          filesDone++
          this.partialDownloads.delete(partialKey)
          if (verifyChecksums) {
            try {
              await this.verifyChecksum(sessionId, item.remote, item.local)
            } catch {
              if (this.cancelledJobs.has(jobId)) return
              sumFails.push(item.name)
            }
          }
        } catch {
          read?.destroy()
          write?.destroy()
          // Remember what was interrupted, so a retry continues this exact
          // remote version rather than guessing from the file size.
          if (remoteInfo) {
            const localNow = await stat(this.longPath(item.local)).catch(() => null)
            if (localNow) {
              this.partialDownloads.set(partialKey, {
                localSize: localNow.size,
                remoteSize: remoteInfo.size,
                remoteMtimeMs: remoteInfo.mtimeMs
              })
            }
          }
          if (this.cancelledJobs.has(jobId)) return
          failures.push(item.name)
        }
      }
    }

    emit(label)
    let walkError: Error | null = null
    const walkP = (async () => {
      try {
        for (const it of items) {
          if (this.cancelledJobs.has(jobId)) return
          if (!it.isDir) {
            try {
              knownTotal += await this.statSize(sftp, it.path)
            } catch {
              /* size unknown */
            }
          }
          await walk(it.path, localBase, it.name, it.isDir, 0)
        }
      } catch (e) {
        walkError = e as Error
      } finally {
        walkDone = true
      }
    })()
    let cancelled = false
    try {
      // Promise.all up front: awaiting walkP first would leave a worker
      // rejection unhandled until we got here.
      const workers = Promise.all(Array.from({ length: conc }, () => worker()))
      await walkP
      await workers
      cancelled = this.cancelledJobs.has(jobId)
      if (cancelled) {
        emit(label, false, SshManager.CANCELLED_TEXT)
      } else if (walkError) {
        emit(label, false, friendlyError((walkError as Error).message), true)
      } else if (failures.length) {
        emit(label, false, `${failures.length} 个文件失败`, true)
      } else if (sumFails.length) {
        emit(label, false, `校验和不匹配 ${sumFails.length} 个文件`, true)
      } else {
        const t = bytesDone || 1
        this.emitProgress({ id: jobId, name: label, direction: 'down', transferred: t, total: t, count: discovered, done: true })
      }
    } finally {
      this.cancelledJobs.delete(jobId)
      this.pausedJobs.delete(jobId)
      this.jobRate.delete(jobId)
      this.jobSession.delete(jobId)
      this.lastProgressAt.delete(jobId)
    }
    // Callers report these: a cancelled or failed download used to come back to
    // the renderer as ok with the item count.
    return { files: filesDone, failures: failures.length, cancelled }
  }

  /** Compares a just-downloaded file's SHA-256 against the remote copy.
   *  Throws on a genuine mismatch; silently no-ops when it cannot verify
   *  (exec failed, no sha256sum, unparseable output) so a missing tool never
   *  fails a transfer. */
  private async verifyChecksum(sessionId: string, remotePath: string, localPath: string): Promise<void> {
    // Single-quote the path (escaping embedded quotes) so spaces stay in one
    // token; `--` guards against names that start with a dash.
    const q = `'${remotePath.replace(/'/g, `'\\''`)}'`
    let out: string
    try {
      out = await this.execCommand(sessionId, `sha256sum -- ${q} 2>/dev/null`)
    } catch {
      return
    }
    const remoteHash = out.trim().split(/\s+/)[0]?.toLowerCase()
    if (!remoteHash || !/^[a-f0-9]{64}$/.test(remoteHash)) return
    const localHash = await sha256File(this.longPath(localPath))
    if (localHash !== remoteHash) throw new Error('sha256 mismatch')
  }

  /** Compares a local and a remote directory tree, returning the relative
   *  paths that exist on only one side or differ in size (rsync-style diff). */
  async diffDirs(
    sessionId: string,
    localDir: string,
    remoteDir: string
  ): Promise<{ onlyLocal: string[]; onlyRemote: string[]; sizeDiff: string[] }> {
    const sftp = await this.getSftp(sessionId)
    const localMap = new Map<string, { size: number; mtimeMs: number }>()
    const remoteMap = new Map<string, { size: number; mtimeMs: number }>()
    const [localOk, remoteOk] = await Promise.all([
      this.walkLocalTree(localDir, '', localMap),
      this.walkRemoteTree(sftp, remoteDir, '', remoteMap)
    ])
    // A partial snapshot would report files as "only on one side"; say so
    // instead of showing a wrong diff.
    if (!localOk || !remoteOk) throw new Error('目录枚举失败（源目录可能暂时不可读）')
    const onlyLocal: string[] = []
    const onlyRemote: string[] = []
    const sizeDiff: string[] = []
    // Cap each list so a huge tree can't produce an unbounded IPC payload / DOM.
    const cap = (arr: string[]): string[] => (arr.length > 2000 ? arr.slice(0, 2000) : arr)
    for (const rel of localMap.keys()) {
      const R = remoteMap.get(rel)
      if (!R) onlyLocal.push(rel)
      else if (R.size !== localMap.get(rel)!.size) sizeDiff.push(rel)
    }
    for (const rel of remoteMap.keys()) if (!localMap.has(rel)) onlyRemote.push(rel)
    return {
      onlyLocal: cap(onlyLocal.sort()),
      onlyRemote: cap(onlyRemote.sort()),
      sizeDiff: cap(sizeDiff.sort())
    }
  }

  /** Uploads local files/folders into remoteDir, streaming like downloadJob: a
   *  producer walks the local tree (creating each remote dir as it reaches it)
   *  while a pool of workers uploads what it finds. A folder with thousands of
   *  entries therefore shows a row and starts transferring at once, instead of
   *  sitting silent through a full pre-scan followed by one serial mkdir
   *  round-trip per directory. Unreadable entries are skipped, not fatal. */
  async uploadJob(
    sessionId: string,
    localPaths: string[],
    remoteDir: string,
    jobId: string,
    concurrency?: number,
    rateBytesPerSec = 0,
    overwrite: UploadOverwrite = 'overwrite'
  ): Promise<{ files: number; failures: number }> {
    this.jobSession.set(jobId, sessionId)
    if (rateBytesPerSec > 0) this.jobRate.set(jobId, rateBytesPerSec)
    const conc = clampConcurrency(concurrency ?? SshManager.CONCURRENCY, SshManager.CONCURRENCY)
    const label = localPaths.length === 1 ? basename(localPaths[0]) : `${localPaths.length} 项`
    let bytesDone = 0
    let filesDone = 0
    let discovered = 0
    let knownTotal = 0
    // Only the count is ever reported, and a tree can fail by the hundred
    // thousand — don't retain a name per failure.
    let failures = 0
    const queue: { local: string; remote: string; name: string }[] = []
    let walkDone = false
    const emit = (name: string, done?: boolean, error?: string, withPaths = false): void =>
      this.emitProgress({ id: jobId, name, direction: 'up', transferred: bytesDone, total: knownTotal, count: discovered, index: filesDone, remoteDir, localPaths: withPaths ? localPaths : undefined, done, error })

    // finally guarantees cleanup even if getSftp throws before any event.
    try {
      const sftp = await this.getSftp(sessionId)

      const walk = async (local: string, remoteBase: string, name: string, depth: number): Promise<void> => {
        if (this.cancelledJobs.has(jobId) || depth > 64) return // depth guards symlink loops
        const remote = this.posixJoin(remoteBase, name)
        let st: Awaited<ReturnType<typeof stat>>
        try {
          st = await stat(this.longPath(local))
        } catch {
          failures++ // unreadable / path too long — skip, don't fail the job
          return
        }
        if (st.isDirectory()) {
          try {
            await this.mkdir(sessionId, remote)
          } catch {
            /* already exists, or unwritable — its children will report */
          }
          let items: string[]
          try {
            items = await readdir(this.longPath(local))
          } catch {
            failures++
            return
          }
          for (const item of items) await walk(join(local, item), remote, item, depth + 1)
        } else {
          // The producer runs far ahead of 4 workers, so a huge tree would
          // otherwise queue every file it finds. Let the pool catch up instead
          // of holding the whole listing in memory.
          while (queue.length >= SshManager.QUEUE_MAX && !this.cancelledJobs.has(jobId)) {
            await new Promise((r) => setTimeout(r, 15))
          }
          discovered++
          knownTotal += st.size
          queue.push({ local, remote, name })
        }
      }

      const worker = async (): Promise<void> => {
        for (;;) {
          if (this.cancelledJobs.has(jobId)) return
          const item = queue.shift()
          if (!item) {
            if (walkDone) return
            await new Promise((r) => setTimeout(r, 15))
            continue
          }
          // Everything the loop does stays inside the try: a worker that
          // rejects would take the terminal event (and the job's UI row) with
          // it, and could surface as an unhandled rejection.
          let read: Readable | undefined
          let write: Writable | undefined
          try {
            emit(item.name)
            // Conflict policy for files that already exist at the target.
            // - skip: leave existing remote files alone (counted as done).
            // - keep: upload alongside under a fresh name (name (1).ext, ...).
            // - overwrite (default): resume partials; skip a remote file that is the
            //   same size *and* not older; otherwise write from the start / offset.
            let offset = 0
            let localSize: number | null = null
            let localMtime = 0
            try {
              const st = await stat(this.longPath(item.local))
              localSize = st.size
              localMtime = st.mtimeMs
            } catch {
              /* source missing — let the stream error below */
            }
            if (localSize !== null) {
              const remote = await this.statFile(sftp, item.remote)
              const remoteSize = remote ? remote.size : -1
              const exists = remote !== null
              if (exists && overwrite === 'skip') {
                filesDone++
                if (localSize) bytesDone += localSize
                emit(item.name)
                continue
              }
              if (exists && overwrite === 'keep') {
                item.remote = await this.uniqueRemote(sftp, item.remote)
              } else if (!exists || overwrite !== 'keep') {
                // overwrite (default) resume/from-scratch. Equal size is not
                // equal content — editing one character keeps the length — so
                // skip only when the remote copy is at least as new. The 1 s
                // slack covers sftp's second-resolution mtime.
                if (remote && remoteSize === localSize && remote.mtimeMs >= localMtime - 1000) {
                  filesDone++
                  if (localSize) bytesDone += localSize
                  emit(item.name)
                  continue
                }
                if (remoteSize > 0 && remoteSize < localSize) offset = remoteSize
              }
            }
            // Build both streams before piping, and destroy them here if
            // either constructor throws — an orphaned stream leaks its fd and
            // later emits 'error' with nobody listening, which is fatal.
            // No cleanup path on failure: the source file is the user's.
            write = offset
              ? sftp.createWriteStream(item.remote, { start: offset })
              : sftp.createWriteStream(item.remote)
            read = offset
              ? createReadStream(this.longPath(item.local), { start: offset })
              : createReadStream(this.longPath(item.local))
            await this.pipeStream(jobId, read, write, (n) => {
              bytesDone += n
              emit(item.name)
            })
            filesDone++
          } catch {
            read?.destroy()
            write?.destroy()
            if (this.cancelledJobs.has(jobId)) return
            failures++
          }
        }
      }

      emit(label)
      let walkError: Error | null = null
      const walkP = (async () => {
        try {
          for (const p of localPaths) {
            if (this.cancelledJobs.has(jobId)) return
            // A drive root ("D:\") has no basename; fall back to a usable name.
            await walk(p, remoteDir, basename(p) || p.replace(/[:\\/]/g, ''), 0)
          }
        } catch (e) {
          walkError = e as Error
        } finally {
          walkDone = true
        }
      })()
      try {
        // Promise.all up front: awaiting walkP first would leave a worker
        // rejection unhandled until we got here.
        const workers = Promise.all(
          Array.from({ length: conc }, () => worker())
        )
        await walkP
        await workers
        if (this.cancelledJobs.has(jobId)) {
          emit(label, false, SshManager.CANCELLED_TEXT)
        } else if (walkError) {
          emit(label, false, friendlyError((walkError as Error).message), true)
        } else if (failures) {
          emit(label, false, `${failures} 个文件失败`, true)
        } else {
          const t = bytesDone || 1
          this.emitProgress({ id: jobId, name: label, direction: 'up', transferred: t, total: t, count: discovered, localPaths, done: true })
        }
      } finally {
        this.cancelledJobs.delete(jobId)
      }
    } finally {
      this.pausedJobs.delete(jobId)
      this.jobRate.delete(jobId)
      this.jobSession.delete(jobId)
      this.lastProgressAt.delete(jobId)
    }
    // Callers report these. A local path that could not even be stat'ed only
    // bumps `failures`, and both counts used to be dropped on the floor — so
    // uploading a path that does not exist answered "ok, 1 file".
    return { files: filesDone, failures }
  }

  /** Windows caps ordinary paths at 260 chars, which a deep folder (node_modules
   *  and friends) blows past; the \\?\ prefix lifts the limit. No-op elsewhere,
   *  and on already-prefixed or short paths. */
  private longPath(p: string): string {
    if (process.platform !== 'win32' || p.length < 240 || p.startsWith('\\\\')) return p
    return `\\\\?\\${resolve(p)}`
  }

  /** Silent recursive download (no progress) into localBase; used for drag-out.
   *  Error-tolerant so one unreadable entry doesn't leave the folder undownloaded
   *  (and thus undraggable). */
  async downloadTree(
    sessionId: string,
    remotePath: string,
    localBase: string,
    name: string,
    isDir: boolean,
    depth = 0
  ): Promise<string> {
    const sftp = await this.getSftp(sessionId)
    const local = this.safeLocalJoin(localBase, name)
    if (isDir) {
      if (depth > 64) return local // guard against server-reported cyclic dirs
      await mkdir(local, { recursive: true })
      let list: { filename: string; attrs: { size: number; isDirectory(): boolean } }[]
      try {
        list = await this.readdirFull(sftp, remotePath)
      } catch {
        return local
      }
      for (const it of list) {
        try {
          await this.downloadTree(sessionId, this.posixJoin(remotePath, it.filename), local, it.filename, it.attrs.isDirectory(), depth + 1)
        } catch {
          /* skip an entry we can't fetch */
        }
      }
    } else {
      await this.pipeStream(randomUUID(), sftp.createReadStream(remotePath), createWriteStream(local), () => undefined, local)
    }
    return local
  }

  /** Silent single-file upload (no progress); used for external-editor save-back. */
  async putFileSilent(sessionId: string, localPath: string, remoteDir: string, name: string): Promise<void> {
    const sftp = await this.getSftp(sessionId)
    const remote = this.posixJoin(remoteDir, name)
    await this.pipeStream(randomUUID(), createReadStream(localPath), sftp.createWriteStream(remote), () => undefined)
  }

  async mkdir(sessionId: string, path: string): Promise<void> {
    const sftp = await this.getSftp(sessionId)
    await new Promise<void>((res, rej) => sftp.mkdir(path, (e) => (e ? rej(e) : res())))
  }

  /** Recursively ensures a remote directory (and its ancestors) exist. Errors
   *  on an existing dir are ignored (idempotent); a genuinely unwritable parent
   *  surfaces via the child upload instead. */
  private async ensureRemoteDir(sftp: SFTPWrapper, path: string): Promise<void> {
    const parent = this.parentOf(path)
    if (parent && parent !== path && parent !== '.' && parent !== '/') {
      await this.ensureRemoteDir(sftp, parent)
    }
    await new Promise<void>((res) => {
      sftp.mkdir(path, () => res())
    })
  }

  /** Creates an empty file, failing if it already exists. */
  async createFile(sessionId: string, path: string): Promise<void> {
    const sftp = await this.getSftp(sessionId)
    await new Promise<void>((res, rej) =>
      sftp.open(path, 'wx', (e, handle) => {
        if (e) return rej(e)
        sftp.close(handle, (ce) => (ce ? rej(ce) : res()))
      })
    )
  }

  async rename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.getSftp(sessionId)
    await new Promise<void>((res, rej) =>
      sftp.rename(oldPath, newPath, (e) => (e ? rej(e) : res()))
    )
  }

  /** Largest number of delete round-trips in flight at once. Deletes are tiny
   *  metadata ops, so a wider pool than file transfers turns a many-thousand-file
   *  folder from minutes of serial round-trips into seconds. */
  private static readonly DELETE_CONCURRENCY = 16

  async deletePath(sessionId: string, path: string, isDir: boolean): Promise<void> {
    const sftp = await this.getSftp(sessionId)
    const failed: string[] = []
    const sem = new Semaphore(SshManager.DELETE_CONCURRENCY)
    await this.rmrf(sftp, sem, path, isDir, failed)
    // One unremovable entry (e.g. no permission) must not abort the whole tree:
    // everything deletable is still gone, and we report only what remained.
    if (failed.length) {
      throw new Error(`${failed.length} 个条目无法删除,可能是权限不足`)
    }
  }

  /**
   * Changes permissions on a path. When recursive, files get `mode` exactly and
   * directories get [treeDirMode] of it: one mode fanned out over files and
   * folders alike used to strip the search bit from every folder (644 applied to
   * a tree), leaving them impossible to enter. A single, non-recursive change is
   * applied exactly as asked, whatever the entry is.
   */
  async chmod(
    sessionId: string,
    path: string,
    mode: number,
    recursive: boolean,
    isDir: boolean
  ): Promise<void> {
    const sftp = await this.getSftp(sessionId)
    // Post-order: change descendants first, then the path itself. This way we
    // never strip a directory's own r/x before we've finished reading it, which
    // would otherwise abort the walk and leave the tree half-changed.
    if (recursive && isDir) await this.chmodChildren(sftp, path, mode)
    await this.chmodOne(sftp, path, recursive && isDir ? treeDirMode(mode) : mode)
  }

  private chmodOne(sftp: SFTPWrapper, path: string, mode: number): Promise<void> {
    return new Promise((res, rej) => sftp.chmod(path, mode, (e) => (e ? rej(e) : res())))
  }

  private async chmodChildren(sftp: SFTPWrapper, dir: string, mode: number): Promise<void> {
    const list = await new Promise<
      { filename: string; attrs: { isDirectory(): boolean } }[]
    >((res, rej) => sftp.readdir(dir, (e, l) => (e ? rej(e) : res(l as never))))
    for (const it of list) {
      const child = this.posixJoin(dir, it.filename)
      const isFolder = it.attrs.isDirectory()
      if (isFolder) await this.chmodChildren(sftp, child, mode)
      await this.chmodOne(sftp, child, isFolder ? treeDirMode(mode) : mode)
    }
  }

  /** Deletes a path recursively. Children of a directory are removed
   *  concurrently under a shared semaphore (bounded total round-trips), and a
   *  failure on any one entry is recorded rather than thrown, so the rest of the
   *  tree is still cleared. Returns whether the path itself was removed. */
  private async rmrf(
    sftp: SFTPWrapper,
    sem: Semaphore,
    path: string,
    isDir: boolean,
    failed: string[]
  ): Promise<boolean> {
    if (!isDir) {
      try {
        await sem.run(
          () => new Promise<void>((res, rej) => sftp.unlink(path, (e) => (e ? rej(e) : res())))
        )
        return true
      } catch {
        failed.push(path)
        return false
      }
    }
    let list: { filename: string; attrs: { isDirectory(): boolean } }[]
    try {
      list = await sem.run(
        () =>
          new Promise<{ filename: string; attrs: { isDirectory(): boolean } }[]>((res, rej) =>
            sftp.readdir(path, (e, l) => (e ? rej(e) : res(l as never)))
          )
      )
    } catch {
      failed.push(path)
      return false
    }
    // Fire all children at once; each blocks on the semaphore, so in-flight
    // requests stay bounded however wide or deep the tree is. Pending promises
    // (not requests) still scale with the entry count, which is fine for the
    // folders this handles; a multi-million-entry tree would want a work queue.
    const results = await Promise.all(
      list.map((it) =>
        this.rmrf(sftp, sem, this.posixJoin(path, it.filename), it.attrs.isDirectory(), failed)
      )
    )
    // A directory can only be removed once empty, so skip rmdir (and don't
    // double-report it) when a child survived.
    if (results.some((ok) => !ok)) return false
    try {
      await sem.run(
        () => new Promise<void>((res, rej) => sftp.rmdir(path, (e) => (e ? rej(e) : res())))
      )
      return true
    } catch {
      failed.push(path)
      return false
    }
  }

  async readTextFile(sessionId: string, path: string): Promise<string> {
    const sftp = await this.getSftp(sessionId)
    const st = await new Promise<{ size: number }>((res, rej) =>
      sftp.stat(path, (e, s) => (e ? rej(e) : res(s as never)))
    )
    if (st.size > 2 * 1024 * 1024) {
      throw new Error('文件超过 2MB,请用外部编辑器打开')
    }
    const buf = await new Promise<Buffer>((res, rej) =>
      sftp.readFile(path, (e, d) => (e ? rej(e) : res(d as never)))
    )
    return buf.toString('utf8')
  }

  /** Reads a file as base64 for inline preview (capped at `maxBytes`). */
  async readBinaryFile(sessionId: string, path: string, maxBytes = 12 * 1024 * 1024): Promise<string> {
    const sftp = await this.getSftp(sessionId)
    const st = await new Promise<{ size: number }>((res, rej) =>
      sftp.stat(path, (e, s) => (e ? rej(e) : res(s as never)))
    )
    if (st.size > maxBytes) {
      throw new Error('文件过大,无法预览')
    }
    const buf = await new Promise<Buffer>((res, rej) =>
      sftp.readFile(path, (e, d) => (e ? rej(e) : res(d as never)))
    )
    return buf.toString('base64')
  }

  async writeTextFile(sessionId: string, path: string, content: string): Promise<void> {
    const sftp = await this.getSftp(sessionId)
    await new Promise<void>((res, rej) =>
      sftp.writeFile(path, content, { encoding: 'utf8' }, (e) => (e ? rej(e) : res()))
    )
  }

  /** Runs a remote command on the shell, resolving with its combined output.
   *  Times out: `close` never arrives if the command blocks on stdin or on a
   *  stuck mount, and the IPC waiting on it (pack / unzip / checksum) would
   *  then hang for the rest of the session with no way to cancel. */
  private execRemote(
    sessionId: string,
    command: string,
    timeoutMs = this.execTimeoutMs
  ): Promise<{ code: number; out: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) return Promise.reject(new Error('会话已断开'))
    return new Promise((resolve, reject) => {
      let settled = false
      let channel: { close: () => void } | undefined
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }
      const timer = setTimeout(() => {
        finish(() => reject(new Error('远端命令超时')))
        try {
          channel?.close()
        } catch {
          /* already gone */
        }
      }, timeoutMs)
      timer.unref?.()
      session.client.exec(command, (err, ch) => {
        if (err) return finish(() => reject(err))
        channel = ch
        let out = ''
        ch.on('data', (d: Buffer) => (out += d.toString('utf8')))
        ch.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')))
        ch.on('close', (code: number) => finish(() => resolve({ code, out })))
        ch.on('error', (e: Error) => finish(() => reject(e)))
      })
    })
  }

  /** Packs selected remote items into an archive on the remote host, then
   *  downloads it as a single file into localDir. Returns the local archive path.
   *  Uses `tar` (universal on Unix) — zip would need `zip` installed elsewhere. */
  async packAndDownload(
    sessionId: string,
    items: { path: string; name: string; isDir: boolean }[],
    localDir: string,
    archiveName?: string
  ): Promise<{ ok: boolean; localPath?: string; error?: string; canceled?: boolean }> {
    if (!items.length) return { ok: false, error: '没有可打包的项' }
    const parent = this.parentOf(items[0].path)
    const tmp = `/tmp/xssh-${randomUUID().slice(0, 8)}.tar.gz`
    const names = items.map((i) => i.name)
    // `cd <parent> && tar czf <tmp> <relative names>` — see buildPackCommand.
    const pack = await this.execRemote(sessionId, buildPackCommand(parent, tmp, names))
    // A non-zero tar exit means the archive was never (fully) written; downloading
    // it anyway would hand back a missing or truncated file as "success".
    if (pack.code !== 0) {
      await this.execRemote(sessionId, `rm -f "${tmp}"`).catch(() => {})
      return { ok: false, error: pack.out.trim() || '打包失败' }
    }
    const name = archiveName || (items.length === 1 ? items[0].name : 'archive') + '.tar.gz'
    const outPath = resolve(localDir, name).replace(/\.tar\.gz$/, '.tar.gz')
    try {
      const r = await this.downloadJob(sessionId, [{ path: tmp, name, isDir: false }], localDir, randomUUID(), 1)
      await this.execRemote(sessionId, `rm -f "${tmp}"`).catch(() => {})
      // downloadJob reports per-file failures / cancellation in its return value
      // instead of throwing, so a partial archive used to come back as ok:true.
      if (r.cancelled) return { ok: false, canceled: true }
      if (r.failures) return { ok: false, error: `${r.failures} 个文件失败` }
      if (!r.files) return { ok: false, error: '打包/下载失败' }
      return { ok: true, localPath: outPath }
    } catch (e) {
      await this.execRemote(sessionId, `rm -f "${tmp}"`).catch(() => {})
      return { ok: false, error: friendlyError((e as Error).message) }
    }
  }

  /** Extracts an archive on the remote host into remoteDir. `format` is picked
   *  from the archive file extension (tar.gz/tgz → tar, zip → unzip). */
  async extractArchive(
    sessionId: string,
    remoteDir: string,
    archiveFileName: string
  ): Promise<{ ok: boolean; error?: string }> {
    const base = this.posixJoin(remoteDir, archiveFileName)
    const cmd = buildExtractCommand(remoteDir, archiveFileName)
    const { code, out } = await this.execRemote(sessionId, cmd).catch((e) => ({
      code: -1,
      out: (e as Error).message
    }))
    if (code !== 0) return { ok: false, error: out.trim() || '解压失败' }
    return { ok: true }
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // If this session shares a multiplexed master, release the reference rather
    // than ending the shared client (which would drop its peer sessions).
    let masterKey: string | undefined
    for (const [k, m] of this.masters) {
      if (m.sessions.has(sessionId)) {
        masterKey = k
        break
      }
    }
    if (session.suppressTimer) clearTimeout(session.suppressTimer)
    this.closeForwards(session)
    this.stopLog(sessionId)
    this.stopWatchSyncsForSession(sessionId)
    session.sftp?.end()
    session.stream?.end()
    if (masterKey) {
      this.releaseMaster(masterKey, sessionId)
      this.sessions.delete(sessionId)
      return
    }
    session.client.end()
    this.sessions.delete(sessionId)
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      if (session.suppressTimer) clearTimeout(session.suppressTimer)
      this.stopLog(session.id)
      this.stopWatchSyncsForSession(session.id)
      // macOS keeps the process alive after the window closes: without this,
      // local/dynamic forwards keep their listeners bound and the jump
      // tunnels keep their sockets until the app fully quits.
      this.closeForwards(session)
      // Mark a clean close so a late client 'close' isn't misread as a drop.
      session.shellExit = true
      session.client.end()
    }
    this.sessions.clear()
    for (const m of this.masters.values()) {
      m.jumpClient?.end()
      ;(m.sock as Socket | Duplex | undefined)?.destroy()
    }
    this.masters.clear()
    for (const w of this.watchSyncs.values()) if (w.timer) clearInterval(w.timer)
    this.watchSyncs.clear()
  }

  /** Cross-session output for the history-search panel (bounded per session). */
  historyList(): { sessionId: string; label: string; text: string }[] {
    const out: { sessionId: string; label: string; text: string }[] = []
    for (const [id, s] of this.sessions) {
      if (s.history) out.push({ sessionId: id, label: s.label ?? '会话', text: s.history })
    }
    return out
  }

  // ---- tmux / screen session helpers (run over a separate exec channel) ----

  /** Runs a command on a dedicated shell channel and returns its stdout. */
  private remoteExec(sessionId: string, cmd: string): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) return Promise.reject(new Error('会话不存在'))
    return new Promise((resolve, reject) => {
      session.client.exec(cmd, (err, stream) => {
        if (err) return reject(err)
        let out = ''
        // The SSH2 spec makes exit-status optional, so a missing 'exit' event
        // still resolves (back-compat); when present, a non-zero code is a
        // failure — previously this was silently reported as success.
        let exitCode: number | null = null
        let settled = false
        const settle = (e?: Error, value?: string): void => {
          if (settled) return
          settled = true
          if (e) reject(e)
          else resolve(value ?? out)
        }
        stream.on('data', (d: Buffer) => {
          out += d.toString()
        })
        stream.on('exit', (code: unknown) => {
          if (typeof code === 'number') exitCode = code
        })
        stream.on('close', () =>
          settle(exitCode !== null && exitCode !== 0 ? new Error(`远程命令退出码 ${exitCode}`) : undefined)
        )
        stream.on('error', (e: Error) => settle(e))
      })
    })
  }

  /** Keys this manager refused, by host:port: the only ones the user can then
   *  trust (ssh:trustHostKey) — a renderer can't plant an arbitrary key. */
  private readonly rejectedKeys = new Map<string, string>()

  private noteRejected(host: string, port: number | undefined, fp: string): void {
    this.rejectedKeys.set(`${host}:${port || 22}`, String(fp).toLowerCase())
  }

  /** True (and forgotten) when `fp` is the key last refused for host:port. */
  takeRejectedKey(host: string, port: number | undefined, fp: string): boolean {
    const k = `${host}:${port || 22}`
    if (this.rejectedKeys.get(k) !== String(fp).toLowerCase()) return false
    this.rejectedKeys.delete(k)
    return true
  }

  /** Background, read-only: logs in without a terminal, runs one command on an
   *  exec channel, returns its stdout and disconnects. Nothing is emitted to the
   *  renderer and no session is registered. Only for a server whose host key is
   *  already on record — an unknown key is never trusted here (that decision
   *  belongs to the user, on a real connect), a changed one aborts. */
  async quietExec(params: ConnectParams, cmd: string, timeoutMs = 20_000): Promise<string> {
    const port = params.port || 22
    await this.knownHosts.load()
    if (!this.knownHosts.get(params.host, port)) throw new Error('host key not on record')
    // The hop too: an unknown jump host would get the saved credential through
    // its tunnel with nobody watching, and connectJump does not record first keys.
    if (params.jump && !this.knownHosts.get(params.jump.host, params.jump.port || 22)) {
      throw new Error('jump host key not on record')
    }
    const config = SshManager.baseConfig(params.host, port, params.username, undefined, 12_000)
    config.hostVerifier = (hashedKey: string, cb: (valid: boolean) => void): void => {
      cb(this.knownHosts.get(params.host, port) === hashedKey)
    }
    const client = new Client()
    let jumpClient: Client | null = null
    let sock: Duplex | Socket | undefined
    return new Promise<string>((resolve, reject) => {
      let done = false
      // One exit for every path — timeout, errors, a throw from connect() —
      // and it always releases the hop, the proxy socket and the client.
      const finish = (err: Error | null, out = ''): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        client.removeAllListeners('close')
        try {
          client.end()
        } catch {
          /* never connected */
        }
        sock?.destroy()
        jumpClient?.end()
        if (err) reject(err)
        else resolve(out)
      }
      // Covers the whole thing, including a proxy or hop that never answers.
      const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs)
      const run = async (): Promise<void> => {
        if (params.jump) {
          const hop = await this.connectJump(params.jump, params.host, port)
          jumpClient = hop.client
          sock = hop.sock
        } else if (params.proxy) {
          sock = await this.connectProxy(params.proxy, params.host, port, (s) => (sock = s))
        }
        if (done) {
          // Timed out while the hop / proxy was still coming up.
          sock?.destroy()
          jumpClient?.end()
          return
        }
        if (sock) {
          sock.on('error', () => undefined)
          config.sock = sock
        }
        Object.assign(config, await this.authConfig(params.auth, params.keyPath, params.passphrase, params.password))
        if (done) return finish(new Error('timeout'))
        client.on('error', (e) => finish(e))
        client.on('close', () => finish(new Error('closed')))
        client.on('ready', () => {
          client.exec(cmd, (err, stream) => {
            if (err) return finish(err)
            let out = ''
            stream.on('data', (d: Buffer) => {
              out += d.toString()
              if (out.length > 64_000) finish(null, out)
            })
            stream.stderr.on('data', () => undefined)
            stream.on('close', () => finish(null, out))
            stream.on('error', (e: Error) => finish(e))
          })
        })
        // ssh2 throws synchronously for an unreadable key (encrypted, no
        // passphrase saved) — that lands in the catch below like any error.
        client.connect(config)
      }
      run().catch((e: Error) => finish(e))
    })
  }

  /** Runs a command on a dedicated exec channel and returns its stdout. */
  execCommand(sessionId: string, cmd: string): Promise<string> {
    return this.remoteExec(sessionId, cmd)
  }

  /** Lists tmux session names on the remote, via a throwaway exec channel. */
  async tmuxListSessions(sessionId: string): Promise<string[]> {
    const out = await this.remoteExec(
      sessionId,
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || true'
    ).catch(() => '')
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  }

  /** Attaches to a tmux session in the live shell, creating it if absent
   *  (`new -A`). Writes to the interactive stream so tmux takes over the pane. */
  tmuxAttachOrCreate(sessionId: string, name: string): void {
    const session = this.sessions.get(sessionId)
    // Single-quote the name so host labels/settings with spaces (or quotes) don't
    // split the shell token — tmux would otherwise create a wrongly-named window.
    const safe = name ? `'${name.replace(/'/g, `'\\''`)}'` : ''
    const cmd = name ? `tmux new -A -s ${safe}` : 'tmux new -A'
    session?.stream?.write(cmd + '\n')
  }
}

/** Parses a SOCKS5 CONNECT request buffer, returning the target if complete
 *  (and minimal enough to act on), or null to wait for more bytes. */
function parseSocksRequest(buf: Buffer): { host: string; port: number } | null {
  if (buf.length < 4) return null
  if (buf[1] !== 0x01) return null // only CONNECT is supported
  const atyp = buf[3]
  if (atyp === 0x01) {
    if (buf.length < 10) return null
    const host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`
    return { host, port: buf.readUInt16BE(8) }
  }
  if (atyp === 0x03) {
    if (buf.length < 7) return null
    const len = buf[4]
    if (len === 0 || buf.length < 5 + len + 2) return null
    return { host: buf.subarray(5, 5 + len).toString('utf8'), port: buf.readUInt16BE(5 + len) }
  }
  if (atyp === 0x04) {
    if (buf.length < 22) return null
    const g: string[] = []
    for (let i = 4; i < 20; i += 2) g.push(buf.readUInt16BE(i).toString(16))
    return { host: g.join(':'), port: buf.readUInt16BE(20) }
  }
  return null
}

/** Caps how many async operations run at once; a released permit is handed
 *  straight to the next waiter rather than counted back up. */
class Semaphore {  private free: number
  private waiters: (() => void)[] = []

  constructor(max: number) {
    this.free = max
  }

  private acquire(): Promise<void> {
    if (this.free > 0) {
      this.free--
      return Promise.resolve()
    }
    return new Promise<void>((res) => this.waiters.push(res))
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) next()
    else this.free++
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}
