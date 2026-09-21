package dev.xssh.android

import com.kyant.backdrop.shadow.Shadow
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.Backdrop
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.geometry.Offset
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.Crossfade
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.draw.shadow
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.material3.Icon
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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
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
import androidx.compose.ui.semantics.contentDescription as contentDescriptionProperty
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
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

/**
 * 栅格。整个应用只有两条竖线:
 * - [Gutter] 16dp —— 所有**盒子**(卡片、输入框、按钮、按键条)的外缘;
 * - Gutter + [BoxPad] = 32dp —— 所有**文字**的左边缘(盒子里的内容缩进 16dp,
 *   标题这类没有盒子的文字直接缩进到 32dp,于是整列文字对成一条线)。
 * 之前标题 18.2dp、卡片文字 30.2dp、搜索文字 32.0dp 各走各的,看着就是不齐。
 */
val Gutter = 16.dp
val BoxPad = 16.dp

/** 列表项之间、并排按钮之间的统一间距。 */
val GapItem = 12.dp

/** 圆角只有两档:盒子 12,小标签 8。 */
val RadiusBox = 12.dp
val RadiusChip = 8.dp

enum class ButtonKind { Primary, Ghost, Danger }

/**
 * 当前页面里"玻璃背后"的内容。每一页把自己的内容标成 `layerBackdrop(backdrop)`,
 * 再通过它提供给浮在上面的玻璃按钮。没有提供时(null),玻璃按钮退化成半透明底色。
 */
val LocalBackdrop = staticCompositionLocalOf<Backdrop?> { null }

/** 卡片:与 Windows 版 `.card` 同款(圆角 10、1px 边框、elev 背景)。 */
@Composable
fun XsshCard(
    modifier: Modifier = Modifier,
    highlight: Boolean = false,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    paddingVertical: Dp = 14.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = LocalXssh.current
    val haptic = LocalHapticFeedback.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    // 列表行,不是卡片:没有边框、没有底色,行与行之间一道细线(参考图的收件箱)。
    // 选中时整块填强调色、白字;按下时浅填充 —— 手指盖住的地方要有反馈。
    Column(
        modifier
            .clip(RoundedCornerShape(RadiusBox))
            .background(
                when {
                    highlight -> p.rowSel
                    pressed -> p.bgElev2
                    else -> Color.Transparent
                },
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
            .padding(horizontal = BoxPad, vertical = paddingVertical),
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
    val scale by animateFloatAsState(if (pressed && enabled) 0.97f else 1f, label = "btnPress")

    // iOS 的做法:主操作实心强调色;次要操作用浅填充,文字决定语义(删除就是红字),没有描边。
    val background = when (kind) {
        ButtonKind.Primary -> p.accent
        ButtonKind.Ghost, ButtonKind.Danger -> p.bgElev2
    }
    val foreground = when (kind) {
        ButtonKind.Primary -> p.onAccent
        ButtonKind.Ghost -> p.accent
        ButtonKind.Danger -> p.danger
    }
    Box(
        modifier
            .scale(scale)
            .heightIn(min = TouchMin + 2.dp)
            .clip(RoundedCornerShape(RadiusBox))
            .background(if (enabled) background else background.copy(alpha = 0.35f))
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
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
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
            .clip(RoundedCornerShape(RadiusBox))
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
    /** 主操作键(⏎):实心强调色,一眼能找到。 */
    emphasis: Boolean = false,
    /** 用图标代替文字(⏎ 用的是画出来的回车图标)。[label] 仍作为读屏文字。 */
    icon: ImageVector? = null,
    onPress: () -> Unit,
) {
    val p = LocalXssh.current
    val haptic = LocalHapticFeedback.current
    val action by rememberUpdatedState(onPress)
    var pressed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val shape = RoundedCornerShape(RadiusBox)

    // 照系统键盘:浅色是白键,深色是灰键;按下变暗一档;粘滞修饰键和回车用强调色。
    val filled = active || emphasis
    val keyBg = when {
        filled && pressed -> p.accent.copy(alpha = 0.8f)
        filled -> p.accent
        pressed -> if (p.dark) Color(0xFF545456) else Color(0xFFD1D1D6)
        else -> if (p.dark) Color(0xFF3A3A3C) else Color.White
    }
    val fg = if (filled) p.onAccent else p.text

    Box(
        modifier
            .heightIn(min = TouchMin)
            .defaultMinSize(minWidth = 48.dp)
            // 浅色白键要一道很淡的投影才从面板上"浮"起来;深色靠灰度差就够了。
            .then(if (p.dark) Modifier else Modifier.shadow(0.6.dp, shape))
            .clip(shape)
            .background(keyBg)
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
            .padding(horizontal = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(22.dp))
        } else {
            Text(
                text = label,
                color = fg,
                fontSize = 15.sp,
                fontWeight = if (filled) FontWeight.SemiBold else FontWeight.Medium,
            )
        }
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

/**
 * 把 "SHA256:<43 个 base64 字符>" 拆成 (算法名, 显示行)。
 *
 * 摘要固定切成 **11 字符一组、两组一行**。让它自由折行的话,断点随宽度和字号浮动,
 * 还会停在 `/` `+` 这类字符后面 —— 第一行只剩 `SHA256:vnOd/` 一小截,既不工整,
 * 逐字符比对时也最容易看串行。确认页和详情栏共用这一套,两处看到的分组完全一样。
 */
fun fingerprintRows(value: String): Pair<String, List<String>> {
    val algorithm = value.substringBefore(':', "")
    val digest = value.substringAfter(':', value)
    return algorithm to digest.chunked(11).chunked(2).map { it.joinToString(" ") }
}

/** 认证方式之类的小标签。 */
@Composable
fun Chip(text: String, color: Color) {
    Box(
        Modifier
            .clip(RoundedCornerShape(RadiusChip))
            .background(color.copy(alpha = 0.14f))
            .padding(horizontal = 7.dp, vertical = 2.dp),
    ) {
        Text(text, color = color, fontSize = 10.5.sp, fontWeight = FontWeight.Medium)
    }
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

/* ────────────────────────── 边缘轨道(参考折叠屏的 chrome 组织方式) ──────────────────────────

   规则只有三条,别再往界面四角散按钮:
   1. 内容通到边缘,不被任何栏夹住;标题是内容的一部分,不是"标题栏"。
   2. 所有 chrome 收进**右边缘一条竖向轨道**,浮在内容之上。
   3. 轨道里是圆形按钮,按功能分组,每组一个半透明胶囊;组与组之间留空。

   为什么是右边:这台机器展开后铰链在正中,左手托住、右手操作;轨道贴右边缘,
   拇指不用跨过折痕。合上时同样落在拇指自然弧线上。
*/

/**
 * 轨道占的宽度:胶囊 56 + 离边 16。内容要按这个让出位置。
 *
 * 离边取 16 而不是 12:胶囊右缘这样才和所有卡片、面板的右缘落在同一条 16dp 线上。
 *
 * 所有形态(外屏、内屏竖、内屏横)都是**右边缘竖排**。曾经试过窄屏贴底横排,
 * 用户明确否掉了 —— 按钮就该在右侧,换一块屏不该换一个位置。
 */
val RailWidth = 72.dp

/**
 * 列表底部要留出的高度:主机页轨道三组单钮胶囊(外观、搜索、新建:56 × 3 + 14 × 2)
 * + 离底 16 + 一条间距。留够了,最后一张卡片才能滚到轨道上方,而不是永远被它压着一角。
 */
val RailClearance = 56.dp * 3 + 14.dp * 2 + 16.dp + Gutter

/**
 * 轨道上的 Liquid Glass 圆钮(56dp,和原来"胶囊 + 圆钮"的外形尺寸完全一样,轨道位置不变)。
 *
 * 照 Apple 对 Liquid Glass 的定义逐条做(HIG「Materials」、SwiftUI「Applying Liquid Glass
 * to custom views」):
 * - **模糊背后的内容,并调整亮度**保证图标清晰(regular 变体):blur + 一层半透明亮度层;
 * - **映出周围的颜色**:vibrancy,背景透过来时饱和度提高;
 * - **边缘的光学感**:lens,玻璃边缘实时折射背后的画面(Android 13+);再加一道镜面高光;
 * - **实时响应触摸**(interactive):按下时弹性放大、按下的位置从内部亮起,松手回弹;
 * - **颜色克制**:只有主操作用染色玻璃([prominent],强调色玻璃 + 白色图标),其余是无色玻璃。
 * 只用在功能层(右侧轨道),不用在列表、详情按钮这类内容层 —— HIG 明确说别把玻璃放进内容层。
 */
@Composable
fun GlassButton(
    icon: ImageVector,
    contentDescription: String,
    tint: Color? = null,
    prominent: Boolean = false,
    onClick: () -> Unit,
) {
    val p = LocalXssh.current
    val backdrop = LocalBackdrop.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val action by rememberUpdatedState(onClick)
    // 0 = 静止,1 = 按到底。弹簧驱动:按下时略冲过头再回来,松手回弹 —— 玻璃的"液态"就在这里。
    val press = remember { Animatable(0f) }
    var touch by remember { mutableStateOf(Offset.Unspecified) }
    val shape = CircleShape

    // 亮度层:浅色偏白、深色偏暗,保证上面的图标在任何背景上都读得出;染色玻璃用强调色。
    val surface = when {
        prominent -> p.accent.copy(alpha = if (p.dark) 0.78f else 0.86f)
        p.dark -> Color(0xFF121214).copy(alpha = 0.36f)
        else -> Color.White.copy(alpha = 0.58f)
    }
    val iconColor = if (prominent) p.onAccent else (tint ?: p.text)

    val gesture = Modifier
        .size(56.dp)
        .semantics {
            role = Role.Button
            contentDescriptionProperty = contentDescription
            onClick {
                action()
                true
            }
        }
        .pointerInput(Unit) {
            detectTapGestures(
                onPress = { position ->
                    touch = position
                    scope.launch { press.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = 600f)) }
                    tryAwaitRelease()
                    scope.launch { press.animateTo(0f, spring(dampingRatio = 0.45f, stiffness = 320f)) }
                },
                onTap = {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    action()
                },
            )
        }

    val glass = if (backdrop != null) {
        gesture.drawBackdrop(
            backdrop = backdrop,
            shape = { shape },
            effects = {
                vibrancy()
                blur(4.dp.toPx())
                lens(refractionHeight = 10.dp.toPx(), refractionAmount = 20.dp.toPx(), depthEffect = true)
            },
            highlight = { Highlight.Default.copy(alpha = if (p.dark) 0.6f else 1f) },
            shadow = {
                Shadow(radius = 16.dp, color = Color.Black.copy(alpha = if (p.dark) 0.4f else 0.14f))
            },
            layerBlock = {
                val s = 1f + 0.1f * press.value
                scaleX = s
                scaleY = s
            },
            onDrawSurface = {
                drawRect(surface)
                // 按下的位置从内部亮起。
                val t = press.value
                if (t > 0.01f && touch.isSpecified) {
                    val r = size.maxDimension
                    drawCircle(
                        Brush.radialGradient(
                            listOf(Color.White.copy(alpha = (if (p.dark) 0.22f else 0.4f) * t), Color.Transparent),
                            center = touch,
                            radius = r,
                        ),
                        radius = r,
                        center = touch,
                    )
                }
            },
        )
    } else {
        // 这一页没提供背景源(或系统太老):半透明底色 + 细边,形状和交互不变。
        gesture
            .graphicsLayer {
                val s = 1f + 0.1f * press.value
                scaleX = s
                scaleY = s
            }
            .clip(shape)
            .background(surface)
            .border(0.8.dp, p.glassBorder, shape)
    }

    Box(glass, contentAlignment = Alignment.Center) {
        // 图标换了就淡入淡出地换(外观按钮每点一下都会变)。
        Crossfade(targetState = icon, animationSpec = tween(180), label = "glassIcon") { shown ->
            Icon(shown, contentDescription = null, tint = iconColor, modifier = Modifier.size(23.dp))
        }
    }
}

/**
 * 轨道本体;[content] 里放若干 [GlassButton]。调用方只传 `Modifier.align(Alignment.BottomEnd)`,
 * 离边、避让系统栏全在这里定 —— **每一屏的轨道因此落在完全相同的像素上**。
 *
 * 原来每一屏各自拼 `safeDrawingPadding().padding(bottom = …)`,拼出来不一样:
 * 主机页离底叠了两层 12dp、新建页只有一层,点 ＋ 进新建页按钮就往下跳 12dp。
 *
 * 也**不能**用 safeDrawing:它包含输入法 inset,键盘一弹轨道就被整个顶上去。
 * 按钮的位置必须固定;键盘开着时它被盖住,收起键盘它还在原处。
 */
@Composable
fun EdgeRail(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier
            .windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout))
            .padding(end = Gutter, bottom = Gutter),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}
