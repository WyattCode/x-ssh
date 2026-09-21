package dev.xssh.android

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

/**
 * Android 16 (API 36) 起,访问局域网地址要单独的运行时权限 ACCESS_LOCAL_NETWORK,
 * 光有 INTERNET 不够。被拒时表现和网络不通一样(连接超时),很容易误判成服务端问题,
 * 所以连内网主机前先要权限,失败时也给出明确提示。
 */
object LocalNetwork {
    const val PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"

    /** 该权限存在的最低版本(Android 16 = API 36)。 */
    private const val MIN_SDK = 36

    /** 地址是否可能在局域网内(不做 DNS 解析,只看字面量)。 */
    fun isLocalTarget(address: String): Boolean {
        val host = address.trim().trim('[', ']').lowercase()
        if (host.isEmpty()) return false
        if (host == "localhost" || host.startsWith("127.")) return false // 回环不受限
        ipv4(host)?.let { (a, b) ->
            return a == 10 ||
                (a == 172 && b in 16..31) ||
                (a == 192 && b == 168) ||
                (a == 169 && b == 254) || // link-local
                (a == 100 && b in 64..127) // CGNAT,家用路由器也常见
        }
        if (host.contains(':')) { // IPv6: 唯一本地地址与链路本地地址
            return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")
        }
        // 主机名: .local(mDNS)或没有点的裸名字基本都在局域网里
        return host.endsWith(".local") || !host.contains('.')
    }

    /** 解析点分四段地址,返回前两段;不是字面量 IPv4 就返回 null。 */
    private fun ipv4(host: String): Pair<Int, Int>? {
        val parts = host.split('.')
        if (parts.size != 4) return null
        val nums = parts.map { it.toIntOrNull() ?: return null }
        if (nums.any { it !in 0..255 }) return null
        return nums[0] to nums[1]
    }

    /** 连这个地址前是否需要先要权限。 */
    fun needsPermission(context: Context, address: String): Boolean =
        Build.VERSION.SDK_INT >= MIN_SDK &&
            isLocalTarget(address) &&
            context.checkSelfPermission(PERMISSION) != PackageManager.PERMISSION_GRANTED

    /** 连接失败后补一句原因,区分「没权限」和「真连不上」。 */
    fun hintFor(context: Context, address: String, error: String): String =
        if (needsPermission(context, address)) {
            "$error\n\n没有本地网络权限,请在系统设置里允许后重试。"
        } else {
            error
        }
}
