/**
 * Types shared between the main process, preload bridge, and renderer.
 * Keep this dependency-free so it can be imported from any layer.
 */

export type AuthMethod = 'password' | 'key' | 'agent'

/** How a port-forward rule is established. */
export type ForwardMode = 'local' | 'remote' | 'dynamic'
/** Why starting / stopping a live port forward failed (translated in the renderer). */
export type ForwardErrorCode = 'no-session' | 'bad-port' | 'already' | 'in-use'

/** Why a `keys:*` IPC call failed (translated in the renderer, see lib/keyError.ts). */
export type KeyErrorCode = 'invalid-key' | 'bad-id' | 'no-pubkey' | 'not-ready'

/**
 * How an upload treats remote files that already exist at the destination.
 *  - overwrite: replace (resume partials, skip truly identical-size files).
 *  - skip:      leave existing remote files untouched.
 *  - keep:      upload alongside under a new name ("name (1).ext").
 */
export type UploadOverwrite = 'overwrite' | 'skip' | 'keep'

/** An HTTP(S) or SOCKS5 proxy the SSH connection tunnels through. */
export interface ProxyConfig {
  host: string
  port: number
  /** 'socks5' | 'http'. */
  type: 'socks5' | 'http'
  username?: string
  password?: string
}

/** A single port-forward rule attached to a connection. */
export interface HostForward {
  /** For 'local'/'dynamic': local listen port. For 'remote': listen port on the server. */
  localPort: number
  /** For 'local': remote host as seen from the server (empty = the server itself).
   *  For 'remote': destination host on this machine. Unused for 'dynamic'. */
  remoteHost: string
  /** For 'local': remote port. For 'remote': destination port on this machine. */
  remotePort: number
  /** Defaults to 'local'. 'dynamic' = SOCKS5 proxy; 'remote' = server-side listen. */
  mode?: ForwardMode
}

/** A saved connection profile. Secrets are never stored here in plaintext. */
export interface Host {
  id: string
  label: string
  host: string
  port: number
  username: string
  auth: AuthMethod
  /** Absolute path to a private key file, when auth === 'key'. */
  keyPath?: string
  /** Optional grouping label for the palette & welcome list. */
  group?: string
  /** Id of another saved Host to tunnel through (ProxyJump). */
  jumpHostId?: string
  /** Tunnel this connection through an HTTP/SOCKS5 proxy instead of a direct link. */
  proxy?: ProxyConfig
  /** Local port-forward rules opened once connected. */
  portForwards?: HostForward[]
  /** Forward the local ssh-agent to the remote (-A) so remote hosts see it. */
  agentForward?: boolean
  /** Optional command(s) to send to the shell right after connecting. May span
   *  multiple lines (one command per line) or reference a script path. */
  onConnect?: string
  /** Delay in ms before the startup command(s) are sent (lets the login shell
   *  and any slow MOTD finish first). Default no delay when unset. */
  onConnectDelayMs?: number
  /** Optional last-used timestamp (ms) for sorting the palette. */
  lastUsedAt?: number
  color?: string
  /** Per-host terminal color-scheme override (''/unset = use the global theme). */
  terminalTheme?: string
  /** Per-host terminal font-family override (unset = use the global font). */
  terminalFontFamily?: string
  /** Free-form labels ("生产", "GPU"…) shown on the host card and matched by search. */
  tags?: string[]
  /** Detected on the last successful connect (see shared/hostOs.ts); drives the card icon. */
  os?: HostOs
  /** Runtime-only flag (not persisted): whether an encrypted password exists. */
  hasSavedPassword?: boolean
  /** Runtime-only flag: whether an encrypted key passphrase exists. */
  hasSavedPassphrase?: boolean
}

/** A host's operating system as detected over SSH. */
export interface HostOs {
  /** Normalized key the UI has an icon for: 'ubuntu', 'centos', 'dgx', 'macos', 'linux'… */
  id: string
  /** os-release PRETTY_NAME, e.g. "Ubuntu 26.04 LTS". */
  pretty?: string
}

/** Result of the background online probe for one saved host. 'unknown' = not
 *  probed directly (reached through a jump host / proxy, or an odd address). */
export type Reachability = 'online' | 'offline' | 'unknown'

/** A user-managed SSH key pair stored in the app's key library dir. */
export interface ManagedKey {
  /** Stable id (also used in the key's filename on disk). */
  id: string
  /** User-facing label, defaults to the basename. */
  name: string
  /** Type from the key (e.g. 'ssh-ed25519', 'ssh-rsa', ...). */
  type?: string
  /** Fingerprint (SHA256) if computable. */
  fingerprint?: string
  /** Absolute path to the private key file. */
  path: string
  /** Whether the key is passphrase-protected. */
  passphraseProtected?: boolean
  /** Unix mtime of the key file, for sorting / display. */
  mtime?: number
}

/** A directory entry in the local filesystem browser. */
export interface LocalEntry {
  name: string
  isDir: boolean
  /** File size in bytes (0 for directories). */
  size?: number
  /** Last-modified time in ms. */
  mtime?: number
}

/** A finished transfer logged to the persistent history (survives restart). */
export interface TransferHistoryItem {
  id: string
  sessionId?: string
  name: string
  direction: 'up' | 'down'
  bytes: number
  count?: number
  status: 'done' | 'error' | 'cancelled'
  error?: string
  /** Remote directory of the transfer, for "locate"/navigate. */
  remoteDir?: string
  /** Local destination directory for a download, so a failed download can be retried. */
  localDir?: string
  /** Whether this single-item download was a folder (so a retry restores isDir). */
  isDir?: boolean
  /** Exact remote path of a single-item download, so a retry survives a Save-As rename. */
  remotePath?: string
  /** The download job's entries, so a failed folder/multi download can be re-run. */
  items?: DownloadItem[]
  /** Local source paths of an upload, so a finished upload can be located locally. */
  localPaths?: string[]
  at: number
}

/** One entry of a download job (remote path + target name), for re-running it. */
export interface DownloadItem {
  path: string
  name: string
  isDir: boolean
}

/** A reusable command snippet shown in the command palette. */
export interface Snippet {
  id: string
  title: string
  /** Raw text sent to the focused terminal (may contain \n). */
  text: string
  /** Ask for confirmation before sending (guards destructive commands). */
  confirm?: boolean
  /** Optional category, grouped in the command palette. */
  group?: string
  /** Pre-filled values keyed by `{var}` name, so placeholders needn't be
   *  retyped every run (overridden by whatever the user types). */
  defaultVars?: Record<string, string>
  /** When set, the snippet only shows for a connection to this saved Host. */
  hostId?: string
}

/** A known-host entry surfaced to the settings page. */
export interface KnownHostEntry {
  host: string
  port: number
  /** Primary (first trusted) fingerprint — kept for older UI / export readers. */
  fingerprint: string
  /** Every trusted fingerprint for this host:port (rotation keeps prior keys). */
  fingerprints?: string[]
  /** ms epoch of first trust (when set) — used to age out stale keys. */
  firstSeen?: number
}

/** A remote file/directory entry from SFTP. */
export interface FileEntry {
  name: string
  isDir: boolean
  size: number
  mtime: number
  /** Permission bits (low 12 bits: rwx + setuid/setgid/sticky). */
  mode?: number
}

export interface SftpList {
  path: string
  entries: FileEntry[]
}

/** Live transfer progress pushed from main → renderer. One id per transfer job
 *  (a job may span many files); transferred/total are aggregate bytes. */
export interface SftpProgress {
  id: string
  /** Session the transfer belongs to, so the drawer can ignore other panes'. */
  sessionId?: string
  /** Current file name, or the job label at start/finish. */
  name: string
  direction: 'up' | 'down'
  transferred: number
  total: number
  /** Total files in the job (>1 shows an "i/N" counter). */
  count?: number
  /** 1-based index of the file currently transferring. */
  index?: number
  /** The remote directory this job targets (used to "locate" a transfer in history). */
  remoteDir?: string
  /** Local destination directory for a download (used to retry a failed download). */
  localDir?: string
  /** Whether this single-item download was a folder (drives the retry button). */
  isDir?: boolean
  /** Exact remote path of a single-item download (so a retry survives a Save-As rename). */
  remotePath?: string
  /** The download job's entries, so a failed folder/multi download can be re-run. */
  items?: DownloadItem[]
  /** Local source paths of an upload, so a finished upload can be located locally. */
  localPaths?: string[]
  done?: boolean
  error?: string
  /** True when the transfer was cancelled (not a failure). Set by main so the
   *  UI never has to match on the `error` wording. */
  cancelled?: boolean
}

/** Fully-resolved (secrets included) connection spec for a ProxyJump hop. */
export interface JumpConfig {
  host: string
  port: number
  username: string
  auth: AuthMethod
  keyPath?: string
  password?: string
  passphrase?: string
}

/** Parameters used to open a live SSH session. */
export interface ConnectParams {
  host: string
  port: number
  username: string
  auth: AuthMethod
  password?: string
  passphrase?: string
  keyPath?: string
  /** Optional reference back to the saved Host this came from. */
  hostId?: string
  cols?: number
  rows?: number
  /** Keepalive ping interval in ms (0 disables). Defaults applied in main. */
  keepaliveMs?: number
  /** Inject a PROMPT_COMMAND that emits OSC 7 so the file panel can follow cwd. */
  shellIntegration?: boolean
  /** Local port-forward rules to open once connected. */
  portForwards?: HostForward[]
  /** Tunnel through this jump host (its own saved Host id) before reaching target. */
  jumpHostId?: string
  /** Resolved jump connection spec; main fills this from the saved Host. */
  jump?: JumpConfig
  /** Tunnel through an HTTP/SOCKS5 proxy (resolved by main from the Host). */
  proxy?: ProxyConfig
  /** Lifecycle params forwarded from the saved Host on connect. */
  agentForward?: boolean
  onConnect?: string
  onConnectDelayMs?: number
  /** Reuse a shared connection to the same host (connection multiplexing). */
  multiplex?: boolean
  /** Connect timeout in ms (default 20000). Kept global in the store. */
  readyTimeoutMs?: number
}

/** Terminal resize payload. */
export interface ResizePayload {
  sessionId: string
  cols: number
  rows: number
}

export type SessionStatus =
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'error'

/** Events pushed from main → renderer for a given session. */
export interface SessionEvent {
  sessionId: string
  status: SessionStatus
  /** Human-readable message for 'error'/'closed' states. */
  message?: string
}

export interface ConnectResult {
  ok: boolean
  sessionId?: string
  error?: string
  /** Machine-readable failure code: 'host_key_unknown' (first connect),
   *  'host_key_changed', 'jump_needs_password', 'locked', 'forward:*'. */
  code?: string
  /** Fingerprint the server presented when a host-key rejection failed the
   *  connect — what the user is being asked to trust. */
  key?: string
  /** Which hop a host-key rejection concerns (default: the target itself;
   *  for 'jump_*' codes the jump host). Needed to write back the right entry. */
  keyHost?: string
  keyPort?: number
  /** A transient network failure (reset, timeout, unreachable, rate-limited):
   *  safe to retry as-is. Auth and host-key failures are deliberately not. */
  transient?: boolean
  /** Minimum wait before the automatic first retry — set when the server
   *  refused the connection by rate limiting (OpenSSH PerSourcePenalties),
   *  where retrying within the penalty window only feeds the penalty. */
  retryDelayMs?: number
}

/**
 * UI preferences handed to the renderer as a launch argument, so first paint
 * needs neither an async round-trip nor Chromium-backed storage. localStorage
 * is deliberately unused: its backing store is locked to one process, so a
 * second instance sharing the profile stalls ~6s on its first access.
 */
/** Appearance choice: 'system' follows the OS light/dark setting live. */
export type ThemePref = 'system' | 'light' | 'dark'

export interface UiPrefs {
  /** Unset (never chosen) behaves as 'system'. */
  theme?: ThemePref
  fontSize?: number
  zoom?: number
  sftpShowHidden?: boolean
  sftpWidth?: number
  /** Stored language preference ('zh' = Simplified); unset or 'system' follows the OS. See shared/lang.ts. */
  lang?: 'zh' | 'zh-TW' | 'en' | 'system'
  /** The OS's preferred locales (most preferred first), for "follow system". */
  systemLocales?: string[]
  /** Layout state the first frame must already have (else it paints the
   *  default and then jumps): sidebar collapsed / width / focus mode, and the
   *  connections page's view and sort. */
  sidebarCollapsed?: boolean
  sidebarWidth?: number
  termSidebarHidden?: boolean
  hostsView?: string
  hostsSort?: string
}

/** Result of a `settings:set`. Main refuses keys outside its allowlist
 *  (see shared/settingsKeys.ts) rather than writing them. */
export interface SettingsWriteResult {
  ok: boolean
  error?: string
}
