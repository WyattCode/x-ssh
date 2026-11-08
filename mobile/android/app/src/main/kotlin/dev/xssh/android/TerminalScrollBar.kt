package dev.xssh.android

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/**
 * 终端右边缘的滚动条(iPhone Duo 版终端同款)。
 *
 * - 回滚历史有内容、不在备用屏(vim / less)时才有;
 * - 平时彻底隐藏:滚动时淡入,停下 1.2 秒后淡出(0.5 秒);
 * - 滑块大小 = 视口 / (视口 + 历史),位置 = 离底部多少行(0 在最下面);
 * - 按住右边缘 28dp 宽的触摸条拖动,直接定位到那一行,滑块变粗变亮。
 *
 * 三个量都以 [State] 传进来、在这个函数里才读:历史每多一行就变一次,读在这里,
 * 只有滚动条自己重组,不牵动整屏终端。
 */
@Composable
fun TerminalScrollBar(
    history: State<Int>,
    offset: State<Int>,
    rows: Int,
    altScreen: State<Boolean>,
    onScrollBy: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val historyNow = history.value
    val offsetNow = offset.value
    val altNow = altScreen.value
    val density = LocalDensity.current
    var visible by remember { mutableStateOf(false) }
    var dragging by remember { mutableStateOf(false) }
    // 上一次见到的偏移:只有它**真的变了**才亮。LaunchedEffect 第一次进组合也会跑一遍,
    // 原来没人滚动、只是历史第一次超过一屏(或退出 vim / less 回来)就白闪 1.2 秒。
    // 这几个状态放在下面的提前 return 之前,进出备用屏时不会被丢掉重来。
    var lastOffset by remember { mutableStateOf(offsetNow) }
    val active = historyNow > 0 && !altNow
    // 拖着拖着滚动条整个消失了(远端进了备用屏、历史被清空):手势协程被取消时不一定会走 onDragCancel,
    // dragging 不复位的话,滚动条下次出现就一直是亮的、粗的。
    LaunchedEffect(active) { if (!active) dragging = false }
    // 滚动一下(偏移变了)就亮,停下 1.2 秒后收;偏移又变了,上一次的计时随之取消。
    // 没在显示(备用屏里)时偏移变了也只记下来、不亮:否则 1.2 秒内退出 vim 回来会白闪一下。
    LaunchedEffect(offsetNow) {
        if (offsetNow != lastOffset) {
            lastOffset = offsetNow
            if (active) {
                visible = true
                delay(1200)
                visible = false
            }
        }
    }
    if (!active) return
    val shown = visible || dragging
    val alpha by animateFloatAsState(if (shown) 1f else 0f, tween(if (shown) 120 else 500), label = "scrollbarAlpha")
    val thumbWidth by animateDpAsState(if (dragging) 6.dp else 4.dp, tween(200), label = "scrollbarThumb")
    val currentOffset by rememberUpdatedState(offsetNow)
    val currentHistory by rememberUpdatedState(historyNow)

    BoxWithConstraints(modifier.width(28.dp).fillMaxHeight()) {
        val heightPx = with(density) { maxHeight.toPx() }
        val viewport = rows.coerceAtLeast(1).toFloat()
        val thumbPx = maxOf(with(density) { 36.dp.toPx() }, heightPx * viewport / (viewport + historyNow))
        val travel = maxOf(1f, heightPx - thumbPx)
        // 离底部 offset 行 → 滑块位置:offset 0 在最下面,offset == history 在最上面。
        val thumbY = travel * (1f - offsetNow.toFloat() / historyNow)

        // 触摸条:几乎透明但接得住手指。手指在轨道里的位置 → 离底部多少行(上 = 历史最早)。
        // 拖动事件比重组快:currentOffset 要等下一次重组才更新,拿它算差值会把上一步又发一遍
        // (终点越过手指、滑块抖)。所以拖的时候记住"上一次发出去的目标",差值从它算起。
        val sent = remember { intArrayOf(-1) }
        fun move(y: Float) {
            val f = ((y - thumbPx / 2f) / travel).coerceIn(0f, 1f)
            val target = ((1f - f) * currentHistory).roundToInt()
            val base = if (sent[0] >= 0) sent[0] else currentOffset
            val delta = target - base
            if (delta != 0) {
                sent[0] = target
                onScrollBy(delta)
            }
        }
        // pointerInput(shown) 里的闭包只在 shown 变时重建:thumbPx / travel 要经由 State 取最新的。
        val moveLatest by rememberUpdatedState<(Float) -> Unit> { move(it) }
        Box(
            Modifier
                .fillMaxSize()
                // 平时隐藏的时候不接手势:右缘 28dp 里的长按选词、鼠标上报、系统的右缘手势都不该被它吃掉。
                // 先滚一下它就淡入,淡入着(或正在拖)才能抓。
                .pointerInput(shown) {
                    if (!shown) return@pointerInput
                    detectDragGestures(
                        onDragStart = {
                            dragging = true
                            sent[0] = -1
                            moveLatest(it.y)
                        },
                        onDrag = { change, _ ->
                            change.consume()
                            moveLatest(change.position.y)
                        },
                        onDragEnd = { dragging = false; sent[0] = -1 },
                        onDragCancel = { dragging = false; sent[0] = -1 },
                    )
                },
        )
        // 轨道:3dp 的细线,7% 的白。
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .padding(end = 3.5.dp, top = 6.dp)
                .width(3.dp)
                .height(maxHeight - 12.dp)
                .graphicsLayer { this.alpha = alpha }
                .background(Color.White.copy(alpha = 0.07f), CircleShape),
        )
        // 滑块:4dp 宽 60% 的白;拖的时候 6dp、85%。
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .padding(end = 3.dp)
                .offset { IntOffset(0, thumbY.roundToInt()) }
                .width(thumbWidth)
                .height(with(density) { thumbPx.toDp() })
                .graphicsLayer { this.alpha = alpha }
                .background(Color.White.copy(alpha = if (dragging) 0.85f else 0.6f), CircleShape),
        )
    }
}
