package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 凭据在保存时怎么取舍。
 *
 * 这一组全是"判错了就把用户的密码永久弄丢"的地方 —— 而真机上要连一次才看得出来,
 * 所以把它们从 Compose / 密钥库里扒出来单测。所有的密文都用字符串字面量假装:
 * 这里验的是**取舍规则**,不是加解密本身(那部分由 Secrets 的实现在真机上保证)。
 */
class CredentialCarryTest {

    private val plain = "YWJj:ZGVm" // 普通密钥的密文(没有 L: 前缀)
    private val locked = "L:d3JhcA==:aXY=:Ym9keQ==" // 加锁的密文

    private fun host(
        password: String = "",
        keyData: String = "",
        lockSecrets: Boolean = true,
        lockedPassword: String? = null,
        lockedKeyData: String? = null,
        lockedKeyPassphrase: String? = null,
        auth: AuthKind = AuthKind.PASSWORD,
    ) = Host(
        id = "h1",
        address = "192.168.1.10",
        username = "root",
        auth = auth,
        password = password,
        keyData = keyData,
        lockSecrets = lockSecrets,
        lockedPassword = lockedPassword,
        lockedKeyData = lockedKeyData,
        lockedKeyPassphrase = lockedKeyPassphrase,
    )

    // ---- 换登录方式时,同一组秘密要么一起留、要么一起清 ----

    @Test
    fun `switching to a key drops the password ciphertext`() {
        val draft = HostDraft(host(lockedPassword = locked))
        val kept = draft.carriedSecrets(key = true, keyLocked = true)
        assertNull("换成私钥登录就不该再留密码", kept.lockedPassword)
    }

    @Test
    fun `switching to a password drops the key ciphertext`() {
        val draft = HostDraft(host(lockedKeyData = locked, lockedKeyPassphrase = locked))
        val kept = draft.carriedSecrets(key = false, keyLocked = true)
        assertNull(kept.lockedKeyData)
        assertNull(kept.lockedKeyPassphrase)
    }

    @Test
    fun `staying on the same auth method keeps everything`() {
        val draft = HostDraft(host(lockedPassword = locked, lockedKeyData = locked))
        // 密码登录:密码密文留下,私钥那两条按规矩清掉。
        val kept = draft.carriedSecrets(key = false, keyLocked = false)
        assertEquals(locked, kept.lockedPassword)
        assertNull(kept.lockedKeyData)
    }

    @Test
    fun `a password key kept without a passphrase field drops only the passphrase`() {
        val draft = HostDraft(
            host(
                auth = AuthKind.KEY,
                lockedKeyData = locked,
                lockedKeyPassphrase = locked,
            ),
        )
        // 口令那一格没露出来(用户没填过口令)= 这次不该再存它。
        val kept = draft.carriedSecrets(key = true, keyLocked = false)
        assertEquals("私钥本身要留", locked, kept.lockedKeyData)
        assertNull(kept.lockedKeyPassphrase)
    }

    // ---- 兜底的旧密文必须和新状态认得的是同一种密钥 ----

    @Test
    fun `locking keeps a previously locked ciphertext as the fallback`() {
        // 这次没封出内容(明文本来就空),旧的那条也是加锁的 —— 可以原样沿用。
        assertEquals(locked, carriedLocked(sealed = "", previous = locked, locking = true))
    }

    @Test
    fun `locking refuses to carry a plain ciphertext into a locked record`() {
        // 这是修复前会把密码弄丢的那条:旧的普通密文配 lockSecrets=true,
        // `Secrets.open` 只认普通密钥、`readLocked` 只认 L: 前缀 —— 两边都读不出来。
        assertNull(
            "加锁状态不能带一条普通密钥的密文",
            carriedLocked(sealed = "", previous = plain, locking = true),
        )
    }

    @Test
    fun `unlocking keeps a plain ciphertext as the fallback`() {
        assertEquals(plain, carriedLocked(sealed = "", previous = plain, locking = false))
    }

    @Test
    fun `this save's own ciphertext always wins`() {
        assertEquals(
            "这次封出来的优先,不该被旧的那条顶掉",
            locked,
            carriedLocked(sealed = locked, previous = plain, locking = true),
        )
    }

    @Test
    fun `nothing to carry stays null`() {
        assertNull(carriedLocked(sealed = "", previous = null, locking = true))
        assertNull(carriedLocked(sealed = "", previous = null, locking = false))
    }
}