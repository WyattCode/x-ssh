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
    val auth: AuthKind = AuthKind.KEY,
    val keyPath: String = "",
    /**
     * 已信任的服务端主机密钥指纹(SHA256:…)。空 = 还没信任过,首次连接会弹确认框。
     * 存了之后每次连接都比对,不一致就拒绝 —— 这是防中间人的唯一一道关。
     */
    val keyFingerprint: String = "",
    /** 密码认证用;仅内存保留,不落盘。 */
    val password: String = "",
) {
    val label: String get() = name.ifBlank { address }

    val subtitle: String
        get() {
            val user = username.ifBlank { "?" }
            return "$user@$address:$port"
        }
}

/**
 * 主机列表持久化。第一批实现用 SharedPreferences + JSON(仅存非敏感信息;
 * 密码不落盘,私钥以文件路径引用,后续迁移到 Rust 核心统一存储)。
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
                    auth = if (item.optString("auth") == "password") AuthKind.PASSWORD else AuthKind.KEY,
                    keyPath = item.optString("keyPath"),
                    keyFingerprint = item.optString("keyFingerprint"),
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
    fun cachedFoldStart(windowWidthDp: Int): Pair<Float, Float>? {
        if (prefs.getInt(KEY_FOLD_WIDTH, -1) != windowWidthDp) return null
        val start = prefs.getFloat(KEY_FOLD_START, -1f)
        return if (start < 0f) null else start to prefs.getFloat(KEY_FOLD_SIZE, 0f)
    }

    /** [startDp] 传 null 表示这个窗口宽度下没有竖直折痕(平板、或已折叠)。 */
    fun cacheFoldStart(windowWidthDp: Int, startDp: Float?, sizeDp: Float) {
        prefs.edit()
            .putInt(KEY_FOLD_WIDTH, windowWidthDp)
            .putFloat(KEY_FOLD_START, startDp ?: -1f)
            .putFloat(KEY_FOLD_SIZE, sizeDp)
            .apply()
    }

    companion object {
        const val FONT_MIN = 9f
        const val FONT_MAX = 30f
        private const val KEY_FONT = "terminalFontSize"
        private const val KEY_FOLD_WIDTH = "foldWindowWidthDp"
        private const val KEY_FOLD_START = "foldStartDp"
        private const val KEY_FOLD_SIZE = "foldSizeDp"
    }
}
