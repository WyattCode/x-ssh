package dev.xssh.android

import androidx.compose.animation.scaleOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.core.animateTo
import androidx.compose.animation.core.AnimationState
import androidx.compose.ui.Alignment
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.sign

/**
 * 全应用共用的动效。所有"弹出来、滑进去"的东西都从这里取曲线,保证手感是同一种:
 *
 * - [Motion.snappy]:跟手的小部件(左滑按钮、卡片开合)—— 快、几乎不回弹;
 * - [Motion.page]:整页推入 / 退出 —— 临界阻尼,不晃;
 * - [Motion.reveal]:页面里的一块出现 / 收起(搜索框、详情切换)。
 *
 * 参照 iOS 17:没有夸张的弹跳,靠弹簧的速度感而不是固定时长。
 */
object Motion {
    fun <T> snappy(): SpringSpec<T> = spring(dampingRatio = 0.86f, stiffness = 520f)
    fun <T> page(): SpringSpec<T> = spring(dampingRatio = 1f, stiffness = 420f)
    fun <T> reveal(): SpringSpec<T> = spring(dampingRatio = 1f, stiffness = Spring.StiffnessMediumLow)

    /**
     * 终端快捷键面板的出现 / 收起:照系统键盘的样子 —— 从屏幕底边升上来,不淡入;
     * 上面的终端同步让出高度。曲线和时长取自 Android 的输入法动画
     * (InsetsController:弹出 275ms、PathInterpolator(0.2, 0, 0, 1);收起走加速曲线)。
     */
    private val imeShow = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    private val imeHide = CubicBezierEasing(0.4f, 0f, 1f, 1f)
    val keyboardIn: EnterTransition =
        slideInVertically(tween(275, easing = imeShow)) { it } +
            expandVertically(tween(275, easing = imeShow), expandFrom = Alignment.Top)
    val keyboardOut: ExitTransition =
        slideOutVertically(tween(220, easing = imeHide)) { it } +
            shrinkVertically(tween(220, easing = imeHide), shrinkTowards = Alignment.Top)

    /**
     * 轨道 / 工具栏上的按钮出现、消失(「回到底部」、连上之后的「文件」…)。
     *
     * 原来是直接出现在那儿:胶囊"砰"地长高一截,手指正要按的按钮瞬间换了位置。
     * 现在长出来的同时淡入、从 80% 放大到原大(和按下时的回弹同一种语气),消失反过来。
     * 竖轨道用 [chipIn] / [chipOut],横着的工具栏用 [chipInRow] / [chipOutRow]。
     */
    val chipIn: EnterTransition = expandVertically(snappy(), expandFrom = Alignment.Bottom) +
        fadeIn(snappy()) + scaleIn(snappy(), initialScale = 0.8f)
    val chipOut: ExitTransition = shrinkVertically(snappy(), shrinkTowards = Alignment.Bottom) +
        fadeOut(snappy()) + scaleOut(snappy(), targetScale = 0.8f)
    val chipInRow: EnterTransition = expandHorizontally(snappy(), expandFrom = Alignment.End) +
        fadeIn(snappy()) + scaleIn(snappy(), initialScale = 0.8f)
    val chipOutRow: ExitTransition = shrinkHorizontally(snappy(), shrinkTowards = Alignment.End) +
        fadeOut(snappy()) + scaleOut(snappy(), targetScale = 0.8f)

    /** 页面里一块内容出现:从上往下展开 + 淡入。 */
    val revealIn: EnterTransition = expandVertically(reveal()) + fadeIn(reveal())
    val revealOut: ExitTransition = shrinkVertically(reveal()) + fadeOut(reveal())

    /**
     * iOS 的导航推入:新页从右边整页滑进来,盖在旧页上;旧页同时往左退三分之一(视差)。
     * 返回时反过来,上面那页滑出右边。[forward] 决定方向和谁在上面。
     * [linear]:拖动返回手势期间用匀速曲线,页面位置和手指一一对应(松手后的收尾另有弹簧)。
     */
    fun <S> AnimatedContentTransitionScope<S>.push(forward: Boolean, linear: Boolean = false): ContentTransform {
        val spec: FiniteAnimationSpec<IntOffset> =
            if (linear) tween(durationMillis = 400, easing = LinearEasing) else page()
        return if (forward) {
            slideInHorizontally(spec) { it } togetherWith slideOutHorizontally(spec) { -it / 3 }
        } else {
            slideInHorizontally(spec) { -it / 3 } togetherWith slideOutHorizontally(spec) { it }
        }.apply { targetContentZIndex = if (forward) 1f else -1f }
    }
}

/**
 * iOS 的橡皮筋回弹:拉到头还能继续拖,越拖越沉,松手弹回;快速甩到头也会弹一下。
 *
 * 为什么不用 Compose 的 OverscrollEffect:内容不满一屏时(外屏只有一两台主机,就是这种情况)
 * 列表根本不把越界分发给它,拖了纹丝不动,用户以为页面卡死。
 * 这里改成接在滚动容器**外面**的 nestedScroll:容器滚不动的那部分(不管是到头还是本来就不满一屏)
 * 都会冒泡上来,在这里变成回弹。挂在每个滚动容器上:`Modifier.bounce()`。
 */
private class Bounce(private val limit: Float) : NestedScrollConnection {
    /** 画面实际偏移(已经过阻尼)。 */
    var shown by mutableFloatStateOf(0f)
        private set

    /** 越过边缘的原始距离(阻尼前)。 */
    private var pulled = 0f

    /**
     * 手指又按上来了:回弹动画必须立刻停。
     *
     * 不停的话,弹簧和手指会同时改 [shown] —— 弹簧刚把它拉回 0,这里又按"当前位移"重新算出一个
     * [pulled],于是每一个触摸事件都被当成"先把橡皮筋收回来"吃掉,整段滑动一动不动
     * (实测:到顶回弹之后紧接着滑 700px,画面只走了 10px)。
     */
    private var grabbed = false

    // iOS UIScrollView 的阻尼曲线:越拉越沉,永远到不了 limit。
    private fun damp(x: Float): Float = sign(x) * (1f - 1f / (abs(x) * 0.55f / limit + 1f)) * limit

    private fun undamp(y: Float): Float {
        val r = (abs(y) / limit).coerceAtMost(0.98f)
        return sign(y) * limit / 0.55f * (1f / (1f - r) - 1f)
    }

    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        if (source == NestedScrollSource.UserInput) grabbed = true
        // 弹簧的尾巴:差不到半个像素就当作已经回到位,别让浮点残渣再把橡皮筋"拉出来"。
        if (abs(shown) < 0.5f && pulled == 0f) shown = 0f
        // 回弹途中又被按住:从当前位置接手,不跳。
        if (pulled == 0f && shown != 0f) pulled = undamp(shown)
        // 已经拉出去了、手指往回走:先把拉出去的收回来,剩下的才去滚内容。
        if (pulled == 0f || available.y == 0f || sign(available.y) == sign(pulled)) return Offset.Zero
        val next = pulled + available.y
        val eaten = if (next == 0f || sign(next) != sign(pulled)) -pulled else available.y
        pulled = if (eaten == -pulled) 0f else next
        shown = damp(pulled)
        return Offset(0f, eaten)
    }

    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
        // 内容滚不动的那部分:拉出去。惯性撞到头在 onPostFling 里处理。
        if (source != NestedScrollSource.UserInput || available.y == 0f) return Offset.Zero
        pulled += available.y
        shown = damp(pulled)
        return Offset(0f, available.y)
    }

    override suspend fun onPreFling(available: Velocity): Velocity {
        grabbed = false
        if (shown == 0f) return Velocity.Zero
        // 拉着松手:内容不再惯性滚动,直接弹回。
        settle(available.y)
        return available
    }

    override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
        grabbed = false
        // 甩到头还剩速度:冲出去一小段再弹回。
        if (abs(available.y) > 50f) settle(available.y.coerceIn(-6000f, 6000f))
        return available
    }

    private suspend fun settle(v: Float) {
        pulled = 0f
        try {
            AnimationState(shown, v).animateTo(0f, spring(dampingRatio = 1f, stiffness = 260f)) {
                // 手指又按上来了:立刻撒手,后面归拖动管(见 [grabbed])。
                if (grabbed) {
                    cancelAnimation()
                    return@animateTo
                }
                shown = value.coerceIn(-limit, limit)
            }
        } finally {
            // 被新的拖动打断时停在原地,由 onPreScroll 从当前位置接手。
            pulled = if (abs(shown) < 0.5f) {
                shown = 0f
                0f
            } else {
                undamp(shown)
            }
        }
    }
}

/** 给一个竖向滚动容器加上 iOS 的橡皮筋回弹(见 [Bounce])。挂在容器本身上。 */
@Composable
fun Modifier.bounce(): Modifier {
    val density = LocalDensity.current
    val bounce = remember(density) { Bounce(with(density) { 160.dp.toPx() }) }
    return this
        // 裁在容器自己的范围里:往上拉时内容不能盖到状态栏上去(滚动时本来就是这样裁的)。
        .clipToBounds()
        .nestedScroll(bounce)
        .graphicsLayer { translationY = bounce.shown }
}
