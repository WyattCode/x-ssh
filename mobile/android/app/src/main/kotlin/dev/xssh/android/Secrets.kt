package dev.xssh.android

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 主机密码的加密存取。
 *
 * 密钥生成在 Android 密钥库里、**不可导出**:就算 SharedPreferences 文件被拷走
 * (备份、root),拿到的也只有密文。卸载应用时密钥随之销毁,旧密文作废 ——
 * 那时读出来是空串,等于要重新填一次密码,不会崩。
 *
 * 加了锁的那几条解密前必须由用户解锁一次。见 [readLocked]、[writeLocked]、[enableLock]、[disableLock]。
 */
object Secrets {
    /**
     * 两条密钥并存。
     *
     * - [PLAIN_ALIAS]:没有认证要求的密钥。升级上来的老密文全在它名下,一直保留 ——
     *   用户不想加锁、这台设备没有可用的解锁方式、或者加锁中途失败,老数据都还读得出来。
     * - [LOCKED_ALIAS]:要求认证的密钥。用户自己打开开关之后才生成,数据随之重新加密。
     */
    private const val PLAIN_ALIAS = "xssh_host_passwords"
    private const val LOCKED_ALIAS = "xssh_host_passwords_locked"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128

    /** 加锁密文的前缀 —— 两条密钥的密文要在同一个字段里共存,靠它区分。 */
    private const val PREFIX = "L:"

    /**
     * 解锁窗口(秒):人脸 / 指纹验证过一次,这几秒内可以连着读几台主机的密码。
     *
     * 原来是 3 秒,太紧:保存一台加锁主机要走"验证 → 建 Host → 写 SharedPreferences"
     * 好几步,中间任何一次卡顿窗口就关了,而 `writeLocked` 失败是**静默**退回旧密文的
     * (见 HostStore.writeSecret)—— 用户改了密码,界面说存好了,其实没改。
     * 10 秒足够走完一次保存,又不会让密钥长时间敞着。
     */
    private const val AUTH_WINDOW_SECONDS = 10

    private const val AUTH =
        KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL

    /**
     * 这台设备上能不能用这道锁。
     *
     * 两种都算:生物识别(指纹 / 人脸),或者锁屏密码。折叠屏这类没有指纹的机器
     * 只能靠后者 —— 只声明 `BIOMETRIC_STRONG` 的话它们会一直返回"不可用"。
     * 同时,"没有锁屏密码"的设备本身也开不了生物识别,不必另外判断。
     */
    fun lockAvailable(context: android.content.Context): Boolean {
        // 要 API 30 起的两件事:`setAllowedAuthenticators`(同时允许生物识别和锁屏密码)
        // 和"密钥认证窗口"的写法。更早的系统上直接不提供这个开关 ——
        // 显示了也弹不出解锁框,连不上还找不到原因。
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) return false
        val allowed = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        return BiometricManager.from(context).canAuthenticate(allowed) == BiometricManager.BIOMETRIC_SUCCESS
    }

    /** 这个密文是不是加锁之后写下的。 */
    fun isLocked(sealed: String): Boolean = sealed.startsWith(PREFIX)

    /**
     * 这条记录是不是还没加过锁(升级上来的老密文,或者加锁时没被转过去的遗留)。
     * 空串既不算加锁也不算没加锁 —— 那是"本来就没有密码"。
     */
    fun isPlain(sealed: String): Boolean = sealed.isNotEmpty() && !isLocked(sealed)

    /**
     * 解开一条加锁的密文。**只在这个密钥的解锁窗口还开着时才会成功** ——
     * 窗口过了会抛 `UserNotAuthenticatedException`,调用方据此去弹一次解锁,
     * 验完再调一次本方法。
     */
    fun readLocked(sealed: String): String {
        val parts = sealed.removePrefix(PREFIX).split(':', limit = 2)
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(
            Cipher.DECRYPT_MODE,
            load(LOCKED_ALIAS),
            GCMParameterSpec(TAG_BITS, unb64(parts[0])),
        )
        return String(cipher.doFinal(unb64(parts[1])), Charsets.UTF_8)
    }

    /** 把明文加密进这道锁。同样要求解锁窗口开着;返回带 `L:` 前缀的密文。 */
    fun writeLocked(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORM)
        // 加密方向不预先知道 IV,由密钥库生成,再从 `cipher.iv` 读回来。
        cipher.init(Cipher.ENCRYPT_MODE, load(LOCKED_ALIAS))
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return PREFIX + b64(cipher.iv) + ":" + b64(body)
    }
    /** 加锁的密钥建出来没有;没有就现建一把([writeLocked] 需要它)。建密钥本身不要求认证。 */
    fun ensureLockKey() {
        if (loadOrNull(LOCKED_ALIAS) == null) generate(LOCKED_ALIAS, AUTH)
    }

    /**
     * 加密成 `iv:密文`(均为 base64)。空串返回空串 —— 没有密码就什么都不存。
     *
     * 密钥库出错(个别机型的 `ProviderException`、密钥库服务一时不可用)时返回空串:
     * 这台主机的密码这次没存上,下次连接前要重填。**不能**让异常往上抛 ——
     * 它是在 `HostStore.save` 里、主线程上调用的,抛出去就是整个应用在
     * 「点 ✓ 保存」的那一下崩掉,其它主机的改动也一起丢。
     */
    fun seal(plain: String): String {
        if (plain.isEmpty()) return ""
        return runCatching {
            // IV 由密钥库生成(它不允许调用方自带 IV),每次加密都不同。
            val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, plainKey()) }
            val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
            b64(cipher.iv) + ":" + b64(body)
        }.getOrDefault("")
    }

    /**
     * 解密没有加锁的密文。损坏、或密钥已不在(重装过)时返回空串。
     *
     * 加锁的密文在这里读不出来 —— 调用方先看 [isLocked],别把"要解锁"当成"密码丢了"。
     */
    fun open(sealed: String): String {
        if (sealed.isEmpty() || isLocked(sealed)) return ""
        return runCatching {
            val parts = sealed.split(':', limit = 2)
            val cipher = Cipher.getInstance(TRANSFORM).apply {
                init(Cipher.DECRYPT_MODE, plainKey(), GCMParameterSpec(TAG_BITS, unb64(parts[0])))
            }
            String(cipher.doFinal(unb64(parts[1])), Charsets.UTF_8)
        }.getOrDefault("")
    }

    /**
     * 打开"用生物识别解锁":把这批凭据逐条加密进这道锁。
     *
     * 前置是**刚刚验过一次**(调用方弹过解锁框)—— 密钥在时间窗内可直接用于加密。
     * 返回重新加密后的值;**任何一步失败都返回 null**,调用方原样保留旧值,
     * 不会留下一半加锁一半没锁、重装前谁都读不出来的状态。
     */
    fun enableLock(values: List<String>): List<String>? {
        return runCatching {
            ensureLockKey()
            values.map { text -> if (text.isEmpty()) "" else writeLocked(text) }
        }.getOrNull()
    }

    /**
     * 关掉这道锁:这台主机的凭据写回不要认证的密钥名下。
     *
     * 读加锁的密文要密钥已解锁 —— 调用方在保存前刚验过一次(见 `buildHostForSave`);
     * 真读不出来时返回 null,调用方原样保留,开关弹回打开状态。
     *
     * **这里不销毁那把加锁的密钥。** 它是**所有**主机共用的一把:在一台主机上关掉开关
     * 就把它删掉,别的加锁主机的 `L:` 密文立刻变成永远解不开的乱码(重新开锁生成的是
     * 另一把密钥,密钥材料对不上)—— 那是不可逆的丢密码。留着不用没有代价:
     * 它只在有 `L:` 密文时才会被读到,下次开锁直接复用,照样要求认证。
     */
    fun disableLock(values: List<String>): List<String>? {
        return runCatching {
            values.map { locked ->
                if (!isLocked(locked)) {
                    locked
                } else {
                    // 这里**不能**用 [seal]:它在失败时返回空串(那是给"存密码"用的兜底),
                    // 空串落到磁盘上就是"这台主机没存密码"—— 用户关一次锁就把密码永久弄丢了。
                    writePlain(readLocked(locked))
                }
            }
        }.getOrNull()
    }

    /**
     * 用那把不带认证要求的密钥加密。**失败即抛** —— 给"必须成功、不能悄悄写空"的场合用
     * ([disableLock]);日常存密码走 [seal],那条路要的是"出错也别崩"。
     */
    private fun writePlain(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, plainKey()) }
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return b64(cipher.iv) + ":" + b64(body)
    }

    /** 不要认证的那把:不存在就现建一个(第一次存密码时)。 */
    private fun plainKey(): SecretKey = loadOrNull(PLAIN_ALIAS) ?: generate(PLAIN_ALIAS, null)

    private fun load(alias: String): SecretKey =
        loadOrNull(alias) ?: throw IllegalStateException("密钥库里没有 $alias")

    private fun loadOrNull(alias: String): SecretKey? {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return store.getKey(alias, null) as? SecretKey
    }

    private fun generate(alias: String, auth: Int?): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
        if (auth != null) {
            // 这里**不能**在旧系统上悄悄跳过认证要求:那会生成一把没有保护的密钥,
            // 而主机记录里却写着"已加锁" —— 用户以为锁上了,实际谁拿到文件都能解。
            // 宁可直接失败(开关在那些系统上本来就不显示,见 [lockAvailable])。
            if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) {
                throw IllegalStateException("要求认证的密钥需要 Android 11 及以上")
            }
            requireAuth(builder, auth)
        }
        generator.init(builder.build())
        return generator.generateKey()
    }

    /**
     * 给密钥加"使用前必须认证"的要求。
     *
     * 单独一个方法是为了挂 [RequiresApi]:调用它的只有 [lockAvailable] 为真的设备
     * (API 30+),但 lint 顺不到这条链路,注解比再写一遍运行时判断准确。
     */
    @androidx.annotation.RequiresApi(android.os.Build.VERSION_CODES.R)
    private fun requireAuth(builder: KeyGenParameterSpec.Builder, auth: Int) {
        builder.setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(AUTH_WINDOW_SECONDS, auth)
    }

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun unb64(text: String) = Base64.decode(text, Base64.NO_WRAP)
}
