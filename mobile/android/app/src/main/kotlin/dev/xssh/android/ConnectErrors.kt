package dev.xssh.android

/**
 * 认出"不是服务器的错、是应用自己坏了"的连接失败。
 *
 * 核心库(`libxssh_ffi.so`)没打进包、或者和这台设备的架构对不上时,第一次调用 FFI 会抛
 * `NoClassDefFoundError` / `UnsatisfiedLinkError` / `ExceptionInInitializerError`,
 * 错误页上原来直接写类名(`uniffi.xssh_ffi.UniffiLib`)—— 用户看不懂,也以为点「重试」有用。
 * 认出来之后给一句人话,原文收进「详情」,并且不提供重试。
 */
/** 认得出的几类常见连接失败(原文是英文的底层错误,用户看不懂)。 */
enum class FriendlyError { Disconnected, Timeout, Refused, Unreachable, AuthFailed }

object ConnectErrors {
    /**
     * 把底层错误原文认成人话的一类;认不出返回 null(原文照样显示)。
     * 只认**纯英文的短原文**:别的路径(比如局域网权限提示)会把原文包进一整段本地化的话里,那种不能被盖掉。
     */
    fun friendly(message: String): FriendlyError? {
        // 底层原文都是英文;含非 ASCII 字符的是已经被包进本地化提示里的,不能盖掉。
        if (message.length > 120 || '\n' in message || message.any { it.code > 127 }) return null
        val m = message.lowercase()
        return when {
            "authentication failed" in m || "permission denied" in m || "auth fail" in m -> FriendlyError.AuthFailed
            "timed out" in m || "timeout" in m -> FriendlyError.Timeout
            "refused" in m -> FriendlyError.Refused
            "unreachable" in m || "no route" in m || "host is down" in m ||
                "name or service not known" in m || "unknown host" in m -> FriendlyError.Unreachable
            "disconnected" in m || "connection reset" in m || "broken pipe" in m -> FriendlyError.Disconnected
            else -> null
        }
    }
    fun isCoreMissing(error: Throwable): Boolean {
        var current: Throwable? = error
        var depth = 0
        // 原因链最多看几层:防止循环引用。
        while (current != null && depth < 8) {
            if (current is UnsatisfiedLinkError ||
                current is NoClassDefFoundError ||
                current is ExceptionInInitializerError
            ) {
                return true
            }
            val text = current.message.orEmpty()
            if ("UniffiLib" in text || "libxssh_ffi" in text || "Unable to load library 'xssh_ffi'" in text) {
                return true
            }
            current = current.cause
            depth++
        }
        return false
    }
}
