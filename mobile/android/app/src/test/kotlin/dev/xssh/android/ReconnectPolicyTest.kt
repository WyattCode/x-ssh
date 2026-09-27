package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.xssh_ffi.FfiException
import uniffi.xssh_ffi.ServerEvent

/**
 * 断线自动重连的规则。
 *
 * 这里错了的代价两头都大:该重连的不连,用户在电梯里掉一次线就得回列表重点;
 * 不该连的去连 —— 用户敲了 `exit` 又被连回去,或者主机密钥变了还自动重试 ——
 * 后者是把一道安全关绕了过去。
 */
class ReconnectPolicyTest {

    @Test
    fun `delays double from one second and then hold at thirty`() {
        assertEquals(listOf(1L, 2L, 4L, 8L, 16L, 30L, 30L), (1..7).map { ReconnectPolicy.delayMillis(it) / 1000 })
    }

    @Test
    fun `all attempts together last about five minutes`() {
        val total = (1..ReconnectPolicy.MAX_ATTEMPTS).sumOf { ReconnectPolicy.delayMillis(it) } / 1000
        assertTrue("总共 $total 秒", total in 240..360)
    }

    @Test
    fun `a changed or unknown host key stops the retries`() {
        // 自动重连绝不能替用户接受一把新的主机密钥。
        assertTrue(ReconnectPolicy.isPermanent(FfiException.HostKeyChanged("SHA256:x")))
        assertTrue(ReconnectPolicy.isPermanent(FfiException.HostKeyUnknown("SHA256:x")))
        // 跳板机的密钥同理。
        assertTrue(ReconnectPolicy.isPermanent(FfiException.JumpHostKeyChanged("SHA256:x")))
        assertTrue(ReconnectPolicy.isPermanent(FfiException.JumpHostKeyUnknown("SHA256:x")))
    }

    @Test
    fun `wrong credentials stop the retries`() {
        assertTrue(ReconnectPolicy.isPermanent(FfiException.Message("authentication failed")))
        assertTrue(ReconnectPolicy.isPermanent(FfiException.KeyEncrypted("passphrase required")))
        // 跳板机那一跳认证失败(核心报的文本带 `jump host: ` 前缀)也一样停。
        assertTrue(ReconnectPolicy.isPermanent(FfiException.Message("jump host: authentication failed")))
    }

    @Test
    fun `a tunnel the jump host could not open is worth another try`() {
        // 目标机器还在重启、跳板机暂时连不过去:过一会儿多半就好了。
        assertFalse(
            ReconnectPolicy.isPermanent(FfiException.Message("jump host could not open a tunnel: Channel open failure")),
        )
        assertFalse(ReconnectPolicy.isPermanent(FfiException.Message("jump host: connection timed out")))
    }

    @Test
    fun `network trouble is worth another try`() {
        assertFalse(ReconnectPolicy.isPermanent(FfiException.Message("connection refused")))
        assertFalse(ReconnectPolicy.isPermanent(FfiException.Message("timed out")))
        assertFalse(ReconnectPolicy.isPermanent(java.io.IOException("network unreachable")))
    }

    @Test
    fun `a dropped transport asks for a reconnect`() {
        assertEquals(LinkOutcome.Dropped, linkOutcome(listOf(ServerEvent.Disconnected)))
    }

    @Test
    fun `a clean close does not`() {
        // `exit`、tmux 里 detach:远端正常关通道,这时自动连回去就是和用户对着干。
        assertEquals(LinkOutcome.Ended, linkOutcome(listOf(ServerEvent.ExitStatus(0u), ServerEvent.Close)))
        assertEquals(LinkOutcome.Ended, linkOutcome(listOf(ServerEvent.Eof, ServerEvent.Close)))
    }

    @Test
    fun `a drop wins over a close in the same batch`() {
        assertEquals(LinkOutcome.Dropped, linkOutcome(listOf(ServerEvent.Close, ServerEvent.Disconnected)))
    }

    @Test
    fun `plain output keeps the link alive`() {
        assertEquals(LinkOutcome.Alive, linkOutcome(emptyList()))
        assertEquals(LinkOutcome.Alive, linkOutcome(listOf(ServerEvent.Data(byteArrayOf(0x41)), ServerEvent.Eof)))
    }

    @Test
    fun `the tmux command reattaches the same session and falls back to a shell`() {
        assertTrue(TMUX_COMMAND.contains("tmux new-session -A -s xssh"))
        // 没装 tmux 时要进登录 shell,不能直接退出把连接关掉。
        assertTrue(TMUX_COMMAND.contains("exec \"\${SHELL:-/bin/sh}\" -l"))
        assertTrue("交给 sh 解释,登录 shell 是 fish 也不怕", TMUX_COMMAND.startsWith("sh -c '"))
        assertTrue(TMUX_COMMAND.endsWith("fi'"))
    }
}
