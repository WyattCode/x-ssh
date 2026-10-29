import { describe, it, expect } from 'vitest'
import { liveSnippetSessionId } from './snippetSession'

describe('liveSnippetSessionId', () => {
  it('returns the id when the pane is connected and owns it', () => {
    expect(liveSnippetSessionId('s1', { status: 'connected', sshSessionId: 's1' })).toBe('s1')
  })

  it('returns null when there is no pane', () => {
    expect(liveSnippetSessionId('s1', undefined)).toBeNull()
    expect(liveSnippetSessionId('s1', null)).toBeNull()
  })

  it('returns null when the pane is not connected', () => {
    expect(liveSnippetSessionId('s1', { status: 'error', sshSessionId: 's1' })).toBeNull()
    expect(liveSnippetSessionId('s1', { status: 'connecting', sshSessionId: 's1' })).toBeNull()
    expect(liveSnippetSessionId('s1', { status: 'closed', sshSessionId: 's1' })).toBeNull()
  })

  it('returns null when the pane holds a different session', () => {
    expect(liveSnippetSessionId('s1', { status: 'connected', sshSessionId: 's2' })).toBeNull()
    expect(liveSnippetSessionId('s1', { status: 'connected' })).toBeNull()
  })

  it('returns null for an undefined sid', () => {
    expect(liveSnippetSessionId(undefined, { status: 'connected', sshSessionId: 's1' })).toBeNull()
  })
})
