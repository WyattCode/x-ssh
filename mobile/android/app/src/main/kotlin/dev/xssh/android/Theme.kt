package dev.xssh.android

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * X-SSH 设计令牌,与 Windows 版 `global.css` 一一对应,保证两端同一套视觉语言。
 */
data class XsshPalette(
    val bg: Color,
    val bgElev: Color,
    val bgElev2: Color,
    val border: Color,
    val borderStrong: Color,
    val text: Color,
    val textDim: Color,
    val textFaint: Color,
    val accent: Color,
    val accentSoft: Color,
    val rowSel: Color,
    val danger: Color,
    val ok: Color,
    val warn: Color,
    // 终端配色(与 terminalThemes.ts 的 systemDark 一致)
    val termBg: Color,
    val termFg: Color,
    val termCursor: Color,
    val termSel: Color,
)

val DarkPalette = XsshPalette(
    bg = Color(0xFF0E0F12),
    bgElev = Color(0xFF16181D),
    bgElev2 = Color(0xFF1D2027),
    border = Color(0xFF262A33),
    borderStrong = Color(0xFF333844),
    text = Color(0xFFE6E8EC),
    textDim = Color(0xFF9AA1AD),
    textFaint = Color(0xFF656B78),
    accent = Color(0xFF6EA8FE),
    accentSoft = Color(0x246EA8FE),
    rowSel = Color(0x336EA8FE),
    danger = Color(0xFFFF6B6B),
    ok = Color(0xFF51CF66),
    warn = Color(0xFFFFD43B),
    termBg = Color(0xFF0E0F12),
    termFg = Color(0xFFE6E8EC),
    termCursor = Color(0xFF6EA8FE),
    termSel = Color(0x476EA8FE),
)

val LightPalette = XsshPalette(
    bg = Color(0xFFF7F8FA),
    bgElev = Color(0xFFFFFFFF),
    bgElev2 = Color(0xFFF0F2F5),
    border = Color(0xFFE3E6EB),
    borderStrong = Color(0xFFD3D7DF),
    text = Color(0xFF1A1D23),
    textDim = Color(0xFF5C636E),
    textFaint = Color(0xFF98A0AB),
    accent = Color(0xFF2F6FED),
    accentSoft = Color(0x1A2F6FED),
    rowSel = Color(0x212F6FED),
    danger = Color(0xFFE03131),
    ok = Color(0xFF2F9E44),
    warn = Color(0xFFF08C00),
    termBg = Color(0xFFF7F8FA),
    termFg = Color(0xFF1A1D23),
    termCursor = Color(0xFF2F6FED),
    termSel = Color(0x332F6FED),
)

val LocalXssh = staticCompositionLocalOf { DarkPalette }

private fun darkScheme(p: XsshPalette) = darkColorScheme(
    primary = p.accent,
    onPrimary = p.bg,
    secondary = p.accent,
    onSecondary = p.bg,
    background = p.bg,
    onBackground = p.text,
    surface = p.bgElev,
    onSurface = p.text,
    surfaceVariant = p.bgElev2,
    onSurfaceVariant = p.textDim,
    outline = p.borderStrong,
    outlineVariant = p.border,
    error = p.danger,
    onError = p.bg,
)

private fun lightScheme(p: XsshPalette) = lightColorScheme(
    primary = p.accent,
    onPrimary = Color.White,
    secondary = p.accent,
    onSecondary = Color.White,
    background = p.bg,
    onBackground = p.text,
    surface = p.bgElev,
    onSurface = p.text,
    surfaceVariant = p.bgElev2,
    onSurfaceVariant = p.textDim,
    outline = p.borderStrong,
    outlineVariant = p.border,
    error = p.danger,
    onError = Color.White,
)

/** 深色是 X-SSH 的默认面目(与 Windows 版一致);浅色留作后续设置项。 */
@Composable
fun XsshTheme(content: @Composable () -> Unit) {
    val palette = DarkPalette
    CompositionLocalProvider(LocalXssh provides palette) {
        MaterialTheme(colorScheme = darkScheme(palette), content = content)
    }
}
