package dev.xssh.android

import uniffi.xssh_ffi.ViewSelection

/** 视口里的一个格子(行、列都从 0 起)。[rightHalf]:落在格子的右半边(往回拖时决定起点这一格算不算)。 */
data class GridCell(val row: Int, val col: Int, val rightHalf: Boolean = false)

/**
 * 选区落在视口里的部分,只用来画高亮。
 *
 * 选区本身记在 Rust 核心里(alacritty 的 Selection,网格坐标):新输出滚上来时跟着内容走,
 * 可以一直选进回滚历史;取文字、按词 / 按行扩展也都在核心里做。
 */
data class TermSelection(val start: GridCell, val end: GridCell) {
    /** 第 [row] 行被选中的列区间(闭区间);不在选区里返回 null。 */
    fun colsOn(row: Int, cols: Int): IntRange? {
        if (row < start.row || row > end.row) return null
        val from = if (row == start.row) start.col else 0
        val to = if (row == end.row) end.col else cols - 1
        return from.coerceAtLeast(0)..to.coerceAtMost(cols - 1)
    }
}

fun ViewSelection.toTermSelection() = TermSelection(
    GridCell(startRow.toInt(), startCol.toInt()),
    GridCell(endRow.toInt(), endCol.toInt()),
)
