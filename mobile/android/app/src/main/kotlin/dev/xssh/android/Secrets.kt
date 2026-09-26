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
import javax.crypto.spec.SecretKeySpec

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

    /**
     * 要求认证的那把,现在是一对 **RSA 密钥**,不再是对称密钥。
     *
     * 对称密钥"存"和"读"用的是同一把,所以存一次密码也得验一次指纹 —— 用户的原话:
     * "人家输入密码点保存,你要识别一次干嘛呢?修改一个 SSH 没有意义。" 完全对:
     * 密码是他本人在自己已解锁的设备上、在自己的 App 里亲手打进去的,再验一次什么都证明不了。
     * **真正值得验的只有"把密码读出来去连服务器"那一刻。**
     *
     * 非对称正好能分开这两件事:密钥库对 RSA 的规矩是**只有私钥操作要认证**,
     * 公钥加密不用。于是「上锁」(公钥加密,保存时)一声不响,「解锁」(私钥解密,连接时)才弹框。
     */
    private const val LOCKED_ALIAS = "xssh_host_secrets_rsa_v2"

    /** 上一版那把要求认证的**对称**密钥。只用来读旧密文(见 [readLocked]),不再写新的。 */
    private const val LEGACY_LOCKED_ALIAS = "xssh_host_passwords_locked"

    /**
     * OAEP 的参数**两边都要写死**。
     *
     * 加密用的是公钥,公钥可以导出,所以那一步跑在普通 JCA 里、MGF1 默认跟着主摘要走 SHA-256;
     * 解密在密钥库里跑,它的 MGF1 默认是 **SHA-1**。不写死就是两边参数不一致,
     * 解出来是乱码,报 `IllegalBlockSizeException`(实测)。统一成密钥库认的那套:
     * 主摘要 SHA-256、MGF1 用 SHA-1(OAEP 里 MGF1 用 SHA-1 本身没有安全问题)。
     */
    private fun oaep() = javax.crypto.spec.OAEPParameterSpec(
        "SHA-256",
        "MGF1",
        java.security.spec.MGF1ParameterSpec.SHA1,
        javax.crypto.spec.PSource.PSpecified.DEFAULT,
    )

    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val RSA_TRANSFORM = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
    private const val TAG_BITS = 128

    /** 加锁密文的前缀 —— 两条密钥的密文要在同一个字段里共存,靠它区分。 */
    private const val PREFIX = "L:"

    /**
     * 解锁窗口(秒):验过一次之后,这几秒内可以连着解开几台主机的凭据
     * (一台主机要解密码 + 私钥 + 口令三条,不能每条都弹一次框)。
     *
     * 只影响"读"。写不再需要认证(公钥加密),所以窗口不用留到够走完一次保存。
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
     * 解开一条加锁的密文。**这一步要用私钥,所以要求用户刚验证过** ——
     * 窗口过了会抛 `UserNotAuthenticatedException`,调用方据此去弹一次解锁,
     * 验完再调一次本方法。
     *
     * 两种格式都认:
     * - `L:包着的AES密钥:iv:密文` —— 现在的写法(见 [writeLocked])。
     * - `L:iv:密文` —— 上一版对称密钥写的老密文,用 [LEGACY_LOCKED_ALIAS] 读。
     *   读出来之后调用方保存一次就会换成新格式(老密钥留着,不删,免得还没转完的读不出来)。
     */
    fun readLocked(sealed: String): String {
        val parts = sealed.removePrefix(PREFIX).split(':')
        if (parts.size < 3) {
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(
                Cipher.DECRYPT_MODE,
                loadSecret(LEGACY_LOCKED_ALIAS),
                GCMParameterSpec(TAG_BITS, unb64(parts[0])),
            )
            return String(cipher.doFinal(unb64(parts[1])), Charsets.UTF_8)
        }
        // 私钥解开那把一次性的 AES 密钥 —— **这一步才要认证**。
        val unwrap = Cipher.getInstance(RSA_TRANSFORM)
        unwrap.init(Cipher.DECRYPT_MODE, loadPrivate(LOCKED_ALIAS), oaep())
        val key = SecretKeySpec(unwrap.doFinal(unb64(parts[0])), KeyProperties.KEY_ALGORITHM_AES)
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, unb64(parts[1])))
        return String(cipher.doFinal(unb64(parts[2])), Charsets.UTF_8)
    }

    /**
     * 把明文加密进这道锁。**不需要认证** —— 用公钥。
     *
     * RSA 直接加密只装得下两百来字节,而私钥动辄几 KB,所以是常规的混合写法:
     * 现摇一把一次性 AES 密钥加密正文,再用公钥把这把 AES 密钥包起来。
     * 解开时反过来,那一步才要私钥、才要指纹。
     */
    fun writeLocked(plain: String): String {
        ensureLockKey()
        val key = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES)
            .apply { init(256) }
            .generateKey()
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key) }
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val wrap = Cipher.getInstance(RSA_TRANSFORM)
            .apply { init(Cipher.ENCRYPT_MODE, publicKey(LOCKED_ALIAS), oaep()) }
        return PREFIX + b64(wrap.doFinal(key.encoded)) + ":" + b64(cipher.iv) + ":" + b64(body)
    }

    /** 加锁的密钥对建出来没有;没有就现建一对。建密钥本身不要求认证。 */
    fun ensureLockKey() {
        if (loadOrNull(LOCKED_ALIAS) == null) generateRsa(LOCKED_ALIAS)
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
     *
     * **空串有歧义**:既可能是"这台主机本来就没存密码",也可能是"存了但读不出来"
     * (密钥库被清、密文损坏)。加载主机时两者已经分开记了,见 `Host.unreadableSecrets`。
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
     * **不需要认证**:加密走公钥(见 [writeLocked])。
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
     * 读加锁的密文要用私钥,**这一步要用户验证一次**(调用方在关锁前弹框);
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
    private fun plainKey(): SecretKey = loadOrNull(PLAIN_ALIAS) as? SecretKey ?: generate(PLAIN_ALIAS, null)

    private fun loadSecret(alias: String): SecretKey =
        loadOrNull(alias) as? SecretKey ?: throw IllegalStateException("密钥库里没有 $alias")

    private fun loadPrivate(alias: String): java.security.PrivateKey =
        loadOrNull(alias) as? java.security.PrivateKey ?: throw IllegalStateException("密钥库里没有 $alias")

    /**
     * 取公钥。**要把它从密钥库里"摘出来"再用**:直接拿密钥库给的那个公钥对象去加密,
     * Cipher 会落到 AndroidKeyStore provider 上,于是这把要求认证的密钥连公钥加密也被它管着,
     * OAEP 参数还按它自己那套走 —— 两边对不上,解出来报 `IllegalBlockSizeException`。
     * 用 KeyFactory 按编码重建一个普通的公钥对象,加密就走标准 provider,参数以我们传的为准。
     */
    private fun publicKey(alias: String): java.security.PublicKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val fromStore = store.getCertificate(alias)?.publicKey
            ?: throw IllegalStateException("密钥库里没有 $alias 的公钥")
        val factory = java.security.KeyFactory.getInstance(fromStore.algorithm)
        return factory.generatePublic(java.security.spec.X509EncodedKeySpec(fromStore.encoded))
    }

    private fun loadOrNull(alias: String): java.security.Key? {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return store.getKey(alias, null)
    }

    /**
     * 建一对要求认证的 RSA 密钥。**私钥要认证,公钥不要** —— 这正是"存密码不弹框、
     * 读密码才弹框"的来源(见 [LOCKED_ALIAS] 的说明)。
     */
    private fun generateRsa(alias: String) {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) {
            throw IllegalStateException("要求认证的密钥需要 Android 11 及以上")
        }
        val generator = java.security.KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_RSA,
            "AndroidKeyStore",
        )
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            // **两个摘要都要授权**:OAEP 的主摘要是 SHA-256,而 MGF1 那一路密钥库默认走 SHA-1。
            // 只授权 SHA-256 的话,解密时带 MGF1-SHA1 的参数会被密钥库拒掉,
            // 报的是 `IllegalBlockSizeException`(实测,看不出真正原因)。
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .setKeySize(2048)
        requireAuth(builder, AUTH)
        generator.initialize(builder.build())
        generator.generateKeyPair()
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
