package dev.xssh.android

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
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
 */
object Secrets {
    private const val ALIAS = "xssh_host_passwords"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    /** 加密成 `iv:密文`(均为 base64)。空串返回空串 —— 没有密码就什么都不存。 */
    fun seal(plain: String): String {
        if (plain.isEmpty()) return ""
        // IV 由密钥库生成(它不允许调用方自带 IV),每次加密都不同。
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return b64(cipher.iv) + ":" + b64(body)
    }

    /** 解密。密文损坏、或密钥已不在(重装过)时返回空串。 */
    fun open(sealed: String): String {
        if (sealed.isEmpty()) return ""
        return runCatching {
            val parts = sealed.split(':', limit = 2)
            val cipher = Cipher.getInstance(TRANSFORM).apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, unb64(parts[0])))
            }
            String(cipher.doFinal(unb64(parts[1])), Charsets.UTF_8)
        }.getOrDefault("")
    }

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun unb64(text: String) = Base64.decode(text, Base64.NO_WRAP)
}
