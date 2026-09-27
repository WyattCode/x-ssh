package dev.xssh.android

import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.io.File
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.xssh_ffi.FfiException
import uniffi.xssh_ffi.RemoteEntry
import uniffi.xssh_ffi.Session
import uniffi.xssh_ffi.Sftp
import uniffi.xssh_ffi.TransferListener

/* ─────────────────────────────── 远端文件(SFTP)的传输引擎 ───────────────────────────────

   SFTP 和终端共用同一条 SSH 连接(Rust 那边在同一连接上再开一个 sftp 子系统通道),
   不用再认证一次。通道第一次打开文件面板时才开,会话断开时一起关。

   传输跑在会话的作用域里,不跟着界面走:切回终端、切到别的会话,下载照样在跑,回来还看得到进度。
   文件内容不经过 Kotlin —— 目标 / 来源的文件描述符直接交给 Rust,边读边写。

   下载去哪儿(和浏览器一样,不每次都问):
   - 「下载」:系统「下载 / X-SSH」目录(MediaStore,Android 10+ 不要任何权限);文件夹按原样的层级放进去。
   - 「下载到…」:用户挑一个文件夹(系统文件夹选择器),一次性。
   - 「打开」:下到应用缓存,交给别的应用查看(FileProvider)。缓存里只留最近打开的那个。
*/

/** 一批传输的进度:[done] / [total] 是整批的字节数,[name] 是正在传的那个,第 [index] 个、共 [count] 个。[count] 为 0 = 还在清点。 */
data class Transfer(
    val name: String,
    val upload: Boolean,
    val done: Long,
    val total: Long,
    val index: Int,
    val count: Int,
)

/** 面板底部的一句提示。[action] 是跟在后面的按钮(「打开」)。[id] 让同一句话再来一次也能重新显示。 */
class Notice(
    val text: String,
    val error: Boolean,
    val action: Pair<String, () -> Unit>? = null,
    val id: Long = SystemClock.uptimeMillis(),
)

/** 要上传的一个本机文件。[name] 可以带 `/`(上传文件夹时是相对路径)。 */
data class UploadItem(val uri: Uri, val name: String, val size: Long)

/** 下载的目的地:系统下载目录下的 X-SSH。 */
const val DownloadFolder = "X-SSH"

/** 传输里的一步(一个文件)。[undo] 在它失败 / 被取消时清理半截产物。 */
private class Step(val name: String, val size: Long, val run: (TransferListener) -> Unit, val undo: () -> Unit = {})

class RemoteFiles(session: Session, private val scope: CoroutineScope) {
    /** 当前连接。断线重连后换成新的那条(见 [rebind]),旧连接上的 SFTP 通道随之作废。 */
    @Volatile
    private var session: Session = session

    /** 断线重连:改用新连接,旧通道丢掉,下次用到时在新连接上重开。 */
    fun rebind(newSession: Session) {
        session = newSession
        reset()
    }

    private val lock = Any()
    private var sftp: Sftp? = null
    private var closed = false
    private val cancelled = AtomicBoolean(false)

    /** 上次看到的目录和内容:切回文件面板时先摆出来,再在后台刷新。只在主线程读写。 */
    var cwd: String? = null
    var cached: List<RemoteEntry>? = null

    private val _transfer = MutableStateFlow<Transfer?>(null)
    val transfer: StateFlow<Transfer?> = _transfer

    /** 我们自己改了远端(上传完成):面板据此重新列一次。 */
    private val _changed = MutableStateFlow(0)
    val changed: StateFlow<Int> = _changed

    private val _notice = MutableStateFlow<Notice?>(null)
    val notice: StateFlow<Notice?> = _notice

    fun notify(text: String, error: Boolean = false, action: Pair<String, () -> Unit>? = null) {
        _notice.value = Notice(text, error, action)
    }

    /** 阻塞调用(在 IO 线程)。通道没开就先开。 */
    private fun <T> withSftp(block: (Sftp) -> T): T {
        val s = synchronized(lock) {
            check(!closed) { "连接已断开" }
            sftp ?: session.openSftp().also { sftp = it }
        }
        return block(s)
    }

    /** 丢掉当前通道,下次用到时重开(列目录失败后点「重试」)。 */
    fun reset() {
        val old = synchronized(lock) { sftp.also { sftp = null } } ?: return
        scope.launch(Dispatchers.IO) { release(old) }
    }

    private fun release(s: Sftp) {
        runCatching { s.shutdown() }
        runCatching { s.destroy() }
    }

    suspend fun home(): String = withContext(Dispatchers.IO) { withSftp { it.home() } }

    suspend fun list(path: String): List<RemoteEntry> = withContext(Dispatchers.IO) { withSftp { it.list(path) } }

    suspend fun isDir(path: String): Boolean = withContext(Dispatchers.IO) { withSftp { it.isDir(path) } }

    suspend fun mkdir(path: String) = withContext(Dispatchers.IO) { withSftp { it.mkdir(path) } }

    suspend fun rename(from: String, to: String) = withContext(Dispatchers.IO) { withSftp { it.rename(from, to) } }

    /** 删除;文件夹连同里面的东西一起删。符号链接只删链接本身,不跟进去。一项失败就停(抛出)。 */
    suspend fun remove(entries: List<RemoteEntry>) = withContext(Dispatchers.IO) {
        withSftp { s -> entries.forEach { removeTree(s, it.path, it.isDir && !it.isLink) } }
    }

    private fun removeTree(s: Sftp, path: String, dir: Boolean) {
        if (dir) s.list(path).forEach { removeTree(s, it.path, it.isDir && !it.isLink) }
        s.remove(path, dir)
    }

    fun cancelTransfer() {
        cancelled.set(true)
    }

    /** 还有传输在跑(一次只传一批):给提示并返回 true。 */
    fun busy(): Boolean {
        if (_transfer.value == null) return false
        notify("还有传输没完成", error = true)
        return true
    }

    /**
     * 跑一批:先 [prepare](在 IO 线程清点要传什么,可能要递归列远端 / 本机目录),再一个一个传。
     * 出错或取消就停在那一个,清掉它的半截产物;[finish] 拿到传完了几个、共几个、失败原因(取消时为 null 且 cancelled = true)。
     */
    private fun runBatch(
        upload: Boolean,
        label: String,
        prepare: (Sftp) -> List<Step>,
        finish: suspend (sent: Int, steps: List<Step>, failure: Throwable?, cancelled: Boolean) -> Unit,
    ) {
        if (busy()) return
        cancelled.set(false)
        _transfer.value = Transfer(label, upload, 0, 0, 0, 0)
        scope.launch(Dispatchers.IO) {
            var steps = emptyList<Step>()
            var sent = 0
            var failure: Throwable? = null
            try {
                steps = withSftp(prepare)
                val total = steps.sumOf { it.size.coerceAtLeast(0) }
                var base = 0L
                for ((index, step) in steps.withIndex()) {
                    if (cancelled.get()) break
                    val at = Transfer(step.name, upload, base, total, index, steps.size)
                    _transfer.value = at
                    val listener = object : TransferListener {
                        override fun progress(done: ULong, total: ULong): Boolean {
                            _transfer.value = at.copy(done = base + done.toLong())
                            return !cancelled.get()
                        }
                    }
                    val result = runCatching { step.run(listener) }
                    if (result.isFailure) {
                        runCatching { step.undo() }
                        failure = result.exceptionOrNull()
                        break
                    }
                    base += step.size.coerceAtLeast(0)
                    sent++
                }
            } catch (e: Throwable) {
                failure = e
            }
            _transfer.value = null
            val wasCancelled = cancelled.get() || failure is FfiException.Cancelled
            withContext(Dispatchers.Main) {
                finish(sent, steps, if (wasCancelled) null else failure, wasCancelled)
            }
        }
    }

    /** 把要下载的远端项展开成一个个文件(文件夹递归;指向目录的链接跳过,免得绕圈)。[rel] 是在目的地里的相对目录。 */
    private fun plan(s: Sftp, entry: RemoteEntry, rel: List<String>, out: MutableList<Pair<List<String>, RemoteEntry>>) {
        when {
            entry.isDir && !entry.isLink -> s.list(entry.path).forEach { plan(s, it, rel + entry.name, out) }
            entry.isLink && s.isDir(entry.path) -> Unit
            else -> out += rel to entry
        }
    }

    private fun downloadSteps(
        s: Sftp,
        entries: List<RemoteEntry>,
        resolver: ContentResolver,
        sink: Sink,
        created: MutableList<Uri>,
    ): List<Step> {
        val jobs = mutableListOf<Pair<List<String>, RemoteEntry>>()
        entries.forEach { plan(s, it, emptyList(), jobs) }
        return jobs.map { (rel, entry) ->
            var target: Uri? = null
            Step(
                name = entry.name,
                size = entry.size.toLong(),
                run = { listener ->
                    val uri = sink.create(rel, entry.name).also { target = it }
                    val pfd = openForWrite(resolver, uri) ?: error("无法写入「${entry.name}」")
                    // use:通道没开成(还没交给 Rust)时描述符也要关;交出去之后 close 是空操作。
                    pfd.use { withSftp { it.downloadToFd(entry.path, pfd.detachFd(), listener) } }
                    sink.finish(uri)
                    created += uri
                },
                undo = { target?.let { runCatching { sink.discard(it) } } },
            )
        }
    }

    /** 下载到系统「下载 / X-SSH」。Android 9 及以下没有 MediaStore.Downloads,返回 false(界面改问目的地)。 */
    fun download(entries: List<RemoteEntry>, context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        val resolver = context.contentResolver
        val created = mutableListOf<Uri>()
        // 在版本判断之后、lambda 之外建好:这样编译器和 lint 都看得见"只有 Android 10+ 才会走到这里"。
        val sink = MediaStoreSink(resolver)
        runBatch(
            upload = false,
            label = entries.singleOrNull()?.name ?: "${entries.size} 项",
            prepare = { s -> downloadSteps(s, entries, resolver, sink, created) },
        ) { sent, steps, failure, wasCancelled ->
            reportDownload(context, sent, steps, failure, wasCancelled, created, "下载 / $DownloadFolder")
        }
        return true
    }

    /** 下载到用户挑的文件夹 [tree](`ACTION_OPEN_DOCUMENT_TREE` 的结果)。 */
    fun downloadTo(entries: List<RemoteEntry>, tree: Uri, context: Context) {
        val resolver = context.contentResolver
        val created = mutableListOf<Uri>()
        val where = treeName(resolver, tree) ?: "所选文件夹"
        runBatch(
            upload = false,
            label = entries.singleOrNull()?.name ?: "${entries.size} 项",
            prepare = { s -> downloadSteps(s, entries, resolver, TreeSink(resolver, tree), created) },
        ) { sent, steps, failure, wasCancelled ->
            reportDownload(context, sent, steps, failure, wasCancelled, created, where)
        }
    }

    private fun reportDownload(
        context: Context,
        sent: Int,
        steps: List<Step>,
        failure: Throwable?,
        wasCancelled: Boolean,
        created: List<Uri>,
        where: String,
    ) {
        when {
            wasCancelled -> notify(if (sent > 0) "已取消(已下载 $sent 个)" else "已取消")
            failure != null -> notify("下载失败:${failure.reason()}", error = true)
            steps.isEmpty() -> notify("没有可下载的文件")
            steps.size == 1 -> {
                val uri = created.firstOrNull()
                // 重名时系统会改成「xxx (1).conf」:提示里说实际存成的名字。
                val name = uri?.let { displayName(context.contentResolver, it) } ?: steps[0].name
                notify("已下载「$name」到 $where", action = uri?.let { "打开" to { view(context, it, name) } })
            }
            else -> notify("已下载 ${steps.size} 个文件到 $where")
        }
    }

    /** 打开:下载到应用缓存,再交给能看它的应用。 */
    fun open(entry: RemoteEntry, context: Context) {
        val dir = File(context.cacheDir, "open")
        val file = File(dir, entry.name.replace('/', '_'))
        runBatch(
            upload = false,
            label = entry.name,
            prepare = {
                // 只留这一个:别让缓存越堆越大。
                dir.listFiles()?.forEach { runCatching { it.delete() } }
                dir.mkdirs()
                listOf(
                    Step(
                        name = entry.name,
                        size = entry.size.toLong(),
                        run = { listener ->
                            val pfd = ParcelFileDescriptor.open(
                                file,
                                ParcelFileDescriptor.MODE_WRITE_ONLY or ParcelFileDescriptor.MODE_CREATE or
                                    ParcelFileDescriptor.MODE_TRUNCATE,
                            )
                            pfd.use { withSftp { it.downloadToFd(entry.path, pfd.detachFd(), listener) } }
                        },
                        undo = { file.delete() },
                    ),
                )
            },
        ) { sent, _, failure, wasCancelled ->
            when {
                wasCancelled -> notify("已取消")
                failure != null -> notify("打开失败:${failure.reason()}", error = true)
                sent == 1 -> {
                    val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                    view(context, uri, entry.name)
                }
            }
        }
    }

    private fun view(context: Context, uri: Uri, name: String) {
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, viewMime(name))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            notify("没有能打开「$name」的应用", error = true)
        }
    }

    /**
     * 上传到远端目录 [dir](同名文件覆盖)。[dirs] 是要先建好的子目录(上传文件夹时,相对 [dir],浅的在前)。
     */
    fun upload(dir: String, items: List<UploadItem>, resolver: ContentResolver, dirs: List<String> = emptyList()) {
        if (items.isEmpty() && dirs.isEmpty()) return
        val top = dirs.firstOrNull() ?: items.singleOrNull()?.name
        runBatch(
            upload = true,
            label = top ?: "${items.size} 个文件",
            prepare = { s ->
                // 目录已经在了就接着用(合并);建不了又不是目录才算错。
                dirs.forEach { rel ->
                    val at = joinPath(dir, rel)
                    runCatching { s.mkdir(at) }.onFailure { if (!s.isDir(at)) throw it }
                }
                items.map { item ->
                    Step(
                        name = item.name.substringAfterLast('/'),
                        size = item.size.coerceAtLeast(0),
                        run = { listener ->
                            val pfd = resolver.openFileDescriptor(item.uri, "r") ?: error("读不到「${item.name}」")
                            val size = pfd.statSize.takeIf { it >= 0 } ?: item.size.coerceAtLeast(0)
                            pfd.use { s.uploadFromFd(joinPath(dir, item.name), pfd.detachFd(), size.toULong(), listener) }
                        },
                    )
                }
            },
        ) { sent, steps, failure, wasCancelled ->
            if (sent > 0 || dirs.isNotEmpty()) _changed.value++
            when {
                wasCancelled -> notify(if (sent > 0) "已取消(已上传 $sent 个)" else "已取消")
                failure != null -> notify("上传失败:${failure.reason()}", error = true)
                dirs.isNotEmpty() -> notify("已上传「${dirs.first()}」(${steps.size} 个文件)")
                steps.size == 1 -> notify("已上传「${steps[0].name}」")
                else -> notify("已上传 ${steps.size} 个文件")
            }
        }
    }

    fun close() {
        cancelled.set(true)
        val old = synchronized(lock) {
            closed = true
            sftp.also { sftp = null }
        } ?: return
        release(old)
    }

    fun closeAsync() {
        scope.launch(Dispatchers.IO) { close() }
    }
}

/* ─────────────────────────────── 下载目的地 ─────────────────────────────── */

private interface Sink {
    /** 在相对目录 [rel] 里建一个名叫 [name] 的新文件(重名由系统加「(1)」)。 */
    fun create(rel: List<String>, name: String): Uri

    /** 写完了(MediaStore 要把「待定」标记去掉,别的应用才看得见)。 */
    fun finish(uri: Uri) {}

    fun discard(uri: Uri)
}

/** 系统「下载 / X-SSH / 原来的层级」。不用任何权限,文件管理和别的应用都看得到。Android 10 才有这套接口。 */
@androidx.annotation.RequiresApi(Build.VERSION_CODES.Q)
private class MediaStoreSink(private val resolver: ContentResolver) : Sink {
    override fun create(rel: List<String>, name: String): Uri {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, fileMime(name))
            put(
                MediaStore.MediaColumns.RELATIVE_PATH,
                (listOf(Environment.DIRECTORY_DOWNLOADS, DownloadFolder) + rel).joinToString("/") + "/",
            )
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        return resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("无法在下载目录里创建「$name」")
    }

    override fun finish(uri: Uri) {
        resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    }

    override fun discard(uri: Uri) {
        resolver.delete(uri, null, null)
    }
}

/** 用户挑的文件夹(文档树)。子目录按需建一次、记住。 */
private class TreeSink(private val resolver: ContentResolver, tree: Uri) : Sink {
    private val root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    private val dirs = mutableMapOf<List<String>, Uri>(emptyList<String>() to root)

    private fun dir(rel: List<String>): Uri = dirs.getOrPut(rel) {
        val parent = dir(rel.dropLast(1))
        DocumentsContract.createDocument(resolver, parent, DocumentsContract.Document.MIME_TYPE_DIR, rel.last())
            ?: error("无法创建文件夹「${rel.last()}」")
    }

    override fun create(rel: List<String>, name: String): Uri =
        DocumentsContract.createDocument(resolver, dir(rel), fileMime(name), name) ?: error("无法创建「$name」")

    override fun discard(uri: Uri) {
        DocumentsContract.deleteDocument(resolver, uri)
    }
}

/** 一个 content:// 的显示名。 */
private fun displayName(resolver: ContentResolver, uri: Uri): String? = runCatching {
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    }
}.getOrNull()

/** 文档树(用户挑的文件夹)的名字,给提示用。 */
private fun treeName(resolver: ContentResolver, tree: Uri): String? = runCatching {
    val doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    resolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    }
}.getOrNull()

/**
 * 本机文件夹(用户挑的文档树)展开成要上传的文件和要先建的目录。相对路径以文件夹自己的名字开头。
 * 返回 (目录, 文件);目录浅的在前。
 */
fun walkLocalTree(resolver: ContentResolver, tree: Uri): Pair<List<String>, List<UploadItem>> {
    val rootId = DocumentsContract.getTreeDocumentId(tree)
    val rootName = treeName(resolver, tree)?.replace('/', '_') ?: "folder"
    val dirs = mutableListOf(rootName)
    val files = mutableListOf<UploadItem>()
    fun walk(docId: String, rel: String) {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
        val columns = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
        )
        val found = mutableListOf<Triple<String, String, Pair<Boolean, Long>>>()
        resolver.query(children, columns, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val name = c.getString(1).replace('/', '_')
                val dir = c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR
                found += Triple(c.getString(0), name, dir to (if (c.isNull(3)) -1L else c.getLong(3)))
            }
        }
        found.forEach { (id, name, info) ->
            val (dir, size) = info
            if (dir) {
                dirs += "$rel/$name"
                walk(id, "$rel/$name")
            } else {
                files += UploadItem(DocumentsContract.buildDocumentUriUsingTree(tree, id), "$rel/$name", size)
            }
        }
    }
    walk(rootId, rootName)
    return dirs to files
}

/** 有的文档提供方不认 "wt"(写 + 截断),退回 "w"。 */
private fun openForWrite(resolver: ContentResolver, uri: Uri) =
    runCatching { resolver.openFileDescriptor(uri, "wt") }.getOrNull() ?: resolver.openFileDescriptor(uri, "w")

/** 给人看的失败原因:核心的错误文本就是服务端 / 系统给的原话。 */
fun Throwable.reason(): String = message?.ifBlank { null } ?: javaClass.simpleName

private fun extension(name: String) = name.substringAfterLast('.', "").lowercase(Locale.ROOT)

/** 存文件时的类型:按扩展名猜,猜不出就是二进制(MediaStore 不会因此改名)。 */
private fun fileMime(name: String): String =
    MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension(name)) ?: "application/octet-stream"

/** 服务器上常见、但系统不认识的纯文本(配置、日志、脚本、没扩展名的)。 */
private val TextLike = setOf(
    "", "conf", "cfg", "ini", "log", "env", "yaml", "yml", "toml", "sh", "bash", "zsh", "py", "rb", "go", "rs",
    "service", "properties", "gradle", "kts", "md", "csv", "sql", "lock", "gitignore", "dockerfile",
)

/** 打开时给别的应用的类型:认不出、又像文本的按纯文本给,至少能用文本编辑器看。 */
private fun viewMime(name: String): String {
    val ext = extension(name)
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
        ?: if (ext in TextLike || '.' !in name) "text/plain" else "*/*"
}

/** SFTP 路径总是 `/` 分隔(和 Rust 的 `sftp::join` 一致)。 */
fun joinPath(dir: String, name: String): String = if (dir.endsWith('/')) dir + name else "$dir/$name"

fun parentPath(path: String): String {
    val trimmed = path.trimEnd('/')
    val at = trimmed.lastIndexOf('/')
    return if (at <= 0) "/" else trimmed.substring(0, at)
}

fun formatSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = arrayOf("KB", "MB", "GB", "TB")
    var value = bytes / 1024.0
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    return String.format(Locale.ROOT, if (value < 10) "%.1f %s" else "%.0f %s", value, units[unit])
}

/** 本机文件的名字和大小(系统文件选择器 / 拖进来的 content://)。 */
fun describe(resolver: ContentResolver, uri: Uri): UploadItem {
    var name: String? = null
    var size = -1L
    runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                name = c.getString(0)
                if (!c.isNull(1)) size = c.getLong(1)
            }
        }
    }
    val fallback = uri.lastPathSegment?.substringAfterLast('/')?.ifBlank { null } ?: "file"
    // 名字里带 `/` 会被远端当成目录,换掉。
    return UploadItem(uri, (name ?: fallback).replace('/', '_'), size)
}
