/**
 * Whether a session status event should trigger auto-reconnect, and how a pane
 * in a given state reacts to losing its connection.
 *
 * These rules used to live inline in the store where they could only be checked
 * by hand. They are the part of reconnect that is easy to get subtly wrong — a
 * stale event from a session we just retired looks exactly like a fresh drop.
 *
 * Retiring a session is the caller's business (the store tracks which ids it
 * closed on purpose, since it is the only side that knows); what this decides is
 * what a *live* event means.
 */

export interface ReconnectInput {
  /** The session id still held by the pane, if any. */
  paneSessionId: string | undefined
  status: 'connecting' | 'connected' | 'closed' | 'error'
  /** Whether the user has auto-reconnect enabled. */
  autoReconnect: boolean
}

export type ReconnectAction =
  | { kind: 'ignore'; reason: 'unowned' }
  | { kind: 'markError'; scheduleRetry: boolean }
  | { kind: 'setStatus' }

/**
 * Decide what a status event means for a pane.
 *
 * The live/dropped distinction is `paneSessionId`, deliberately *not* the
 * previous status: a dropped session can emit `closed` before `error`, so a
 * status-based check would see 'closed' and never schedule the retry.
 */
export function decideStatusEvent(input: ReconnectInput): ReconnectAction {
  const { paneSessionId, status } = input
  // No pane owns this session id: either it was already cleared and its
  // trailing event arrived, or it belongs to a closed pane.
  if (!paneSessionId) return { kind: 'ignore', reason: 'unowned' }

  if (status === 'error') {
    // Notification wording and delivery are the caller's, since it also decides
    // whether to shout at all (an in-flight backoff loop already shows a banner).
    return { kind: 'markError', scheduleRetry: input.autoReconnect }
  }
  // Anything else (connecting, connected, or a clean close) just becomes the
  // pane's status. A clean close — the user typed `exit` — keeps the session id
  // so the "closed · reconnect" banner shows, and never auto-reconnects.
  return { kind: 'setStatus' }
}

/** Whether a further retry is still within the user's configured ceiling. */
export function mayRetry(attempt: number, connectRetries: number): boolean {
  return attempt <= connectRetries
}

/** Backoff delay in ms: doubling from 1s, capped at 20s, with ±20% jitter. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(20000, 1000 * 2 ** (attempt - 1))
  return Math.round(base * (0.8 + random() * 0.4))
}

/**
 * Delay for a reconnect attempt: the exponential backoff, but never below a
 * floor the caller asks for. The floor matters when the last refusal came from
 * the server's connection-rate limiting — retrying inside the penalty window
 * is itself a pre-auth connect and keeps the penalty alive, so the floor has
 * to outlast the decay instead.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random, minDelayMs = 0): number {
  return Math.max(backoffMs(attempt, random), minDelayMs)
}

/**
 * Floor for the next reconnect wait after a connect attempt.
 * `fromResultMs` is ConnectResult.retryDelayMs (30_000 on "not allowed at this
 * time", else undefined). Last attempt wins: a penalty raises the floor; a
 * non-penalty transient clears it so we do not stick at 30s forever.
 * Used by the established-session reconnect loop — the drop itself is not a
 * penalty, but a mid-loop refusal that returns retryDelayMs must elevate the
 * subsequent wait.
 */
export function nextReconnectFloorMs(fromResultMs: number | undefined): number | undefined {
  return fromResultMs && fromResultMs > 0 ? fromResultMs : undefined
}

/**
 * Whether a pane should be revived when the network comes back.
 *
 * A pane whose last connect returned a `code` (bad credentials, changed host
 * key, locked app) is not revived automatically — hammering a host that cannot
 * authenticate helps nobody. `errorCode` is cleared when a new attempt starts,
 * so a pane that has since succeeded or been retried is eligible again.
 */
export function shouldReviveOnOnline(pane: {
  status: string
  errorCode: string | undefined
  sessionId: string | undefined
  autoReconnect: boolean
}): boolean {
  return (
    pane.status === 'error' && !pane.errorCode && !pane.sessionId && pane.autoReconnect
  )
}

/**
 * Connect-result codes that retrying can never fix.
 *
 * These are the ones worth stopping for: wrong credentials, a changed host key,
 * a locked app — each needs a person to do something. Everything else that main
 * can return (`socks5-*`, `proxy-handshake-timeout`, `jump-connect-failed`,
 * `jump-forward-timeout`, or no code at all) is a network condition that may
 * well be gone by the next attempt.
 *
 * This list matters twice over: the reconnect loop stops on a permanent code,
 * and `shouldReviveOnOnline` refuses to revive a pane that carries one. Letting
 * a transient code into `errorCode` would therefore both stop the backoff and
 * strand the pane when the network came back — which is what happened when a
 * merge collapsed this into "any code is permanent".
 */
const PERMANENT_CONNECT_CODES = new Set([
  'auth_failed',
  'needs_key',
  'needs_password',
  'needs_passphrase',
  'bad_passphrase',
  'no-private-key',
  'host_key_unknown',
  'host_key_changed',
  'jump_needs_password',
  'jump_needs_key',
  'jump_missing',
  'secrets_load_failed',
  'locked'
])

/** Whether a connect-result code should stop the reconnect loop for good. */
export function isPermanentConnectCode(code: string | undefined): boolean {
  if (!code) return false
  return PERMANENT_CONNECT_CODES.has(code)
}
