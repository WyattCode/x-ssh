import { describe, expect, it, vi } from 'vitest'
import { createReleaseCopy } from './releaseCopy'

function setup(writeImpl?: (t: string) => void) {
  const state = { text: '' }
  const write = vi.fn(writeImpl)
  const onError = vi.fn()
  const c = createReleaseCopy({ getSelection: () => state.text, write, onError })
  /** The terminal changes its selection (and fires onSelectionChange). */
  const select = (text: string) => {
    state.text = text
    c.selectionChanged()
  }
  return { c, write, onError, select, state }
}

describe('releaseCopy', () => {
  it('copies what was selected during the gesture, on release', () => {
    const { c, write, select } = setup()
    c.down()
    select('https://example.com')
    expect(c.up()).toBe(true)
    expect(write).toHaveBeenCalledWith('https://example.com')
  })

  it('writes once per gesture, not per selection change while dragging', () => {
    const { c, write, select } = setup()
    c.down()
    select('a')
    select('ab')
    select('abc')
    c.up()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('abc')
  })

  it('copies a double-click, which selects at the press itself', () => {
    const { c, write, select } = setup()
    c.down()
    select('word') // xterm selects the word in its own mousedown handler
    expect(c.up()).toBe(true)
    expect(write).toHaveBeenCalledWith('word')
  })

  it('copies a re-selection of the identical text (clear + set both fire)', () => {
    const { c, write, select } = setup()
    select('abc') // earlier, outside any gesture
    c.down()
    select('')
    select('abc')
    expect(c.up()).toBe(true)
    expect(write).toHaveBeenCalledWith('abc')
  })

  it('does not re-copy an old highlight on a plain click', () => {
    const { c, write, select } = setup()
    select('old')
    c.down()
    expect(c.up()).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('leaves the clipboard alone when the gesture cleared the selection', () => {
    const { c, write, select } = setup()
    select('old')
    c.down()
    select('')
    expect(c.up()).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('ignores a release that did not start on the terminal', () => {
    const { c, write, select } = setup()
    select('x')
    expect(c.up()).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('ignores selection changes made outside a gesture (keyboard, programmatic)', () => {
    const { c, write, select } = setup()
    select('x')
    c.down()
    expect(c.up()).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('handles one gesture at a time', () => {
    const { c, write, select } = setup()
    c.down()
    select('one')
    c.up()
    write.mockClear()
    expect(c.up()).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('reports a failed clipboard write instead of throwing', () => {
    const { c, onError, select } = setup(() => {
      throw new Error('denied')
    })
    c.down()
    select('x')
    expect(c.up()).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
