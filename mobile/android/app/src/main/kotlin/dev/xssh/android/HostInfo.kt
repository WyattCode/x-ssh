package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop

/* ─────────────────────────────── 主机信息 ───────────────────────────────

   一台主机"连的是谁、怎么登录、认不认得它"。平板详情栏先做的这一套,手机 / 折叠屏共用:
   - 平板:右栏详情;
   - 折叠屏内屏横屏:折痕右边那一栏;
   - 外屏 / 内屏竖屏 / 直板机:卡片右端的 ⓘ 推进来一整页(点卡片本身仍然直接连接)。

   两组:「连接」(地址、端口、用户名、登录方式、私钥指纹)和「主机密钥」(未确认 / 指纹)。
   不写说明文字;需要注意的取值(密码未保存、私钥未导入、主机密钥未确认)标成橙色。
*/

/** 「连接」「主机密钥」两组。 */
@Composable
fun HostInfoGroups(host: Host) {
    val p = LocalXssh.current
    FormGroup(title = "连接") {
        InfoRow("地址", host.address, mono = true)
        FormDivider()
        InfoRow("端口", host.port.toString(), mono = true)
        FormDivider()
        InfoRow("用户名", host.username.ifBlank { "未设置" }, mono = host.username.isNotBlank())
        FormDivider()
        if (host.jumpHostId.isNotEmpty()) {
            val jump = LocalHosts.current.firstOrNull { it.id == host.jumpHostId }
            InfoRow("跳板机", jump?.label ?: "已删除", valueColor = if (jump == null) p.warn else null)
            FormDivider()
        }
        // 判"到底存没存"要看磁盘上那条密文:加了锁而这次没解锁时,明文本来就是空的,
        // 有密文、但这次读不出来(重装过、密钥库被清):那不是"没存过",是**出事了**。
        // 一律说「未保存」的话,用户会以为自己从没存过密码。解不开这件事是加载时记下的
        // (见 Host.unreadableSecrets) —— 原来在这里拿 `locked*` 去判,可那几个字段只装加锁的密文,
        // 而加锁的又被排除在外,于是这一行永远不出现。
        val broken = host.unreadableSecrets
        // 只看 `host.password` 会把"已保存但锁着"误报成"未保存"(用户以为密码丢了)。
        // 解不开的也算"存过":它下面单独有一行说「读不出来」,这里别再说成「未保存」。
        val hasPassword = host.password.isNotEmpty() || host.lockedPassword != null || "密码" in broken
        val hasKey = host.keyData.isNotEmpty() || host.keyPath.isNotEmpty() || host.lockedKeyData != null ||
            "私钥" in broken
        val login = when {
            host.auth == AuthKind.KEY && !hasKey -> "私钥 · 未导入"
            host.auth == AuthKind.KEY -> "私钥" + host.keyName.takeIf { it.isNotEmpty() }?.let { " · $it" }.orEmpty()
            !hasPassword -> "密码 · 未保存"
            else -> "密码"
        }
        val attention = (host.auth == AuthKind.KEY && !hasKey) ||
            (host.auth == AuthKind.PASSWORD && !hasPassword) ||
            broken.isNotEmpty()
        InfoRow("登录方式", login, valueColor = if (attention) p.warn else null)
        if (broken.isNotEmpty()) {
            FormDivider()
            InfoRow("凭据", broken.joinToString("、") + " 读不出来", valueColor = p.warn)
        }
        // 加了锁就在这里说一声:这一页是"把这台主机的情况全摊开"的地方,
        // 而"连接前要验一次"这件事原来只有编辑页的开关知道 —— 用户在这页看不出来,
        // 点了连接突然弹解锁框会一愣。
        if (host.lockSecrets) {
            FormDivider()
            InfoRow("解锁", "生物识别或锁屏密码")
        }
        // 这一页是"把这台主机的情况全摊开"的地方:连上会自动进 tmux,在这里也说一声。
        if (host.tmux) {
            FormDivider()
            InfoRow("连接后", "进入 tmux")
        }
        if (host.auth == AuthKind.KEY && host.keyPublicFingerprint.isNotEmpty()) {
            FormDivider()
            InfoRow("私钥指纹", host.keyPublicFingerprint.removePrefix("SHA256:"), mono = true)
        }
    }
    Spacer(Modifier.height(24.dp))
    FormGroup(title = "主机密钥") {
        if (host.keyFingerprint.isBlank()) {
            InfoRow("状态", "未确认", valueColor = p.warn)
        } else {
            // 指纹 11 字一组、两组一行(和确认主机身份那一页同一个断法),逐段比对时断点落在同一处。
            val (algorithm, rows) = fingerprintRows(host.keyFingerprint)
            Column(Modifier.fillMaxWidth().padding(horizontal = BoxPad, vertical = 14.dp)) {
                Text(algorithm.ifBlank { "指纹" }, color = p.textDim, fontSize = 13.sp)
                Spacer(Modifier.height(6.dp))
                SelectionContainer {
                    Column {
                        rows.forEach {
                            Text(it, color = p.text, fontSize = 15.sp, fontFamily = XsshFonts.monoUi)
                        }
                    }
                }
            }
        }
    }
}

/** 只读的一行:左标签、右取值。取值可以选中复制。 */
@Composable
fun InfoRow(label: String, value: String, mono: Boolean = false, valueColor: Color? = null) {
    val p = LocalXssh.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = BoxPad),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = p.text, fontSize = 15.sp)
        Spacer(Modifier.width(GapItem))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            SelectionContainer {
                Text(
                    value,
                    color = valueColor ?: p.textDim,
                    fontSize = 15.sp,
                    fontFamily = if (mono) XsshFonts.monoUi else FontFamily.Default,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * 详情里的按钮组:主按钮一整条(连着就是「打开会话」),下面一排「编辑」+「删除」;
 * 连着的时候「删除」换成「断开」—— 正在用的主机先断开才谈得上删。
 * 删除要点两下(第一下变「确认删除」),和卡片左滑一致;换一台主机就复位。
 */
@Composable
fun HostActions(
    host: Host,
    running: Boolean,
    onConnect: (Host) -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
) {
    Column(Modifier.widthIn(max = PageMaxWidth)) {
        XsshButton(if (running) "打开会话" else "连接", modifier = Modifier.fillMaxWidth()) { onConnect(host) }
        Spacer(Modifier.height(GapItem))
        var confirming by remember(host.id, running) { mutableStateOf(false) }
        Row(horizontalArrangement = Arrangement.spacedBy(GapItem)) {
            XsshButton("编辑", kind = ButtonKind.Ghost, modifier = Modifier.weight(1f)) { onEdit(host) }
            if (running) {
                XsshButton("断开", kind = ButtonKind.Danger, modifier = Modifier.weight(1f)) {
                    SessionRegistry.close(host.id)
                }
            } else {
                XsshButton(
                    if (confirming) "确认删除" else "删除",
                    kind = ButtonKind.Danger,
                    modifier = Modifier.weight(1f),
                ) {
                    if (confirming) onDelete(host) else confirming = true
                }
            }
        }
    }
}

/** 图标块 + 主机名 + 地址。连着的时候图标块变绿(和卡片一致)。 */
@Composable
fun HostIdentity(host: Host, running: Boolean, modifier: Modifier = Modifier) {
    val p = LocalXssh.current
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(56.dp)
                .clip(RoundedCornerShape(15.dp))
                .background(if (running) p.ok.copy(alpha = 0.16f) else p.cardBg),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                XIcons.Terminal,
                contentDescription = null,
                tint = if (running) p.ok else p.text,
                modifier = Modifier.size(30.dp),
            )
        }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(
                host.label,
                color = p.text,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                host.subtitle,
                color = p.textDim,
                fontSize = 13.sp,
                fontFamily = XsshFonts.monoUi,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * 只看不改的整页(主机详情、终端字体)的外壳:内容铺满、可滚动、带回弹,
 * ‹ 折叠屏在右侧轨道(和编辑页、终端同一个落点)、直板机在底栏左边。
 *
 * 两页共用一个外壳,边距、‹ 的落点、底部留白就不会各写一套慢慢走偏。
 */
@Composable
fun ReadingPage(
    onBack: () -> Unit,
    /** 钉在页面底部、不跟着滚的主操作(见 [PinnedActions]);没有就照旧整页滚。 */
    actions: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = LocalXssh.current
    val bottomBar = LocalChrome.current == Chrome.BottomBar
    val backdrop = rememberLayerBackdrop()
    var actionsHeight by remember { mutableStateOf(0.dp) }
    Box(Modifier.fillMaxSize().background(p.bg)) {
        Column(
            Modifier
                .fillMaxSize()
                .layerBackdrop(backdrop)
                .background(p.bg)
                .windowInsetsPadding(stableSafeDrawing())
                .bounce()
                .verticalScroll(rememberScrollState())
                // 版心:左边盒子线,右边让开轨道(见 Components 的 railSide)。
                .padding(
                    start = Gutter,
                    end = railSide(),
                    top = Gutter,
                    // 底部让开钉住的操作条;没有操作条时给轨道 / 底栏留白。
                    bottom = if (actions != null) actionsHeight + Gutter else if (bottomBar) BarClearance else RailClearance,
                ),
            content = content,
        )
        if (actions != null) {
            // 安全区在滚动那一层加过了,这里自己再加一次 —— 它不在那一层里面。
            Box(Modifier.fillMaxSize().windowInsetsPadding(stableSafeDrawing())) {
                // 直板机:大按钮叠在底栏上面(底栏在最下面一条,‹ 和外观在里面)。
                PinnedActions(
                    onHeight = { actionsHeight = it },
                    bottom = if (bottomBar) BarClearance else Gutter,
                    content = actions,
                )
            }
        }
        // 外观在最上面:每一页都有,位置一样(见 ThemeGlassItem)。
        if (bottomBar) {
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                BottomBar(
                    Modifier.align(Alignment.BottomCenter),
                    start = { GlassButton(XIcons.Back, "返回") { onBack() } },
                    end = { GlassGroup { ThemeGlassItem() } },
                )
            }
        } else {
            CompositionLocalProvider(LocalBackdrop provides backdrop) {
                EdgeRail(Modifier.align(Alignment.BottomEnd)) {
                    GlassGroup { ThemeGlassItem() }
                    GlassButton(XIcons.Back, "返回") { onBack() }
                }
            }
        }
    }
}

/**
 * 单栏的主机详情页(外屏、内屏竖屏、直板机):卡片上的 ⓘ 推进来。
 */
@Composable
fun HostInfoScreen(
    host: Host,
    onBack: () -> Unit,
    onConnect: (Host) -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
) {
    val running = host.id in SessionRegistry.sessions.collectAsState().value
    // 「连接 / 编辑 / 删除」钉在页底,和展开的折叠屏一个规矩:手在下半截,按钮就在下半截。
    ReadingPage(onBack, actions = { HostActions(host, running, onConnect, onEdit, onDelete) }) {
        HostInfoBody(host, running, onConnect, onEdit, onDelete, actionsPinned = true)
    }
}

/**
 * 详情正文:身份 → 按钮 → 两组信息。
 * 图标块和下面的按钮、分组块都落在**盒子线**上(和连接页的身份块一样);标题线由各自的标题自己带。
 */
@Composable
fun HostInfoBody(
    host: Host,
    running: Boolean,
    onConnect: (Host) -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    header: (@Composable () -> Unit)? = null,
    /**
     * 按钮不跟着正文滚,由调用方钉在栏底(双栏的右栏)。
     *
     * 展开的折叠屏上手握在下半截,顶部的「连接 / 编辑 / 删除」要抬手去够;信息本来就是"看的",
     * 按钮才是"按的",所以信息在上、按钮贴着底边。单栏页面不这样 —— 那是一页从上往下读到底,
     * 按钮跟在身份块后面才是常规位置。
     */
    actionsPinned: Boolean = false,
) {
    Column(Modifier.widthIn(max = PageMaxWidth)) {
        header?.invoke() ?: HostIdentity(host, running)
        Spacer(Modifier.height(24.dp))
        if (!actionsPinned) {
            HostActions(host, running, onConnect, onEdit, onDelete)
            Spacer(Modifier.height(32.dp))
        }
        HostInfoGroups(host)
    }
}
