package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 主机页。三种形态:
 * - 窄屏(外屏 425dp):单列卡片,点卡片直接连,主操作在拇指够得到的右下角;
 * - 中屏(内屏竖 608dp):同一套卡片自动排成两列,不塞详情栏;
 * - 宽屏(内屏横 860dp / 平板):左列表 + 右详情,**分界线压在折痕上**,内容不跨折痕。
 */
@Composable
fun HomeScreen(
    hosts: List<Host>,
    selectedId: String?,
    onSelect: (Host) -> Unit,
    onConnect: (Host) -> Unit,
    onNew: () -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
) {
    val adaptive = LocalAdaptive.current
    val p = LocalXssh.current
    var query by remember { mutableStateOf("") }
    val filtered = remember(hosts, query) {
        if (query.isBlank()) {
            hosts
        } else {
            hosts.filter {
                it.label.contains(query, ignoreCase = true) ||
                    it.address.contains(query, ignoreCase = true) ||
                    it.username.contains(query, ignoreCase = true)
            }
        }
    }

    // 注意:折痕位置是**窗口**坐标,所以这一层不能先加安全区内边距 —— 否则挖孔在侧边时
    // (内屏横屏挖孔占 51dp)分界线会整体右移,正好压不在折痕上。内边距放进各栏自己加。
    BoxWithConstraints(Modifier.fillMaxSize().background(p.bg)) {
        if (adaptive.twoPane) {
            val listWidth = adaptive.listPaneWidth(maxWidth)
            Row(Modifier.fillMaxSize()) {
                HostListPane(
                    modifier = Modifier
                        .width(listWidth)
                        .fillMaxHeight()
                        .windowInsetsPadding(
                            WindowInsets.safeDrawing.only(
                                WindowInsetsSides.Vertical + WindowInsetsSides.Start,
                            ),
                        ),
                    hosts = filtered,
                    total = hosts.size,
                    selectedId = selectedId,
                    onPrimary = onSelect,
                    onNew = onNew,
                    onEdit = onEdit,
                    onDelete = onDelete,
                    query = query,
                    onQuery = { query = it },
                    columns = 1,
                    floatingNew = false,
                )
                // 折痕:让它成为可见的分界,而不是从内容中间穿过去的一道暗缝。
                Box(
                    Modifier
                        .width(maxOf(1.dp, adaptive.bookFold?.sizeDp ?: 1.dp))
                        .fillMaxHeight()
                        .background(p.border),
                )
                HostDetailPane(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .windowInsetsPadding(
                            WindowInsets.safeDrawing.only(
                                WindowInsetsSides.Vertical + WindowInsetsSides.End,
                            ),
                        ),
                    host = hosts.firstOrNull { it.id == selectedId },
                    onConnect = onConnect,
                    onEdit = onEdit,
                    onDelete = onDelete,
                    onNew = onNew,
                )
            }
        } else {
            HostListPane(
                modifier = Modifier.fillMaxSize().safeDrawingPadding(),
                hosts = filtered,
                total = hosts.size,
                selectedId = selectedId,
                onPrimary = onConnect,
                onNew = onNew,
                onEdit = onEdit,
                onDelete = onDelete,
                query = query,
                onQuery = { query = it },
                // 一列至少 264dp:外屏排一列,内屏竖屏自动变两列,不用再判断机型。
                columns = 0,
                floatingNew = true,
            )
        }
    }
}

@Composable
private fun HostListPane(
    modifier: Modifier,
    hosts: List<Host>,
    total: Int,
    selectedId: String?,
    onPrimary: (Host) -> Unit,
    onNew: () -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    query: String,
    onQuery: (String) -> Unit,
    columns: Int,
    floatingNew: Boolean,
) {
    val p = LocalXssh.current
    Box(modifier) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().padding(start = 18.dp, end = 10.dp, top = 12.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("X-SSH", color = p.text, fontSize = 23.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        if (total == 0) "还没有主机" else "$total 台主机",
                        color = p.textFaint,
                        fontSize = 12.sp,
                    )
                }
                if (!floatingNew) XsshButton("＋ 新建", kind = ButtonKind.Ghost) { onNew() }
            }

            OutlinedTextField(
                value = query,
                onValueChange = onQuery,
                placeholder = { Text("搜索名称 / 地址 / 用户", color = p.textFaint) },
                singleLine = true,
                colors = xsshFieldColors(),
                shape = RoundedCornerShape(12.dp),
                trailingIcon = {
                    if (query.isNotEmpty()) XsshIconButton("✕") { onQuery("") }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )

            if (hosts.isEmpty()) {
                EmptyHosts(Modifier.weight(1f).fillMaxWidth(), searching = query.isNotBlank(), onNew = onNew)
            } else {
                LazyVerticalGrid(
                    columns = if (columns > 0) GridCells.Fixed(columns) else GridCells.Adaptive(264.dp),
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    // 底部留出悬浮按钮的位置,最后一张卡片不会被挡住。
                    contentPadding = PaddingValues(
                        start = 16.dp,
                        end = 16.dp,
                        top = 4.dp,
                        bottom = if (floatingNew) 96.dp else 20.dp,
                    ),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(hosts, key = { it.id }) { host ->
                        HostCard(
                            host = host,
                            selected = host.id == selectedId,
                            onPrimary = onPrimary,
                            onEdit = onEdit,
                            onDelete = onDelete,
                        )
                    }
                }
            }
        }

        // 窄屏把新建放右下角:单手握持时拇指正好落在这里,顶栏够不着。
        // 宽屏不用悬浮按钮 —— 它会压住卡片右侧的 ⋮,而标题栏有的是地方。
        if (floatingNew) NewHostFab(Modifier.align(Alignment.BottomEnd).padding(20.dp), onNew)
    }
}

@Composable
private fun NewHostFab(modifier: Modifier, onNew: () -> Unit) {
    Box(modifier) {
        XsshButton("＋ 新建主机", modifier = Modifier.heightIn(min = 56.dp)) { onNew() }
    }
}

@Composable
private fun EmptyHosts(modifier: Modifier, searching: Boolean, onNew: () -> Unit) {
    val p = LocalXssh.current
    Column(
        modifier.padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (searching) {
            Text("没有匹配的主机", color = p.textDim, fontSize = 16.sp)
            Spacer(Modifier.height(6.dp))
            Text("换个关键词试试", color = p.textFaint, fontSize = 13.sp)
        } else {
            Text("还没有主机", color = p.textDim, fontSize = 17.sp)
            Spacer(Modifier.height(8.dp))
            Text(
                "添加一台后,点卡片即可连接;长按卡片可以编辑或删除。",
                color = p.textFaint,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(20.dp))
            XsshButton("＋ 新建主机") { onNew() }
        }
    }
}

@Composable
private fun HostCard(
    host: Host,
    selected: Boolean,
    onPrimary: (Host) -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
) {
    val p = LocalXssh.current
    var menu by remember { mutableStateOf(false) }

    XsshCard(
        modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp),
        highlight = selected,
        onClick = { onPrimary(host) },
        onLongClick = { menu = true },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(host.label, color = p.text, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(4.dp))
                Text(
                    host.subtitle,
                    color = p.textDim,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Chip(
                        if (host.auth == AuthKind.KEY) "私钥" else "密码",
                        if (host.auth == AuthKind.KEY) p.accent else p.warn,
                    )
                    if (host.keyFingerprint.isBlank()) Chip("密钥待确认", p.warn)
                }
            }
            Box {
                XsshIconButton("⋮") { menu = true }
                HostMenu(
                    open = menu,
                    onDismiss = { menu = false },
                    onEdit = { onEdit(host) },
                    onDelete = { onDelete(host) },
                )
            }
        }
    }
}

@Composable
private fun HostMenu(open: Boolean, onDismiss: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    val p = LocalXssh.current
    DropdownMenu(expanded = open, onDismissRequest = onDismiss) {
        DropdownMenuItem(
            text = { Text("编辑", fontSize = 15.sp) },
            modifier = Modifier.heightIn(min = TouchMin),
            onClick = { onDismiss(); onEdit() },
        )
        DropdownMenuItem(
            text = { Text("删除", color = p.danger, fontSize = 15.sp) },
            modifier = Modifier.heightIn(min = TouchMin),
            onClick = { onDismiss(); onDelete() },
        )
    }
}

@Composable
private fun HostDetailPane(
    modifier: Modifier,
    host: Host?,
    onConnect: (Host) -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    onNew: () -> Unit,
) {
    val p = LocalXssh.current
    if (host == null) {
        Column(
            modifier.padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("选择左边的主机", color = p.textDim, fontSize = 15.sp)
            Spacer(Modifier.height(6.dp))
            Text("这里会显示它的详情和操作", color = p.textFaint, fontSize = 13.sp)
            Spacer(Modifier.height(20.dp))
            XsshButton("＋ 新建主机", kind = ButtonKind.Ghost) { onNew() }
        }
        return
    }

    Column(
        modifier.verticalScroll(rememberScrollState()).padding(horizontal = 32.dp, vertical = 28.dp),
    ) {
        Text(host.label, color = p.text, fontSize = 26.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(host.subtitle, color = p.textDim, fontFamily = FontFamily.Monospace, fontSize = 15.sp)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(
                if (host.auth == AuthKind.KEY) "私钥认证" else "密码认证",
                if (host.auth == AuthKind.KEY) p.accent else p.warn,
            )
            Chip(
                if (host.keyFingerprint.isBlank()) "主机密钥未确认" else "主机密钥已信任",
                if (host.keyFingerprint.isBlank()) p.warn else p.ok,
            )
        }

        Spacer(Modifier.height(24.dp))
        DetailRow("认证", if (host.auth == AuthKind.KEY) host.keyPath.ifBlank { "(未指定私钥)" } else "密码(不落盘)")
        if (host.keyFingerprint.isNotBlank()) {
            Spacer(Modifier.height(14.dp))
            DetailRow("已信任的主机密钥", host.keyFingerprint)
        }

        Spacer(Modifier.height(28.dp))
        XsshButton("连接", modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { onConnect(host) }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            XsshButton("编辑", kind = ButtonKind.Ghost, modifier = Modifier.weight(1f)) { onEdit(host) }
            XsshButton("删除", kind = ButtonKind.Danger, modifier = Modifier.weight(1f)) { onDelete(host) }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    val p = LocalXssh.current
    Column {
        Text(label, color = p.textFaint, fontSize = 12.sp)
        Spacer(Modifier.height(4.dp))
        Text(value, color = p.text, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
    }
}
