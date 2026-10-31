import { describe, expect, it } from 'vitest'
import { helloTextFor } from './userVerifyIpc'

/**
 * The reason line Windows Hello draws cannot come from the renderer, so it is
 * the one place where a wrong string reaches a user in a language they did not
 * pick. These lock the two things that actually went wrong before: an English
 * user seeing Chinese, and a batch counter printed when there is no batch.
 */
describe('helloTextFor', () => {
  it('speaks each interface language', () => {
    expect(helloTextFor('zh')).toBe('X-SSH 私钥')
    expect(helloTextFor('zh-TW')).toBe('X-SSH 私鑰')
    expect(helloTextFor('en')).toBe('X-SSH private key')
  })

  it('never leaks Chinese into English', () => {
    for (const s of [helloTextFor('en'), helloTextFor('en', 2, 3)]) {
      // Any CJK codepoint means the wrong table row was picked.
      expect(/[\u3400-\u9fff\uf900-\ufaff]/.test(s)).toBe(false)
    }
  })

  it('adds a position counter only for a real batch', () => {
    expect(helloTextFor('en', 2, 3)).toBe('X-SSH private key (2/3)')
    expect(helloTextFor('zh', 1, 2)).toBe('X-SSH 私钥（1/2）')
  })

  it('treats a single-host run as no batch', () => {
    // Publishing to one host must look exactly like an ordinary connect.
    expect(helloTextFor('en', 1, 1)).toBe('X-SSH private key')
  })

  it('drops the counter rather than printing an impossible one', () => {
    // A host list can shrink between building the batch and reaching this
    // host (deleted or unreadable host is skipped), so nth > total happens.
    expect(helloTextFor('en', 4, 3)).toBe('X-SSH private key')
    expect(helloTextFor('en', 0, 3)).toBe('X-SSH private key')
  })

  it('ignores a half-supplied pair', () => {
    expect(helloTextFor('en', 2)).toBe('X-SSH private key')
    expect(helloTextFor('en', undefined, 3)).toBe('X-SSH private key')
  })
})