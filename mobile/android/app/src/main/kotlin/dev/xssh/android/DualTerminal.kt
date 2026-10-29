package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog

/**
 * 折叠屏内屏左右两个终端。
 *
 * 分栏线压在折痕上([Adaptive.listPaneWidth]);每一侧是嵌着的 [TerminalScreen],
 * **只有聚焦侧画 EdgeRail**(见 TerminalView 的 focused 门控),整窗同一时刻一条轨道。
 */
@Composable
fun DualTerminalPanes(
    left: Host,
    right: Host,
    focus: PaneSide,
    onFocus: (PaneSide) -> Unit,
    onExitPane: (PaneSide) -> Unit,
    onSwap: () -> Unit,
    onOpenBeside: () -> Unit,
    onTrustKey: (Host, String) -> Unit,
    onTrustJumpKey: (Host, String) -> Unit,
    onFiles: (Host) -> Unit,
    onEditHost: (Host) -> Unit,
    onConnected: (String) -> Unit,
) {
    val adaptive = LocalAdaptive.current
    val p = LocalXssh.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val leftW = adaptive.listPaneWidth(maxWidth).coerceAtMost(maxWidth - 200.dp)
        val crease = maxOf(1.dp, adaptive.bookFold?.sizeDp ?: 1.dp)
        Row(Modifier.fillMaxSize()) {
            Box(Modifier.width(leftW).fillMaxHeight()) {
                TerminalScreen(
                    host = left,
                    onExit = { onExitPane(PaneSide.Left) },
                    onTrustKey = { onTrustKey(left, it) },
                    onTrustJumpKey = onTrustJumpKey,
                    onFiles = { onFiles(left) },
                    onEditHost = { onEditHost(left) },
                    onConnected = onConnected,
                    embedded = true,
                    focused = focus == PaneSide.Left,
                    onFocusRequest = { onFocus(PaneSide.Left) },
                    onOpenBeside = onOpenBeside,
                    onSwapPanes = onSwap,
                )
            }
            Box(
                Modifier
                    .width(crease)
                    .fillMaxHeight()
                    .background(p.border),
            )
            Box(Modifier.weight(1f).fillMaxHeight()) {
                TerminalScreen(
                    host = right,
                    onExit = { onExitPane(PaneSide.Right) },
                    onTrustKey = { onTrustKey(right, it) },
                    onTrustJumpKey = onTrustJumpKey,
                    onFiles = { onFiles(right) },
                    onEditHost = { onEditHost(right) },
                    onConnected = onConnected,
                    embedded = true,
                    focused = focus == PaneSide.Right,
                    onFocusRequest = { onFocus(PaneSide.Right) },
                    onOpenBeside = onOpenBeside,
                    onSwapPanes = onSwap,
                )
            }
        }
    }
}

/**
 * 挑选一条已有活会话放到右侧。排除 [excludeId](当前主窗格)。
 */
@Composable
fun PickBesideSessionDialog(
    excludeId: String,
    hosts: List<Host>,
    onPick: (Host) -> Unit,
    onDismiss: () -> Unit,
) {
    val p = LocalXssh.current
    val running by SessionRegistry.sessions.collectAsState()
    val choices = remember(running, excludeId, hosts) {
        running.keys
            .filter { it != excludeId }
            .mapNotNull { id -> hosts.firstOrNull { it.id == id } ?: running[id]?.host }
            .sortedBy { it.label.lowercase() }
    }
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .width(340.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(if (p.dark) p.bgElev else p.bg)
                .border(0.5.dp, p.glassBorder, RoundedCornerShape(18.dp))
                .padding(20.dp),
        ) {
            Text(
                stringResource(R.string.term_split_pick),
                color = p.text,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
            )
            if (choices.isEmpty()) {
                Text(
                    stringResource(R.string.term_split_unavailable),
                    color = p.textDim,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(top = 12.dp, bottom = 16.dp),
                )
            } else {
                LazyColumn(
                    Modifier
                        .padding(top = 8.dp)
                        .heightIn(max = 360.dp)
                        .fillMaxWidth(),
                ) {
                    items(choices, key = { it.id }) { host ->
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onPick(host) }
                                .padding(vertical = 12.dp),
                        ) {
                            Text(host.label, color = p.text, fontSize = 16.sp)
                            Text(host.subtitle, color = p.textDim, fontSize = 13.sp)
                        }
                    }
                }
            }
            XsshButton(
                stringResource(R.string.tab_cancel),
                Modifier.fillMaxWidth().padding(top = 8.dp),
                kind = ButtonKind.Ghost,
            ) { onDismiss() }
        }
    }
}
