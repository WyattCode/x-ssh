package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import uniffi.xssh_ffi.InputModes

/**
 * 实体键盘 → 终端字节的编码。
 *
 * 这一层的错**不会报错**:发出去的是合法但错误的字节,远端要么当普通字符插进正文,
 * 要么干脆不认。所以每条约定都在这里钉住 —— 尤其是应用光标模式(DECCKM)和 Ctrl 映射。
 */
class KeyEncoderTest {

    private val normal = InputModes(
        appCursor = false,
        bracketedPaste = false,
        altScreen = false,
        mouseReport = false,
        sgrMouse = false,
        alternateScroll = true,
    )
    private val appCursor = normal.copy(appCursor = true)
    private val esc = "\u001B"

    // ---- 方向键:应用光标模式决定第二种写法 ----

    @Test
    fun `arrow keys use CSI in normal mode`() {
        assertEquals("${esc}[A", KeyEncoder.cursor('A', normal))
        assertEquals("${esc}[B", KeyEncoder.cursor('B', normal))
        assertEquals("${esc}[C", KeyEncoder.cursor('C', normal))
        assertEquals("${esc}[D", KeyEncoder.cursor('D', normal))
    }

    @Test
    fun `arrow keys use SS3 in application cursor mode`() {
        // vim / less 会打开这个模式,只认 ESC O A。发错了它们把 "[A" 当普通字符插入。
        assertEquals("${esc}OA", KeyEncoder.cursor('A', appCursor))
        assertEquals("${esc}OD", KeyEncoder.cursor('D', appCursor))
    }

    @Test
    fun `a modifier switches to the CSI 1-m form regardless of mode`() {
        // 带修饰键时 DECCKM 不参与 —— xterm 的规矩是这样,应用光标模式下也一样。
        // m = 1 + Alt(2) + Ctrl(4)(Shift 那一位由实体键盘分支自己算)。
        assertEquals("${esc}[1;3A", KeyEncoder.cursor('A', normal, alt = true))
        assertEquals("${esc}[1;5A", KeyEncoder.cursor('A', normal, ctrl = true))
        assertEquals("${esc}[1;7A", KeyEncoder.cursor('A', normal, ctrl = true, alt = true))
        // 应用光标模式不改变带修饰键的写法。
        assertEquals("${esc}[1;5A", KeyEncoder.cursor('A', appCursor, ctrl = true))
    }

    // ---- 滚轮 / 双指滑动 ----

    @Test
    fun `no movement produces no bytes`() {
        assertNull(KeyEncoder.wheel(0, 0, 0, normal))
    }

    @Test
    fun `a plain shell lets the caller scroll locally`() {
        // null = 由界面翻本地回滚缓冲,不发任何东西给服务器。
        assertNull(KeyEncoder.wheel(3, 0, 0, normal))
        // 全屏但没开 alternate scroll 也一样。
        assertNull(KeyEncoder.wheel(3, 0, 0, normal.copy(altScreen = true, alternateScroll = false)))
    }

    @Test
    fun `an alt-screen program without mouse gets arrow keys`() {
        val m = normal.copy(altScreen = true)
        assertEquals("${esc}[A", KeyEncoder.wheel(1, 0, 0, m))
        assertEquals("${esc}[B", KeyEncoder.wheel(-1, 0, 0, m))
        assertEquals("${esc}[A${esc}[A", KeyEncoder.wheel(2, 0, 0, m))
        // 方向也跟应用光标模式走。
        assertEquals("${esc}OA", KeyEncoder.wheel(1, 0, 0, m.copy(appCursor = true)))
    }

    @Test
    fun `a mouse-reporting program gets wheel events`() {
        val m = normal.copy(altScreen = true, mouseReport = true, sgrMouse = true)
        // SGR:按钮 64 = 上滚,1-based 坐标。
        assertEquals("${esc}[<64;1;1M", KeyEncoder.wheel(1, 0, 0, m))
        assertEquals("${esc}[<65;1;1M", KeyEncoder.wheel(-1, 0, 0, m))
        assertEquals("${esc}[<64;11;3M", KeyEncoder.wheel(1, 10, 2, m))
    }

    @Test
    fun `x10 mouse coordinates stay inside one byte`() {
        // X10 一个坐标一个字节;按 UTF-8 发出去超过 127 会变两字节,所以夹在 127。
        val m = normal.copy(altScreen = true, mouseReport = true, sgrMouse = false)
        val far = KeyEncoder.wheel(1, 300, 300, m)!!
        for (ch in far) {
            assertEquals("坐标不该超过 127", true, ch.code <= 127)
        }
    }

    // ---- 粘贴 ----

    @Test
    fun `paste normalizes newlines to carriage returns`() {
        assertEquals("a\rb\rc", KeyEncoder.paste("a\nb\r\nc", normal))
    }

    @Test
    fun `paste is wrapped when the program asked for bracketed paste`() {
        val m = normal.copy(bracketedPaste = true)
        assertEquals("${esc}[200~a\rb${esc}[201~", KeyEncoder.paste("a\nb", m))
    }

    @Test
    fun `an empty paste is still well formed`() {
        assertEquals("", KeyEncoder.paste("", normal))
        assertEquals("${esc}[200~${esc}[201~", KeyEncoder.paste("", normal.copy(bracketedPaste = true)))
    }

    @Test
    fun `existing carriage returns are not doubled`() {
        assertEquals("a\rb", KeyEncoder.paste("a\rb", normal))
    }
}