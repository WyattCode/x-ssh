package dev.xssh.android

import android.view.KeyEvent as AndroidKeyEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

/* ─────────────────────────────── 连接前的那一屏 ───────────────────────────────

   终端连上之前的三种状态:确认主机身份(首次连接 / 密钥变了)、正在连接、连接失败。
   原来是屏幕正中一行字加两颗按钮,没有层次。现在三种状态共用一套版式,按设备分三种摆法:

   - **平板**:右栏里居中一张浮起的卡片(iPad 的 form sheet),侧边栏照常可用;回车 = 主操作,Esc = 返回。
     密钥变了时回车**不**做任何事 —— 这个决定必须用手点,不能被顺手一敲回车带过去。
   - **折叠屏**:内屏横着关于折痕分两栏(左:这是哪台主机、出了什么事;右:指纹和操作),外屏单栏;‹ 在右侧轨道。
   - **直板机**:单栏,‹ 在底栏左边,「确认 / 取消」叠在底栏上面。

   版式:图标块(盾牌 / 警告 / 终端)→ 大标题 → 主机名与地址 → 内容卡片(指纹分组大字 / 失败原因)→ 按钮(同主机详情页)。
*/

/** 门页的一个状态要摆的东西。 */
private class GateContent(
    val icon: ImageVector,
    val tint: Color,
    val tile: Color,
    val title: String,
    /** 标题下面、主机那一行之后的一句话(只在需要注意时有)。 */
    val note: String? = null,
    val noteColor: Color = Color.Unspecified,
    /** 回车 / 主按钮;null = 回车不做事(密钥变了)。 */
    val onEnter: (() -> Unit)?,
    val body: @Composable ColumnScope.() -> Unit,
    val actions: @Composable (stacked: Boolean) -> Unit,
)

/** 首次连接 / 密钥变了:让用户比对指纹,决定信不信。 */
@Composable
fun HostKeyGate(
    host: Host,
    fingerprint: String,
    changed: Boolean,
    tablet: Boolean,
    /** 不为空时:[host] 是经它去连的跳板机,这一页确认的是跳板机的密钥。 */
    jumpFor: Host? = null,
    onTrust: () -> Unit,
    onExit: () -> Unit,
) {
    val p = LocalXssh.current
    // Enter and the primary button both trust. A double Enter (or Enter + tap)
    // used to fire onTrust twice and kick two overlapping reconnects.

    var trusted by remember { mutableStateOf(false) }
    fun trustOnce() {
        if (trusted) return
        trusted = true
        onTrust()
    }
    val content = GateContent(
        icon = if (changed) XIcons.Alert else XIcons.Shield,
        tint = if (changed) p.danger else p.accent,
        tile = if (changed) p.danger.copy(alpha = 0.12f) else p.accentSoft,
        title = when {
            jumpFor != null && changed -> stringResource(R.string.host_gate_jump_key_changed)
            jumpFor != null -> stringResource(R.string.host_gate_verify_jump)
            changed -> stringResource(R.string.host_gate_key_changed)
            else -> stringResource(R.string.host_gate_verify_host)
        },
        note = when {
            changed -> stringResource(R.string.host_gate_changed_note)
            // 用户点的是另一台,这里冒出一个不同的名字会一愣:说一句它是谁的跳板机。
            jumpFor != null -> stringResource(R.string.host_gate_jump_note, jumpFor.label)
            else -> null
        },
        noteColor = if (changed) p.danger else p.textDim,
        onEnter = if (changed) null else ({ trustOnce() }),
        body = {
            if (changed) {
                // 可能已信任多把:全部列出来,方便对照"是不是轮换还是中间人"。
                host.trustedHostKeys().forEachIndexed { index, fp ->
                    if (index > 0) Spacer(Modifier.height(GapItem))
                    FingerprintCard(
                        if (host.trustedHostKeys().size == 1) stringResource(R.string.host_gate_last_recorded)
                        else stringResource(R.string.host_gate_last_recorded) + " (${index + 1})",
                        fp,
                        p.textDim,
                        artTint = p.textDim,
                    )
                }
                Spacer(Modifier.height(GapItem))
                FingerprintCard(stringResource(R.string.host_gate_received_now), fingerprint, p.danger, artTint = Color(0xFFFF8C80))
            } else {
                FingerprintCard(stringResource(R.string.host_gate_server_fingerprint), fingerprint, p.text)
            }
        },
        actions = { stacked ->
            GateButtons(
                stacked = stacked,
                primary = stringResource(
                    if (changed) R.string.host_gate_trust_new_key else R.string.host_gate_trust_and_connect,
                ),
                primaryKind = if (changed) ButtonKind.Danger else ButtonKind.Primary,
                onPrimary = { trustOnce() },
                secondary = stringResource(R.string.host_cancel),
                onSecondary = onExit,
            )
        },
    )
    GatePage(host, content, tablet, onExit)
}

/** 正在连接 / 连接失败。[failure] 为 null 时是连接中,[waited] 是已经等了几秒。 */
@Composable
fun ConnectGate(
    host: Host,
    failure: String?,
    waited: Int,
    tablet: Boolean,
    retry: (() -> Unit)?,
    /** 能就地修的问题(没存密码、没导入私钥、口令不对):主按钮换成它。 */
    fix: Pair<String, () -> Unit>?,
    onExit: () -> Unit,
    /** 失败原文(应用自己的错误才有):收在卡片里的「详情」下面,默认不展开。 */
    detail: String? = null,
) {
    val p = LocalXssh.current
    // Retry / fix both reconnect: remember must be unconditional (Compose).
    // Keyed on failure so a fresh error gets a fresh one-shot.
    // 失败页上回车、主按钮、重试按钮指向同一个动作:一次失败只允许触发一次,
    // 否则连点两下(或回车 + 点按钮)会同时发起两次重连。以 failure 为 key,
    // 下一次新的失败会重新给一次机会。
    var acted by remember(failure) { mutableStateOf(false) }
    fun actOnce(block: () -> Unit) {
        if (acted) return
        acted = true
        block()
    }
    val content = if (failure == null) {
        GateContent(
            icon = XIcons.Terminal,
            tint = p.text,
            tile = p.bgElev2,
            // 标题写状态,不写主机名:三种状态(确认身份 / 正在连接 / 连接失败)的行数、落点
            // 完全一样,连不上时只换图标、标题字和卡片内容,整页不会跳一行。
            title = stringResource(R.string.host_gate_connecting),
            onEnter = null,
            body = { StatusCard(waited) },
            actions = { stacked ->
                GateButtons(
                    stacked,
                    primary = null,
                    onPrimary = {},
                    secondary = stringResource(R.string.host_cancel),
                    onSecondary = onExit,
                )
            },
        )
    } else {
        val retryLabel = stringResource(R.string.host_gate_retry)
        val primary = fix ?: retry?.let { retryLabel to it }
        GateContent(
            icon = XIcons.Alert,
            tint = p.danger,
            tile = p.danger.copy(alpha = 0.12f),
            title = stringResource(R.string.host_gate_failed),
            onEnter = primary?.second?.let { run -> { actOnce(run) } },
            body = { MessageCard(failure, detail) },
            actions = { stacked ->
                GateButtons(
                    stacked = stacked,
                    primary = primary?.first,
                    onPrimary = { primary?.second?.let { actOnce(it) } },
                    // 有「填写密码」这类修复时,重试退到第二颗(填完再连就是重试)。
                    secondary = stringResource(R.string.host_back),
                    onSecondary = onExit,
                    tertiary = if (fix != null && retry != null) retryLabel to ({ actOnce(retry) }) else null,
                )
            },
        )
    }
    GatePage(host, content, tablet, onExit)
}

/** 按设备摆放:平板卡片、折叠屏内屏双栏、其余单栏;附带 ‹ 与键盘。 */
@Composable
private fun GatePage(host: Host, content: GateContent, tablet: Boolean, onExit: () -> Unit) {
    val p = LocalXssh.current
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    val keys = Modifier
        .focusRequester(focus)
        .focusable()
        .onKeyEvent { event ->
            val e = event.nativeKeyEvent
            if (e.action != AndroidKeyEvent.ACTION_DOWN) return@onKeyEvent false
            when (e.keyCode) {
                AndroidKeyEvent.KEYCODE_ENTER, AndroidKeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    content.onEnter?.invoke() ?: return@onKeyEvent false
                    true
                }
                AndroidKeyEvent.KEYCODE_ESCAPE -> {
                    onExit()
                    true
                }
                else -> false
            }
        }

    if (tablet) {
        // 平板右栏:居中一张浮起的卡片。
        BoxWithConstraints(Modifier.fillMaxSize().background(p.groupedBg).then(keys), contentAlignment = Alignment.Center) {
            Column(
                Modifier
                    .padding(24.dp)
                    .widthIn(max = 520.dp)
                    .fillMaxWidth()
                    .shadow(24.dp, RoundedCornerShape(22.dp), ambientColor = p.glassShadow, spotColor = p.glassShadow)
                    .clip(RoundedCornerShape(22.dp))
                    .background(if (p.dark) p.bgElev else p.bg)
                    .border(0.5.dp, p.glassBorder, RoundedCornerShape(22.dp))
                    .verticalScroll(rememberScrollState())
                    .padding(28.dp),
            ) {
                Identity(host, content)
                Spacer(Modifier.height(24.dp))
                content.body(this)
                Spacer(Modifier.height(28.dp))
                content.actions(false)
            }
        }
        return
    }

    val adaptive = LocalAdaptive.current
    val bottomBar = LocalChrome.current == Chrome.BottomBar
    val backdrop = rememberLayerBackdrop()
    val insets = stableSafeDrawing()
    val startInset = insets.asPaddingValues().calculateStartPadding(LocalLayoutDirection.current)
    BoxWithConstraints(Modifier.fillMaxSize().background(p.groupedBg).then(keys)) {
        val twoPane = adaptive.splits(maxWidth)
        if (twoPane) {
            val left = adaptive.listPaneWidth(maxWidth).coerceAtMost(maxWidth - 280.dp)
            val creaseWidth = maxOf(1.dp, adaptive.bookFold?.sizeDp ?: 0.dp)
            // 和主机页、编辑页同一条规矩:右栏让开了轨道,左栏就收到同样宽(见 creaseGapFor)。
            val rightContent = ((maxWidth - left - creaseWidth) - Gutter * 2 - railSide())
                .coerceAtMost(PageMaxWidth)
            val leftEnd = creaseGapFor(left, startInset + Gutter, rightContent)
            Row(
                Modifier
                    .fillMaxSize()
                    .layerBackdrop(backdrop)
                    .background(p.groupedBg)
                    .windowInsetsPadding(insets.only(WindowInsetsSides.Vertical)),
            ) {
                // 左栏止于折痕前 32dp,右栏从折痕后 32dp 起(同主机页、编辑页)。
                Column(
                    Modifier
                        .width(left)
                        .fillMaxHeight()
                        .padding(start = startInset + Gutter, end = leftEnd, top = Gutter),
                ) {
                    Identity(host, content)
                }
                Spacer(Modifier.width(creaseWidth))
                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .bounce()
                        .verticalScroll(rememberScrollState())
                        .padding(
                            start = Gutter * 2,
                            end = railSide(),
                            top = Gutter,
                            bottom = if (bottomBar) BarClearance else RailClearance,
                        ),
                ) {
                    Column(Modifier.widthIn(max = PageMaxWidth)) {
                        content.body(this)
                        Spacer(Modifier.height(24.dp))
                        content.actions(true)
                    }
                }
            }
        } else {
            // 「确认 / 取消」也钉在页底(同主机详情页):这是要按的东西,指纹是要看的东西。
            var actionsHeight by remember { mutableStateOf(0.dp) }
            Column(
                Modifier
                    .fillMaxSize()
                    .layerBackdrop(backdrop)
                    .background(p.groupedBg)
                    .windowInsetsPadding(insets.only(WindowInsetsSides.Vertical + WindowInsetsSides.End))
                    .bounce()
                    .verticalScroll(rememberScrollState())
                    // 版心:左边盒子线,右边让开轨道。
                    .padding(
                        start = startInset + Gutter,
                        end = railSide(),
                        top = Gutter,
                        bottom = actionsHeight + Gutter,
                    ),
            ) {
                Column(Modifier.widthIn(max = PageMaxWidth)) {
                    Identity(host, content)
                    Spacer(Modifier.height(24.dp))
                    content.body(this)
                }
            }
            Box(
                Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(insets.only(WindowInsetsSides.Vertical + WindowInsetsSides.End)),
            ) {
                PinnedActions(
                    onHeight = { actionsHeight = it },
                    start = startInset + Gutter,
                    // 直板机:「确认 / 取消」叠在底栏上面。
                    bottom = if (bottomBar) BarClearance else Gutter,
                    background = p.groupedBg,
                ) {
                    Column(Modifier.widthIn(max = PageMaxWidth)) { content.actions(true) }
                }
            }
        }
        if (bottomBar) {
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                BottomBar(
                    Modifier.align(Alignment.BottomCenter),
                    // 只留返回:外观切换在这一页没有用处,多一颗按钮只会分散注意力。
                    start = { GlassButton(XIcons.Back, stringResource(R.string.host_back)) { onExit() } },
                )
            }
        } else {
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                EdgeRail(Modifier.align(Alignment.BottomEnd)) {
                    GlassButton(XIcons.Back, stringResource(R.string.host_back)) { onExit() }
                }
            }
        }
    }
}

/** 图标块 + 大标题 + 这是哪台主机(+ 需要注意的一句)。 */
@Composable
private fun Identity(host: Host, content: GateContent) {
    val p = LocalXssh.current
    // iOS 版状态卡片的抬头:左边一枚带光晕的细圆环图标,右边「标题 / 哪台主机 / 地址」。
    // 圆环落在盒子线上(和卡片、按钮同一条左边)。
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconRing(content.icon, content.tint, size = 52.dp)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    content.title,
                    color = p.text,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                // 三种状态一律「标题是状态、下面是哪台主机」,行数不随状态变(见 ConnectGate 的标题注释)。
                // 没起名字时 label 就是地址,再写一行 user@地址:端口 是重复的:只留后者。
                if (host.name.isNotBlank() && host.name != host.address) {
                    Text(host.label, color = p.text, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(1.dp))
                }
                Text(host.subtitle, color = p.textDim, fontSize = 12.5.sp, fontFamily = XsshFonts.monoUi, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        content.note?.let {
            Spacer(Modifier.height(16.dp))
            Text(it, color = content.noteColor, fontSize = 14.sp)
        }
    }
}

/**
 * 指纹卡片:算法写在标签里,摘要固定 11 个字符一组、两组一行、大号等宽字 ——
 * 人要逐段比对,断点得在每台设备上都落在同一个位置(见 [fingerprintRows])。
 */
@Composable
private fun FingerprintCard(label: String, value: String, color: Color, artTint: Color = Color(0xFF80E3A1)) {
    val p = LocalXssh.current
    val algorithm = fingerprintRows(value).first
    Column(
        Modifier
            .fillMaxWidth()
            .cardChrome()
            .padding(horizontal = 18.dp, vertical = 16.dp),
    ) {
        Text(
            if (algorithm.isBlank()) label else "$label · $algorithm",
            color = p.textDim,
            fontSize = 12.5.sp,
        )
        Spacer(Modifier.height(12.dp))
        if (value.isBlank()) {
            Text(stringResource(R.string.host_gate_none), color = color, fontSize = 17.sp, fontFamily = XsshFonts.monoUi)
        } else {
            FingerprintArtAndWords(value, color, artTint)
        }
    }
}

/**
 * 指纹图案 + 分行指纹(iOS 版:图案在左、指纹每 12 个字符一行共四行;窄了就上下排)。
 * 指纹文字可以选中复制:逐段比对之前常要先拿去和服务器那头对一下。
 * 确认页和主机详情页共用这一块,两处看到的一模一样。
 */
@Composable
fun FingerprintArtAndWords(value: String, color: Color, artTint: Color = Color(0xFF80E3A1)) {
    val art = remember(value) { RandomArt.lines(value) }
    val words = remember(value) { RandomArt.wrapped(value) }
    SelectionContainer {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            if (art != null && maxWidth >= 280.dp) {
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                    HostKeyArt(art, artTint)
                    FingerprintWords(words, color)
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    art?.let { HostKeyArt(it, artTint) }
                    FingerprintWords(words, color)
                }
            }
        }
    }
}

/** 指纹文字:每行 12 个字符的等宽字,逐行比对。 */
@Composable
private fun FingerprintWords(lines: List<String>, color: Color) {
    Column {
        lines.forEach { line ->
            Text(
                line,
                color = color,
                fontSize = 15.sp,
                fontFamily = XsshFonts.mono,
                letterSpacing = 0.4.sp,
                softWrap = false,
                modifier = Modifier.padding(vertical = 1.5.dp),
            )
        }
    }
}

/**
 * 一把密钥的指纹图案:黑底细框的小方块,底边嵌一个 `[SHA256]` 标签(iOS 版 `HostKeyArt`)。
 * 只是装饰、读屏跳过 —— 指纹文字才是要念的东西。
 */
@Composable
private fun HostKeyArt(lines: List<String>, tint: Color) {
    val p = LocalXssh.current
    val shape = RoundedCornerShape(4.dp)
    Box(Modifier.padding(bottom = 7.dp).clearAndSetSemantics { }) {
        Text(
            lines.joinToString("\n"),
            color = tint,
            fontFamily = XsshFonts.mono,
            fontSize = 10.5.sp,
            lineHeight = 11.sp,
            softWrap = false,
            modifier = Modifier
                .clip(shape)
                .background(Color.Black)
                .border(1.dp, Color.White.copy(alpha = 0.25f), shape)
                .padding(horizontal = 7.dp, vertical = 6.dp),
        )
        Text(
            "[SHA256]",
            color = if (p.dark) Color.White.copy(alpha = 0.55f) else p.textDim,
            fontFamily = XsshFonts.mono,
            fontSize = 9.sp,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .offset(x = 8.dp, y = 7.dp)
                // 标签底色要和卡片底(渐变的下沿)一致,才像是"嵌"在边框上。
                .background(if (p.dark) Color(0xFF111111) else Color(0xFFF5F5F7))
                .padding(horizontal = 4.dp),
        )
    }
}

/**
 * 正在连接:和指纹卡片、失败卡片同一个盒子。
 *
 * 曾经这里是一行裸的「转圈 + 正在连接」。三种状态里只有它不是卡片,于是它左边贴着盒子线 16dp、
 * 上面的标题在标题线 28dp,右边又什么都没有 —— 外屏上看就是"没对齐、不对称"。
 * 现在同样是一张铺满版心的卡片:三种状态的版式一模一样(图标块 → 标题 → 地址 → 卡片 → 按钮),
 * 单栏、内屏双栏、平板卡片里都成立,状态之间切换也不会跳。
 */
@Composable
private fun StatusCard(waited: Int) {
    val p = LocalXssh.current
    Row(
        Modifier
            .fillMaxWidth()
            .cardChrome()
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(Modifier.size(18.dp), color = p.accent, strokeWidth = 2.dp, trackColor = p.bgElev2)
        Spacer(Modifier.width(12.dp))
        Text(stringResource(R.string.host_gate_establishing), color = p.text, fontSize = 15.sp)
        // 等久了才报秒数:前两秒一闪而过,数字只会显得慌。取值靠右,和详情页的「标签—取值」一个规矩。
        if (waited >= 3) {
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.width(12.dp))
            Text(stringResource(R.string.host_gate_waited, waited), color = p.textDim, fontSize = 13.sp, maxLines = 1)
        }
    }
}

/** 失败原因:原话照录(服务端 / 系统的错误文本),放在卡片里,和指纹卡片一个样子。 */
@Composable
private fun MessageCard(message: String, detail: String? = null) {
    val p = LocalXssh.current
    var expanded by remember { mutableStateOf(false) }
    // 等宽小字、可选中复制(iOS 版:错误原文是要拿去搜的东西)。
    Column(
        Modifier
            .fillMaxWidth()
            .cardChrome()
            .padding(horizontal = 18.dp, vertical = 16.dp),
    ) {
        SelectionContainer {
            Text(
                message,
                color = p.text.copy(alpha = 0.72f),
                fontSize = 13.5.sp,
                fontFamily = XsshFonts.monoUi,
            )
        }
        if (detail != null) {
            Spacer(Modifier.height(12.dp))
            // 「详情」:点一下展开原文(类名 + 原始消息),报问题时能原样复制。
            Text(
                (if (expanded) "▾ " else "▸ ") + stringResource(R.string.host_gate_details),
                color = p.textDim,
                fontSize = 13.sp,
                fontFamily = XsshFonts.monoUi,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { expanded = !expanded }
                    .padding(vertical = 4.dp),
            )
            if (expanded) {
                Spacer(Modifier.height(6.dp))
                SelectionContainer {
                    Text(detail, color = p.textFaint, fontSize = 12.sp, fontFamily = XsshFonts.mono)
                }
            }
        }
    }
}

/**
 * 按钮组。[stacked]:手机 / 折叠屏竖着排、主按钮在上、全宽(同主机详情页的「连接」);
 * 平板卡片里横着排,次要的在左、主要的在右(iPad 表单的习惯)。
 */
@Composable
private fun GateButtons(
    stacked: Boolean,
    primary: String?,
    primaryKind: ButtonKind = ButtonKind.Primary,
    onPrimary: () -> Unit,
    secondary: String,
    onSecondary: () -> Unit,
    tertiary: Pair<String, () -> Unit>? = null,
) {
    // iOS 版状态卡片的按钮:胶囊形的实心主按钮 + 无底色的文字按钮(取消 / 返回)。
    if (stacked) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (primary != null) CapsuleButton(primary, Modifier.fillMaxWidth(), kind = primaryKind) { onPrimary() }
            tertiary?.let { (label, run) -> CapsuleButton(label, Modifier.fillMaxWidth(), kind = ButtonKind.Ghost) { run() } }
            CapsuleButton(secondary, Modifier.fillMaxWidth(), kind = ButtonKind.Ghost) { onSecondary() }
        }
    } else {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(GapItem)) {
            CapsuleButton(secondary, Modifier.weight(1f), kind = ButtonKind.Ghost) { onSecondary() }
            tertiary?.let { (label, run) -> CapsuleButton(label, Modifier.weight(1f), kind = ButtonKind.Ghost) { run() } }
            if (primary != null) CapsuleButton(primary, Modifier.weight(1f), kind = primaryKind) { onPrimary() }
        }
    }
}
