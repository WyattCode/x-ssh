import { describe, it, expect } from 'vitest'
import { decideStatusEvent, mayRetry, backoffMs, retryDelayMs, shouldReviveOnOnline } from './reconnect'

const base = {
  paneSessionId: 's1',
  status: 'error' as const,
  autoReconnect: true
}

describe('decideStatusEvent', () => {
  it('schedules a retry on an unexpected drop', () => {
    const action = decideStatusEvent(base)
    expect(action.kind).toBe('markError')
    if (action.kind === 'markError') expect(action.scheduleRetry).toBe(true)
  })

  it('ignores an event once the pane has let go of the session', () => {
    // This is the stale-event guard on its own: by the time an event for a
    // session we closed arrives, the pane no longer holds that id. (Whether the
    // id was cleared because we retired the session or because the drop already
    // landed, the answer is the same.)
    const action = decideStatusEvent({ ...base, paneSessionId: undefined })
    expect(action).toEqual({ kind: 'ignore', reason: 'unowned' })
  })

  it('does not auto-reconnect when the user turned it off', () => {
    const action = decideStatusEvent({ ...base, autoReconnect: false })
    if (action.kind === 'markError') expect(action.scheduleRetry).toBe(false)
    else throw new Error('expected markError')
  })

  it('treats a clean close as closed, never as a drop', () => {
    const action = decideStatusEvent({ ...base, status: 'closed' })
    expect(action.kind).toBe('setStatus')
  })

  it('does not treat a still-connecting or connected pane as dropped', () => {
    // `closed` is the only non-error status that reaches here in practice, but
    // neither of these should ever schedule a retry.
    expect(decideStatusEvent({ ...base, status: 'connected' }).kind).toBe('setStatus')
    expect(decideStatusEvent({ ...base, status: 'connecting' }).kind).toBe('setStatus')
  })
})

describe('mayRetry', () => {
  it('allows attempts up to and including the ceiling', () => {
    expect(mayRetry(1, 3)).toBe(true)
    expect(mayRetry(3, 3)).toBe(true)
    expect(mayRetry(4, 3)).toBe(false)
  })

  it('treats a ceiling of zero as no retries', () => {
    expect(mayRetry(1, 0)).toBe(false)
  })
})

describe('backoffMs', () => {
  it('doubles from a one-second base', () => {
    const fixed = () => 0.5 // midpoint, so jitter cancels out
    expect(backoffMs(1, fixed)).toBe(1000)
    expect(backoffMs(2, fixed)).toBe(2000)
    expect(backoffMs(3, fixed)).toBe(4000)
    expect(backoffMs(4, fixed)).toBe(8000)
    expect(backoffMs(5, fixed)).toBe(16000)
  })

  it('caps at twenty seconds', () => {
    expect(backoffMs(6, () => 0.5)).toBe(20000)
    expect(backoffMs(20, () => 0.5)).toBe(20000)
  })

  it('stays within ±20% of the base', () => {
    for (const attempt of [1, 2, 3, 4, 5, 6]) {
      const base = Math.min(20000, 1000 * 2 ** (attempt - 1))
      expect(backoffMs(attempt, () => 0)).toBe(Math.round(base * 0.8))
      expect(backoffMs(attempt, () => 1)).toBe(Math.round(base * 1.2))
    }
  })
})

describe('shouldReviveOnOnline', () => {
  const dropped = {
    status: 'error',
    errorCode: undefined,
    sessionId: undefined,
    autoReconnect: true
  }

  it('revives a genuinely dropped pane', () => {
    expect(shouldReviveOnOnline(dropped)).toBe(true)
  })

  it('does not revive a pane that failed with a code', () => {
    // Bad credentials / changed host key / locked app: the network coming back
    // changes nothing, so don't hammer the host.
    for (const code of [
      'locked',
      'host_key_changed',
      'host_key_unknown',
      'jump_needs_password',
      'auth_failed'
    ]) {
      expect(shouldReviveOnOnline({ ...dropped, errorCode: code }), code).toBe(false)
    }
  })

  it('revives a pane whose errorCode was cleared by a new attempt', () => {
    // runConnect clears errorCode as it starts, so a pane that has been retried
    // is eligible again rather than being skipped forever.
    expect(shouldReviveOnOnline({ ...dropped, errorCode: undefined })).toBe(true)
  })

  it('does not revive a live or closed pane', () => {
    expect(shouldReviveOnOnline({ ...dropped, status: 'connected' })).toBe(false)
    expect(shouldReviveOnOnline({ ...dropped, sessionId: 's1' })).toBe(false)
  })

  it('respects the autoReconnect setting', () => {
    expect(shouldReviveOnOnline({ ...dropped, autoReconnect: false })).toBe(false)
  })
})
describe('retryDelayMs', () => {
  it('keeps the exponential backoff when no floor is asked for', () => {
    expect(retryDelayMs(3, () => 0.5)).toBe(backoffMs(3, () => 0.5))
  })
  it('raises the wait to the floor when the server is rate-limiting us', () => {
    // attempt 1 backs off ~1s, but the penalty window outlives that by far.
    expect(retryDelayMs(1, () => 0.5, 30_000)).toBe(30_000)
    expect(retryDelayMs(6, () => 0.5, 30_000)).toBe(30_000)
  })
  it('keeps the jitter inside the floored wait', () => {
    expect(retryDelayMs(5, () => 0, 0)).toBe(Math.round(backoffMs(5, () => 0)))
  })
})
