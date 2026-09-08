import { describe, it, expect } from 'vitest'
import { snippetVars } from './snippetVars'
import type { Snippet } from '../../../shared/types'

function snip(text: string): Snippet {
  return { id: 's1', title: 't', text }
}

describe('snippetVars', () => {
  it('extracts distinct placeholders in order', () => {
    expect(snippetVars(snip('ssh {user}@{host} -p {port}'))).toEqual(['user', 'host', 'port'])
  })

  it('de-duplicates repeated placeholders', () => {
    expect(snippetVars(snip('cp {name} {name}.bak'))).toEqual(['name'])
  })

  it('ignores non-word braces and returns empty when none', () => {
    expect(snippetVars(snip('echo {x-y} ok'))).toEqual([])
    expect(snippetVars(snip('plain command'))).toEqual([])
  })
})
