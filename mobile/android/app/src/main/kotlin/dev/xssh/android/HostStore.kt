package dev.xssh.android

import android.content.Context
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

enum class AuthKind { KEY, PASSWORD }

data class Host(
    val id: String = UUID.randomUUID().toString(),
    val name: String = "",
    val address: String = "",
    val port: Int = 22,
    val username: String = "",
    /** 默认密码:手机上更常见,也不需要先把私钥弄进设备。 */
    val auth: AuthKind = AuthKind.PASSWORD,
    val keyPath: String = "",
    /**
     * 已信任的服务端主机密钥指纹(SHA256:…)。空 = 还没信任过,首次连接会弹确认框。
     * 存了之后每次连接都比对,不一致就拒绝 —— 这是防中间人的唯一一道关。
     */
    val keyFingerprint: String = "",
    /** 密码认证用。落盘时经 [Secrets] 加密(Android 密钥库、不可导出),不存明文。 */
    val password: String = "",
    /**
     * 导入的私钥内容(OpenSSH / PEM 文本)。和密码一样经 [Secrets] 加密落盘,
     * 连接时在内存里解密交给核心 —— 磁盘上没有明文私钥文件。空 = 走 [keyPath](老数据 / 调试)。
     */
    val keyData: String = "",
    /** 私钥口令(没有就空)。同样加密存。 */
    val keyPassphrase: String = "",
    /** 导入时的文件名,只用来显示(「id_ed25519」)。 */
    val keyName: String = "",
    /** 私钥对应公钥的指纹(SHA256:…),给用户对照服务器上的 authorized_keys。 */
    val keyPublicFingerprint: String = "",
) {
    /** 用私钥登录,但手里既没有导入的私钥、也没有私钥文件。 */
    val keyMissing: Boolean get() = auth == AuthKind.KEY && keyData.isEmpty() && keyPath.isEmpty()

    val label: String get() = name.ifBlank { address }

    val subtitle: String
        get() {
            val user = username.ifBlank { "?" }
            return "$user@$address:$port"
        }
}

/**
 * 主机列表持久化:SharedPreferences + JSON。密码经 [Secrets] 加密后存进同一条记录,
 * 私钥以文件路径引用。
 *
 * 密码原来只放内存 —— 结果是存过密码、连过一次,下次打开(进程被回收、重装、
 * 系统重启)又得重新输密码、再存、再连。
 */
class HostStore(context: Context) {
    private val prefs = context.getSharedPreferences("xssh_hosts", Context.MODE_PRIVATE)

    fun load(): List<Host> {
        val raw = prefs.getString(KEY_LIST, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                Host(
                    id = item.optString("id", UUID.randomUUID().toString()),
                    name = item.optString("name"),
                    address = item.optString("address"),
                    port = item.optInt("port", 22),
                    username = item.optString("username"),
                    // 默认跟数据类一致(密码);只有明确存了 "key" 才是私钥。
                    auth = if (item.optString("auth") == "key") AuthKind.KEY else AuthKind.PASSWORD,
                    keyPath = item.optString("keyPath"),
                    keyFingerprint = item.optString("keyFingerprint"),
                    password = Secrets.open(item.optString("password")),
                    keyData = Secrets.open(item.optString("keyData")),
                    keyPassphrase = Secrets.open(item.optString("keyPassphrase")),
                    keyName = item.optString("keyName"),
                    keyPublicFingerprint = item.optString("keyPublicFingerprint"),
                )
            }
        }.getOrDefault(emptyList())
    }

    fun save(hosts: List<Host>) {
        val array = JSONArray()
        hosts.forEach { host ->
            val item = JSONObject()
            item.put("id", host.id)
            item.put("name", host.name)
            item.put("address", host.address)
            item.put("port", host.port)
            item.put("username", host.username)
            item.put("auth", if (host.auth == AuthKind.PASSWORD) "password" else "key")
            item.put("keyPath", host.keyPath)
            item.put("keyFingerprint", host.keyFingerprint)
            item.put("password", Secrets.seal(host.password))
            item.put("keyData", Secrets.seal(host.keyData))
            item.put("keyPassphrase", Secrets.seal(host.keyPassphrase))
            item.put("keyName", host.keyName)
            item.put("keyPublicFingerprint", host.keyPublicFingerprint)
            array.put(item)
        }
        prefs.edit().putString(KEY_LIST, array.toString()).apply()
    }

    private companion object {
        const val KEY_LIST = "list"
    }
}
/** 界面偏好(与主机无关的小设置)。 */
class UiPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("xssh_ui", Context.MODE_PRIVATE)

    /** 终端字号。手指缩放调过之后要记住,否则每开一个会话都得重新捏一次。 */
    var terminalFontSize: Float
        get() = prefs.getFloat(KEY_FONT, 14f).coerceIn(FONT_MIN, FONT_MAX)
        set(value) {
            prefs.edit().putFloat(KEY_FONT, value.coerceIn(FONT_MIN, FONT_MAX)).apply()
        }

    /**
     * 上次量到的竖直折痕位置(dp)。
     *
     * 折痕信息来自 `WindowInfoTracker` 的异步回调,冷启动时第一帧还没到,分栏只能先用
     * 百分比兜底,等回调到了再跳一次 —— 展开状态下打开应用,右栏内容会往右弹约 100dp。
     * 同一台设备上折痕位置是固定的,记下来,下次第一帧就用对。
     *
     * 返回 null 表示"这个窗口宽度下还没量过",或"量过但这台设备没有折痕"。
     */
    fun cachedFoldStart(windowWidthDp: Int, windowHeightDp: Int): Pair<Float, Float>? {
        val raw = prefs.getString(foldKey(windowWidthDp, windowHeightDp), null) ?: return null
        val parts = raw.split(',')
        val start = parts.getOrNull(0)?.toFloatOrNull() ?: return null
        return if (start < 0f) null else start to (parts.getOrNull(1)?.toFloatOrNull() ?: 0f)
    }

    /** 这台设备上是否量到过竖直折痕 —— 量到过就一定是折叠屏。 */
    fun everSawFold(): Boolean = prefs.all.any { (key, value) ->
        key.startsWith("fold_") && ((value as? String)?.substringBefore(',')?.toFloatOrNull() ?: -1f) >= 0f
    }

    /** [startDp] 传 null 表示这个窗口形态下没有可用的竖直折痕(平板、或已折叠)。 */
    fun cacheFoldStart(windowWidthDp: Int, windowHeightDp: Int, startDp: Float?, sizeDp: Float) {
        prefs.edit()
            .putString(foldKey(windowWidthDp, windowHeightDp), "${startDp ?: -1f},$sizeDp")
            .apply()
    }

    /**
     * 每个窗口形态一个槽。
     *
     * 原来只有一个槽,外屏(623dp)跑一次就把内屏(860dp)量到的折痕顶掉,
     * 再展开冷启动又得按百分比兜底 —— "打开应用闪一下"就这么回来了。
     * 内屏竖屏 / 内屏横屏 / 外屏是三种形态,各记各的。
     */
    private fun foldKey(widthDp: Int, heightDp: Int) = "fold_${widthDp}x$heightDp"

    /** 外观:跟随系统 / 浅色 / 深色。 */
    var themeMode: ThemeMode
        get() = ThemeMode.entries.firstOrNull { it.name == prefs.getString(KEY_THEME, null) } ?: ThemeMode.System
        set(value) {
            prefs.edit().putString(KEY_THEME, value.name).apply()
        }

    /** 平板侧边栏是否展开(收起后终端独占整个宽度,下次打开保持用户的选择)。 */
    var sidebarVisible: Boolean
        get() = prefs.getBoolean(KEY_SIDEBAR, true)
        set(value) {
            prefs.edit().putBoolean(KEY_SIDEBAR, value).apply()
        }

    companion object {
        private const val KEY_SIDEBAR = "sidebarVisible"
        private const val KEY_THEME = "themeMode"
        const val FONT_MIN = 9f
        const val FONT_MAX = 30f
        private const val KEY_FONT = "terminalFontSize"
    }
}
