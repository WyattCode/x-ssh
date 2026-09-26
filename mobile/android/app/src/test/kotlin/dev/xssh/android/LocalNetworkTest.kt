package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「这个地址算不算局域网」的判据。
 *
 * 判错的代价不对称:漏判 = 连内网主机时静默超时(和网络不通长得一模一样,
 * 用户会去查服务器);误判 = 连公网主机时多要一次权限,看着莫其妙。
 * 所以这里只测 [LocalNetwork.isLocalTarget] 这个纯函数 —— 权限那部分要看设备状态。
 */
class LocalNetworkTest {

    private val local = listOf(
        // RFC1918
        "10.0.0.1", "10.255.255.254",
        "172.16.0.1", "172.31.255.255",
        "192.168.1.1", "192.168.1.100",
        // link-local / CGNAT
        "169.254.1.1",
        "100.64.0.1", "100.127.255.255",
        // IPv6 唯一本地 / 链路本地
        "fd00::1", "fc00::1", "fe80::1",
        // mDNS
        "printer.local", "workstation.local",
        // 没有点的裸主机名
        "nas", "dgx"
    )

    private val notLocal = listOf(
        // 回环不受这个权限管
        "localhost", "127.0.0.1", "127.0.0.53",
        // 公网
        "8.8.8.8", "1.1.1.1", "203.0.113.10",
        // 172 的邻居不属于私网
        "172.15.0.1", "172.32.0.1",
        // 100 的邻居不属于 CGNAT
        "100.63.255.255", "100.128.0.0",
        // 169 但不是 link-local
        "169.253.0.1",
        // 带点的公网域名
        "example.com", "github.com"
    )

    @Test
    fun `private address ranges are local`() {
        for (a in local) assertTrue("$a 应该算局域网", LocalNetwork.isLocalTarget(a))
    }

    @Test
    fun `loopback and public addresses are not local`() {
        for (a in notLocal) assertFalse("$a 不该算局域网", LocalNetwork.isLocalTarget(a))
    }

    @Test
    fun `a bare hostname is local`() {
        // 没有点的名字没法从字面上判断,只能当内网 —— 用户输 "nas" 的意图就是本机网络里那台。
        assertTrue(LocalNetwork.isLocalTarget("nas"))
    }

    @Test
    fun `brackets and case are tolerated`() {
        assertTrue(LocalNetwork.isLocalTarget("[192.168.1.1]"))
        assertTrue(LocalNetwork.isLocalTarget(" 192.168.1.1 "))
        assertTrue(LocalNetwork.isLocalTarget("FD00::1"))
        assertTrue(LocalNetwork.isLocalTarget("Printer.LOCAL"))
    }

    @Test
    fun `an empty address is not local`() {
        // 地址还没填完时不该弹权限框。
        assertFalse(LocalNetwork.isLocalTarget(""))
        assertFalse(LocalNetwork.isLocalTarget("   "))
    }

    @Test
    fun `a malformed dotted address falls back to the hostname rule`() {
        // 四段但数字越界 / 不是数字:当主机名处理,带点就不是局域网。
        assertFalse(LocalNetwork.isLocalTarget("999.1.1.1"))
        assertFalse(LocalNetwork.isLocalTarget("1.2.3.x"))
    }
}