package dev.xssh.android

import android.app.Activity
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.CancellationSignal
import android.util.Log
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Serialize prompts so a double-tap / host+jump unlock cannot stack two system sheets. */
private val authMutex = Mutex()

/**
 * 读一条加锁的凭据,不够就先弹一次解锁。
 *
 * 用**时间窗**模式([Secrets] 里密钥声明的 `setUserAuthenticationParameters`):
 * 验证通过之后的几秒内,那把密钥直接可用 —— 不再需要把 `Cipher` 包进 `CryptoObject`。
 *
 * 试过 CryptoObject 那条路(认证和某一次加密/解密绑定,安全性更高),但它在
 * "密钥还没解锁"时拿不到一个已初始化的 `Cipher`,而 `BiometricPrompt` 要求传入的
 * `CryptoObject` 必须是已初始化的 —— 实测直接 `IllegalStateException:
 * Crypto primitive not initialized` 崩掉。时间窗模式没有这个前提。
 *
 * 用户取消、验证失败一律作为"没读到"返回 null,由调用方显示连接失败页 ——
 * 密码始终没有机会以明文出现在界面上。
 */
suspend fun unlockSecret(activity: Activity, sealed: String): String? {
    if (sealed.isEmpty()) return ""
    if (!Secrets.isLocked(sealed)) return Secrets.open(sealed)
    // 先直接读一次:解锁窗口还开着(刚验证过、或者几秒内连第二台)时它就成了,
    // 不用打扰用户。窗口过了会抛 UserNotAuthenticatedException,那才去弹框。
    val direct = runCatching { Secrets.readLocked(sealed) }
    direct.getOrNull()?.let { return it }
    // 只有"还没认证"才值得让用户验一次。密钥被系统销毁(改了锁屏方式、清了凭据)
    // 时验多少次都没用 —— 那种情况直接放弃,省得用户白按一次指纹还以为是自己按错了。
    val cause = direct.exceptionOrNull()
    if (cause !is android.security.keystore.UserNotAuthenticatedException) {
        Log.w(TAG, "locked secret unreadable: ${cause?.javaClass?.simpleName} ${cause?.message} / cause=${cause?.cause}")
        return null
    }
    return authMutex.withLock {
        // Another coroutine may have just authenticated while we waited.
        runCatching { Secrets.readLocked(sealed) }.getOrNull()?.let { return@withLock it }
        if (!authenticate(activity)) return@withLock null
        withContext(Dispatchers.IO) {
            runCatching { Secrets.readLocked(sealed) }
                .onFailure { Log.w(TAG, "unlock read failed: ${it.javaClass.simpleName} ${it.message} / cause=${it.cause}") }
                .getOrNull()
        }
    }
}

/**
 * 为了**写入**而解锁一次:验证通过之后,密钥在时间窗内可直接用于加密。
 *
 * 用户取消返回 false,调用方保持"没加锁"的原样。
 */
suspend fun unlockForWrite(activity: Activity): Boolean {
    if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) {
        Log.w(TAG, "unlockForWrite: SDK too old")
        return false
    }
    return authMutex.withLock { authenticate(activity) }
}

/**
 * 弹一次生物识别 / 锁屏密码,成功后返回 true。
 *
 * 用平台的 [BiometricPrompt] 而不是 androidx 那个:`setAllowedAuthenticators`
 * 能同时允许生物识别和锁屏密码,折叠屏这类没有指纹的机器才不会卡住。
 * 验证成功时只是"人验过了",密钥的开锁由系统按时间窗自己完成。
 */
private suspend fun authenticate(activity: Activity): Boolean =
    suspendCancellableCoroutine { continuation ->
        // 这套 API 要 Android 11。minSdk 是 26,这一条必须显式挡住 ——
        // 更早的系统上这个开关根本不会出现(见 Secrets.lockAvailable),走到这里说明
        // 系统升过级,或者数据是从别的机器上恢复来的,那就当"没解锁成"处理。
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) {
            continuation.resume(false)
            return@suspendCancellableCoroutine
        }
        val signal = CancellationSignal()
        continuation.invokeOnCancellation { signal.cancel() }

        val prompt = BiometricPrompt.Builder(activity)
            .setTitle(activity.getString(R.string.term_unlock_title))
            .setSubtitle(activity.getString(R.string.term_unlock_subtitle))
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or
                    BiometricManager.Authenticators.DEVICE_CREDENTIAL,
            )
            .build()

        prompt.authenticate(
            signal,
            activity.mainExecutor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    if (continuation.isActive) continuation.resume(true)
                }

                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    Log.i(TAG, "unlock cancelled/failed: $code $message")
                    if (continuation.isActive) continuation.resume(false)
                }

                override fun onAuthenticationFailed() {
                    // 认错了手指:系统还留在框里让重试,这里什么都不做。
                    Log.i(TAG, "unlock attempt failed")
                }
            },
        )
    }

/**
 * 把一台主机里三条可能加锁的凭据解开,返回可以拿去连接的 [Host]。
 *
 * 返回 null 表示**该解锁但没解开**(用户取消、验证失败) —— 调用方去显示连接失败页,
 * 让用户点「重试」。没开锁的主机原样返回,不会弹任何框。
 *
 * 读的是 `locked*` 字段里那几条密文,不是 Host 上的明文属性:加锁之后列表里
 * 读到的明文是空的,真正的内容只在磁盘上的密文里。
 */
suspend fun unlockCredentials(context: android.content.Context, host: Host): Host? {
    val activity = hostActivity(context) ?: return null
    // **没加锁的那几条要原样留着**:`locked*` 只有加过锁才有值,没加锁时是 null,
    // 而明文早在 HostStore.load 里就解出来放在 Host 上了。拿空密文去"解锁"会得到空串,
    // 写回去就把好好的密码抹成空 —— 表现是每一台没加锁的主机都连不上,
    // 一律报「这台主机还没有保存密码」。
    suspend fun resolve(locked: String?, plain: String): String? =
        if (locked == null) plain else unlockSecret(activity, locked)
    return host.copy(
        password = resolve(host.lockedPassword, host.password) ?: return null,
        // 私钥和口令只在用私钥登录时才需要解锁;密码主机上它们是空的,不会弹框。
        keyData = resolve(host.lockedKeyData, host.keyData) ?: return null,
        keyPassphrase = resolve(host.lockedKeyPassphrase, host.keyPassphrase) ?: return null,
    )
}

/**
 * Compose 的 Context 通常被包了一层 ContextWrapper,要一路剥到 Activity。
 *
 * `Adaptive.kt` / `Theme.kt` 各有一份同名的私有实现,私有的顶层函数在同包内会撞名,
 * 所以这里换个名字。
 */
internal fun hostActivity(context: android.content.Context): Activity? {
    var current: android.content.Context? = context
    while (current is android.content.ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}
