package dev.xssh.android

/**
 * 传输批队列:一次只跑一批,其余排队。纯 Kotlin,JVM 单测可跑。
 *
 * [offer] 在空闲时返回 null(调用方立刻启动),忙时入队并返回排位(从 1 起)。
 * 当前批结束后 [poll] 取下一批;没有则回到空闲。
 */
internal class TransferQueue<T> {
    private var running = false
    private val pending = ArrayDeque<T>()

    /** 待跑批数(不含正在跑的那批)。 */
    @get:Synchronized
    val pendingCount: Int
        get() = pending.size

    /** 是否有批正在跑(含刚 offer 成功、调用方尚未 launch 的瞬间)。 */
    @get:Synchronized
    val isRunning: Boolean
        get() = running

    /**
     * @return null = 空闲,已标为 running,调用方应立刻启动这一批;
     *         Int = 已入队,值为排位(1 = 下一轮就跑)。
     */
    @Synchronized
    fun offer(job: T): Int? {
        if (!running) {
            running = true
            return null
        }
        pending.addLast(job)
        return pending.size
    }

    /**
     * 当前批结束后调用。返回下一批,或 null(回到空闲)。
     * 若返回非 null,[isRunning] 仍为 true。
     */
    @Synchronized
    fun poll(): T? {
        val next = pending.removeFirstOrNull()
        if (next == null) {
            running = false
            return null
        }
        return next
    }

    /** 丢掉全部待跑批,返回被丢弃的(当前批不动 —— 由调用方取消)。 */
    @Synchronized
    fun cancelPending(): List<T> {
        if (pending.isEmpty()) return emptyList()
        val dropped = pending.toList()
        pending.clear()
        return dropped
    }
}
