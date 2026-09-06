import { readFile, stat, readdir, mkdir, unlink } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer, type Server, Socket } from 'node:net'
import { Duplex } from 'node:stream'
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import type { Readable, Writable } from 'node:stream'
import type { WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  ConnectParams,
  ConnectResult,
  HostForward,
  JumpConfig,
  SessionEvent,
  SftpList,
  SftpProgress
} from '../shared/types'
import { KnownHosts } from './knownHosts'
import { friendlyError } from './friendlyError'

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
  /** Human label for history results (user@host[:port]). */
  label?: string
  /** Recent raw output, capped, for cross-session history search. */
  history?: string
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
  /** jobId → sessionId, so progress events can be tagged for the right pane. */
  private jobSession = new Map<string, string>()
  /** Files transferred concurrently within one job. */
  private static readonly CONCURRENCY = 4
  /** How far a job's tree walk may run ahead of its transfer workers. */
  private static readonly QUEUE_MAX = 2000

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
   *  the target ssh2 Client to connect through (ProxyJump). */
  private connectJump(
    jump: JumpConfig,
    targetHost: string,
    targetPort: number
  ): Promise<{ sock: Duplex; client: Client }> {
    return new Promise((res, rej) => {
      const client = new Client()
      const config = SshManager.baseConfig(jump.host, jump.port, jump.username, undefined)
      let keyChanged = false
      config.hostVerifier = (
        hashedKey: string,
        cb: (valid: boolean) => void
      ): void => {
        const known = this.knownHosts.get(jump.host, jump.port)
        if (!known) {
          void this.knownHosts.set(jump.host, jump.port, hashedKey).catch(() => undefined)
          return cb(true)
        }
        if (known === hashedKey) return cb(true)
        keyChanged = true
        cb(false)
      }
      let settled = false
      const fail = (msg: string): void => {
        if (settled) return
        settled = true
        client.end()
        rej(new Error(msg))
      }
      this.authConfig(jump.auth, jump.keyPath, jump.passphrase, jump.password)
        .then((auth) => {
          Object.assign(config, auth)
          client.connect(config)
        })
        .catch((e) => fail(friendlyError((e as Error).message)))
      client.on('error', (err) =>
        fail(keyChanged ? '跳板机主机密钥与记录不一致,已中止' : friendlyError(err.message))
      )
      client.on('ready', () => {
        client.forwardOut(
          '127.0.0.1',
          0,
          targetHost,
          targetPort,
          (err, channel) => {
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

  /** Opens port forwards per rule mode (local -L, remote -R, dynamic SOCKS -D). */
  private openForwards(session: Session, rules: HostForward[]): void {
    const servers: Server[] = []
    for (const rule of rules) {
      if (!rule.localPort) continue
      const mode = rule.mode ?? 'local'
      // Remote forwards are attached to the client's 'tcp connection' handler
      // (one shared listener), which openRemoteForward wires up on first use.
      if (mode === 'remote') {
        this.openRemoteForward(session, rule)
        continue
      }
      if (mode === 'dynamic') {
        const server = createServer((socket: Socket) => this.handleSocks(session, socket))
        server.on('error', () => {
          /* local port busy — skip silently */
        })
        server.listen(rule.localPort, '127.0.0.1')
        servers.push(server)
        continue
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
      servers.push(server)
    }
    if (servers.length) {
      session.forwardServers = (session.forwardServers ?? []).concat(servers)
    }
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
    const client = new Client()
    this.sessions.set(id, { id, client })

    const port = params.port || 22
    this.sessions.get(id)!.label =
      `${params.username}@${params.host}${port !== 22 ? `:${port}` : ''}`
    const config = SshManager.baseConfig(params.host, port, params.username, params.keepaliveMs, params.readyTimeoutMs)

    // Trust-on-first-use host-key verification.
    await this.knownHosts.load()
    let keyChanged = false
    config.hostVerifier = (
      hashedKey: string,
      cb: (valid: boolean) => void
    ): void => {
      const known = this.knownHosts.get(params.host, port)
      if (!known) {
        void this.knownHosts.set(params.host, port, hashedKey).catch(() => undefined)
        return cb(true)
      }
      if (known === hashedKey) return cb(true)
      keyChanged = true
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
              this.emit({ sessionId: id, status: 'closed' })
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

            // Send the per-host startup command after the shell is ready.
            if (params.onConnect) stream.write(params.onConnect + '\n')

            this.emit({ sessionId: id, status: 'connected' })
            settle({ ok: true, sessionId: id })
          }
        )
      })

      client.on('error', (err) => {
        const message = keyChanged
          ? '主机密钥与首次连接时记录的不一致,连接已中止;这可能是中间人攻击,若你确认服务器已重装或更换,可选择“信任新密钥并重连”'
          : friendlyError(err.message)
        this.emit({ sessionId: id, status: 'error', message })
        if (jumpClient) jumpClient.end()
        this.sessions.delete(id)
        settle({
          ok: false,
          error: message,
          code: keyChanged ? 'host_key_changed' : undefined
        })
      })

      client.on('close', () => {
        this.emit({ sessionId: id, status: 'closed' })
        if (jumpClient) jumpClient.end()
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
    return `${dir.replace(/\/+$/, '')}/${name}`
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

  private emitProgress(p: SftpProgress): void {
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
    if (!this.sender.isDestroyed()) this.sender.send(IPC.sftpProgress, { ...p, sessionId })
  }

  private readdirFull(
    sftp: SFTPWrapper,
    dir: string
  ): Promise<{ filename: string; attrs: { size: number; isDirectory(): boolean } }[]> {
    return new Promise((res, rej) => sftp.readdir(dir, (e, l) => (e ? rej(e) : res(l as never))))
  }

  private statSize(sftp: SFTPWrapper, path: string): Promise<number> {
    return new Promise((res, rej) =>
      sftp.stat(path, (e, s) => (e ? rej(e) : res((s as { size: number }).size)))
    )
  }

  /** Pipes readable→writable, reporting byte deltas; abortable via the job id
   *  (its abort is one of possibly several registered under that job). */
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
      const abort = (): void => finish(new Error('已取消'))
      set.add(abort)
      readable.on('data', (c: Buffer) => onDelta(c.length))
      readable.on('error', (e: Error) => finish(e))
      writable.on('error', (e: Error) => finish(e))
      writable.on('finish', () => finish())
      writable.on('close', () => finish())
      readable.pipe(writable)
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
    concurrency?: number
  ): Promise<void> {
    this.jobSession.set(jobId, sessionId)
    // If the SFTP channel can't be opened the job never emits a terminal event,
    // so drop the mapping here to avoid leaking it.
    const sftp = await this.getSftp(sessionId).catch((e) => {
      this.jobSession.delete(jobId)
      throw e
    })
    const conc = Math.max(1, Math.min(32, concurrency ?? SshManager.CONCURRENCY))
    const label = items.length === 1 ? items[0].name : `${items.length} 项`
    let bytesDone = 0
    let filesDone = 0
    let discovered = 0
    let knownTotal = 0
    const failures: string[] = []
    // A producer (walk) fills this queue; a pool of workers drains it in
    // parallel — streaming (downloads start as files are found) AND concurrent.
    const queue: { remote: string; local: string; name: string }[] = []
    let walkDone = false
    const emit = (name: string, done?: boolean, error?: string): void =>
      this.emitProgress({ id: jobId, name, direction: 'down', transferred: bytesDone, total: knownTotal, count: discovered, index: filesDone, done, error })

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
        try {
          emit(item.name)
          // Both streams are built here so a throwing constructor can't leave
          // the other one orphaned (a stream nobody listens to turns its
          // 'error' into an uncaught exception).
          // Resume: if a partial local file exists and is smaller than the
          // remote, continue from its size (append); a larger/equal partial is
          // stale, so start over. On error/cancel we deliberately keep the
          // partial (no cleanup) so a retry can pick up where it left off.
          let offset = 0
          try {
            const localSize = (await stat(this.longPath(item.local))).size
            if (localSize > 0) {
              const remoteSize = await this.statSize(sftp, item.remote).catch(() => -1)
              if (remoteSize > localSize) offset = localSize
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
        } catch {
          read?.destroy()
          write?.destroy()
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
    try {
      // Promise.all up front: awaiting walkP first would leave a worker
      // rejection unhandled until we got here.
      const workers = Promise.all(Array.from({ length: conc }, () => worker()))
      await walkP
      await workers
      if (this.cancelledJobs.has(jobId)) {
        emit(label, false, '已取消')
      } else if (walkError) {
        emit(label, false, friendlyError((walkError as Error).message))
      } else if (failures.length) {
        emit(label, false, `${failures.length} 个文件失败`)
      } else {
        const t = bytesDone || 1
        this.emitProgress({ id: jobId, name: label, direction: 'down', transferred: t, total: t, count: discovered, done: true })
      }
    } finally {
      this.cancelledJobs.delete(jobId)
      this.jobSession.delete(jobId)
      this.lastProgressAt.delete(jobId)
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
    concurrency?: number
  ): Promise<void> {
    this.jobSession.set(jobId, sessionId)
    const conc = Math.max(1, Math.min(32, concurrency ?? SshManager.CONCURRENCY))
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
    const emit = (name: string, done?: boolean, error?: string): void =>
      this.emitProgress({ id: jobId, name, direction: 'up', transferred: bytesDone, total: knownTotal, count: discovered, index: filesDone, done, error })

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
            // Resume: if the remote file already exists and is smaller than the
            // local source, continue from its size; a same-or-larger remote is
            // already complete, so skip it. This keeps a failed/partial upload
            // from re-sending bytes already on the server.
            let offset = 0
            let localSize: number | null = null
            try {
              localSize = (await stat(this.longPath(item.local))).size
            } catch {
              /* source missing — let the stream error below */
            }
            if (localSize !== null) {
              const remoteSize = await this.statSize(sftp, item.remote).catch(() => -1)
              if (remoteSize === localSize) {
                filesDone++
                if (localSize) bytesDone += localSize
                emit(item.name)
                continue
              }
              if (remoteSize > 0 && remoteSize < localSize) offset = remoteSize
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
          emit(label, false, '已取消')
        } else if (walkError) {
          emit(label, false, friendlyError((walkError as Error).message))
        } else if (failures) {
          emit(label, false, `${failures} 个文件失败`)
        } else {
          const t = bytesDone || 1
          this.emitProgress({ id: jobId, name: label, direction: 'up', transferred: t, total: t, count: discovered, done: true })
        }
      } finally {
        this.cancelledJobs.delete(jobId)
      }
    } finally {
      this.jobSession.delete(jobId)
      this.lastProgressAt.delete(jobId)
    }
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

  /** Changes permissions on a path; when recursive, applies the same mode to every descendant. */
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
    await this.chmodOne(sftp, path, mode)
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
      if (it.attrs.isDirectory()) await this.chmodChildren(sftp, child, mode)
      await this.chmodOne(sftp, child, mode)
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

  async writeTextFile(sessionId: string, path: string, content: string): Promise<void> {
    const sftp = await this.getSftp(sessionId)
    await new Promise<void>((res, rej) =>
      sftp.writeFile(path, content, { encoding: 'utf8' }, (e) => (e ? rej(e) : res()))
    )
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.suppressTimer) clearTimeout(session.suppressTimer)
    this.closeForwards(session)
    session.sftp?.end()
    session.stream?.end()
    session.client.end()
    this.sessions.delete(sessionId)
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      if (session.suppressTimer) clearTimeout(session.suppressTimer)
      session.client.end()
    }
    this.sessions.clear()
  }

  /** Cross-session output for the history-search panel (bounded per session). */
  historyList(): { sessionId: string; label: string; text: string }[] {
    const out: { sessionId: string; label: string; text: string }[] = []
    for (const [id, s] of this.sessions) {
      if (s.history) out.push({ sessionId: id, label: s.label ?? '会话', text: s.history })
    }
    return out
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
