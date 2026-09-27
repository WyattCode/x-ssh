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

    /** 主机:终端提示符 >_ 。 */
    val Terminal = icon("terminal") {
        moveTo(6f, 7.5f); lineTo(10.5f, 12f); lineTo(6f, 16.5f)
        moveTo(12.5f, 16.5f); lineTo(18f, 16.5f)
    }

    /** 命令片段:闪电(点一下就发出去的「快捷命令」)。 */
    val Bolt = icon("bolt") {
        moveTo(13.5f, 3f); lineTo(5.5f, 13.5f); lineTo(11.5f, 13.5f)
        lineTo(10.5f, 21f); lineTo(18.5f, 10.5f); lineTo(12.5f, 10.5f); close()
    }

    /** 快捷键面板:⌘(和 Mac 键盘上的 command 同一个符号)。 */
    val Command = icon("command") {
        moveTo(9f, 9f); lineTo(15f, 9f); lineTo(15f, 15f); lineTo(9f, 15f); close()
        moveTo(9f, 9f); lineTo(9f, 6.5f); arcTo(2.5f, 2.5f, 0f, true, false, 6.5f, 9f); lineTo(9f, 9f)
        moveTo(15f, 9f); lineTo(15f, 6.5f); arcTo(2.5f, 2.5f, 0f, true, true, 17.5f, 9f); lineTo(15f, 9f)
        moveTo(15f, 15f); lineTo(17.5f, 15f); arcTo(2.5f, 2.5f, 0f, true, true, 15f, 17.5f); lineTo(15f, 15f)
        moveTo(9f, 15f); lineTo(9f, 17.5f); arcTo(2.5f, 2.5f, 0f, true, true, 6.5f, 15f); lineTo(9f, 15f)
    }

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

    /** 显示 / 隐藏侧边栏(平板):圆角框 + 左侧一道竖线,和 iPad 的 sidebar.left 同一个意思。 */
    val Sidebar = icon("sidebar") {
        moveTo(6f, 5f); lineTo(18f, 5f)
        arcTo(2.5f, 2.5f, 0f, false, true, 20.5f, 7.5f)
        lineTo(20.5f, 16.5f)
        arcTo(2.5f, 2.5f, 0f, false, true, 18f, 19f)
        lineTo(6f, 19f)
        arcTo(2.5f, 2.5f, 0f, false, true, 3.5f, 16.5f)
        lineTo(3.5f, 7.5f)
        arcTo(2.5f, 2.5f, 0f, false, true, 6f, 5f)
        close()
        moveTo(9.5f, 5f); lineTo(9.5f, 19f)
        moveTo(5.8f, 8.5f); lineTo(7.2f, 8.5f)
        moveTo(5.8f, 11f); lineTo(7.2f, 11f)
    }

    val Pencil = icon("pencil") {
        moveTo(4.5f, 19.5f); lineTo(5.3f, 15.6f); lineTo(15.6f, 5.3f)
        arcTo(1.9f, 1.9f, 0f, false, true, 18.3f, 5.3f)
        lineTo(18.7f, 5.7f)
        arcTo(1.9f, 1.9f, 0f, false, true, 18.7f, 8.4f)
        lineTo(8.4f, 18.7f); close()
        moveTo(13.8f, 7.1f); lineTo(16.9f, 10.2f)
    }

    val Trash = icon("trash") {
        moveTo(4.5f, 7f); lineTo(19.5f, 7f)
        moveTo(9.5f, 7f); lineTo(9.5f, 5f); lineTo(14.5f, 5f); lineTo(14.5f, 7f)
        moveTo(6.5f, 7f); lineTo(7.4f, 18.2f)
        arcTo(2f, 2f, 0f, false, false, 9.4f, 20f)
        lineTo(14.6f, 20f)
        arcTo(2f, 2f, 0f, false, false, 16.6f, 18.2f)
        lineTo(17.5f, 7f)
        moveTo(10.2f, 10.5f); lineTo(10.4f, 16.5f)
        moveTo(13.8f, 10.5f); lineTo(13.6f, 16.5f)
    }

    /** 更多:横排三点。 */
    val More = icon("more") {
        // 每个点画成半径 0.9 的小圆:描边 1.8 之后是一颗实心的 3.6dp 圆点(零长线段只有 1.8dp,太小)。
        for (x in floatArrayOf(6f, 12f, 18f)) {
            moveTo(x + 0.9f, 12f)
            arcTo(0.9f, 0.9f, 0f, true, true, x - 0.9f, 12f)
            arcTo(0.9f, 0.9f, 0f, true, true, x + 0.9f, 12f)
        }
    }

    /** 文件夹(SFTP 文件面板)。 */
    val Folder = icon("folder") {
        moveTo(3.5f, 7.5f)
        arcTo(2f, 2f, 0f, false, true, 5.5f, 5.5f)
        lineTo(9.3f, 5.5f); lineTo(11.3f, 7.8f); lineTo(18.5f, 7.8f)
        arcTo(2f, 2f, 0f, false, true, 20.5f, 9.8f)
        lineTo(20.5f, 16.5f)
        arcTo(2f, 2f, 0f, false, true, 18.5f, 18.5f)
        lineTo(5.5f, 18.5f)
        arcTo(2f, 2f, 0f, false, true, 3.5f, 16.5f)
        close()
    }

    val FolderPlus = icon("folderPlus") {
        moveTo(3.5f, 7.5f)
        arcTo(2f, 2f, 0f, false, true, 5.5f, 5.5f)
        lineTo(9.3f, 5.5f); lineTo(11.3f, 7.8f); lineTo(18.5f, 7.8f)
        arcTo(2f, 2f, 0f, false, true, 20.5f, 9.8f)
        lineTo(20.5f, 16.5f)
        arcTo(2f, 2f, 0f, false, true, 18.5f, 18.5f)
        lineTo(5.5f, 18.5f)
        arcTo(2f, 2f, 0f, false, true, 3.5f, 16.5f)
        close()
        moveTo(12f, 10.5f); lineTo(12f, 15.5f)
        moveTo(9.5f, 13f); lineTo(14.5f, 13f)
    }

    /** 文件:折角的纸。 */
    val File = icon("file") {
        moveTo(13.5f, 3.5f); lineTo(7f, 3.5f)
        arcTo(2f, 2f, 0f, false, false, 5f, 5.5f)
        lineTo(5f, 18.5f)
        arcTo(2f, 2f, 0f, false, false, 7f, 20.5f)
        lineTo(17f, 20.5f)
        arcTo(2f, 2f, 0f, false, false, 19f, 18.5f)
        lineTo(19f, 9f); close()
        moveTo(13.5f, 3.5f); lineTo(13.5f, 9f); lineTo(19f, 9f)
    }

    /** 上传:托盘 + 向上箭头。 */
    val Upload = icon("upload") {
        moveTo(12f, 15f); lineTo(12f, 4.5f)
        moveTo(7.5f, 9f); lineTo(12f, 4.5f); lineTo(16.5f, 9f)
        moveTo(4.5f, 14.5f); lineTo(4.5f, 17.5f)
        arcTo(2f, 2f, 0f, false, false, 6.5f, 19.5f)
        lineTo(17.5f, 19.5f)
        arcTo(2f, 2f, 0f, false, false, 19.5f, 17.5f)
        lineTo(19.5f, 14.5f)
    }

    val Refresh = icon("refresh") {
        moveTo(19f, 12f)
        arcTo(7f, 7f, 0f, true, true, 16.9f, 7f)
        moveTo(17.5f, 3.8f); lineTo(17.5f, 7.5f); lineTo(13.8f, 7.5f)
    }

    /** 上一级目录。 */
    val ArrowUp = icon("arrowUp") {
        moveTo(12f, 19f); lineTo(12f, 5.5f)
        moveTo(6.5f, 11f); lineTo(12f, 5.5f); lineTo(17.5f, 11f)
    }

    /** 面包屑分隔。 */
    val Chevron = icon("chevron") {
        moveTo(9.5f, 6f); lineTo(15.5f, 12f); lineTo(9.5f, 18f)
    }

    /** 符号链接:两个扣在一起的环。 */
    val Link = icon("link") {
        moveTo(10.5f, 13.5f); lineTo(13.5f, 10.5f)
        moveTo(11f, 7.5f); lineTo(12.8f, 5.7f)
        arcTo(3.3f, 3.3f, 0f, false, true, 18.3f, 11.2f)
        lineTo(16.5f, 13f)
        moveTo(13f, 16.5f); lineTo(11.2f, 18.3f)
        arcTo(3.3f, 3.3f, 0f, false, true, 5.7f, 12.8f)
        lineTo(7.5f, 11f)
    }

    /** 主机身份(首次连接确认主机密钥):盾牌 + 勾。 */
    val Shield = icon("shield") {
        moveTo(12f, 3.2f); lineTo(19f, 5.8f); lineTo(19f, 11.2f)
        curveTo(19f, 15.6f, 16.1f, 19f, 12f, 20.8f)
        curveTo(7.9f, 19f, 5f, 15.6f, 5f, 11.2f)
        lineTo(5f, 5.8f); close()
        moveTo(8.8f, 12f); lineTo(11.2f, 14.4f); lineTo(15.4f, 9.8f)
    }

    /** 终端字体:大写 A 加小写 a。 */
    val Font = icon("font") {
        moveTo(2.6f, 18.5f); lineTo(7.6f, 6f); lineTo(12.6f, 18.5f)
        moveTo(4.6f, 13.8f); lineTo(10.6f, 13.8f)
        moveTo(21.4f, 11.6f); lineTo(21.4f, 18.5f)
        moveTo(21.4f, 13.6f)
        curveTo(21.4f, 11.9f, 20.2f, 11f, 18.6f, 11f)
        curveTo(17.5f, 11f, 16.6f, 11.4f, 16.1f, 12f)
        moveTo(21.4f, 15.6f)
        lineTo(18.4f, 15.6f)
        curveTo(16.8f, 15.6f, 15.8f, 16.3f, 15.8f, 17.3f)
        curveTo(15.8f, 18.3f, 16.7f, 18.9f, 18f, 18.9f)
        curveTo(19.7f, 18.9f, 21.4f, 17.8f, 21.4f, 16.2f)
    }

    /** 主机信息:圆圈里一个 i(iOS 列表行尾的 ⓘ)。 */
    val Info = icon("info") {
        moveTo(12f, 3.8f)
        arcTo(8.2f, 8.2f, 0f, true, true, 11.99f, 3.8f)
        moveTo(12f, 11f); lineTo(12f, 16.2f)
        moveTo(12f, 7.9f); lineTo(12.01f, 7.9f)
    }

    /**
     * 看一眼密码:眼睛。
     *
     * 杏仁形上下对称(在 y=12 上下各 6.5),瞳孔 r=2.8 —— 比例照着通用的线性眼睛图标,
     * 太扁会糊成一条缝,太圆又像个球。和 [EyeOff] **只差一道斜杠**,
     * 切换时图形不跳,一眼能看出是同一个开关的两个状态。
     */
    val Eye = icon("eye") {
        moveTo(2.5f, 12f)
        curveTo(5.3f, 7.4f, 8.6f, 5.5f, 12f, 5.5f)
        curveTo(15.4f, 5.5f, 18.7f, 7.4f, 21.5f, 12f)
        curveTo(18.7f, 16.6f, 15.4f, 18.5f, 12f, 18.5f)
        curveTo(8.6f, 18.5f, 5.3f, 16.6f, 2.5f, 12f)
        close()
        // 瞳孔:整圆。**起点必须是圆的顶点** —— arcTo 画整圆时圆心落在"起点正下方 r 处",
        // 从右侧起笔的话圆心会歪到右上,瞳孔跑出眼眶(画歪过一次,看着像条鱼)。
        // 终点比起点差一丁点,否则 arcTo 认为"没动"就不画。
        moveTo(12f, 9.2f)
        arcTo(2.8f, 2.8f, 0f, true, true, 11.99f, 9.2f)
    }

    /** 盖住密码:同一只眼睛 + 一道斜杠。 */
    val EyeOff = icon("eyeOff") {
        moveTo(2.5f, 12f)
        curveTo(5.3f, 7.4f, 8.6f, 5.5f, 12f, 5.5f)
        curveTo(15.4f, 5.5f, 18.7f, 7.4f, 21.5f, 12f)
        curveTo(18.7f, 16.6f, 15.4f, 18.5f, 12f, 18.5f)
        curveTo(8.6f, 18.5f, 5.3f, 16.6f, 2.5f, 12f)
        close()
        moveTo(12f, 9.2f)
        arcTo(2.8f, 2.8f, 0f, true, true, 11.99f, 9.2f)
        // 斜杠从左下到右上,两端收在杏仁形之内一点,不顶到边框角上。
        moveTo(4.5f, 19.5f)
        lineTo(19.5f, 4.5f)
    }

    /** 警告:三角 + 感叹号(主机密钥变了、连接失败)。 */
    val Alert = icon("alert") {
        moveTo(12f, 4f); lineTo(21f, 19.5f); lineTo(3f, 19.5f); close()
        moveTo(12f, 9.8f); lineTo(12f, 13.8f)
        moveTo(12f, 16.6f); lineTo(12.01f, 16.6f)
    }

    val Return = icon("return") {
        // ⏎:从右上下来,折向左边,箭头朝左
        moveTo(18.5f, 6f); lineTo(18.5f, 12.5f)
        arcTo(2.5f, 2.5f, 0f, false, true, 16f, 15f)
        lineTo(6f, 15f)
        moveTo(9.8f, 11.2f); lineTo(6f, 15f); lineTo(9.8f, 18.8f)
    }
}
