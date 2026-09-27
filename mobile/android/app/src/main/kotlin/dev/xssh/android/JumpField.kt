package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog

/**
 * 能当 [self] 的跳板机的主机:别的、自己没设跳板机的(只支持一层 —— 跳板机的跳板机核心不看,
 * 让人选了只会连不上)。
 */
internal fun jumpCandidates(hosts: List<Host>, self: String?): List<Host> =
    hosts.filter { it.id != self && it.jumpHostId.isEmpty() }

/**
 * 编辑页的「跳板机」一行:点开从已保存的主机里选一台,或者不用。
 *
 * 这台本身是别的主机的跳板机时不能再设跳板机(那就成了两层),这一行灰掉、下面说明是谁在用它。
 * 原来选的那台被删了:值写「已删除」(橙色),连接时也会明确报出来,不会悄悄改成直连。
 */
@Composable
fun JumpField(draft: HostDraft) {
    val p = LocalXssh.current
    val hosts = LocalHosts.current
    val self = draft.id
    val usedBy = if (self == null) emptyList() else hosts.filter { it.jumpHostId == self }
    val chosen = hosts.firstOrNull { it.id == draft.jumpHostId }
    val gone = draft.jumpHostId.isNotEmpty() && chosen == null
    // 已经设了的(老数据)照样能改回「不用」,所以只在"没设"时才挡。
    val blocked = usedBy.isNotEmpty() && draft.jumpHostId.isEmpty()
    var picking by remember { mutableStateOf(false) }
    FormGroup(
        footnote = when {
            blocked -> "它是「${usedBy.first().label}」的跳板机，不能再经过别的跳板机。"
            gone -> "原来选的跳板机已经删除了。"
            else -> null
        },
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clickable(enabled = !blocked) { picking = true }
                .padding(horizontal = BoxPad),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("跳板机", color = if (blocked) p.textFaint else p.text, fontSize = 16.sp)
            Spacer(Modifier.width(GapItem))
            Text(
                when {
                    chosen != null -> chosen.label
                    gone -> "已删除"
                    else -> "不用"
                },
                color = if (gone) p.warn else p.textDim,
                fontSize = 16.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.End,
                modifier = Modifier.weight(1f),
            )
            if (!blocked) {
                Spacer(Modifier.width(4.dp))
                Icon(XIcons.Chevron, contentDescription = null, tint = p.textFaint, modifier = Modifier.size(16.dp))
            }
        }
    }
    if (picking) {
        JumpPicker(
            options = jumpCandidates(hosts, self),
            selected = draft.jumpHostId,
            onPick = {
                draft.jumpHostId = it
                picking = false
            },
            onDismiss = { picking = false },
        )
    }
}

/** 选跳板机:第一行「不用」,下面是可选的主机(名字 + 地址),当前选中的打勾。点一下就选定、关掉。 */
@Composable
private fun JumpPicker(options: List<Host>, selected: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val p = LocalXssh.current
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .width(360.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(if (p.dark) p.bgElev else p.bg)
                .border(0.5.dp, p.glassBorder, RoundedCornerShape(18.dp))
                .padding(vertical = 12.dp),
        ) {
            Text(
                "跳板机",
                color = p.text,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                PickerRow("不用", "直接连接", selected.isEmpty()) { onPick("") }
                options.forEach { host ->
                    PickerRow(host.label, host.subtitle, host.id == selected) { onPick(host.id) }
                }
                if (options.isEmpty()) {
                    Text(
                        "还没有别的主机可以当跳板机。先把跳板机当作一台主机保存下来。",
                        color = p.textDim,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun PickerRow(title: String, detail: String, checked: Boolean, onClick: () -> Unit) {
    val p = LocalXssh.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable { onClick() }
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = p.text, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                detail,
                color = p.textDim,
                fontSize = 13.sp,
                fontFamily = XsshFonts.monoUi,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (checked) {
            Spacer(Modifier.width(GapItem))
            Icon(XIcons.Check, contentDescription = "已选", tint = p.accent, modifier = Modifier.size(20.dp))
        }
    }
}
