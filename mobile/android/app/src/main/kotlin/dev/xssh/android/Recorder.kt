package dev.xssh.android

import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer

/**
 * 调试录制:把**服务器发来的原始字节**和**窗口尺寸变化**按时间顺序写进文件,
 * 拿到电脑上用同一个 Rust 终端核心回放(`cargo run -p xssh-core --example replay`)。
 *
 * 为什么要有它:全屏程序(Codex 之类)显示不全时,靠截图猜不出是"终端模型里就没有"
 * 还是"模型里有、安卓没画出来"。回放一遍就分清了。
 *
 * - 只在可调试的包里生效([dir] 由 MainActivity 在调试包里才设置);
 * - 默认关闭:`files/record` 这个标记文件存在才录
 *   (`adb shell run-as dev.xssh.android touch files/record`);
 * - **只录服务器输出,不录用户敲的键** —— 键盘输入里可能有 sudo 密码。
 *
 * 文件格式:若干条记录,每条 = 类型(1 字节:0 数据 / 1 尺寸)+ 毫秒时间戳(8)+ 长度(4)+ 内容。
 * 尺寸记录的内容是两个 int:列、行。
 */
object DebugRecorder {
    @Volatile
    var dir: File? = null

    fun open(): Recording? {
        val base = dir ?: return null
        if (!File(base, "record").exists()) return null
        val file = File(base, "rec-${System.currentTimeMillis()}.bin")
        return runCatching { Recording(FileOutputStream(file).buffered()) }.getOrNull()
    }
}

class Recording(private val out: BufferedOutputStream) {
    private val started = System.nanoTime()

    @Synchronized
    fun data(bytes: ByteArray) = write(0, bytes)

    @Synchronized
    fun resize(cols: Int, rows: Int) = write(1, ByteBuffer.allocate(8).putInt(cols).putInt(rows).array())

    @Synchronized
    fun close() {
        runCatching { out.close() }
    }

    private fun write(type: Int, payload: ByteArray) {
        runCatching {
            val millis = (System.nanoTime() - started) / 1_000_000
            out.write(ByteBuffer.allocate(13).put(type.toByte()).putLong(millis).putInt(payload.size).array())
            out.write(payload)
            out.flush()
        }
    }
}
