package dev.xssh.android

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * 轨道和按键上用的线性图标。
 *
 * 原来用文字符号(⌕ ＋ ‹ ✓ ⌨ ✕):不同字符来自不同字体,粗细、大小、基线各不一样,
 * 放进同一排圆钮里高低不齐;⏻ 这种还会因为缺字显示成豆腐块。
 * 这里统一画成 24dp 画布、1.8dp 线宽、圆头圆角的线条 —— 和参考图的 SF Symbols 同一种语气。
 * 颜色由调用方 tint,这里的描边色只是占位。
 */
object XIcons {
    private fun icon(name: String, block: PathBuilder.() -> Unit): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
            .path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.8f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = block,
            )
            .build()

    val Search = icon("search") {
        // 放大镜:圆 + 斜柄
        moveTo(17f, 10.5f)
        arcTo(6.5f, 6.5f, 0f, true, true, 4f, 10.5f)
        arcTo(6.5f, 6.5f, 0f, true, true, 17f, 10.5f)
        moveTo(15.3f, 15.3f)
        lineTo(20f, 20f)
    }

    val Plus = icon("plus") {
        moveTo(12f, 5f); lineTo(12f, 19f)
        moveTo(5f, 12f); lineTo(19f, 12f)
    }

    val Back = icon("back") {
        moveTo(14.5f, 5.5f); lineTo(8f, 12f); lineTo(14.5f, 18.5f)
    }

    val Check = icon("check") {
        moveTo(5f, 12.5f); lineTo(9.8f, 17.2f); lineTo(19f, 7.2f)
    }

    val Close = icon("close") {
        moveTo(6.5f, 6.5f); lineTo(17.5f, 17.5f)
        moveTo(17.5f, 6.5f); lineTo(6.5f, 17.5f)
    }

    val Keyboard = icon("keyboard") {
        // 外框
        moveTo(5.5f, 6.5f); lineTo(18.5f, 6.5f)
        arcTo(2.5f, 2.5f, 0f, false, true, 21f, 9f)
        lineTo(21f, 15f)
        arcTo(2.5f, 2.5f, 0f, false, true, 18.5f, 17.5f)
        lineTo(5.5f, 17.5f)
        arcTo(2.5f, 2.5f, 0f, false, true, 3f, 15f)
        lineTo(3f, 9f)
        arcTo(2.5f, 2.5f, 0f, false, true, 5.5f, 6.5f)
        close()
        // 一排键 + 空格
        moveTo(7f, 10.5f); lineTo(7.01f, 10.5f)
        moveTo(10.3f, 10.5f); lineTo(10.31f, 10.5f)
        moveTo(13.7f, 10.5f); lineTo(13.71f, 10.5f)
        moveTo(17f, 10.5f); lineTo(17.01f, 10.5f)
        moveTo(8.5f, 14f); lineTo(15.5f, 14f)
    }

    val ArrowDown = icon("arrowDown") {
        moveTo(12f, 5f); lineTo(12f, 18.5f)
        moveTo(6.5f, 13f); lineTo(12f, 18.5f); lineTo(17.5f, 13f)
    }

    val Sun = icon("sun") {
        // 圆 + 八道光
        moveTo(16f, 12f)
        arcTo(4f, 4f, 0f, true, true, 8f, 12f)
        arcTo(4f, 4f, 0f, true, true, 16f, 12f)
        moveTo(12f, 2.8f); lineTo(12f, 4.6f)
        moveTo(12f, 19.4f); lineTo(12f, 21.2f)
        moveTo(2.8f, 12f); lineTo(4.6f, 12f)
        moveTo(19.4f, 12f); lineTo(21.2f, 12f)
        moveTo(5.5f, 5.5f); lineTo(6.8f, 6.8f)
        moveTo(17.2f, 17.2f); lineTo(18.5f, 18.5f)
        moveTo(5.5f, 18.5f); lineTo(6.8f, 17.2f)
        moveTo(17.2f, 6.8f); lineTo(18.5f, 5.5f)
    }

    val Moon = icon("moon") {
        // 月牙:大圆弧外沿 + 内切的小圆弧
        moveTo(19.5f, 14.2f)
        arcTo(8f, 8f, 0f, true, true, 9.8f, 4.5f)
        arcTo(6.2f, 6.2f, 0f, false, false, 19.5f, 14.2f)
        close()
    }

    /** 跟随系统:左半实心的圆(和 iOS 的 circle.lefthalf.filled 同一个意思)。 */
    val Auto: ImageVector = ImageVector.Builder("auto", 24.dp, 24.dp, 24f, 24f)
        .path(fill = SolidColor(Color.Black)) {
            moveTo(12f, 3.8f)
            arcTo(8.2f, 8.2f, 0f, false, false, 12f, 20.2f)
            close()
        }
        .path(
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.8f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        ) {
            moveTo(20.2f, 12f)
            arcTo(8.2f, 8.2f, 0f, true, true, 3.8f, 12f)
            arcTo(8.2f, 8.2f, 0f, true, true, 20.2f, 12f)
        }
        .build()

    val Return = icon("return") {
        // ⏎:从右上下来,折向左边,箭头朝左
        moveTo(18.5f, 6f); lineTo(18.5f, 12.5f)
        arcTo(2.5f, 2.5f, 0f, false, true, 16f, 15f)
        lineTo(6f, 15f)
        moveTo(9.8f, 11.2f); lineTo(6f, 15f); lineTo(9.8f, 18.8f)
    }
}
