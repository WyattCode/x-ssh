package dev.xssh.android

import java.io.File
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.remember
import android.content.pm.ApplicationInfo
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.core.view.WindowCompat

/**
 * 设计令牌。浅色 / 深色两套,跟随系统。
 *
 * 取值参照 iOS 的系统色(label / secondaryLabel / separator / systemGroupedBackground …),
 * 参考图就是那套视觉:浅色是白底,表单是浅灰分组底上的白色分组块;深色是纯黑底上的深灰分组块。
 */
data class XsshPalette(
    val dark: Boolean,
    /** 页面底色(主机页、终端页)。 */
    val bg: Color,
    /** 分组表单的页面底色(编辑页)。浅色是浅灰,深色是纯黑。 */
    val groupedBg: Color,
    /** 抬起来的一层:表单分组块、按键。浅色是白,深色是深灰。 */
    val bgElev: Color,
    /** 填充色:分段控件的轨道、次要按钮、按下态。半透明,叠在任何底上都成立。 */
    val bgElev2: Color,
    /** 分隔线。 */
    val border: Color,
    val borderStrong: Color,
    val text: Color,
    /** 次要文字(地址、说明)。 */
    val textDim: Color,
    /** 第三级文字(占位、分组标题)。 */
    val textFaint: Color,
    val accent: Color,
    /** 强调色上的文字/图标。 */
    val onAccent: Color,
    val accentSoft: Color,
    /** 列表选中行:整块填强调色(参考图收件箱里的选中邮件)。 */
    val rowSel: Color,
    val danger: Color,
    val ok: Color,
    val warn: Color,
    /** 毛玻璃:叠在模糊背景上的那层底色。 */
    val glassTint: Color,
    /** 毛玻璃的描边 —— 浅色是一道亮边,深色是一道极淡的白边,勾出玻璃的轮廓。 */
    val glassBorder: Color,
    /** 毛玻璃的投影。深色模式下投影看不见,干脆不画。 */
    val glassShadow: Color,
    val termBg: Color,
    val termFg: Color,
    val termCursor: Color,
    val termSel: Color,
    /** 终端 16 色(ANSI 0..15),交给 Rust 解析颜色时用。浅色底上不能沿用深色那套。 */
    val term16: List<Long>,
)

val DarkPalette = XsshPalette(
    dark = true,
    bg = Color(0xFF000000),
    groupedBg = Color(0xFF000000),
    bgElev = Color(0xFF1C1C1E),
    bgElev2 = Color(0x3D767680),
    border = Color(0x99545458),
    borderStrong = Color(0xFF48484A),
    text = Color(0xFFFFFFFF),
    textDim = Color(0x99EBEBF5),
    textFaint = Color(0x4DEBEBF5),
    accent = Color(0xFF0A84FF),
    onAccent = Color(0xFFFFFFFF),
    accentSoft = Color(0x330A84FF),
    rowSel = Color(0xFF0A84FF),
    danger = Color(0xFFFF453A),
    ok = Color(0xFF30D158),
    warn = Color(0xFFFF9F0A),
    glassTint = Color(0x8C2C2C2E),
    glassBorder = Color(0x24FFFFFF),
    glassShadow = Color(0x00000000),
    termBg = Color(0xFF000000),
    termFg = Color(0xFFF2F2F7),
    termCursor = Color(0xFF0A84FF),
    termSel = Color(0x660A84FF),
    // 与 Rust 核心的默认 16 色一致(深色底上对比度够的一组)。
    term16 = listOf(
        0x000000, 0xCD3131, 0x0DBC79, 0xE5E510, 0x2472C8, 0xBC3FBC, 0x11A8CD, 0xE5E5E5,
        0x666666, 0xF14C4C, 0x23D18B, 0xF5F543, 0x3B8EEA, 0xD670D6, 0x29B8DB, 0xFFFFFF,
    ),
)

val LightPalette = XsshPalette(
    dark = false,
    bg = Color(0xFFFFFFFF),
    // 浅色下表单页也用白底,分组块用浅灰填充。
    // 试过 iOS 设置页那种"偏紫的浅灰底 + 白色分组块":和白底的主机页一进一出,
    // 用户看了直接说配色不好看。白底灰块更干净,两页也统一。
    groupedBg = Color(0xFFFFFFFF),
    bgElev = Color(0xFFF2F2F7),
    bgElev2 = Color(0x1F767680),
    // 分隔线要轻:原来 29% 的黑、1dp 粗,把分组块切成几段。
    border = Color(0x2E3C3C43),
    borderStrong = Color(0xFFC7C7CC),
    text = Color(0xFF000000),
    textDim = Color(0x993C3C43),
    // 第三级文字比 iOS 的 30% 再深一点 —— 手机上 30% 的占位字、说明字在白底上几乎看不见。
    textFaint = Color(0x663C3C43),
    accent = Color(0xFF007AFF),
    onAccent = Color(0xFFFFFFFF),
    accentSoft = Color(0x26007AFF),
    rowSel = Color(0xFF007AFF),
    danger = Color(0xFFFF3B30),
    ok = Color(0xFF34C759),
    warn = Color(0xFFFF9500),
    // 浅色玻璃不能是白的:白底上白色亮边等于没有,轨道按钮只剩一点阴影,像悬在空中。
    // 用浅灰半透明底色 + 一道很淡的深色细边,轮廓才出得来(iOS 的玻璃在白底上也是灰的)。
    glassTint = Color(0xD1F2F2F5),
    glassBorder = Color(0x1A000000),
    glassShadow = Color(0x24000000),
    termBg = Color(0xFFFFFFFF),
    termFg = Color(0xFF1C1C1E),
    termCursor = Color(0xFF007AFF),
    termSel = Color(0x40007AFF),
    // 白底终端配色:"白色"文字在白底上看不见,换成中灰;黄色压暗。
    term16 = listOf(
        0x000000, 0xCD3131, 0x00A000, 0x949800, 0x0451A5, 0xBC05BC, 0x0598BC, 0x555555,
        0x666666, 0xCD3131, 0x14A814, 0xB5BA00, 0x0451A5, 0xBC05BC, 0x0598BC, 0x777777,
    ),
)

val LocalXssh = staticCompositionLocalOf { DarkPalette }

private fun darkScheme(p: XsshPalette) = darkColorScheme(
    primary = p.accent,
    onPrimary = p.onAccent,
    secondary = p.accent,
    onSecondary = p.onAccent,
    background = p.bg,
    onBackground = p.text,
    surface = p.bgElev,
    onSurface = p.text,
    surfaceVariant = p.bgElev,
    onSurfaceVariant = p.textDim,
    outline = p.borderStrong,
    outlineVariant = p.border,
    error = p.danger,
    onError = p.onAccent,
)

private fun lightScheme(p: XsshPalette) = lightColorScheme(
    primary = p.accent,
    onPrimary = p.onAccent,
    secondary = p.accent,
    onSecondary = p.onAccent,
    background = p.bg,
    onBackground = p.text,
    surface = p.bgElev,
    onSurface = p.text,
    surfaceVariant = p.groupedBg,
    onSurfaceVariant = p.textDim,
    outline = p.borderStrong,
    outlineVariant = p.border,
    error = p.danger,
    onError = p.onAccent,
)

private fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}

/*
 * 文字行高的统一口径。
 *
 * Material 的 `bodyLarge` 上钉着 `lineHeight = 24.sp`,继承下来之后 11sp 和 14sp 的
 * 文字**行盒一样高(实测都是 24dp)**,字形只占其中一小半,多出来的行距全变成上下两行
 * 之间的空隙。行高改为跟随字号,并裁掉首行上方与末行下方的多余行距。
 */
/** 跟随系统的深浅色。manifest 里 configChanges 含 uiMode,切换时不重建 Activity,这里直接重组。 */
@Composable
fun XsshTheme(content: @Composable () -> Unit) {
    // 调试包里可以用标记文件强制某个主题(files/force_light、files/force_dark),
    // 用来在不改手机系统设置的前提下检查两套主题。正式包里不生效。
    val context = LocalContext.current
    val forced = remember(context) {
        val debuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        when {
            !debuggable -> null
            File(context.filesDir, "force_light").exists() -> false
            File(context.filesDir, "force_dark").exists() -> true
            else -> null
        }
    }
    val palette = if (forced ?: isSystemInDarkTheme()) DarkPalette else LightPalette

    // 状态栏、导航条的图标颜色跟着主题翻:浅色底上要深色图标,否则时间和电量都看不见。
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = view.context.findActivity()?.window ?: return@SideEffect
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !palette.dark
                isAppearanceLightNavigationBars = !palette.dark
            }
        }
    }

    CompositionLocalProvider(LocalXssh provides palette) {
        MaterialTheme(colorScheme = if (palette.dark) darkScheme(palette) else lightScheme(palette)) {
            // 必须放在 MaterialTheme **里面**:它自己会 ProvideTextStyle(bodyLarge),
            // 在外面提供会被它盖掉(第一次就是这么改错的)。
            val base = MaterialTheme.typography.bodyLarge.copy(
                lineHeight = TextUnit.Unspecified,
                platformStyle = PlatformTextStyle(includeFontPadding = false),
                lineHeightStyle = LineHeightStyle(
                    alignment = LineHeightStyle.Alignment.Center,
                    trim = LineHeightStyle.Trim.Both,
                ),
            )
            CompositionLocalProvider(LocalTextStyle provides base, content = content)
        }
    }
}
