package dev.xssh.android

import kotlinx.coroutines.delay
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.ui.draw.shadow
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
                color = p.textDim,
                fontSize = 13.sp,
                modifier = Modifier.padding(start = BoxPad, bottom = 7.dp),
            )
        }
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(RadiusBox))
                // 和主机卡片同一个底色:整个应用的"卡片"只有这一种灰。
                .background(p.cardBg),
            content = content,
        )
        if (footnote != null) {
            Text(
                footnote,
                color = p.textDim,
                fontSize = 13.sp,
                modifier = Modifier.padding(start = BoxPad, end = BoxPad, top = 7.dp),
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
            // 细线:0.5dp。1dp 的线在分组块里太重,像把一块切成了几块。
            .height(0.5.dp)
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
) {
    val p = LocalXssh.current
    // 聚焦时把这一行连同下面一截 [LocalFieldClearance] 一起滚进视野:
    // 右下角悬浮的按钮随键盘升起,不这样的话,正在输入的取值正好被按钮盖住。
    val clearance = LocalFieldClearance.current
    val requester = remember { BringIntoViewRequester() }
    var focused by remember { mutableStateOf(false) }
    var rowSize by remember { mutableStateOf(IntSize.Zero) }
    val density = LocalDensity.current

    @OptIn(ExperimentalLayoutApi::class)
    val imeUp = WindowInsets.isImeVisible
    LaunchedEffect(focused, imeUp) {
        if (!focused || !imeUp || clearance == 0.dp) return@LaunchedEffect
        // 等键盘升完、可滚动区域缩好,再算要滚多少。
        delay(320)
        val extra = with(density) { clearance.toPx() }
        requester.bringIntoView(Rect(0f, 0f, rowSize.width.toFloat(), rowSize.height + extra))
    }
    Row(
        Modifier
            .fillMaxWidth()
            .bringIntoViewRequester(requester)
            .onSizeChanged { rowSize = it }
            .onFocusChanged { focused = it.hasFocus }
            .heightIn(min = 52.dp)
            .padding(horizontal = BoxPad),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 标签用主文字色、取值右对齐 —— iOS 设置页的写法。
        Text(label, color = p.text, fontSize = 16.sp)
        Spacer(Modifier.width(GapItem))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            if (value.isEmpty() && placeholder.isNotEmpty()) {
                Text(
                    placeholder,
                    color = p.textFaint,
                    fontSize = 16.sp,
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
                    fontSize = 16.sp,
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
        Text(label, color = if (danger) p.danger else p.accent, fontSize = 16.sp)
    }
}

/** 表单行聚焦时,除了自己还要额外露出的高度(给悬浮在右下角的按钮让位)。 */
val LocalFieldClearance = compositionLocalOf { 0.dp }
