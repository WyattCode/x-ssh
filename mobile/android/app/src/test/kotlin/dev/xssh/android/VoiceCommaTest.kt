package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 语音输入前面多出的逗号:真机日志里的形状是 哨兵 + "，" + 文字,组字起点贴着哨兵。 */
class VoiceCommaTest {
    private val s = "​"

    @Test
    fun `composition that starts with the IME's comma is recognised`() {
        assertTrue(startsWithVoiceComma(s + "，你好", compositionStart = 1, sentinelLength = 1))
    }

    @Test
    fun `a lone typed comma is not touched`() {
        assertFalse(startsWithVoiceComma(s + "，", compositionStart = 1, sentinelLength = 1))
        assertEquals("，", dropVoiceComma("，", voiceComma = false))
    }

    @Test
    fun `ordinary composition and no composition are not voice commas`() {
        assertFalse(startsWithVoiceComma(s + "nihao", compositionStart = 1, sentinelLength = 1))
        assertFalse(startsWithVoiceComma(s + "，你好", compositionStart = null, sentinelLength = 1))
        assertFalse(startsWithVoiceComma(s + "x，你好", compositionStart = 2, sentinelLength = 1))
    }

    @Test
    fun `the comma is dropped from the committed text`() {
        assertEquals("你好", dropVoiceComma("，你好", voiceComma = true))
        assertEquals(",ls", dropVoiceComma(",ls", voiceComma = false))
        assertEquals("你好，世界", dropVoiceComma("你好，世界", voiceComma = true))
    }
}
