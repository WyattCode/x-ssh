package dev.xssh.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color

/**
 * 终端配色方案:id / 显示名与桌面版 `terminalThemes.ts` 一致。
 *
 * 空 id = 跟随外观(沿用 [DarkPalette] / [LightPalette] 里的 term*);
 * 具名方案用桌面同款 RGB,不跟浅色/深色外观走。
 */
data class TerminalSchemePreset(
    val id: String,
    /** 专有名词,三端同名,不翻译。 */
    val label: String,
    val background: Long,
    val foreground: Long,
    val cursor: Long,
    /** ARGB,含透明度(选区叠在内容上)。 */
    val selection: Long,
    /** ANSI 0..15,RGB(无 alpha),交给 Rust `setPalette`。 */
    val term16: List<Long>,
) {
    init {
        require(term16.size == 16) { "term16 must have 16 colors, got ${term16.size}" }
    }
}

/** 从 0xRRGGBB 拼成不透明 Compose Color。 */
internal fun rgbColor(rgb: Long): Color = Color(0xFF000000L or (rgb and 0xFFFFFFL))

/** 桌面版同名六套 + 解析入口。 */
object TerminalSchemes {
    /**
     * 跟随外观时的深色终端色:与 [DarkPalette] 的 term* 一致。
     * 具名方案不走这里。
     */
    val systemDark16: List<Long> = listOf(
        0x000000, 0xCD3131, 0x0DBC79, 0xE5E510, 0x2472C8, 0xBC3FBC, 0x11A8CD, 0xE5E5E5,
        0x666666, 0xF14C4C, 0x23D18B, 0xF5F543, 0x3B8EEA, 0xD670D6, 0x29B8DB, 0xFFFFFF,
    )

    val systemLight16: List<Long> = listOf(
        0x000000, 0xCD3131, 0x00A000, 0x949800, 0x0451A5, 0xBC05BC, 0x0598BC, 0x555555,
        0x666666, 0xCD3131, 0x14A814, 0xB5BA00, 0x0451A5, 0xBC05BC, 0x0598BC, 0x777777,
    )

    val PRESETS: List<TerminalSchemePreset> = listOf(
        preset(
            "nord", "Nord",
            bg = 0x2E3440, fg = 0xD8DEE9, cursor = 0x88C0D0, sel = 0x4D88C0D0,
            black = 0x3B4252, brightBlack = 0x616E88,
            red = 0xBF616A, green = 0xA3BE8C, yellow = 0xEBCB8B,
            blue = 0x81A1C1, magenta = 0xB48EAD, cyan = 0x88C0D0, white = 0xE5E9F0,
        ),
        preset(
            "dracula", "Dracula",
            bg = 0x282A36, fg = 0xF8F8F2, cursor = 0xF8F8F2, sel = 0x4DFF79C6,
            black = 0x21222C, brightBlack = 0x6272A4,
            red = 0xFF5555, green = 0x50FA7B, yellow = 0xF1FA8C,
            blue = 0xBD93F9, magenta = 0xFF79C6, cyan = 0x8BE9FD, white = 0xF8F8F2,
        ),
        preset(
            "solarized", "Solarized Dark",
            bg = 0x002B36, fg = 0x839496, cursor = 0x93A1A1, sel = 0x4D93A1A1,
            black = 0x073642, brightBlack = 0x586E75,
            red = 0xDC322F, green = 0x859900, yellow = 0xB58900,
            blue = 0x268BD2, magenta = 0xD33682, cyan = 0x2AA198, white = 0xEEE8D5,
        ),
        preset(
            "one-dark", "One Dark",
            bg = 0x282C34, fg = 0xABB2BF, cursor = 0x528BFF, sel = 0x4D528BFF,
            black = 0x21252B, brightBlack = 0x5C6370,
            red = 0xE06C75, green = 0x98C379, yellow = 0xE5C07B,
            blue = 0x61AFEF, magenta = 0xC678DD, cyan = 0x56B6C2, white = 0xD0D7E5,
        ),
        preset(
            "gruvbox", "Gruvbox Dark",
            bg = 0x282828, fg = 0xEBDBB2, cursor = 0xD79921, sel = 0x4DD79921,
            black = 0x3C3836, brightBlack = 0x928374,
            red = 0xFB4934, green = 0xB8BB26, yellow = 0xFABD2F,
            blue = 0x83A598, magenta = 0xD3869B, cyan = 0x8EC07C, white = 0xEBDBB2,
        ),
        preset(
            "monokai", "Monokai",
            bg = 0x272822, fg = 0xF8F8F2, cursor = 0xF8F8F0, sel = 0x47F8F8F2,
            black = 0x272822, brightBlack = 0x75715E,
            red = 0xF92672, green = 0xA6E22E, yellow = 0xF4BF75,
            blue = 0x66D9EF, magenta = 0xAE81FF, cyan = 0xA1EFE4, white = 0xF9F8F5,
        ),
    )

    val BY_ID: Map<String, TerminalSchemePreset> = PRESETS.associateBy { it.id }

    /** 桌面同款六个 id(单测钉死)。 */
    val DESKTOP_IDS: List<String> = listOf(
        "nord", "dracula", "solarized", "one-dark", "gruvbox", "monokai",
    )

    /**
     * [id] 空 / 未知 → 跟随外观的系统终端色。
     * 具名方案忽略 [dark]。
     */
    fun resolve(id: String?, dark: Boolean): ResolvedTerminalScheme {
        val preset = id?.takeIf { it.isNotEmpty() }?.let { BY_ID[it] }
        if (preset != null) {
            return ResolvedTerminalScheme(
                id = preset.id,
                background = rgbColor(preset.background),
                foreground = rgbColor(preset.foreground),
                cursor = rgbColor(preset.cursor),
                selection = Color(preset.selection),
                term16 = preset.term16,
            )
        }
        return if (dark) {
            ResolvedTerminalScheme(
                id = "",
                background = Color(0xFF000000),
                foreground = Color(0xFFF2F2F7),
                cursor = Color(0xFF0A84FF),
                selection = Color(0xFF0A84FF).copy(alpha = 0.32f),
                term16 = systemDark16,
            )
        } else {
            ResolvedTerminalScheme(
                id = "",
                background = Color(0xFFFFFFFF),
                foreground = Color(0xFF1C1C1E),
                cursor = Color(0xFF007AFF),
                selection = Color(0xFF007AFF).copy(alpha = 0.32f),
                term16 = systemLight16,
            )
        }
    }

    private fun preset(
        id: String,
        label: String,
        bg: Long,
        fg: Long,
        cursor: Long,
        sel: Long,
        black: Long,
        brightBlack: Long,
        red: Long,
        green: Long,
        yellow: Long,
        blue: Long,
        magenta: Long,
        cyan: Long,
        white: Long,
    ): TerminalSchemePreset {
        // brightX 与桌面补齐策略一致:除 brightBlack 外跟常态同色,brightWhite = white。
        val term16 = listOf(
            black, red, green, yellow, blue, magenta, cyan, white,
            brightBlack, red, green, yellow, blue, magenta, cyan, white,
        )
        return TerminalSchemePreset(id, label, bg, fg, cursor, sel, term16)
    }
}

data class ResolvedTerminalScheme(
    val id: String,
    val background: Color,
    val foreground: Color,
    val cursor: Color,
    val selection: Color,
    val term16: List<Long>,
)

/** 把解析结果叠进界面令牌的终端字段(UI 铬色不动)。 */
fun XsshPalette.withTerminalScheme(id: String?): XsshPalette {
    val r = TerminalSchemes.resolve(id, dark)
    return copy(
        termBg = r.background,
        termFg = r.foreground,
        termCursor = r.cursor,
        termSelection = r.selection,
        term16 = r.term16,
    )
}

/** 当前终端配色 id:设置页写,主题组合读。空字符串 = 跟随外观。 */
object TerminalSchemeChoice {
    var currentId by mutableStateOf("")
        private set
    private var prefs: UiPrefs? = null

    fun load(context: android.content.Context) {
        val p = UiPrefs(context)
        prefs = p
        currentId = p.terminalTheme.orEmpty()
    }

    fun choose(id: String) {
        currentId = id
        prefs?.terminalTheme = id.ifEmpty { null }
    }
}
