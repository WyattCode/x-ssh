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
    /**
     * 「用生物识别解锁」:密码 / 私钥 / 口令都要先解锁才能读。
     * 和上面三个字段的关系是**二者必居其一** —— 开了锁之后明文就不再落盘。
     */
    val lockSecrets: Boolean = false,
    /**
     * 还没解锁时,磁盘上那几条**读不出来**的密文原样带着。
     *
     * 没有它们的话,「解锁之前保存一次主机」(改个端口、换个名字)就会把密码
     * 加密成空串写回去 —— 用户下次连接发现密码没了,而他从没动过密码。
     */
    val lockedPassword: String? = null,
    val lockedKeyData: String? = null,
    val lockedKeyPassphrase: String? = null,
) {
    /**
     * 用私钥登录,但手里既没有导入的私钥、也没有私钥文件。
     *
     * 加了锁而这次没解锁时,`keyData` 本来就是空的 —— 所以还要看磁盘上那条密文在不在
     * ([lockedKeyData]),否则会把"锁着的私钥"误判成"没导入"。
     */
    val keyMissing: Boolean
        get() = auth == AuthKind.KEY && keyData.isEmpty() && keyPath.isEmpty() && lockedKeyData == null

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
                    password = readSecret(item.optString("password")),
                    keyData = readSecret(item.optString("keyData")),
                    keyPassphrase = readSecret(item.optString("keyPassphrase")),
                    keyName = item.optString("keyName"),
                    keyPublicFingerprint = item.optString("keyPublicFingerprint"),
                    // **这一条不能漏**:漏了每次加载都是 false —— 编辑页的开关显示成"关"
                    // (磁盘上明明锁着),而且保存时 `writeSecret` 会按"没加锁"用普通密钥
                    // 重新加密,用户没碰过开关,锁就被悄悄去掉了。
                    // 兜底看密文本身:老记录没有这个字段,但 `L:` 前缀就说明它是锁着的。
                    lockSecrets = item.optBoolean("lockSecrets", false) ||
                        Secrets.isLocked(item.optString("password")) ||
                        Secrets.isLocked(item.optString("keyData")) ||
                        Secrets.isLocked(item.optString("keyPassphrase")),
                    /** 加锁的密文读不出来(还没解锁),原样带着走,别在保存时把它覆盖成空。 */
                    lockedPassword = item.optString("password").takeIf { Secrets.isLocked(it) },
                    lockedKeyData = item.optString("keyData").takeIf { Secrets.isLocked(it) },
                    lockedKeyPassphrase = item.optString("keyPassphrase").takeIf { Secrets.isLocked(it) },
                )
            }
        }.getOrDefault(emptyList())
    }

    /**
     * 读一条凭据。加锁的密文在没解锁时读出来是空串([Secrets.open] 只认没加锁的那把密钥)——
     * 界面按"未保存"显示,用户连接时再解锁重读。原密文由 Host 里那几个 `locked*` 字段带着,
     * 保存时不会被冲掉,所以这里读不到也不会丢东西。
     */
    private fun readSecret(sealed: String): String = Secrets.open(sealed)

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
            // 三条凭据按这台主机**当前**的加锁状态写:
            // - 加锁的:明文要重新封进这道锁(普通 `seal` 用的是另一把不带认证要求的密钥,
            //   拿它写就等于把锁悄悄去掉了,而 `lockSecrets` 还写着 true)。
            // - 没加锁的:明文直接加密;明文为空而手里还攥着一条老密文时原样写回,
            //   免得"没解锁就保存"把密码覆盖成空。
            item.put("password", writeSecret(host.password, host.lockedPassword, host.lockSecrets))
            item.put("keyData", writeSecret(host.keyData, host.lockedKeyData, host.lockSecrets))
            item.put(
                "keyPassphrase",
                writeSecret(host.keyPassphrase, host.lockedKeyPassphrase, host.lockSecrets),
            )
            item.put("lockSecrets", host.lockSecrets)
            item.put("keyName", host.keyName)
            item.put("keyPublicFingerprint", host.keyPublicFingerprint)
            array.put(item)
        }
        prefs.edit().putString(KEY_LIST, array.toString()).apply()
    }

    /**
     * 写一条凭据。
     *
     * [locked] 是这台主机要不要走"要求认证"的那把密钥。它必须由调用方按主机当前的
     * 加锁状态给 —— 用普通密钥写加锁主机的明文,锁会无声地消失。
     *
     * 明文为空时原样沿用 [sealed](磁盘上那条):没解锁就保存(只改了个端口)时
     * 明文本来就是空的,拿空值去写就把密码弄丢了。
     */
    private fun writeSecret(plain: String, sealed: String?, locked: Boolean): String = when {
        plain.isEmpty() -> sealed ?: ""
        // 加锁状态下要重新封:窗口还开着才行(用户刚在编辑页验过),封不上就留着原来的。
        locked -> runCatching { Secrets.writeLocked(plain) }.getOrElse { sealed ?: "" }
        else -> Secrets.seal(plain)
    }

    private companion object {
        const val KEY_LIST = "list"
    }
}
/** 界面偏好(与主机无关的小设置)。 */
class UiPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("xssh_ui", Context.MODE_PRIVATE)

    /** 终端字体([TerminalFont.id])。 */
    var terminalFont: String?
        get() = prefs.getString(KEY_TERM_FONT, null)
        set(value) {
            prefs.edit().putString(KEY_TERM_FONT, value).apply()
        }

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
        private const val KEY_TERM_FONT = "terminalFont"
    }
}
