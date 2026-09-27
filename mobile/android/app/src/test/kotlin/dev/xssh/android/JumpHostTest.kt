package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 跳板机:哪些主机能被选成跳板机,核心报的错怎么换成"是哪一台出的事"。
 */
class JumpHostTest {

    private val bastion = Host(id = "b", name = "堡垒机", address = "1.2.3.4")
    private val inner = Host(id = "i", name = "内网", address = "10.0.0.5", port = 2200, jumpHostId = "b")
    private val plain = Host(id = "p", name = "直连", address = "5.6.7.8")

    @Test
    fun `candidates exclude itself and hosts that already use a jump`() {
        val all = listOf(bastion, inner, plain)
        // 只支持一层:内网那台自己经过堡垒机,不能再当别人的跳板机。
        assertEquals(listOf("b"), jumpCandidates(all, self = "p").map { it.id })
        assertEquals(listOf("b", "p"), jumpCandidates(all, self = "i").map { it.id })
        // 新建的主机(还没有 id)能选所有没设跳板机的。
        assertEquals(listOf("b", "p"), jumpCandidates(all, self = null).map { it.id })
    }

    @Test
    fun `tunnel failure names the jump host and the target it could not reach`() {
        val failure = jumpFailure("jump host could not open a tunnel: Channel open failure", bastion, inner)
        assertEquals(JumpFailure.Tunnel("堡垒机", "10.0.0.5:2200", "Channel open failure"), failure)
    }

    @Test
    fun `failures on the jump hop itself are attributed to it`() {
        assertEquals(
            JumpFailure.Hop("堡垒机", "authentication failed"),
            jumpFailure("jump host: authentication failed", bastion, inner),
        )
    }

    @Test
    fun `failures on the target are left alone`() {
        assertNull(jumpFailure("authentication failed", bastion, inner))
        assertNull(jumpFailure("connection timed out", bastion, inner))
    }
}
