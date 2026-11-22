import { describe, expect, it } from 'vitest'
import { splitTip } from './tooltipText'

describe('splitTip', () => {
  it('pulls a trailing shortcut out of the label', () => {
    expect(splitTip('新建连接 (Ctrl+K)')).toEqual({ label: '新建连接', key: 'Ctrl+K' })
    expect(splitTip('Hosts（⌘B）')).toEqual({ label: 'Hosts', key: '⌘B' })
    expect(splitTip('Close tab (Ctrl+W)')).toEqual({ label: 'Close tab', key: 'Ctrl+W' })
  })
  it('leaves a parenthesis that is not a shortcut alone', () => {
    expect(splitTip('端口转发 (2 条规则)')).toEqual({ label: '端口转发 (2 条规则)', key: '' })
    expect(splitTip('wyatt@10.0.0.1 — Shift+点击并排打开')).toEqual({ label: 'wyatt@10.0.0.1 — Shift+点击并排打开', key: '' })
  })
  it('handles empty and bare text', () => {
    expect(splitTip('')).toEqual({ label: '', key: '' })
    expect(splitTip('(Ctrl+K)')).toEqual({ label: '(Ctrl+K)', key: '' })
  })
})
