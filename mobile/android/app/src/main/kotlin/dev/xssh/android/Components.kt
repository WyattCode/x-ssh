package dev.xssh.android

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * 手指能稳稳点到的最小边长。Material 的无障碍下限是 48dp,本应用一律不低于它 ——
 * 终端这种会连点很多次的界面,差几 dp 就是频繁点错。
 */
val TouchMin = 48.dp

enum class ButtonKind { Primary, Ghost, Danger }

/** 卡片:与 Windows 版 `.card` 同款(圆角 10、1px 边框、elev 背景)。 */
@Composable
fun XsshCard(
    modifier: Modifier = Modifier,
    highlight: Boolean = false,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = LocalXssh.current
    val haptic = LocalHapticFeedback.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    // 按下时轻微内缩:手指盖住卡片时,边缘的位移是唯一还看得见的反馈。
    val scale by animateFloatAsState(if (pressed) 0.985f else 1f, label = "cardPress")

    Column(
        modifier
            .scale(scale)
            .clip(RoundedCornerShape(12.dp))
            .background(if (highlight) p.rowSel else p.bgElev)
            .border(
                1.dp,
                if (highlight) p.accent.copy(alpha = 0.7f) else p.border,
                RoundedCornerShape(12.dp),
            )
            .then(
                if (onClick == null) {
                    Modifier
                } else {
                    combinedTap(
                        interaction = interaction,
                        onTap = onClick,
                        onLongPress = onLongClick?.let {
                            {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                onLongClick()
                            }
                        },
                    )
                },
            )
            .padding(14.dp),
        content = content,
    )
}

/**
 * 点击 + 长按。用 `combinedClickable` 会把长按也报成一次点击前的按下态,这里手写
 * 手势以便长按后**不再**触发点击(卡片长按出菜单,松手不应该顺带连上主机)。
 */
@Composable
private fun combinedTap(
    interaction: MutableInteractionSource,
    onTap: () -> Unit,
    onLongPress: (() -> Unit)?,
): Modifier {
    val tap by rememberUpdatedState(onTap)
    val long by rememberUpdatedState(onLongPress)
    val scope = rememberCoroutineScope()
    return Modifier
        .semantics {
            role = Role.Button
            onClick {
                tap()
                true
            }
        }
        .pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val press = PressInteraction.Press(down.position)
            scope.launch { interaction.emit(press) }
            var longFired = false
            val pending = long?.let { handler ->
                scope.launch {
                    delay(450)
                    longFired = true
                    handler()
                }
            }
            val up = waitForUpOrCancellation()
            pending?.cancel()
            scope.launch { interaction.emit(PressInteraction.Release(press)) }
            if (up != null && !longFired) tap()
        }
    }
}

@Composable
fun XsshButton(
    label: String,
    modifier: Modifier = Modifier,
    kind: ButtonKind = ButtonKind.Primary,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val p = LocalXssh.current
    val haptic = LocalHapticFeedback.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed && enabled) 0.96f else 1f, label = "btnPress")

    val background = when (kind) {
        ButtonKind.Primary -> p.accent
        ButtonKind.Ghost -> p.bgElev2
        ButtonKind.Danger -> Color.Transparent
    }
    val foreground = when (kind) {
        ButtonKind.Primary -> p.bg
        ButtonKind.Ghost -> p.text
        ButtonKind.Danger -> p.danger
    }
    val borderColor = when (kind) {
        ButtonKind.Primary -> Color.Transparent
        ButtonKind.Ghost -> p.borderStrong
        ButtonKind.Danger -> p.danger.copy(alpha = 0.55f)
    }
    Box(
        modifier
            .scale(scale)
            .heightIn(min = TouchMin)
            .clip(RoundedCornerShape(12.dp))
            .background(if (enabled) background else background.copy(alpha = 0.35f))
            .border(1.dp, if (enabled) borderColor else borderColor.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
            .clickable(interactionSource = interaction, indication = null, enabled = enabled) {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onClick()
            }
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (enabled) foreground else foreground.copy(alpha = 0.4f),
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
    }
}

/** 只有一个符号的按钮(⋮、⌨ 之类)。符号再小,可点区域也必须是整整 48dp。 */
@Composable
fun XsshIconButton(
    glyph: String,
    modifier: Modifier = Modifier,
    tint: Color? = null,
    onClick: () -> Unit,
) {
    val p = LocalXssh.current
    val haptic = LocalHapticFeedback.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        modifier
            .size(TouchMin)
            .clip(RoundedCornerShape(12.dp))
            .background(if (pressed) p.bgElev2 else Color.Transparent)
            .clickable(interactionSource = interaction, indication = null) {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onClick()
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(glyph, color = tint ?: p.textDim, fontSize = 18.sp)
    }
}

/**
 * 终端快捷键。[repeatable] 的键(方向键、退格)按住会连发 —— 在终端里改一行命令
 * 时,没有连发就得戳十几下。
 */
@Composable
fun KeyCap(
    label: String,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    repeatable: Boolean = false,
    wide: Boolean = false,
    onPress: () -> Unit,
) {
    val p = LocalXssh.current
    val haptic = LocalHapticFeedback.current
    val action by rememberUpdatedState(onPress)
    var pressed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Box(
        modifier
            .heightIn(min = TouchMin)
            .defaultMinSize(minWidth = if (wide) 72.dp else 52.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    active -> p.accentSoft
                    pressed -> p.rowSel
                    else -> p.bgElev2
                },
            )
            .border(1.dp, if (active) p.accent else p.border, RoundedCornerShape(10.dp))
            // 手势是自己写的(为了连发),点击语义得手动补上,不然读屏用户点不动。
            .semantics {
                role = Role.Button
                onClick(label = label) {
                    action()
                    true
                }
            }
            .pointerInput(repeatable) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    pressed = true
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    action()
                    val repeat = if (repeatable) {
                        scope.launch {
                            delay(380)
                            while (isActive) {
                                action()
                                delay(55)
                            }
                        }
                    } else {
                        null
                    }
                    waitForUpOrCancellation()
                    repeat?.cancel()
                    pressed = false
                }
            }
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (active) p.accent else p.text,
            fontFamily = FontFamily.Monospace,
            fontSize = 14.sp,
        )
    }
}

/**
 * 终端按键条。整排键(约 20 个 × 52dp ≈ 1100dp)哪块屏都放不下一行,只有两种正经摆法:
 * - 窄屏:一行横向滚动,常用键排在前面(换行会吃掉手机本就不多的竖向空间);
 * - 宽屏:自动折成两行全部露出来,不用滚 —— 滚动意味着要的键可能不在眼前。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KeyCapRow(modifier: Modifier = Modifier, wrap: Boolean, content: @Composable RowScope.() -> Unit) {
    val scroll = rememberScrollState()
    val pad = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp)
    if (wrap) {
        FlowRow(
            modifier.then(pad),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // FlowRowScope 也是 RowScope,内容原样复用。
            content()
        }
    } else {
        Row(
            modifier.fillMaxWidth().horizontalScroll(scroll).padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            content = content,
        )
    }
}

@Composable
fun StatusDot(color: Color) {
    Box(
        Modifier
            .defaultMinSize(minWidth = 9.dp, minHeight = 9.dp)
            .clip(CircleShape)
            .background(color),
    )
}

/** 认证方式之类的小标签。 */
@Composable
fun Chip(text: String, color: Color) {
    Box(
        Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.14f))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(text, color = color, fontSize = 11.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun SectionLabel(text: String) {
    Text(
        text = text,
        color = LocalXssh.current.textFaint,
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        modifier = Modifier.padding(start = 2.dp, bottom = 6.dp),
    )
}

@Composable
fun xsshFieldColors(): TextFieldColors {
    val p = LocalXssh.current
    return OutlinedTextFieldDefaults.colors(
        focusedBorderColor = p.accent,
        unfocusedBorderColor = p.borderStrong,
        focusedTextColor = p.text,
        unfocusedTextColor = p.text,
        cursorColor = p.accent,
        focusedLabelColor = p.accent,
        unfocusedLabelColor = p.textFaint,
        focusedContainerColor = p.bg,
        unfocusedContainerColor = p.bg,
    )
}
