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
        val login = when {
            host.keyMissing -> "私钥 · 未导入"
            host.auth == AuthKind.KEY -> "私钥" + host.keyName.takeIf { it.isNotEmpty() }?.let { " · $it" }.orEmpty()
            host.password.isEmpty() -> "密码 · 未保存"
            else -> "密码"
        }
        val attention = host.keyMissing || (host.auth == AuthKind.PASSWORD && host.password.isEmpty())
        InfoRow("登录方式", login, valueColor = if (attention) p.warn else null)
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
 * ‹ 折叠屏在右侧轨道(和编辑页、终端同一个落点)、直板机在顶栏。
 *
 * 两页共用一个外壳,边距、‹ 的落点、底部留白就不会各写一套慢慢走偏。
 */
@Composable
fun ReadingPage(onBack: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val p = LocalXssh.current
    val topBar = LocalChrome.current == Chrome.TopBar
    val backdrop = rememberLayerBackdrop()
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
                    top = (if (topBar) TopBarHeight else 0.dp) + Gutter,
                    bottom = if (topBar) 40.dp else RailClearance,
                ),
            content = content,
        )
        // 外观在最上面:每一页都有,位置一样(见 ThemeGlassItem)。
        if (topBar) {
            TopBar(
                Modifier.align(Alignment.TopCenter),
                start = { GlassButton(XIcons.Back, "返回") { onBack() } },
                end = { GlassGroup { ThemeGlassItem() } },
            )
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
    ReadingPage(onBack) {
        HostInfoBody(host, running, onConnect, onEdit, onDelete)
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
) {
    Column(Modifier.widthIn(max = PageMaxWidth)) {
        header?.invoke() ?: HostIdentity(host, running)
        Spacer(Modifier.height(24.dp))
        HostActions(host, running, onConnect, onEdit, onDelete)
        Spacer(Modifier.height(32.dp))
        HostInfoGroups(host)
    }
}
