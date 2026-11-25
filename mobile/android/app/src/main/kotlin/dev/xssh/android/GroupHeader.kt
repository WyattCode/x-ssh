package dev.xssh.android

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 分组标题:`名称  数量`,点一下折叠 / 展开这一组。手机首页和平板侧栏共用。
 *
 * [name] 为空 = 「未分组」那一堆。折叠状态由调用方记着(搜索时一律展开,见各自的列表)。
 */
@Composable
internal fun GroupHeader(
    name: String,
    count: Int,
    collapsed: Boolean,
    onToggle: () -> Unit,
    startPad: Dp,
    modifier: Modifier = Modifier,
) {
    val p = LocalXssh.current
    val label = name.ifEmpty { stringResource(R.string.group_none) }
    val stateText = stringResource(if (collapsed) R.string.group_collapsed else R.string.group_expanded)
    Row(
        modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .semantics {
                role = Role.Button
                contentDescription = "$label, $count"
                stateDescription = stateText
            }
            .padding(start = startPad, end = 12.dp, top = 12.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            XIcons.Chevron,
            contentDescription = null,
            tint = p.textFaint,
            // 展开时朝下,折叠时朝右。
            modifier = Modifier.size(14.dp).rotate(if (collapsed) 0f else 90f),
        )
        androidx.compose.material3.Text(
            label,
            color = p.textDim,
            fontFamily = XsshFonts.monoUi,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(start = 6.dp),
        )
        androidx.compose.material3.Text(
            count.toString(),
            color = p.textFaint,
            fontFamily = XsshFonts.monoUi,
            fontSize = 12.sp,
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}
