package dev.xssh.android

import android.content.res.Configuration
import android.view.KeyCharacterMap
import android.view.KeyEvent
import uniffi.xssh_ffi.InputModes

/** 没连上 / 还没取到画面时的默认模式:全关。 */
val DefaultInputModes = InputModes(
    appCursor = false,
    bracketedPaste = false,
    altScreen = false,
    mouseReport = false,
    sgrMouse = false,
    alternateScroll = true,
)

/**
 * 插着实体键盘(平板的键盘保护套、蓝牙键盘)。
 *
 * 这时终端的焦点**不能**放在输入框上:系统会先把按键交给输入法,中文输入法把字母吃进拼音组合里
 * (实测 `echo` 整个消失),回车、方向键、Tab、Ctrl+C 又被输入框当成编辑操作吞掉。
 */
fun Configuration.hasHardKeyboard(): Boolean =
    keyboard == Configuration.KEYBOARD_QWERTY &&
        hardKeyboardHidden == Configuration.HARDKEYBOARDHIDDEN_NO

/**
 * 实体键盘 → 终端字节,按 xterm 的约定编码。
 *
 * 修饰键参数 `m = 1 + Shift(1) + Alt(2) + Ctrl(4)`:带修饰键的方向键是 `ESC[1;mA`,
 * 翻页这一类是 `ESC[5;m~`。不带修饰键时方向键看 DECCKM —— 应用光标模式下是 `ESC O A`
 * (vim、less 认这个),否则 `ESC [ A`。
 */
object KeyEncoder {
    private const val ESC = "\u001B"

    /**
     * 方向键 / Home / End 的字节。屏幕按键条也走这里 —— 它原来是自己硬写 `ESC[A`,
     * 于是**同一颗上箭头,从实体键盘按和从屏幕上按发出去的字节不一样**:
     * 应用光标模式(vim、less 都会打开)下该发 `ESC O A`,屏幕那颗却还在发 `ESC [ A`,
     * 编辑器认不出来,甚至把 `[A` 当普通字符插进正文。粘滞的 Ctrl / Alt 同理要带上。
     */
    fun cursor(c: Char, modes: InputModes, ctrl: Boolean = false, alt: Boolean = false): String {
        val mod = 1 + (if (alt) 2 else 0) + (if (ctrl) 4 else 0)
        return when {
            mod > 1 -> "$ESC[1;$mod$c"
            modes.appCursor -> "${ESC}O$c"
            else -> "$ESC[$c"
        }
    }

    /**
     * 返回要发的字节;null 表示这颗键终端不管(交给系统,比如 Win 键组合、音量键)。
     * [stickyCtrl] / [stickyAlt] 是屏幕按键条上的粘滞修饰键,和实体修饰键等效。
     */
    fun encode(e: KeyEvent,modes: InputModes, stickyCtrl: Boolean = false, stickyAlt: Boolean = false): String? {
        if (e.isMetaPressed) return null
        val shift = e.isShiftPressed
        val alt = e.isAltPressed || stickyAlt
        val ctrl = e.isCtrlPressed || stickyCtrl
        val mod = 1 + (if (shift) 1 else 0) + (if (alt) 2 else 0) + (if (ctrl) 4 else 0)

        fun cursor(c: Char) = when {
            mod > 1 -> "$ESC[1;$mod$c"
            modes.appCursor -> "${ESC}O$c"
            else -> "$ESC[$c"
        }
        fun tilde(n: Int) = if (mod > 1) "$ESC[$n;$mod~" else "$ESC[$n~"
        fun ss3(c: Char) = if (mod > 1) "$ESC[1;$mod$c" else "${ESC}O$c"
        fun meta(s: String) = if (alt) ESC + s else s

        return when (e.keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> cursor('A')
            KeyEvent.KEYCODE_DPAD_DOWN -> cursor('B')
            KeyEvent.KEYCODE_DPAD_RIGHT -> cursor('C')
            KeyEvent.KEYCODE_DPAD_LEFT -> cursor('D')
            KeyEvent.KEYCODE_MOVE_HOME -> cursor('H')
            KeyEvent.KEYCODE_MOVE_END -> cursor('F')
            KeyEvent.KEYCODE_INSERT -> tilde(2)
            KeyEvent.KEYCODE_FORWARD_DEL -> tilde(3)
            KeyEvent.KEYCODE_PAGE_UP -> tilde(5)
            KeyEvent.KEYCODE_PAGE_DOWN -> tilde(6)
            KeyEvent.KEYCODE_F1 -> ss3('P')
            KeyEvent.KEYCODE_F2 -> ss3('Q')
            KeyEvent.KEYCODE_F3 -> ss3('R')
            KeyEvent.KEYCODE_F4 -> ss3('S')
            KeyEvent.KEYCODE_F5 -> tilde(15)
            KeyEvent.KEYCODE_F6 -> tilde(17)
            KeyEvent.KEYCODE_F7 -> tilde(18)
            KeyEvent.KEYCODE_F8 -> tilde(19)
            KeyEvent.KEYCODE_F9 -> tilde(20)
            KeyEvent.KEYCODE_F10 -> tilde(21)
            KeyEvent.KEYCODE_F11 -> tilde(23)
            KeyEvent.KEYCODE_F12 -> tilde(24)
            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> meta("\r")
            KeyEvent.KEYCODE_TAB -> if (shift) "$ESC[Z" else meta("\t")
            KeyEvent.KEYCODE_ESCAPE -> meta(ESC)
            // 退格发 DEL(0x7F),和 xterm / 桌面版一致;Ctrl+退格发 ^H(删一个词,很多 shell 这么绑)。
            KeyEvent.KEYCODE_DEL -> meta(if (ctrl) "\b" else "\u007F")
            KeyEvent.KEYCODE_SPACE -> meta(if (ctrl) "\u0000" else " ")
            else -> printable(e, ctrl, alt)
        }
    }

    /**
     * 普通字符。先去掉 Ctrl/Alt 再按键盘布局取字符:Ctrl 由我们自己换成控制字符,
     * Alt 用 ESC 前缀(终端的 Meta 约定),不走 Android 的 Alt 符号层。
     */
    private fun printable(e: KeyEvent, ctrl: Boolean, alt: Boolean): String? {
        val plain = e.metaState and (KeyEvent.META_CTRL_MASK or KeyEvent.META_ALT_MASK).inv()
        val code = e.getUnicodeChar(plain)
        if (code == 0 || code and KeyCharacterMap.COMBINING_ACCENT != 0) return null
        var s = String(Character.toChars(code))
        if (ctrl) s = control(s) ?: return null
        if (alt) s = ESC + s
        return s
    }

    /** Ctrl+字符 → 控制字符(xterm 的映射,含 Ctrl+数字这些老终端习惯)。 */
    private fun control(s: String): String? {
        if (s.length != 1) return null
        val c = s[0]
        val code = when (c) {
            in 'a'..'z' -> c - 'a' + 1
            in 'A'..'Z' -> c - 'A' + 1
            '@', '2', ' ' -> 0
            '[', '3' -> 27
            '\\', '4' -> 28
            ']', '5' -> 29
            '^', '6' -> 30
            '_', '/', '7', '-' -> 31
            '?', '8' -> 127
            else -> return null
        }
        return code.toChar().toString()
    }

    /**
     * 滚轮 / 双指滑动。[lines] 正数 = 往上(看更早的内容)。
     *
     * - 程序要鼠标(vim `mouse=a`、htop):发滚轮事件,位置是指针所在的格子;
     * - 全屏程序但不要鼠标(less、man):换成方向键(xterm 的 alternate scroll);
     * - 普通 shell:返回 null,由调用方翻本地回滚缓冲。
     */
    fun wheel(lines: Int, col: Int, row: Int, modes: InputModes): String? {
        if (lines == 0) return null
        val up = lines > 0
        val n = kotlin.math.abs(lines)
        if (modes.mouseReport) {
            val button = if (up) 64 else 65
            val one = if (modes.sgrMouse) {
                "$ESC[<$button;${col + 1};${row + 1}M"
            } else {
                // X10 编码一个字节放一个坐标;发送时按 UTF-8 编码,超过 127 会变成两个字节,
                // 所以夹在 95 列/行以内(现代程序基本都开 SGR,走上面那支)。
                val x = (col + 1 + 32).coerceAtMost(127).toChar()
                val y = (row + 1 + 32).coerceAtMost(127).toChar()
                "$ESC[M${(button + 32).toChar()}$x$y"
            }
            return one.repeat(n)
        }
        if (modes.altScreen && modes.alternateScroll) {
            val c = if (up) 'A' else 'B'
            val one = if (modes.appCursor) "${ESC}O$c" else "$ESC[$c"
            return one.repeat(n)
        }
        return null
    }

    /** 粘贴:换行统一成回车;程序开了括号粘贴就包起来(防止粘进来的内容被当成命令逐行执行)。 */
    fun paste(text: String, modes: InputModes): String {
        val body = text.replace("\r\n", "\r").replace('\n', '\r')
        return if (modes.bracketedPaste) "$ESC[200~$body$ESC[201~" else body
    }
}
