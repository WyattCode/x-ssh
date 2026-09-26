package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * "本来就没存"和"存了但读不出来"必须分得开。
 *
 * 这两者在 `Secrets.open` 眼里都是空串,而界面对它们的说法完全不同:前者是用户没做过的事,
 * 后者是**出事了**(重装、密钥库被清)。一律说「未保存」,用户会以为自己从没存过密码。
 *
 * 判断在 `HostStore.load` 解密的那一刻做([unreadableSecrets]),输入就是磁盘上的原文和解出来的明文。
 * 原来是在详情页拿 `Host.locked*` 去判 —— 可那几个字段只装**加锁**的密文(load 里 `takeIf { isLocked }`),
 * 而加锁的又被排除在外,于是一条都报不出来。当时的测试手工造了 `lockedPassword = "YWJj:ZGVm"`
 * 这种 load 永远产生不了的 Host,所以一直是绿的。这里的输入只用 load 真会给的形态。
 */
class UnreadableSecretsTest {

    private val locked = "L:d3JhcA==:aXY=:Ym9keQ=="
    private val plainSealed = "YWJj:ZGVm"

    @Test
    fun `nothing saved is not unreadable`() {
        assertEquals(emptyList<String>(), unreadableSecrets(listOf("", "", ""), listOf("", "", "")))
    }

    @Test
    fun `a sealed value that decrypted is fine`() {
        assertEquals(
            emptyList<String>(),
            unreadableSecrets(listOf(plainSealed, "", ""), listOf("hunter2", "", "")),
        )
    }

    @Test
    fun `a sealed value that no longer decrypts is reported`() {
        // 形态对(不空、也不是 L: 前缀),但这把密钥已经不在 —— 重装之后的必然结果。
        assertEquals(listOf("密码"), unreadableSecrets(listOf(plainSealed, "", ""), listOf("", "", "")))
    }

    @Test
    fun `a locked value waiting for unlock is not reported`() {
        // `open` 本来就不读加锁的那条,明文为空是正常的:它等的是连接时的解锁,不是坏了。
        assertEquals(emptyList<String>(), unreadableSecrets(listOf(locked, "", ""), listOf("", "", "")))
    }

    @Test
    fun `every kind is reported in field order`() {
        assertEquals(
            listOf("密码", "私钥", "口令"),
            unreadableSecrets(listOf(plainSealed, plainSealed, plainSealed), listOf("", "", "")),
        )
        assertEquals(
            listOf("私钥"),
            unreadableSecrets(listOf(locked, plainSealed, ""), listOf("", "", "")),
        )
    }

    @Test
    fun `a host loaded with a broken password carries the report and no locked copy`() {
        // load 给"解不开的普通密文"造出来的就是这个形态:明文空、locked* 为 null、报告里有它。
        // 详情页只能看 unreadableSecrets —— 看 locked* 的话这里什么都看不到(原来的 bug)。
        val host = Host(address = "192.168.1.10", unreadableSecrets = listOf("密码"))
        assertEquals(null, host.lockedPassword)
        assertEquals("", host.password)
        assertEquals(listOf("密码"), host.unreadableSecrets)
    }
}
