package dev.xssh.android

/**
 * 导入 / 生成私钥之后,「用生物识别解锁」该不该打开。
 *
 * 纯函数、不碰密钥库 —— 单测在 JVM 上跑。真正的加解密仍走 [Secrets]。
 */
internal object LockPolicy {
    /**
     * @param lockAvailable 设备能不能弹生物识别 / 锁屏密码([Secrets.lockAvailable])
     * @param userChoice 用户亲手拨过开关的值;null = 还没碰过
     * @param currentlyLocked 现在的 draft.lockSecrets
     */
    fun afterKeyAdded(
        lockAvailable: Boolean,
        userChoice: Boolean?,
        currentlyLocked: Boolean,
    ): Boolean = when {
        !lockAvailable -> currentlyLocked
        userChoice != null -> userChoice
        else -> true
    }
}
