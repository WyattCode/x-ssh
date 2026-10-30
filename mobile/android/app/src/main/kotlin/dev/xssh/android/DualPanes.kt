package dev.xssh.android

/**
 * 折叠屏内屏双终端的窗格状态(纯逻辑,无 Compose)。
 *
 * 双窗格是**渲染形态**,不是 [Screen] 目的地 —— `App` 里用 `termHostId`(左/主)
 * + `termCompanionId`(右/副) 推导;合上外屏时不清副 id,会话仍在 [SessionRegistry]。
 */
enum class PaneSide { Left, Right }

/**
 * 这一帧该画哪几个窗格。
 *
 * [dual] 为真时左右都画;[leftId]/[rightId] 是主机 id。
 * 窄屏 / 外屏时只返回聚焦侧那一个([rightId] 为 null),副会话的 id 仍由 `App` 的
 * `termCompanionId` 自己留着,展开后原样配对。
 */
data class DualPanes(
    val leftId: String?,
    val rightId: String?,
    val focus: PaneSide,
) {
    val dual: Boolean get() = leftId != null && rightId != null && leftId != rightId

    /** 当前该收键盘 / 快捷键的那台主机 id。 */
    val focusedId: String?
        get() = when (focus) {
            PaneSide.Left -> leftId
            PaneSide.Right -> rightId ?: leftId
        }
}

/**
 * 从窗口是否够宽 + 主/副会话 id 推出这一帧的窗格。
 *
 * - 没有主会话 → 空。
 * - 不够宽,或没有不同的副会话 → 单窗格,显示**聚焦侧**那台(合上时右聚焦就显示副)。
 * - 够宽且副存在且不同 → 双窗格。
 */
fun resolveDualPanes(
    wide: Boolean,
    primaryId: String?,
    companionId: String?,
    focus: PaneSide,
): DualPanes {
    if (primaryId == null) return DualPanes(null, null, PaneSide.Left)
    val companion = companionId?.takeIf { it != primaryId }
    if (!wide || companion == null) {
        val show = when {
            companion != null && focus == PaneSide.Right -> companion
            else -> primaryId
        }
        return DualPanes(show, null, PaneSide.Left)
    }
    return DualPanes(primaryId, companion, focus)
}

/** 左右互换。返回新的 (primaryId, companionId)。 */
fun swapPanes(primaryId: String?, companionId: String?): Pair<String?, String?> {
    if (primaryId == null || companionId == null || primaryId == companionId) {
        return primaryId to companionId
    }
    return companionId to primaryId
}

/**
 * 关掉当前聚焦的那一窗格,退回单窗格。
 *
 * - 关左 / 关唯一窗格且副还在 → 副升主,副清空。
 * - 关右 → 只清副,主不动。
 * 不碰 [SessionRegistry] —— 断开会话由调用方按既有 disconnect 路径做。
 * 返回新的 (primaryId, companionId, focus)。
 */
fun closeFocusedPane(
    primaryId: String?,
    companionId: String?,
    focus: PaneSide,
): Triple<String?, String?, PaneSide> {
    if (primaryId == null) return Triple(null, null, PaneSide.Left)
    val companion = companionId?.takeIf { it != primaryId }
    return when {
        companion == null -> Triple(null, null, PaneSide.Left)
        focus == PaneSide.Right -> Triple(primaryId, null, PaneSide.Left)
        else -> Triple(companion, null, PaneSide.Left)
    }
}

/**
 * 在右侧打开 [besideId]。已是副窗格则只把焦点挪过去;与主相同则忽略。
 * 返回 (primaryId, companionId, focus)。
 */
fun openBeside(
    primaryId: String?,
    companionId: String?,
    besideId: String,
): Triple<String?, String?, PaneSide> {
    if (primaryId == null) return Triple(besideId, null, PaneSide.Left)
    if (besideId == primaryId) return Triple(primaryId, companionId?.takeIf { it != primaryId }, PaneSide.Left)
    return Triple(primaryId, besideId, PaneSide.Right)
}
