package dev.xssh.android

import androidx.compose.foundation.LocalOverscrollFactory
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.annotation.StringRes
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.core.view.WindowCompat

/**
 * 设计令牌。浅色 / 深色两套,跟随系统。
 *
 * 取值参照 iOS 的系统色(label / secondaryLabel / separator / systemGroupedBackground …),
 * 强调色、侧栏 / 弹层的灰度台阶、行间虚线、主机色点则来自 iOS SwiftUI 版的终端风格(`Theme.swift`、`HostsView.swift`),
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
    /** 卡片底色(主机卡片、表单分组块)。深色下比 bgElev 暗一档,按用户要求更贴近黑底。 */
    val cardBg: Color,
    /**
     * 列表选中的卡片:比普通卡片亮一档的**中性灰**,不带蓝。
     * 试过整块实心蓝(太重)和浅蓝(深色下是一块发闷的藏青,挨着右边亮蓝的「连接」很不搭)。
     * 蓝色只留给「连接」这一个按钮:左边灰色告诉你选的是哪台,右边蓝色告诉你下一步点哪里。
     */
    val rowSel: Color,
    val danger: Color,
    /** 分段控件 / 开关的滑块:深色下是一块中灰，浅色下是白。 */
    val switchThumb: Color,
    /** 按键面板的键面，以及按下时的加深色。 */
    val keyFace: Color,
    val keyFacePressed: Color,
    /** 终端页工具条 / 键盘上方的功能条底色。 */
    val barBg: Color,
    val ok: Color,
    val warn: Color,
    /** Liquid Glass 的亮度层:叠在模糊背景上,保证上面的图标在任何底色上都读得出。 */
    val glassTint: Color,
    /** 没有背景源时玻璃的细边,以及按键面板的描边。 */
    val glassBorder: Color,
    /** Liquid Glass 的投影。 */
    val glassShadow: Color,
    /**
     * 两栏时左边主机列表那一栏的底:深色 #171717,比右边纯黑的详情 / 终端亮一档,整栏通高,一眼分得开。
     * (取值照 iOS 版 `Color.appSidebar`。)
     */
    val sidebar: Color,
    /** 弹层(新建 / 编辑主机)的底:浮在黑底上要比黑亮一档(#1C1C1C)。 */
    val sheet: Color,
    /** 弹层里的卡片 / 表单行:再亮一档(#2B2B2B),和弹层的底拉开层次。 */
    val sheetCard: Color,
    /** 行与行之间的虚线(1dp、3 实 3 空)。深色是 16% 的白。 */
    val dash: Color,
    val termBg: Color,
    val termFg: Color,
    val termCursor: Color,
    /** 选区叠色(含透明度);具名配色方案可覆盖。 */
    val termSelection: Color,
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
    // 绿色强调色:iOS 版的终端风格(`❯`、光标、主按钮、`# ` 都是这个绿)。主按钮上的字用深绿,
    // 不用白 —— 白字在 #30D158 上对比度只有 2:1 左右。
    accent = Color(0xFF30D158),
    onAccent = Color(0xFF04210C),
    accentSoft = Color(0x3330D158),
    cardBg = Color(0xFF161618),
    rowSel = Color(0xFF2C2C2E),
    danger = Color(0xFFFF453A),
    switchThumb = Color(0xFF636366),
    keyFace = Color(0xFF3A3A3C),
    keyFacePressed = Color(0xFF545456),
    barBg = Color(0xFF1C1C1E),
    ok = Color(0xFF30D158),
    warn = Color(0xFFFF9F0A),
    glassTint = Color(0x5C121214),
    glassBorder = Color(0x24FFFFFF),
    glassShadow = Color(0x66000000),
    sidebar = Color(0xFF171717),
    sheet = Color(0xFF1C1C1C),
    sheetCard = Color(0xFF2B2B2B),
    dash = Color(0x29FFFFFF),
    termBg = Color(0xFF000000),
    termFg = Color(0xFFF2F2F7),
    // 光标白色、选区用强调色:和 iOS 版一致(原来光标是蓝的,换成绿会和绿色 `❯` 混在一起)。
    termCursor = Color(0xFFFFFFFF),
    termSelection = Color(0xFF30D158).copy(alpha = 0.32f),
    // 与 Rust 核心的默认 16 色一致(深色底上对比度够的一组)。
    term16 = listOf(
        0x000000, 0xCD3131, 0x0DBC79, 0xE5E510, 0x2472C8, 0xBC3FBC, 0x11A8CD, 0xE5E5E5,
        0x666666, 0xF14C4C, 0x23D18B, 0xF5F543, 0x3B8EEA, 0xD670D6, 0x29B8DB, 0xFFFFFF,
    ),
)

val LocalXssh = staticCompositionLocalOf { DarkPalette }

/**
 * 主机行末的色点:12 种沉稳的色相,和 iOS 版 `HostColor` 同一组(取值是那边 0..1 的 RGB 换算成十六进制),
 * 一眼认出哪台是哪台。
 */
val HostPips: List<Color> = listOf(
    Color(0xFF708CFF), // 蓝
    Color(0xFF4FBAA3), // 青绿
    Color(0xFFB58CF0), // 紫
    Color(0xFFE08A5C), // 橙
    Color(0xFFE8738F), // 粉
    Color(0xFF9EC266), // 草绿
    Color(0xFF5CBDE6), // 天蓝
    Color(0xFFE6C257), // 黄
    Color(0xFFCC73CC), // 洋红
    Color(0xFF8CA8A8), // 灰青
    Color(0xFFDB8075), // 珊瑚
    Color(0xFF8585EB), // 靛
)

/**
 * 这台主机的色点:用记录里存的编号(新建时挑没被别的主机用过的,见 [assignColors])。
 * 还没有编号的老数据先按 id 取模凑合 —— 下一次落盘时 [assignColors] 会补上编号。
 */
fun hostPip(host: Host): Color =
    HostPips[host.colorIndex.takeIf { it in HostPips.indices } ?: ((host.id.hashCode() and Int.MAX_VALUE) % HostPips.size)]

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
/**
 * 只有深色:产品定位就是终端风格的深色界面,不再提供浅色和跟随系统。
 */
@Composable
fun XsshTheme(content: @Composable () -> Unit) {
    val base = DarkPalette
    // 设置里选的终端配色叠在 term* 上;UI 铬色仍跟外观走。
    val palette = base.withTerminalScheme(TerminalSchemeChoice.currentId)

    // 状态栏、导航条:深色底上一律用浅色图标。
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = view.context.findActivity()?.window ?: return@SideEffect
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        }
    }

    CompositionLocalProvider(LocalXssh provides palette) {
        MaterialTheme(colorScheme = darkScheme(palette)) {
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
            // 关掉 Android 的拉伸效果:滚动页一律用 iOS 的橡皮筋回弹(Motion.kt 的 bounce),两个叠在一起会打架。
            CompositionLocalProvider(
                LocalTextStyle provides base,
                LocalOverscrollFactory provides null,
                content = content,
            )
        }
    }
}
