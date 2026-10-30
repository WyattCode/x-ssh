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
     *
     * 兼容字段:等于 [keyFingerprints] 的第一把。服务端轮换密钥时旧指纹仍留在
     * [keyFingerprints] 里,不要只改这一项。新代码请用 [trustedHostKeys] /
     * [withTrustedHostKey]。
     */
    val keyFingerprint: String = "",
    /**
     * 这台主机信任的全部主机密钥指纹。服务端轮换时点「信任新密钥」会**追加**,
     * 不会抹掉旧的 —— 双密钥窗口 / 回滚到旧密钥都能连上。
     * 老数据只有 [keyFingerprint] 时,加载时迁进这里。
     */
    val keyFingerprints: List<String> = emptyList(),
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
     * 「连接后进入 tmux」:通道里直接跑 `tmux new-session -A -s xssh`(见 [TMUX_COMMAND])。
     * 断线自动重连回来接上的还是同一个 tmux 会话,正在跑的命令不受影响。服务器没装 tmux 时退回普通 shell。
     */
    val tmux: Boolean = false,
    /**
     * 跳板机:另一台已保存主机的 id(空 = 直连)。先登录那台,再让它开隧道连到这台 ——
     * 公司内网、云上私有子网里的机器常常只能这样进。只支持一层:跳板机自己设的跳板机不看
     * (编辑页也不让这样选)。字段名和桌面版的 `jumpHostId` 一致。
     *
     * 那台主机被删了的话这里留着原 id,连接时明确报「跳板机已删除」,
     * **不会**悄悄改成直连 —— 直连一个内网地址只会超时,还会让人以为是网络问题。
     */
    val jumpHostId: String = "",
    /**
     * 端口转发规则(连接成功后自动开)。结构和桌面版 `portForwards` 一致:
     * local / remote / dynamic。空列表 = 不开。
     */
    val portForwards: List<HostForward> = emptyList(),
    /**
     * 最近一次**连上**的时刻(毫秒,0 = 从没连过)。首页按"置顶 → 最近使用 → 添加顺序"排,
     * 遥控器的第一需求是"点我最常连的那台"。只在连接成功时写,失败和自动重连不写。
     */
    val lastUsed: Long = 0,
    /** 置顶:永远排在列表最前(组内仍按最近使用)。老数据没有这个字段,默认不置顶。 */
    val pinned: Boolean = false,
    /**
     * 还没解锁时,磁盘上那几条**读不出来**的密文原样带着。
     *
     * 没有它们的话,「解锁之前保存一次主机」(改个端口、换个名字)就会把密码
     * 加密成空串写回去 —— 用户下次连接发现密码没了,而他从没动过密码。
     */
    val lockedPassword: String? = null,
    val lockedKeyData: String? = null,
    val lockedKeyPassphrase: String? = null,
    /**
     * 磁盘上**有密文、这次却解不开**的凭据(没加锁的那种):密码 / 私钥 / 口令(见 [SecretField])。
     *
     * 重装、清了应用数据、密钥库被换掉之后,普通密钥已经不在,那几条密文永久解不开 ——
     * [password] 这些字段读出来是空串,和"本来就没存"一模一样。只看空串的话界面会说「未保存」,
     * 用户以为自己从没存过。所以在 [HostStore.load] 解密的那一刻就把"解不开"记下来。
     *
     * 只在加载时算,不落盘。加锁的密文不算(那是等着解锁,见 [lockedPassword])。
     */
    val unreadableSecrets: List<SecretField> = emptyList(),
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

/** 这台主机当前信任的全部指纹(去空白、去重、保序)。 */
fun Host.trustedHostKeys(): List<String> {
    val raw = if (keyFingerprints.isNotEmpty()) keyFingerprints else listOfNotNull(keyFingerprint.takeIf { it.isNotBlank() })
    val seen = linkedSetOf<String>()
    for (fp in raw) {
        val t = fp.trim()
        if (t.isNotEmpty()) seen.add(t)
    }
    return seen.toList()
}

/** 信任一把新的主机密钥:追加进列表,不抹掉旧的。 */
fun Host.withTrustedHostKey(fingerprint: String): Host {
    val fp = fingerprint.trim()
    if (fp.isEmpty()) return this
    val all = (trustedHostKeys() + fp).distinct()
    return copy(keyFingerprint = all.first(), keyFingerprints = all)
}


/** 从一条主机 JSON 读出指纹列表:优先 `keyFingerprints` 数组,否则迁单个 `keyFingerprint`。 */
private fun readFingerprints(item: JSONObject): List<String> {
    val out = linkedSetOf<String>()
    val arr = item.optJSONArray("keyFingerprints")
    if (arr != null) {
        for (i in 0 until arr.length()) {
            val t = arr.optString(i).trim()
            if (t.isNotEmpty()) out.add(t)
        }
    }
    if (out.isEmpty()) {
        val one = item.optString("keyFingerprint").trim()
        if (one.isNotEmpty()) out.add(one)
    }
    return out.toList()
}

/** 三条凭据。给用户看的名字在界面层按资源取(见 HostInfo.kt),这里不带文字。 */
enum class SecretField { Password, PrivateKey, Passphrase }

/** 记录里三条凭据的字段名,和 [SecretField] 的顺序一一对应。 */
private val SecretFields = listOf("password", "keyData", "keyPassphrase")

/**
 * 哪几条凭据"有密文、却解不开"。[sealed] 是磁盘上的原文,[plain] 是 [Secrets.open] 的结果,
 * 顺序同 [SecretFields]。
 *
 * - 空的不算:本来就没存。
 * - 加锁的不算:`open` 本来就不读它,那是等着连接时解锁。
 * - 剩下的"原文不空、明文却空",就是密钥已经不在(或密文坏了)。
 */
internal fun unreadableSecrets(sealed: List<String>, plain: List<String>): List<SecretField> =
    SecretField.entries.filterIndexed { i, _ ->
        sealed[i].isNotEmpty() && !Secrets.isLocked(sealed[i]) && plain[i].isEmpty()
    }

/**
 * 首页 / 侧栏的显示顺序:**置顶在前,然后按最近使用,都没用过的保持添加顺序**。
 *
 * `sortedWith` 是稳定排序 —— pinned 和 lastUsed 都相同时保持原样,
 * 所以老数据(两个字段都缺)不会被打乱,升级前后列表一模一样。
 */
fun orderHosts(hosts: List<Host>): List<Host> =
    hosts.sortedWith(
        compareByDescending<Host> { it.pinned }.thenByDescending { it.lastUsed },
    )

/**
 * 这条凭据落盘时的"旧密文"。加锁的用 [locked];没加锁却解不开的([unreadable]),
 * 内存里明文是空的,只能把磁盘上那条 [disk] 原样带回去 —— 否则任何一次保存
 * (连接写 lastUsed、置顶、删别的主机)都会把它覆盖成空串,瞬时的密钥库故障就变成永久丢失。
 */
internal fun fallbackSealed(locked: String?, unreadable: Boolean, disk: String?): String? =
    locked ?: disk?.takeIf { unreadable && it.isNotEmpty() }

class HostStore(context: Context) {
    private val prefs = context.getSharedPreferences("xssh_hosts", Context.MODE_PRIVATE)

    /**
     * 这次 [save] 里有没有哪条凭据"封不上、退回了旧密文"。
     *
     * 退回旧密文是为了不丢东西,但它同时意味着"用户改了密码,界面说存好了,其实没改" ——
     * 光靠日志看不见,得让界面把这件事说出来(见 MainActivity 的 persist)。
     */
    private var sealFellBack = false
     * 上一次 [save] 里有没有凭据"没封上"(见 [writeSecret])。封不上时旧密文会原样留着
     * (不丢数据),但界面必须知道"新密码其实没存进去",否则用户以为改成功了。
     */
    var lastSaveSealFailed: Boolean = false
        private set

    /** 磁盘上现有的记录,按 id 索引(只读 JSON,不碰密钥库)。读不出来就当没有。 */
    private fun diskRecords(): Map<String, JSONObject> = runCatching {
        val array = JSONArray(prefs.getString(KEY_LIST, "[]"))
        (0 until array.length()).mapNotNull { i ->
            array.optJSONObject(i)?.let { it.optString("id") to it }
        }.toMap()
    }.getOrDefault(emptyMap())

    /** 加载时丢了记录(或整段解析失败)就把原文另存一份,只存第一次,免得被后面的坏状态盖掉。 */
    private fun keepCorruptCopy(raw: String) {
        if (prefs.getString(KEY_CORRUPT, null) == null) {
            prefs.edit().putString(KEY_CORRUPT, raw).apply()
        }
    }

    /**
     * 磁盘上有几条主机记录。**只数 JSON 长度,不碰任何凭据** —— persist 的数据安全护栏
     * 在主线程高频调用,这里走一遍解密的话每次连接 / 置顶 / 删除都要过一遍 Keystore。
     */
    fun diskCount(): Int = runCatching {
        JSONArray(prefs.getString(KEY_LIST, "[]")).length()
    }.getOrDefault(0)

    /**
     * 磁盘上是否还有值得保护的数据:能解析出记录,或原文非空却解析不了(坏 JSON)。
     * 解析失败时 [diskCount] 会变成 0,不能再用它挡空表落盘。
     */
    fun hasProtectedDiskData(): Boolean {
        val raw = prefs.getString(KEY_LIST, null) ?: return false
        if (raw.isBlank()) return false
        return runCatching { JSONArray(raw).length() > 0 }.getOrDefault(true)
    }

    /** 上次 [load] 是否丢了记录(整段解析失败,或个别记录坏了)。只在内存里。 */
    var loadFailed: Boolean = false
        private set

    fun load(): List<Host> {
        loadFailed = false
        val raw = prefs.getString(KEY_LIST, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            // 每条记录单独兜:一条记录坏了(字段缺失、类型不对)只丢它自己,
            // 不许把整张表拖下水 —— 原来整表一个 runCatching,一条坏记录
            // 就 getOrDefault(空),首页直接变"还没有主机"。
            val loaded = (0 until array.length()).mapNotNull { index ->
                runCatching {
                    val item = array.getJSONObject(index)
                    // 三条凭据只解一次:解出来的明文进 Host,顺带记下哪条"有密文却解不开"。
                    val sealed = SecretFields.map { item.optString(it) }
                    // 单条凭据解不开(密钥没就绪、密文坏了)也不许炸整条加载:
                    // 明文落空 + unreadableSecrets 标记,界面说"读不出来",密文原样在盘上。
                    // (2026-10-10 真机:整表兜底 + 一次普通删除,曾把用户全部主机抹成空表。)
                    val plain = sealed.map { runCatching { readSecret(it) }.getOrDefault("") }
                    Host(
                        id = item.optString("id", UUID.randomUUID().toString()),
                        name = item.optString("name"),
                        address = item.optString("address"),
                        port = item.optInt("port", 22),
                        username = item.optString("username"),
                        // 默认跟数据类一致(密码);只有明确存了 "key" 才是私钥。
                        auth = if (item.optString("auth") == "key") AuthKind.KEY else AuthKind.PASSWORD,
                        keyPath = item.optString("keyPath"),
                        keyFingerprint = readFingerprints(item).let { it.firstOrNull().orEmpty() },
                        keyFingerprints = readFingerprints(item),
                        password = plain[0],
                        keyData = plain[1],
                        keyPassphrase = plain[2],
                        keyName = item.optString("keyName"),
                        keyPublicFingerprint = item.optString("keyPublicFingerprint"),
                        tmux = item.optBoolean("tmux", false),
                        jumpHostId = item.optString("jumpHostId"),
                        portForwards = parsePortForwards(item.optJSONArray("portForwards")),
                        lastUsed = item.optLong("lastUsed", 0L),
                        pinned = item.optBoolean("pinned", false),
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
                        unreadableSecrets = unreadableSecrets(sealed, plain),
                    )
                }.getOrNull()
            }
            if (loaded.size < array.length()) {
                loadFailed = true
                keepCorruptCopy(raw)
            }
            loaded
        }.getOrElse {
            loadFailed = true
            keepCorruptCopy(raw)
            emptyList()
        }
    }

    /**
     * 读一条凭据。加锁的密文在没解锁时读出来是空串([Secrets.open] 只认没加锁的那把密钥)——
     * 界面按"未保存"显示,用户连接时再解锁重读。原密文由 Host 里那几个 `locked*` 字段带着,
     * 保存时不会被冲掉,所以这里读不到也不会丢东西。
     */
    private fun readSecret(sealed: String): String = Secrets.open(sealed)

    /** 返回 true 表示有凭据没能重新加密、沿用了旧密文(界面要提示"密码没存上")。 */
    fun save(hosts: List<Host>): Boolean {
        sealFellBack = false
    /** 存盘。用 commit 而不是 apply,好让调用方知道写没写进去。 */

    fun save(hosts: List<Host>): Boolean {
    fun save(hosts: List<Host>) {
        lastSaveSealFailed = false
        val array = JSONArray()
        val disk = diskRecords()
        hosts.forEach { host ->
            fun carry(field: SecretField, key: String, locked: String?) =
                fallbackSealed(locked, field in host.unreadableSecrets, disk[host.id]?.optString(key))
            val item = JSONObject()
            item.put("id", host.id)
            item.put("name", host.name)
            item.put("address", host.address)
            item.put("port", host.port)
            item.put("username", host.username)
            item.put("auth", if (host.auth == AuthKind.PASSWORD) "password" else "key")
            item.put("keyPath", host.keyPath)
            val trusted = host.trustedHostKeys()
            item.put("keyFingerprint", trusted.firstOrNull().orEmpty())
            item.put("keyFingerprints", JSONArray(trusted))
            // 三条凭据按这台主机**当前**的加锁状态写:
            // - 加锁的:明文要重新封进这道锁(普通 `seal` 用的是另一把不带认证要求的密钥,
            //   拿它写就等于把锁悄悄去掉了,而 `lockSecrets` 还写着 true)。
            // - 没加锁的:明文直接加密;明文为空而手里还攥着一条老密文时原样写回,
            //   免得"没解锁就保存"把密码覆盖成空。
            item.put(
                "password",
                writeSecret(host.password, carry(SecretField.Password, "password", host.lockedPassword), host.lockSecrets),
            )
            item.put(
                "keyData",
                writeSecret(host.keyData, carry(SecretField.PrivateKey, "keyData", host.lockedKeyData), host.lockSecrets),
            )
            item.put(
                "keyPassphrase",
                writeSecret(
                    host.keyPassphrase,
                    carry(SecretField.Passphrase, "keyPassphrase", host.lockedKeyPassphrase),
                    host.lockSecrets,
                ),
            )
            item.put("lockSecrets", host.lockSecrets)
            item.put("keyName", host.keyName)
            item.put("keyPublicFingerprint", host.keyPublicFingerprint)
            item.put("tmux", host.tmux)
            item.put("jumpHostId", host.jumpHostId)
            if (host.portForwards.isNotEmpty()) item.put("portForwards", encodePortForwards(host.portForwards))
            item.put("lastUsed", host.lastUsed)
            item.put("pinned", host.pinned)
            array.put(item)
        }
        prefs.edit().putString(KEY_LIST, array.toString()).apply()
        return sealFellBack
        val ok = prefs.edit().putString(KEY_LIST, array.toString()).commit()
        if (!ok) android.util.Log.e("XsshData", "host list persist commit failed")
        return ok

        return prefs.edit().putString(KEY_LIST, array.toString()).commit()
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
        // 加锁状态下要重新封。**封不上时记一条日志**:这里退回旧密文是为了不丢东西,
        // 但它同时意味着"用户改了密码,界面说存好了,其实没改" —— 不打日志就完全看不见,
        // 这个静默兜底已经骗过两轮排查了。
        locked -> runCatching { Secrets.writeLocked(plain) }.getOrElse { err ->
            android.util.Log.w("xssh", "seal locked secret failed: ${err.javaClass.simpleName} ${err.message}")
            sealFellBack = true
            lastSaveSealFailed = true
            sealed ?: ""
        }
        // `Secrets.seal` 出错时返回空串(它的兜底是"这次没存上,别崩")。直接写下去
        // 就是**把原来那条密码抹掉** —— 用户只是重输了一次密码,结果连旧的一起没了。
        // 封不上就留着旧的,并记一条日志(界面这一层看不见,只能靠日志发现)。
        else -> Secrets.seal(plain).ifEmpty {
            android.util.Log.w("xssh", "seal secret failed; keeping the previous ciphertext")
            sealFellBack = true
            lastSaveSealFailed = true
            sealed ?: ""
        }
    }

    private companion object {
        const val KEY_LIST = "list"
        const val KEY_CORRUPT = "list.corrupt"
    }
}
/** 界面偏好(与主机无关的小设置)。 */
class UiPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("xssh_ui", Context.MODE_PRIVATE)

    /** 终端字体([TerminalFont.id])。 */
    var terminalFont: String?
        get() = prefs.getString(KEY_TERM_FONT, null)
        set(value) { setTerminalFont(value) }

    /** 写终端字体。返回 false = 没写进磁盘(下次冷启动会回到旧字体)。 */
    fun setTerminalFont(id: String?): Boolean =
        prefs.edit().putString(KEY_TERM_FONT, id).commit()

    /**
     * 终端配色方案 id(与桌面 `terminalTheme` 同名:nord / dracula …)。
     * null 或空 = 跟随外观。
     */
    var terminalTheme: String?
        get() = prefs.getString(KEY_TERM_THEME, null)?.takeIf { it.isNotEmpty() }
        set(value) {
            val v = value?.takeIf { it.isNotEmpty() }
            val edit = prefs.edit()
            if (v == null) edit.remove(KEY_TERM_THEME) else edit.putString(KEY_TERM_THEME, v)
            edit.apply()
        }

    /** 终端字号。手指缩放调过之后要记住,否则每开一个会话都得重新捏一次。 */
    var terminalFontSize: Float
        get() = prefs.getFloat(KEY_FONT, 14f).coerceIn(FONT_MIN, FONT_MAX)
        set(value) {
            setTerminalFontSize(value)
        }

    /**
     * 写盘并**等它落定**:`apply()` 是异步的,写失败(磁盘满、SharedPreferences 坏掉)时
     * 界面已经按新字号排好了,下次启动却又变回去 —— 用户看到的是"调了没用"。
     * 返回 false 时调用方要把字号滚回 [terminalFontSize] 并提示。
     */
    fun setTerminalFontSize(value: Float): Boolean =
        prefs.edit().putFloat(KEY_FONT, value.coerceIn(FONT_MIN, FONT_MAX)).commit()

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
        set(value) { setThemeMode(value) }

    /** Persist theme. Returns false when SharedPreferences.commit failed. */
    fun setThemeMode(value: ThemeMode): Boolean =
        prefs.edit().putString(KEY_THEME, value.name).commit()

    /** 平板侧边栏是否展开(收起后终端独占整个宽度,下次打开保持用户的选择)。 */
    var sidebarVisible: Boolean
        get() = prefs.getBoolean(KEY_SIDEBAR, true)
        set(value) { setSidebarVisible(value) }

    /** 写侧边栏展开状态。返回 false = 没写进磁盘(下次冷启动会回到旧值)。 */
    /** Persist sidebar visibility. Returns false when SharedPreferences.commit failed. */
    fun setSidebarVisible(value: Boolean): Boolean =
        prefs.edit().putBoolean(KEY_SIDEBAR, value).commit()

    companion object {
        private const val KEY_SIDEBAR = "sidebarVisible"
        private const val KEY_THEME = "themeMode"
        const val FONT_MIN = 9f
        const val FONT_MAX = 30f
        private const val KEY_FONT = "terminalFontSize"
        private const val KEY_TERM_FONT = "terminalFont"
        private const val KEY_TERM_THEME = "terminalTheme"
    }
}
