package dev.xssh.android

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 端口转发规则的键、文案和校验。
 *
 * 键错了会让"已经开着"判重失败、保存/临时两条对不上;
 * 端口 0 / 超范围写进磁盘会在连接时才炸 —— 编辑页就必须拦掉。
 */
class ForwardsTest {

    @Test
    fun `forwardKey includes mode so local and remote on the same port differ`() {
        assertEquals("local:8080", forwardKey(HostForward(ForwardMode.LOCAL, 8080, "db", 5432)))
        assertEquals("remote:8080", forwardKey(HostForward(ForwardMode.REMOTE, 8080, "127.0.0.1", 3000)))
        assertEquals("dynamic:1080", forwardKey(ForwardMode.DYNAMIC, 1080))
    }

    @Test
    fun `ruleLabel uses loopback when remote host is blank`() {
        assertEquals(
            "8080 → 127.0.0.1:5432",
            ruleLabel(HostForward(ForwardMode.LOCAL, 8080, "", 5432)),
        )
        assertEquals(
            "server:9000 → 127.0.0.1:3000",
            ruleLabel(HostForward(ForwardMode.REMOTE, 9000, "", 3000)),
        )
        assertEquals("127.0.0.1:1080", ruleLabel(HostForward(ForwardMode.DYNAMIC, 1080, "", 0)))
    }

    @Test
    fun `validateForward rejects bad ports and duplicates`() {
        assertEquals(
            ForwardValidation.BadPort,
            validateForward(HostForward(ForwardMode.LOCAL, 0, "db", 5432)),
        )
        assertEquals(
            ForwardValidation.BadPort,
            validateForward(HostForward(ForwardMode.LOCAL, 8080, "db", 0)),
        )
        assertEquals(
            ForwardValidation.Ok,
            validateForward(HostForward(ForwardMode.DYNAMIC, 1080, "", 0)),
        )
        val existing = listOf(HostForward(ForwardMode.LOCAL, 8080, "db", 5432))
        assertEquals(
            ForwardValidation.Duplicate,
            validateForward(HostForward(ForwardMode.LOCAL, 8080, "other", 1), existing),
        )
    }

    @Test
    fun `JSON round trip keeps modes and drops bad rows`() {
        val rules = listOf(
            HostForward(ForwardMode.LOCAL, 8080, "db", 5432),
            HostForward(ForwardMode.DYNAMIC, 1080, "", 0),
            HostForward(ForwardMode.REMOTE, 9000, "127.0.0.1", 3000),
        )
        val again = parsePortForwards(encodePortForwards(rules))
        assertEquals(rules, again)

        val junk = JSONArray(
            """[{"mode":"local","localPort":0,"remoteHost":"x","remotePort":1},
                {"mode":"nope","localPort":22,"remoteHost":"","remotePort":22}]""",
        )
        val parsed = parsePortForwards(junk)
        assertEquals(1, parsed.size)
        assertEquals(ForwardMode.LOCAL, parsed[0].mode)
        assertEquals(22, parsed[0].localPort)
    }

    @Test
    fun `forwardErrorKind matches stable core prefixes`() {
        assertEquals("in_use", forwardErrorKind("forward: port in use: 8080"))
        assertEquals("already", forwardErrorKind("forward: already forwarding: 8080"))
        assertEquals("bad_port", forwardErrorKind("forward: bad port"))
        assertEquals("denied", forwardErrorKind("forward: denied: AllowTcpForwarding no"))
        assertEquals("unknown", forwardErrorKind("something else"))
    }
}
