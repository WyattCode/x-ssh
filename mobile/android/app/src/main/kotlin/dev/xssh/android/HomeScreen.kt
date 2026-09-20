package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 主机页。[expanded] 为真(内屏展开,≥600dp)时左右两栏,分界线对齐折痕;
 * 否则单栏,点卡片直接连接。
 */
@Composable
fun HomeScreen(
    hosts: List<Host>,
    selectedId: String?,
    expanded: Boolean,
    onSelect: (Host) -> Unit,
    onConnect: (Host) -> Unit,
    onNew: () -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
) {
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

    if (expanded) {
        Row(Modifier.fillMaxSize().systemBarsPadding()) {
            HostListPane(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                hosts = filtered,
                selectedId = selectedId,
                onSelect = onSelect,
                onConnect = onConnect,
                onNew = onNew,
                onEdit = onEdit,
                onDelete = onDelete,
                query = query,
                onQuery = { query = it },
            )
            Box(Modifier.width(1.dp).fillMaxHeight().background(LocalXssh.current.border))
            HostDetailPane(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                host = hosts.firstOrNull { it.id == selectedId },
                onConnect = onConnect,
                onEdit = onEdit,
                onDelete = onDelete,
                onNew = onNew,
            )
        }
    } else {
        HostListPane(
            modifier = Modifier.fillMaxSize().systemBarsPadding(),
            hosts = filtered,
            selectedId = selectedId,
            onSelect = onConnect,
            onConnect = onConnect,
            onNew = onNew,
            onEdit = onEdit,
            onDelete = onDelete,
            query = query,
            onQuery = { query = it },
        )
    }
}

@Composable
private fun HostListPane(
    modifier: Modifier,
    hosts: List<Host>,
    selectedId: String?,
    onSelect: (Host) -> Unit,
    onConnect: (Host) -> Unit,
    onNew: () -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
    query: String,
    onQuery: (String) -> Unit,
) {
    val p = LocalXssh.current
    Column(modifier.background(p.bg)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("X-SSH", color = p.text, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Text("主机", color = p.textFaint, fontSize = 12.sp)
            }
            XsshButton("＋ 新建", kind = ButtonKind.Ghost) { onNew() }
        }

        OutlinedTextField(
            value = query,
            onValueChange = onQuery,
            placeholder = { Text("搜索主机", color = p.textFaint) },
            singleLine = true,
            colors = xsshFieldColors(),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
        )

        if (hosts.isEmpty()) {
            EmptyHosts(Modifier.weight(1f).fillMaxWidth(), onNew)
        } else {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(hosts, key = { it.id }) { host ->
                    HostCard(
                        host = host,
                        selected = host.id == selectedId,
                        onSelect = onSelect,
                        onConnect = onConnect,
                        onEdit = onEdit,
                        onDelete = onDelete,
                    )
                }
            }
        }
    }
}

@Composable
private fun EmptyHosts(modifier: Modifier, onNew: () -> Unit) {
    val p = LocalXssh.current
    Column(
        modifier,
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("还没有主机", color = p.textDim, fontSize = 16.sp)
        Spacer(Modifier.height(6.dp))
        Text("点右上角 ⋮ 可编辑 / 删除", color = p.textFaint, fontSize = 12.sp)
        Spacer(Modifier.height(18.dp))
        XsshButton("新建主机") { onNew() }
    }
}

@Composable
private fun HostCard(
    host: Host,
    selected: Boolean,
    onSelect: (Host) -> Unit,
    onConnect: (Host) -> Unit,
    onEdit: (Host) -> Unit,
    onDelete: (Host) -> Unit,
) {
    val p = LocalXssh.current
    var menu by remember { mutableStateOf(false) }

    XsshCard(
        modifier = Modifier.fillMaxWidth(),
        highlight = selected,
        onClick = { onSelect(host) },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(host.label, color = p.text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(3.dp))
                Text(host.subtitle, color = p.textDim, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp)
                Spacer(Modifier.height(6.dp))
                Text(
                    if (host.auth == AuthKind.KEY) "私钥认证" else "密码认证",
                    color = if (host.auth == AuthKind.KEY) p.accent else p.warn,
                    fontSize = 11.sp,
                )
            }
            XsshButton("连接", kind = ButtonKind.Ghost, modifier = Modifier.heightIn(min = 44.dp)) {
                onConnect(host)
            }
            Box {
                KeyCap("⋮") { menu = true }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("编辑") }, onClick = { menu = false; onEdit(host) })
                    DropdownMenuItem(
                        text = { Text("删除", color = p.danger) },
                        onClick = { menu = false; onDelete(host) },
                    )
                }
            }
        }
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
    Column(
        modifier.background(p.bg).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (host == null) {
            Text("选择左侧主机", color = p.textFaint, fontSize = 14.sp)
            Spacer(Modifier.height(14.dp))
            XsshButton("＋ 新建主机") { onNew() }
        } else {
            Text(host.label, color = p.text, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text(host.subtitle, color = p.textDim, fontFamily = FontFamily.Monospace, fontSize = 14.sp)
            Spacer(Modifier.height(6.dp))
            Text(
                if (host.auth == AuthKind.KEY) "私钥认证" else "密码认证",
                color = if (host.auth == AuthKind.KEY) p.accent else p.warn,
                fontSize = 12.sp,
            )
            Spacer(Modifier.height(28.dp))
            XsshButton("连接", modifier = Modifier.fillMaxWidth()) { onConnect(host) }
            Spacer(Modifier.height(10.dp))
            Row {
                XsshButton("编辑", kind = ButtonKind.Ghost, modifier = Modifier.weight(1f)) { onEdit(host) }
                Spacer(Modifier.width(10.dp))
                XsshButton("删除", kind = ButtonKind.Danger, modifier = Modifier.weight(1f)) { onDelete(host) }
            }
        }
    }
}