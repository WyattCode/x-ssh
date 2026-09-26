package dev.xssh.android

import androidx.compose.animation.AnimatedVisibility
import android.os.Build
import android.hardware.display.DisplayManager
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.layout.layout
import androidx.compose.foundation.layout.imeAnimationTarget
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.Density
import androidx.compose.foundation.layout.ime
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
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.hoverable
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.pointerHoverIcon
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
import androidx.compose.foundation.layout.offset
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
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
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
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.ui.layout.onSizeChanged

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

/* ── 版心(整个应用就这一套,别在页面里另写) ─────────────────────────────
 *
 *   盒子线    离屏幕边 [Gutter] = 16dp:卡片、分组块、按钮、输入框的左右边缘,**每一页一样长**。
 *   标题线    离屏幕边 28dp([TitlePad]):页面大标题和分组小标题。比盒子里的文字再往左 4dp ——
 *             大号字左侧自带一点空白,按盒子内缘摆看着偏右。
 *   盒内文字  离屏幕边 32dp(盒子线 + [BoxPad]):行标签、取值。
 *
 * 宽屏:内容整体限宽 [PageMaxWidth],不让一行横跨过去;内屏横屏另有折痕镜像的规矩(见主机页)。
 */

/** 分组小标题相对盒子线的缩进(比盒内文字少 4dp,见上面的版心说明)。 */
val TitlePad = BoxPad - 4.dp

/**
 * **页面大标题**再往左挪的那一点(视觉补偿,不动它下面的小字)。
 *
 * 字号越大,字形左边自带的空白越宽(28~34sp 的大标题比 12sp 的小标题明显多一截),
 * 按同一条线摆出来,大标题看着就是比下面的小标题往右缩了一点。往左补 2dp,视觉上才真的对齐。
 * 用 `Modifier.offset(x = -TitleOptical)` 加在**大标题那一行文字**上,不要改整块的 padding ——
 * 副标题、搜索框、下面的卡片仍旧站在各自的版心线上。
 */
val TitleOptical = 2.dp

/** 一页内容的最大宽度:超过这个宽度就居左留白,所有页面同一个数。 */
val PageMaxWidth = 560.dp

/**
 * 两栏页面里,**左栏靠折痕那一侧**该留多宽 —— 让两栏的内容一样长。
 *
 * 右栏的右边要让开轨道([railSide]),左栏不用,于是左栏一路铺到折痕前 32dp、右栏却短一条轨道:
 * 一边长一边短。分栏线钉在折痕上(`listPaneWidth`)动不了,所以反过来算:**右栏能放多宽,
 * 左栏就收到多宽**,差值全堆在折痕那一侧(折痕本来就不该压内容)。
 *
 * 主机页和编辑页都用这一个式子 —— 否则两页的分栏看着不是一套。
 *
 * @param listWidth 左栏的宽度(含它自己的左边距)
 * @param leadInset 左栏左边已经占掉的宽度(安全区 + 盒子线)
 * @param detailContent 右栏内容实际有多宽
 */
fun creaseGapFor(listWidth: Dp, leadInset: Dp, detailContent: Dp): Dp =
    (listWidth - leadInset - detailContent)
        .coerceAtLeast(Gutter * 2)
        .coerceAtMost(maxOf(Gutter * 2, listWidth / 2))

/**
 * 内容右边要让开的宽度。
 *
 * 折叠屏的轨道悬浮在右下角,内容铺到边缘的话,那一段里右对齐的取值(「22」「未确认」「2.4K」)
 * 会被玻璃切掉一半 —— 用户要的是"不被挡住"优先,所以**除了终端**,每一页右边都让开一整条轨道
 * (56 + 两条 16 = 88dp)。终端是满屏画面,字从玻璃底下过没关系,不让。
 * 直板机 / 平板的按钮不在右边缘竖着排,就只用盒子线。
 */
@Composable
fun railSide(): Dp = if (LocalChrome.current == Chrome.Rail) Gutter * 2 + 56.dp else Gutter

/**
 * **钉在页面底部的操作条**:正文从它底下滚过去,上缘用一段 28dp 的渐变化开(不画硬线)。
 *
 * 手是握在屏幕下半截的,主操作就该在那儿。放在标题底下的话,内屏竖屏 2364px 高、
 * 展开横屏 600dp 高,按钮都落在上三分之一 —— 要么换手,要么把手机往下捋一截。
 * 页面再长也不用往回滚去够按钮:它根本不跟着滚。
 *
 * 右边默认让开轨道([railSide]),别压在 ‹ 和外观那一列玻璃底下。
 * [onHeight] 把量到的高度回给调用方,正文按它加底部留白,滚到底时最后一行正好停在条的上沿。
 */
@Composable
fun BoxScope.PinnedActions(
    onHeight: (Dp) -> Unit,
    modifier: Modifier = Modifier,
    start: Dp = Gutter,
    end: Dp = railSide(),
    bottom: Dp = Gutter,
    /** 页面自己的底色 —— 条子要和它一个颜色,否则渐变尽头会露出一条色带(分组页用 groupedBg)。 */
    background: Color = LocalXssh.current.bg,
    content: @Composable ColumnScope.() -> Unit,
) {
    val density = LocalDensity.current
    Column(
        modifier
            .align(Alignment.BottomStart)
            .onSizeChanged { onHeight(with(density) { it.height.toDp() }) },
    ) {
        Spacer(
            Modifier
                .fillMaxWidth()
                .height(28.dp)
                .background(Brush.verticalGradient(listOf(Color.Transparent, background))),
        )
        Column(
            Modifier
                .fillMaxWidth()
                .background(background)
                .padding(start = start, end = end, bottom = bottom),
            content = content,
        )
    }
}

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
    // 平板接鼠标 / 触控板时的悬停态(小米:光标指向要有明确的悬停表现)。手指操作不会触发。
    val hovered by interaction.collectIsHoveredAsState()
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
            .then(if (hovered && enabled) Modifier.background(p.text.copy(alpha = 0.06f)) else Modifier)
            .hoverable(interaction, enabled)
            .pointerHoverIcon(PointerIcon.Hand)
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
 * 轨道占的宽度:胶囊 56 + 离边 16。
 *
 * 轨道是**悬浮**的:页面内容一律铺满到右边缘,从玻璃按钮底下穿过去(用户要最宽的内容)。
 * 只有和轨道并排、同一条底边的东西(终端快捷键面板)才按这个宽度让位;
 * 可滚动的页面在底部留出 [RailClearance],最后一行能滚到按钮上面。
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
        // 没有背景源(终端底栏里的按钮,或系统太老):浅填充 + 细边,形状和交互不变。
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
 * 开关。关着时和分段选择器同一套图形语言(灰底轨道 + 亮一档的滑块);
 * 打开时**轨道**换成强调色 —— 一眼能看出它是"开着的",而不是靠滑块位置去猜。
 */
@Composable
fun XsshSwitch(checked: Boolean, onChange: (Boolean) -> Unit) {
    val p = LocalXssh.current
    val haptic = LocalHapticFeedback.current
    // 轨道 52×32、滑块 28,两边留 2 —— 和 Material 的比例一致。
    val knob by animateFloatAsState(if (checked) 20f else 0f, label = "switchKnob")
    Box(
        Modifier
            .size(52.dp, 32.dp)
            .clip(CircleShape)
            .background(if (checked) p.accent else p.bgElev2)
            // 自绘控件要自己给语义:读屏软件靠它念出"开 / 关"和"开关"这个角色,
            // uiautomator 也靠它报状态(否则自动化里看不到这个开关到底开没开)。
            .semantics {
                role = Role.Switch
                this.toggleableState = if (checked) ToggleableState.On else ToggleableState.Off
                onClick { onChange(!checked); true }
            }
            .clickable(role = Role.Switch) {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onChange(!checked)
            },
    ) {
        Box(
            Modifier
                .align(Alignment.CenterStart)
                .offset(x = 2.dp + knob.dp)
                .size(28.dp)
                .clip(CircleShape)
                // 打开时轨道是强调色,滑块**一律白色** —— 深色下沿用分段选择器那块灰滑块的话,
                // 就是蓝底上一坨灰,糊成一团看不出滑块在哪。关着时才跟分段选择器一致。
                .background(
                    when {
                        checked -> Color.White
                        p.dark -> Color(0xFF636366)
                        else -> Color.White
                    },
                ),
        )
    }
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
        // 底栏 / 工具栏里横着排。
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

/**
 * 外观(跟随系统 → 浅色 → 深色)。**每一页的轨道 / 底栏里都有它** ——
 * 用户在终端里看着输出想换个深浅色,不该先退回主机页。
 */
@Composable
fun ThemeGlassItem() {
    val theme = LocalThemeControl.current
    GlassItem(theme.mode.icon, "外观:${theme.mode.label}") { theme.onChange(theme.mode.next()) }
}

/**
 * 会来会去的按钮(「回到底部」、连上才有的「文件」)统一的出现 / 消失动效。
 * 竖轨道里往上长,底栏(横着排)里往右长 —— 按 [LocalGlassRow] 自己选,调用方不用管。
 */
@Composable
fun GlassReveal(visible: Boolean, content: @Composable () -> Unit) {
    val row = LocalGlassRow.current
    AnimatedVisibility(
        visible,
        enter = if (row) Motion.chipInRow else Motion.chipIn,
        exit = if (row) Motion.chipOutRow else Motion.chipOut,
    ) { content() }
}

/** 横着的工具栏(平板、直板机底栏)上同样的东西。 */
@Composable
fun GlassRevealRow(visible: Boolean, content: @Composable () -> Unit) {
    AnimatedVisibility(visible, enter = Motion.chipInRow, exit = Motion.chipOutRow) { content() }
}

/** 胶囊里的一个按钮:按下时图标弹一下、按下的位置亮起。 */
@Composable
fun GlassItem(icon: ImageVector, contentDescription: String, tint: Color? = null, onClick: () -> Unit) {
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
                tint = tint ?: p.text,
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

/** 玻璃按钮的直径:轨道和底栏里 56dp,终端底栏 / 平板工具栏里小一号(调用方提供)。 */
val LocalGlassSize = compositionLocalOf { 56.dp }

/** 胶囊横着排(底栏、工具栏)还是竖着排(轨道)。 */
val LocalGlassRow = compositionLocalOf { false }

private fun glassIconSize(button: Dp): Dp = if (button < 56.dp) 21.dp else 23.dp

/**
 * 直板机底栏占掉的高度:按钮 56 + 离底 16 + 上面再空一条 16。
 * 可滚动的页面底部留这么多,最后一行能滚到底栏上面;钉在页底的大按钮([PinnedActions])
 * 也垫这么高,叠在底栏上面而不是被它压住。
 */
val BarClearance = 56.dp + Gutter * 2

/**
 * 直板机的底栏(见 [Chrome.BottomBar]):**左边**是返回 / 次要操作,**右边**是这一页的主操作 ——
 * 安卓底部操作栏的惯例(Material 的 bottom app bar:动作在左、主按钮在右)。
 *
 * 和折叠屏的 [EdgeRail] 是同一套东西横过来:同样的玻璃按钮、同样悬浮在内容上(内容从底下滚过)、
 * 同样**跟着键盘升起来**(用含输入法的 [stableSafeDrawing])。中间空着的那一段不拦触摸,
 * 点得到压在底下的卡片。
 *
 * **返回永远在左下角**。连点返回一路退回去时,下一下落在的地方必须无害:终端页左下角是空的
 * (按钮靠右),主机页左下角是外观胶囊 —— 都不会断开会话(见 Files 页轨道那条实测的教训)。
 */
@Composable
fun BottomBar(
    modifier: Modifier = Modifier,
    /**
     * 要避让的系统区域。整页宽的底栏两边都让;只铺在左栏底下的(横屏双栏)右边挨着的是折痕 / 右栏,
     * 不是屏幕边缘,传 `Start + Bottom`,否则屏幕右边的挖孔会把它的右端莫名其妙往里推。
     */
    sides: WindowInsetsSides = WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom,
    /**
     * 自己避让系统区域。终端页把底栏放进一个已经避让过的 Column 里(它占自己的一行,不浮在终端上),
     * 那里传 false,否则导航条的高度会算两遍。按钮大小、离底、间距不变 —— 换页时按钮落在同一个位置。
     */
    insets: Boolean = true,
    start: @Composable RowScope.() -> Unit = {},
    end: @Composable RowScope.() -> Unit = {},
) {
    CompositionLocalProvider(LocalGlassRow provides true) {
        Row(
            modifier
                .fillMaxWidth()
                .then(if (insets) Modifier.windowInsetsPadding(stableSafeDrawing().only(sides)) else Modifier)
                .padding(start = Gutter, end = Gutter, bottom = Gutter),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(GapItem),
        ) {
            start()
            Spacer(Modifier.weight(1f))
            end()
        }
    }
}

/**
 * 右侧边缘的按钮轨道(折叠屏);[content] 里放若干 [GlassButton]。调用方只传
 * `Modifier.align(Alignment.BottomEnd)`,离边、避让系统栏全在这里定 ——
 * **每一屏的轨道因此落在完全相同的像素上**(原来每屏各自拼 padding,换页时按钮会跳 12dp)。
 *
 * 轨道**跟着界面走**:键盘弹出来,它和内容一起升到键盘上面(用户要求按钮跟随界面变化,
 * 不要钉在原处被键盘盖住)。左右边距取 [stableSafeDrawing],键盘弹起时不会横向跳。
 */
@Composable
fun EdgeRail(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val insets = stableSafeDrawing()
    val camera = rememberCornerCamera()
    val gap = with(LocalDensity.current) { 8.dp.roundToPx() }
    Column(
        modifier
            .windowInsetsPadding(insets.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom))
            .padding(end = Gutter, bottom = Gutter)
            // 摄像头挖孔落在右下角(小米 Fold 内屏倒着拿横屏)时,整条轨道往上让开,
            // 底边停在挖孔上方 8dp。键盘弹起来盖住了那一角就不用让。
            // 在布局阶段算,键盘动画的每一帧只重新摆放,不重组。
            .layout { measurable, constraints ->
                val placeable = measurable.measure(constraints)
                val rest = insets.getBottom(this) + Gutter.roundToPx()
                val lift = if (camera > 0) (camera + gap - rest).coerceAtLeast(0) else 0
                layout(placeable.width, placeable.height) { placeable.place(0, -lift) }
            },
        verticalArrangement = Arrangement.spacedBy(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

/**
 * 页面要避开的系统区域:状态栏、导航栏、输入法 —— **不含挖孔**。
 *
 * 小米 Fold 内屏横屏实测:平时系统报的挖孔 inset 是 0,一请求键盘就报成 140px,
 * 动画结束又变回 0(倒着拿时在右边,正着拿时在左边)。照单全收的话,整页内容和右侧按钮
 * 跟着键盘先横着挤一下、再弹回去,就是用户看到的"卡一下、跳一下"。
 * 挖孔在所有形态下都落在状态栏里或某个角上:角上的那个只会碰到右下角的轨道,
 * 由 [EdgeRail] 按屏幕真实的挖孔位置单独避让([rememberCornerCamera])。
 */
@Composable
fun stableSafeDrawing(): WindowInsets {
    val bars = WindowInsets.systemBars
    val ime = WindowInsets.ime
    return remember(bars, ime) { bars.union(ime) }
}

/**
 * 摄像头挖孔如果落在屏幕右下角(轨道所在的角),返回轨道底边至少要离屏幕底边多少像素;否则 0。
 *
 * 取的是**屏幕**的挖孔(`Display.getCutout()`,随当前旋转方向),不看窗口 inset —— 后者在 MIUI 上
 * 会随键盘忽有忽无。倒着拿横屏不会触发配置变更(宽高没变),所以另外监听屏幕旋转。
 */
@Composable
fun rememberCornerCamera(): Int {
    val view = LocalView.current
    val context = LocalContext.current
    var rotation by remember { mutableStateOf(view.display?.rotation ?: 0) }
    DisposableEffect(context) {
        val manager = context.getSystemService(DisplayManager::class.java)
        val listener = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) {}
            override fun onDisplayRemoved(displayId: Int) {}
            override fun onDisplayChanged(displayId: Int) {
                view.display?.let { if (it.displayId == displayId) rotation = it.rotation }
            }
        }
        manager?.registerDisplayListener(listener, null)
        onDispose { manager?.unregisterDisplayListener(listener) }
    }
    val size = LocalWindowInfo.current.containerSize
    return remember(rotation, size) {
        // Display.getCutout() 是 Android 10 才有的;更老的系统上不避让。
        val rects = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            view.display?.cutout?.boundingRects.orEmpty()
        } else {
            emptyList()
        }
        val railZone = size.width * 0.8f
        rects
            .filter { it.left > railZone && it.top > size.height / 2 }
            .maxOfOrNull { size.height - it.top } ?: 0
    }
}
