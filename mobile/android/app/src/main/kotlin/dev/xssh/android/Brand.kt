package dev.xssh.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material3.Text
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 字标「X SSH」(和桌面版侧栏同一个标识,build/icon-src/make_icons.py 按密度出图):
 * 白天 / 夜间两张,跟着应用自己的深浅色走(不是系统的 night 资源 —— 应用可以单独选浅色 / 深色)。
 * 图已经裁到不透明部分,左边缘就是 X 的笔画,所以**不用** TitleOptical 那 2dp 的字形补偿:
 * 它的左边直接站在版心线上,和下面的副标题、卡片对齐。
 */
@Composable
fun BrandLockup(height: Dp, modifier: Modifier = Modifier) {
    val p = LocalXssh.current
    val bitmap = ImageBitmap.imageResource(if (p.dark) R.drawable.logo_lockup_dark else R.drawable.logo_lockup_light)
    // 平板侧栏把 28dp 的图缩到 18dp:高质量缩放,细笔画不起锯齿。
    val painter = remember(bitmap) { BitmapPainter(bitmap, filterQuality = FilterQuality.High) }
    Image(
        painter = painter,
        contentDescription = "X-SSH",
        modifier = modifier.height(height).aspectRatio(bitmap.width.toFloat() / bitmap.height),
    )
}

/**
 * 大标题位上的字标:占一行 [titleSize] 粗体文字的行高(透明占位),字标在这一行里竖直居中 ——
 * 折叠屏两栏时,右栏的文字大标题和左栏的字标还在同一条线上,换字标不挪动下面任何东西。
 */
@Composable
fun BrandTitleLine(logoHeight: Dp, titleSize: TextUnit = 34.sp, modifier: Modifier = Modifier) {
    Box(modifier, contentAlignment = Alignment.CenterStart) {
        Text(" ", color = Color.Transparent, fontSize = titleSize, fontWeight = FontWeight.Bold, maxLines = 1)
        BrandLockup(logoHeight)
    }
}

/** 直板机 / 折叠屏大标题位的字标高度:比同位置 34sp 文字的视觉分量略轻(用户定的「缩小约 10%」)。 */
val BrandTitleHeight = 28.dp

/** 平板侧栏顶栏里的字标高度(原来是 20sp 的「X-SSH」)。 */
val BrandToolbarHeight = 18.dp
