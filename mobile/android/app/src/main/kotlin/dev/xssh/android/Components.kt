package dev.xssh.android

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.graphics.compositeOver
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
    // 每台主机一张实底圆角卡片(深色 #161618 压在黑底上,浅色浅灰压在白底上),卡片之间留缝。
    // 试过收件箱那种通栏行 + 细线:一台主机时整屏只有两行字飘着,外屏尤其单薄,
    // 深浅两种主题下都看不出"这是一个可以点的东西"。
    // 选中时换成亮一档的中性灰;按下时再压一层浅填充 —— 手指盖住的地方要有反馈。
    val base = if (highlight) p.rowSel.compositeOver(p.cardBg) else p.cardBg
    Column(
        modifier
            .clip(RoundedCornerShape(RadiusBox))
            .background(if (pressed) p.bgElev2.compositeOver(base) else base)
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
 * 手势以便长按后**不再**触发点击(长按打开左滑按钮,松手不应该顺带连上主机)。
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

    // 主操作(连接 / 重试 / 信任)是实心蓝白字 —— 一屏只有这一块实心蓝,一眼就知道能点。
    // 试过浅蓝底 + 蓝字:深色下像一块标签,用户说"不像是可以点的按钮"。
    // (当初"蓝得很重"是选中行、回车键、＋ 也都是实心蓝;那些已经改浅,这里不受影响。)
    // 次要操作是浅灰底 + 正文色,危险操作是浅灰底 + 红字。
    val background = when (kind) {
        ButtonKind.Primary -> p.accent
        ButtonKind.Ghost, ButtonKind.Danger -> p.bgElev2
    }
    val foreground = when (kind) {
        ButtonKind.Primary -> p.onAccent
        ButtonKind.Ghost -> p.text
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
    /** 主操作键(⏎):浅蓝底 + 蓝字,一眼能找到。 */
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

    // 照系统键盘:浅色是白键,深色是灰键;按下变暗一档。
    // 粘滞修饰键和回车用浅蓝底 + 蓝字,一眼能认出来,但不是一块实心蓝。
    // 浅蓝要先叠到普通键色上变成不透明:半透明的键底会透出浅色模式下那道投影,键面发灰发脏。
    val filled = active || emphasis
    val plainKey = if (p.dark) Color(0xFF3A3A3C) else Color.White
    val keyBg = when {
        filled && pressed -> p.accent.copy(alpha = 0.34f).compositeOver(plainKey)
        filled -> p.accentSoft.compositeOver(plainKey)
        pressed -> if (p.dark) Color(0xFF545456) else Color(0xFFD1D1D6)
        else -> plainKey
    }
    val fg = if (filled) p.accent else p.text

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


/* ────────────────────────── 边缘轨道(参考折叠屏的 chrome 组织方式) ──────────────────────────

   规则只有三条,别再往界面四角散按钮:
   1. 内容通到边缘,不被任何栏夹住;标题是内容的一部分,不是"标题栏"。
   2. 所有 chrome 收进**右边缘一条竖向轨道**,浮在内容之上。
   3. 相关的按钮装进同一枚 Liquid Glass 胶囊(GlassGroup),主操作单独一颗圆(GlassButton)
      放在最下面;组与组之间留空。

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
 * 列表底部要留出的高度:主机页轨道 = 胶囊(外观、搜索:56 × 2)+ 间距 14 + 单独的 ＋(56)
 * + 离底 16 + 一条间距。留够了,最后一行才能滚到轨道上方,而不是永远被它压着一角。
 */
val RailClearance = 56.dp * 3 + 14.dp + 16.dp + Gutter

/**
 * Liquid Glass 材质本体。照 Apple 的定义(HIG「Materials」、SwiftUI「Applying Liquid Glass
 * to custom views」)逐条做:
 * - 模糊背后的内容,并叠一层亮度层保证上面的图标清晰(regular 变体);
 * - vibrancy:透过来的颜色更饱和("映出周围的颜色");
 * - lens:边缘实时折射背后的画面(Android 13+),加镜面高光和阴影;
 * - 颜色克制:玻璃一律无色,图标用正文色,只有危险操作(✕)的图标是红色
 *   (参考图里"写邮件""+"都是无色玻璃、黑色图标)。
 *   试过给主操作用强调色染色的玻璃:内屏双栏同一屏上选中行、「连接」按钮、＋ 三块实心蓝抢注意力。
 * [press] 0..1 驱动整块玻璃的弹性缩放;[glow] 在亮度层上画按压时"从内部亮起"的光。
 */
@Composable
private fun Modifier.liquidGlass(
    shape: Shape,
    press: () -> Float,
    glow: (DrawScope.() -> Unit)? = null,
): Modifier {
    val p = LocalXssh.current
    val backdrop = LocalBackdrop.current
    val surface = p.glassTint
    return if (backdrop != null) {
        drawBackdrop(
            backdrop = backdrop,
            shape = { shape },
            effects = {
                vibrancy()
                blur(4.dp.toPx())
                lens(refractionHeight = 10.dp.toPx(), refractionAmount = 20.dp.toPx(), depthEffect = true)
            },
            highlight = { Highlight.Default.copy(alpha = if (p.dark) 0.6f else 1f) },
            shadow = { Shadow(radius = 16.dp, color = p.glassShadow) },
            layerBlock = {
                val s = 1f + 0.08f * press()
                scaleX = s
                scaleY = s
            },
            onDrawSurface = {
                drawRect(surface)
                glow?.invoke(this)
            },
        )
    } else {
        // 没有背景源(顶栏里的按钮,或系统太老):浅填充 + 细边,形状和交互不变。
        // 不用 glassTint:那是叠在模糊背景上的亮度层,单独放在纯色底上几乎看不见。
        graphicsLayer {
            val s = 1f + 0.08f * press()
            scaleX = s
            scaleY = s
        }
            .clip(shape)
            .background(p.bgElev2)
            .border(0.8.dp, p.glassBorder, shape)
    }
}

/** 按压状态:弹簧驱动的 0..1,外加按下的位置(光从那里亮起来)。 */
private class Press(val amount: Animatable<Float, *>) {
    var at by mutableStateOf(Offset.Unspecified)
}

@Composable
private fun rememberPress() = remember { Press(Animatable(0f)) }

/** 点击手势 + 按压动画 + 读屏语义,单独圆钮和胶囊里的按钮共用。 */
@Composable
private fun Modifier.glassTap(press: Press, contentDescription: String, onClick: () -> Unit): Modifier {
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val action by rememberUpdatedState(onClick)
    return semantics {
        role = Role.Button
        contentDescriptionProperty = contentDescription
        onClick {
            action()
            true
        }
    }.pointerInput(Unit) {
        detectTapGestures(
            onPress = { position ->
                press.at = position
                // 按下时略冲过头再回来,松手回弹 —— 玻璃的"液态"就在这里。
                scope.launch { press.amount.animateTo(1f, spring(dampingRatio = 0.55f, stiffness = 600f)) }
                tryAwaitRelease()
                scope.launch { press.amount.animateTo(0f, spring(dampingRatio = 0.45f, stiffness = 320f)) }
            },
            onTap = {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                action()
            },
        )
    }
}

/** 按下的位置"从内部亮起"。 */
private fun DrawScope.pressGlow(press: Press, dark: Boolean) {
    val t = press.amount.value
    if (t <= 0.01f || !press.at.isSpecified) return
    val r = size.maxDimension
    drawCircle(
        Brush.radialGradient(
            listOf(Color.White.copy(alpha = (if (dark) 0.22f else 0.4f) * t), Color.Transparent),
            center = press.at,
            radius = r,
        ),
        radius = r,
        center = press.at,
    )
}

/**
 * 单独一颗 Liquid Glass 圆钮(56dp)。每页的主操作(＋ / ✓)和危险操作(✕,红色图标)
 * 用它,放在轨道最下面 —— 参考图里"写邮件""+"都是这样单独一颗无色玻璃。
 */
@Composable
fun GlassButton(
    icon: ImageVector,
    contentDescription: String,
    tint: Color? = null,
    onClick: () -> Unit,
) {
    val p = LocalXssh.current
    val press = rememberPress()
    val size = LocalGlassSize.current
    Box(
        Modifier
            .size(size)
            .glassTap(press, contentDescription, onClick)
            .liquidGlass(CircleShape, { press.amount.value }) { pressGlow(press, p.dark) },
        contentAlignment = Alignment.Center,
    ) {
        Crossfade(targetState = icon, animationSpec = tween(180), label = "glassIcon") { shown ->
            Icon(
                shown,
                contentDescription = null,
                tint = tint ?: p.text,
                modifier = Modifier.size(glassIconSize(size)),
            )
        }
    }
}

/**
 * 一枚 Liquid Glass 胶囊,把**相关的**几个按钮装在一起(参考图:日历 / 收件箱 / 搜索同在一枚胶囊)。
 * 原来每个按钮各自一颗圆,竖着排成一串珠子,看不出哪些是一组。
 *
 * 胶囊里每个按钮占 56dp,和单独圆钮等高 —— 所以胶囊最下面那个按钮和"单独一颗圆"落在同一个位置,
 * 换页时按钮不会跳。胶囊从底部往上长:新加的按钮(比如翻历史时才出现的"回到底部")加在上面。
 */
@Composable
fun GlassGroup(content: @Composable () -> Unit) {
    val size = LocalGlassSize.current
    val shape = RoundedCornerShape(size / 2)
    // 组内按钮按下时的光要被胶囊的圆头裁住。
    if (LocalGlassRow.current) {
        // 顶栏里横着排。
        Row(
            Modifier.height(size).liquidGlass(shape, press = { 0f }).clip(shape),
            verticalAlignment = Alignment.CenterVertically,
        ) { content() }
    } else {
        Column(
            Modifier.width(size).liquidGlass(shape, press = { 0f }).clip(shape),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) { content() }
    }
}

/** 胶囊里的一个按钮:按下时图标弹一下、按下的位置亮起。 */
@Composable
fun GlassItem(icon: ImageVector, contentDescription: String, onClick: () -> Unit) {
    val p = LocalXssh.current
    val press = rememberPress()
    val size = LocalGlassSize.current
    Box(
        Modifier
            .size(size)
            .glassTap(press, contentDescription, onClick)
            .drawBehind { pressGlow(press, p.dark) },
        contentAlignment = Alignment.Center,
    ) {
        Crossfade(targetState = icon, animationSpec = tween(180), label = "glassItemIcon") { shown ->
            Icon(
                shown,
                contentDescription = null,
                tint = p.text,
                modifier = Modifier
                    .size(glassIconSize(size))
                    .graphicsLayer {
                        val s = 1f + 0.16f * press.amount.value
                        scaleX = s
                        scaleY = s
                    },
            )
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
/** 玻璃按钮的直径:轨道里 56dp,顶栏里 44dp(由 [TopBar] 提供)。 */
val LocalGlassSize = compositionLocalOf { 56.dp }

/** 胶囊横着排(顶栏)还是竖着排(轨道)。 */
val LocalGlassRow = compositionLocalOf { false }

private fun glassIconSize(button: Dp): Dp = if (button < 56.dp) 21.dp else 23.dp

/** 顶栏高度(不含状态栏)。 */
val TopBarHeight = 56.dp

/** 直板机的列表底部留白:只有右下角一颗 ＋,不像轨道那样一整列。 */
val FabClearance = 56.dp + 16.dp + Gutter

/**
 * 直板机的顶栏(见 [Chrome.TopBar]):左边是返回之类,右边是这一页的操作。
 * 铺一层页面底色,内容从它底下滚过去;按钮是同一套玻璃按钮,只是小一号、横着排。
 */
@Composable
fun TopBar(
    modifier: Modifier = Modifier,
    /** 铺页面底色、内容从底下滚过(竖屏);false 时只是浮在右上角的一排按钮(横屏双栏,省高度)。 */
    solid: Boolean = true,
    start: @Composable RowScope.() -> Unit = {},
    end: @Composable RowScope.() -> Unit = {},
) {
    val p = LocalXssh.current
    CompositionLocalProvider(
        LocalGlassSize provides 44.dp,
        LocalGlassRow provides true,
        // 顶栏底下是纯色,没有可以折射的内容。
        LocalBackdrop provides null,
    ) {
        Row(
            modifier
                .fillMaxWidth()
                // 铺了底色的顶栏要把触摸"吃掉":它盖在列表 / 表单上面,不拦的话点顶栏的空白处
                // 会点到压在底下看不见的卡片或输入框。
                .then(if (solid) Modifier.background(p.bg).pointerInput(Unit) { detectTapGestures() } else Modifier)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
                .height(TopBarHeight)
                .padding(horizontal = Gutter),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            start()
            Spacer(Modifier.weight(1f))
            end()
        }
    }
}

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
