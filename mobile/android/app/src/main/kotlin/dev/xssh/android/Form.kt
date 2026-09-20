package dev.xssh.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/* ─────────────────────────── 移动端表单 ───────────────────────────

   不用桌面那套"每个字段一个描边框"的排法。手机上更顺的是**分组行式列表**:
   一组字段装在一块圆角面板里,每行左边是标签、右边是值,行与行之间一条内缩的细线。
   手指点一行就在那一行里改,视线不用在框和标签之间来回跳。
*/

/** 一组表单行。[title] 是组标题(写在面板外面),[footnote] 是组下面的小字说明。 */
@Composable
fun FormGroup(
    title: String? = null,
    footnote: String? = null,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = LocalXssh.current
    Column(modifier.fillMaxWidth()) {
        if (title != null) {
            Text(
                title,
                color = p.textFaint,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(start = BoxPad, bottom = 8.dp),
            )
        }
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(RadiusBox))
                .background(p.bgElev),
            content = content,
        )
        if (footnote != null) {
            Text(
                footnote,
                color = p.textFaint,
                fontSize = 12.sp,
                modifier = Modifier.padding(start = BoxPad, top = 8.dp),
            )
        }
    }
}

/** 组内行与行之间的分隔线:左边内缩,让它读起来像"同一组里的下一行"。 */
@Composable
fun FormDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = BoxPad)
            .height(1.dp)
            .background(LocalXssh.current.border),
    )
}

/**
 * 可编辑的一行:左标签、右取值。
 *
 * 值用 [BasicTextField] 自己画,不用 Material 的描边输入框 —— 那个框在手机上
 * 既占地方又把一行拆成两层。这里点哪一行就在哪一行里改。
 */
@Composable
fun FormField(
    label: String,
    value: String,
    onValue: (String) -> Unit,
    placeholder: String = "",
    mono: Boolean = false,
    secret: Boolean = false,
    keyboard: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    /**
     * 长值(文件路径之类)改成上下排:标签在上、值在下占满整行。
     * 右对齐的单行放不下一条路径,只会从中间切掉,既看不全也没法确认改对没有。
     */
    stacked: Boolean = false,
) {
    val p = LocalXssh.current
    if (stacked) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = BoxPad, vertical = 12.dp),
        ) {
            Text(label, color = p.textDim, fontSize = 12.sp)
            Spacer(Modifier.height(4.dp))
            Box {
                if (value.isEmpty() && placeholder.isNotEmpty()) {
                    Text(
                        placeholder,
                        color = p.textFaint,
                        fontSize = 14.sp,
                        fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValue,
                    textStyle = TextStyle(
                        color = p.text,
                        fontSize = 14.sp,
                        fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
                    ),
                    keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = imeAction),
                    cursorBrush = SolidColor(p.accent),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        return
    }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = BoxPad),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = p.textDim, fontSize = 14.sp)
        Spacer(Modifier.width(GapItem))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            if (value.isEmpty() && placeholder.isNotEmpty()) {
                Text(
                    placeholder,
                    color = p.textFaint,
                    fontSize = 15.sp,
                    fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
                    textAlign = TextAlign.End,
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValue,
                singleLine = true,
                textStyle = TextStyle(
                    color = p.text,
                    fontSize = 15.sp,
                    fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
                    textAlign = TextAlign.End,
                ),
                visualTransformation =
                    if (secret) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = imeAction),
                cursorBrush = SolidColor(p.accent),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** 只读/可点的一行(删除之类)。[danger] 为真时整行用危险色。 */
@Composable
fun FormAction(label: String, danger: Boolean = false, onClick: () -> Unit) {
    val p = LocalXssh.current
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable { onClick() }
            .padding(horizontal = BoxPad),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(label, color = if (danger) p.danger else p.text, fontSize = 15.sp)
    }
}

/**
 * 分段选择(私钥 / 密码)。
 *
 * 比两个并排的按钮好在:它是一个整体,一眼看得出"这几个里选一个",
 * 而不是"两个都能按"。
 */
@Composable
fun Segmented(options: List<String>, selectedIndex: Int, onSelect: (Int) -> Unit) {
    val p = LocalXssh.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = BoxPad, vertical = 10.dp)
            .clip(RoundedCornerShape(RadiusBox))
            .background(p.bgElev2)
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        options.forEachIndexed { index, label ->
            val on = index == selectedIndex
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = 42.dp)
                    .clip(RoundedCornerShape(RadiusChip + 2.dp))
                    .background(if (on) p.accentSoft else androidx.compose.ui.graphics.Color.Transparent)
                    .clickable { onSelect(index) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    color = if (on) p.accent else p.textDim,
                    fontSize = 14.sp,
                    fontWeight = if (on) FontWeight.Medium else FontWeight.Normal,
                )
            }
        }
    }
}
