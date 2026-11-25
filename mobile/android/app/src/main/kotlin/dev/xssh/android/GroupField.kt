package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog

/**
 * 编辑页保存时这台主机的分组两个字段。抽成函数是为了能测 —— 规则只有三条:
 *  - 填了分组名:就是这个组,并且是用户的决定(锁住,按名称自动分组不再动它);
 *  - 明确选了「无」:不分组,同样锁住;
 *  - 空着(「自动」):不设,也不锁 —— 名字合得上就按名称自动成组。
 */
internal fun groupFieldsForSave(text: String, none: Boolean): Pair<String, Boolean> {
    val name = text.trim().take(MAX_GROUP_LEN)
    return when {
        name.isNotEmpty() -> name to true
        none -> "" to true
        else -> "" to false
    }
}

/**
 * 编辑页的「分组」一行:点开从在用的分组里选,或者「自动」(按名称)、「无」,也能直接新建一个名字。
 * 在用的分组 = 别的主机已经在的组(包括按名称自动分出来的),所以不用先去别处建组。
 */
@Composable
fun GroupField(draft: HostDraft) {
    val p = LocalXssh.current
    val hosts = LocalHosts.current
    var picking by remember { mutableStateOf(false) }
    FormGroup {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clickable { picking = true }
                .padding(horizontal = BoxPad),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.edit_group), color = p.text, fontSize = 16.sp)
            Spacer(Modifier.width(GapItem))
            Text(
                when {
                    draft.groupText.isNotBlank() -> draft.groupText.trim()
                    draft.groupNone -> stringResource(R.string.edit_group_none)
                    else -> stringResource(R.string.edit_group_auto)
                },
                color = p.textDim,
                fontSize = 16.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.End,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(4.dp))
            Icon(XIcons.Chevron, contentDescription = null, tint = p.textFaint, modifier = Modifier.size(16.dp))
        }
    }
    if (picking) {
        // 编辑自己这台时,它自己不该撑起一个只有它的"在用"分组。
        val others = hosts.filter { it.id != draft.id }
        GroupPicker(
            names = groupNames(others),
            text = draft.groupText.trim(),
            none = draft.groupNone,
            onAuto = {
                draft.groupText = ""
                draft.groupNone = false
                picking = false
            },
            onNone = {
                draft.groupText = ""
                draft.groupNone = true
                picking = false
            },
            onName = {
                draft.groupText = it.trim().take(MAX_GROUP_LEN)
                draft.groupNone = false
                picking = false
            },
            onDismiss = { picking = false },
        )
    }
}

@Composable
private fun GroupPicker(
    names: List<String>,
    text: String,
    none: Boolean,
    onAuto: () -> Unit,
    onNone: () -> Unit,
    onName: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val p = LocalXssh.current
    var typed by remember { mutableStateOf("") }
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
                stringResource(R.string.edit_group),
                color = p.text,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                GroupRow(
                    stringResource(R.string.edit_group_auto),
                    stringResource(R.string.edit_group_auto_detail),
                    checked = text.isEmpty() && !none,
                    onClick = onAuto,
                )
                GroupRow(
                    stringResource(R.string.edit_group_none),
                    stringResource(R.string.edit_group_none_detail),
                    checked = text.isEmpty() && none,
                    onClick = onNone,
                )
                names.forEach { name ->
                    GroupRow(name, null, checked = name.equals(text, ignoreCase = true)) { onName(name) }
                }
                // 新建:现有的组里没有想要的,直接起一个名字。
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.weight(1f)) {
                        if (typed.isEmpty()) {
                            Text(stringResource(R.string.edit_group_new), color = p.textFaint, fontSize = 16.sp)
                        }
                        androidx.compose.foundation.text.BasicTextField(
                            value = typed,
                            onValueChange = { typed = it.take(MAX_GROUP_LEN) },
                            singleLine = true,
                            textStyle = androidx.compose.ui.text.TextStyle(color = p.text, fontSize = 16.sp),
                            cursorBrush = androidx.compose.ui.graphics.SolidColor(p.accent),
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                                imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                            ),
                            keyboardActions = androidx.compose.foundation.text.KeyboardActions(
                                onDone = { if (typed.isNotBlank()) onName(typed) },
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (typed.isNotBlank()) {
                        Spacer(Modifier.width(GapItem))
                        Icon(
                            XIcons.Check,
                            contentDescription = stringResource(R.string.edit_group_new),
                            tint = p.accent,
                            modifier = Modifier.size(24.dp).clickable { onName(typed) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun GroupRow(title: String, detail: String?, checked: Boolean, onClick: () -> Unit) {
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
            if (detail != null) {
                Text(detail, color = p.textDim, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (checked) {
            Spacer(Modifier.width(GapItem))
            Icon(XIcons.Check, contentDescription = stringResource(R.string.edit_selected), tint = p.accent, modifier = Modifier.size(20.dp))
        }
    }
}
