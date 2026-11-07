package dev.xssh.android

/**
 * 认出"不是服务器的错、是应用自己坏了"的连接失败。
 *
 * 核心库(`libxssh_ffi.so`)没打进包、或者和这台设备的架构对不上时,第一次调用 FFI 会抛
 * `NoClassDefFoundError` / `UnsatisfiedLinkError` / `ExceptionInInitializerError`,
 * 错误页上原来直接写类名(`uniffi.xssh_ffi.UniffiLib`)—— 用户看不懂,也以为点「重试」有用。
 * 认出来之后给一句人话,原文收进「详情」,并且不提供重试。
 */
object ConnectErrors {
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
