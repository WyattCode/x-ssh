package dev.xssh.android

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo

/**
 * 窗口尺寸档(Material 3 的三档)。用**窗口**宽度而不是屏幕宽度:分屏、小窗、
 * 自由窗口下屏幕还是那么大,能用的地方却小得多。
 */
enum class SizeClass { Compact, Medium, Expanded }

private fun classify(dp: Int): SizeClass = when {
    dp < 600 -> SizeClass.Compact
    dp < 840 -> SizeClass.Medium
    else -> SizeClass.Expanded
}

/**
 * 铰链。[startDp] 是折痕**起点**在窗口内的位置(竖直铰链就是左边距),
 * [sizeDp] 是折痕本身的厚度 —— 完全展开时通常为 0(只是一条线),半折时是真实缝隙。
 */
data class Hinge(
    val vertical: Boolean,
    val halfOpen: Boolean,
    val startDp: Dp,
    val sizeDp: Dp,
)

/**
 * 这一帧的窗口形态。界面只看这个,不去判断"是不是小米折叠屏"——
 * 平板、分屏、小窗、外屏、内屏走的是同一套规则。
 */
data class Adaptive(
    val width: SizeClass,
    val height: SizeClass,
    val hinge: Hinge?,
) {
    /** 竖直铰链把窗口分成左右两块:分栏的分界线必须压在折痕上。 */
    val bookFold: Hinge? get() = hinge?.takeIf { it.vertical }

    /** 桌面模式:横铰链半开着放在桌上 —— 上半屏看内容,下半屏放手要碰的东西。 */
    val tabletop: Hinge? get() = hinge?.takeIf { !it.vertical && it.halfOpen }

    /**
     * 宽到能同时放下列表和详情。
     *
     * 有竖直折痕**也不够** —— 分屏后每一半只剩 430dp 却仍带着折痕信息,再切两栏就是
     * 两条 200dp 的窄缝。窗口本身必须先够宽。
     */
    val twoPane: Boolean get() = width == SizeClass.Expanded ||
        (bookFold != null && width != SizeClass.Compact)

    /** 一屏放得下所有终端快捷键(不必横向滚动)。 */
    val roomyKeys: Boolean get() = width != SizeClass.Compact
}

val LocalAdaptive = staticCompositionLocalOf {
    Adaptive(SizeClass.Compact, SizeClass.Compact, null)
}

private fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}

/** 读当前窗口形态。折叠状态来自 WindowInfoTracker,尺寸来自 Configuration。 */
@Composable
fun rememberAdaptive(): Adaptive {
    val config = LocalConfiguration.current
    val density = LocalDensity.current
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }

    val layout: WindowLayoutInfo? by produceState<WindowLayoutInfo?>(null, activity) {
        val host = activity ?: return@produceState
        WindowInfoTracker.getOrCreate(host).windowLayoutInfo(host).collect { value = it }
    }

    val fold = layout?.displayFeatures?.filterIsInstance<FoldingFeature>()?.firstOrNull()
    val observed = fold?.let {
        val vertical = it.orientation == FoldingFeature.Orientation.VERTICAL
        val bounds = it.bounds
        with(density) {
            Hinge(
                vertical = vertical,
                halfOpen = it.state == FoldingFeature.State.HALF_OPENED,
                startDp = (if (vertical) bounds.left else bounds.top).toDp(),
                sizeDp = (if (vertical) bounds.width() else bounds.height()).toDp(),
            )
        }
    }

    // 回调还没到之前,先用上次量到的折痕位置。
    // 不这么做的话冷启动第一帧只能按百分比兜底摆分栏,等回调到了再跳一次 ——
    // 实测左栏 327dp → 430dp,右栏内容整帧右移约 100dp,就是"打开应用闪一下"。
    val prefs = remember(context) { UiPrefs(context) }
    val cached = remember(config.screenWidthDp) {
        prefs.cachedFoldStart(config.screenWidthDp)?.let { (start, size) ->
            Hinge(vertical = true, halfOpen = false, startDp = start.dp, sizeDp = size.dp)
        }
    }
    val hinge = if (layout != null) observed else cached

    // 量到了就记下来(只记竖直折痕 —— 半折是临时状态,不该被缓存成初始值)。
    LaunchedEffect(layout != null, observed?.startDp, config.screenWidthDp) {
        if (layout == null) return@LaunchedEffect
        val vertical = observed?.takeIf { it.vertical }
        prefs.cacheFoldStart(
            config.screenWidthDp,
            vertical?.startDp?.value,
            vertical?.sizeDp?.value ?: 0f,
        )
    }

    val width = classify(config.screenWidthDp)
    val height = classify(config.screenHeightDp)
    // staticCompositionLocalOf 不比较新旧值,只要实例变了整棵树就重组。
    // 这里必须缓存:否则每次重组都 new 一个内容相同的 Adaptive,白白全量重组。
    return remember(width, height, hinge) { Adaptive(width, height, hinge) }
}

/**
 * 分栏时左栏该多宽。有折痕就贴着折痕切(内容不跨折痕);没有折痕的平板按 38% 给列表,
 * 详情留大头;两种情况都夹在一个手指友好的区间里。
 */
fun Adaptive.listPaneWidth(totalDp: Dp): Dp {
    val fold = bookFold
    if (fold != null && fold.startDp > 200.dp && fold.startDp < totalDp - 200.dp) return fold.startDp
    return (totalDp * 0.38f).coerceIn(280.dp, 420.dp)
}
