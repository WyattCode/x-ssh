package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

enum class ButtonKind { Primary, Ghost, Danger }

/** 卡片:与 Windows 版 `.card` 同款(圆角 10、1px 边框、elev 背景)。 */
@Composable
fun XsshCard(
    modifier: Modifier = Modifier,
    highlight: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = LocalXssh.current
    Column(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .background(p.bgElev)
            .border(1.dp, if (highlight) p.accent.copy(alpha = 0.55f) else p.border, RoundedCornerShape(10.dp))
            .let { if (onClick != null) it.clickable { onClick() } else it }
            .padding(14.dp),
        content = content,
    )
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
    val background = when (kind) {
        ButtonKind.Primary -> p.accent
        ButtonKind.Ghost -> Color.Transparent
        ButtonKind.Danger -> Color.Transparent
    }
    val foreground = when (kind) {
        ButtonKind.Primary -> p.bg
        ButtonKind.Ghost -> p.text
        ButtonKind.Danger -> p.danger
    }
    val borderColor = when (kind) {
        ButtonKind.Primary -> Color.Transparent
        ButtonKind.Ghost -> p.borderStrong
        ButtonKind.Danger -> p.danger.copy(alpha = 0.55f)
    }
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (enabled) background else background.copy(alpha = 0.35f))
            .border(1.dp, if (enabled) borderColor else borderColor.copy(alpha = 0.4f), RoundedCornerShape(10.dp))
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (enabled) foreground else foreground.copy(alpha = 0.4f),
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

/** 终端快捷键(≥44dp 触摸目标)。 */
@Composable
fun KeyCap(label: String, active: Boolean = false, onPress: () -> Unit) {
    val p = LocalXssh.current
    Box(
        Modifier
            .padding(horizontal = 3.dp, vertical = 3.dp)
            .heightIn(min = 44.dp)
            .defaultMinSize(minWidth = 46.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (active) p.accentSoft else p.bgElev2)
            .border(1.dp, if (active) p.accent else p.border, RoundedCornerShape(8.dp))
            .clickable { onPress() }
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (active) p.accent else p.text,
            fontFamily = FontFamily.Monospace,
            fontSize = 13.sp,
        )
    }
}

@Composable
fun KeyCapRow(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Composable
fun StatusDot(color: Color) {
    Box(
        Modifier
            .defaultMinSize(minWidth = 8.dp, minHeight = 8.dp)
            .clip(CircleShape)
            .background(color),
    )
}

@Composable
fun SectionLabel(text: String) {
    Text(
        text = text,
        color = LocalXssh.current.textFaint,
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        modifier = Modifier.padding(start = 2.dp, bottom = 6.dp),
    )
}

@Composable
fun xsshFieldColors(): TextFieldColors {
    val p = LocalXssh.current
    return OutlinedTextFieldDefaults.colors(
        focusedBorderColor = p.accent,
        unfocusedBorderColor = p.borderStrong,
        focusedTextColor = p.text,
        unfocusedTextColor = p.text,
        cursorColor = p.accent,
        focusedLabelColor = p.accent,
        unfocusedLabelColor = p.textFaint,
        focusedContainerColor = p.bg,
        unfocusedContainerColor = p.bg,
    )
}