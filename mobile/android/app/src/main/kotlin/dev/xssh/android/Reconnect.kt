package dev.xssh.android

import uniffi.xssh_ffi.FfiException
import uniffi.xssh_ffi.ServerEvent

/**
 * 断线自动重连的规则。和界面、Rust 对象都无关,单独放一处好测。
 *
 * 手机上的 SSH 最常见的"坏掉"不是服务器出事,而是**网络换了**:Wi-Fi 换 5G、进电梯、
 * 锁屏后被系统限制联网。连接是好的、账号是对的,只是那条 TCP 死了 —— 重新连一次就行。
 * 所以掉线之后先自己连回去,别让用户退回列表再点一次。
 */
object ReconnectPolicy {
    /** 最多试几次。按 [delayMillis] 的间隔加起来大约五分钟,够走出电梯、等地铁出隧道。 */
    const val MAX_ATTEMPTS = 12

    /**
     * 第 [attempt] 次(从 1 起)之前等多久:1、2、4、8、16 秒,之后每次 30 秒。
     *
     * [lastError] 是上一次失败的原因:被 OpenSSH 的 PerSourcePenalties 挡住时,
     * 基础间隔会被抬到至少 30 秒(见 [penaltyRetryDelayMs])。
     */
    fun delayMillis(attempt: Int, lastError: Throwable? = null): Long {
        require(attempt >= 1) { "attempt starts at 1" }
        val seconds = if (attempt <= 5) 1L shl (attempt - 1) else 30L
        return maxOf(seconds * 1000, penaltyRetryDelayMs(lastError) ?: 0L)
    }

    /**
     * 服务器是不是在按 OpenSSH 的 PerSourcePenalties 拒绝我们。
     *
     * 连错几次之后 sshd 会在一段时间里直接拒绝这个来源的握手,报 "not allowed at this time"。
     * 在这段时间里继续重试只会**喂大**惩罚窗口 —— 越试越久。桌面版早就按 30 秒起步了,这里跟上。
     */
    fun isRateLimited(error: Throwable?): Boolean =
        error?.message?.contains("not allowed at this time", ignoreCase = true) == true

    /** 被 PerSourcePenalties 挡住时的重试下限;其余情况 null。和桌面版一致。 */
    fun penaltyRetryDelayMs(error: Throwable?): Long? =
        if (isRateLimited(error)) 30_000L else null

    /**
     * 这次失败再试也没用吗。
     *
     * - 主机密钥不认识 / 变了:那是**安全问题**,自动重连绝不能绕过它,必须停下来让人看。
     * - 私钥口令不对、认证失败:凭据错了,再试一百次也一样,还可能触发服务器封禁。
     * - 其余(连不上、超时、DNS、握手中断)都当成网络问题,值得再试。
     */
    fun isPermanent(error: Throwable): Boolean = when (error) {
        is FfiException.HostKeyUnknown,
        is FfiException.HostKeyChanged,
        is FfiException.JumpHostKeyUnknown,
        is FfiException.JumpHostKeyChanged,
        is FfiException.KeyEncrypted,
        -> true
        is FfiException.Message -> error.message.orEmpty().contains("authentication failed", ignoreCase = true)
        else -> false
    }
}

/**
 * 首次连接的自动重试。
 *
 * 自动重连([ReconnectPolicy])只管"连上之后掉线";而**第一次连就失败**(握手被中间的
 * 转发 / NAT 掐了、SYN 丢了一个、DNS 抖一下)过去直接弹「连接失败」,用户点一下重试就 100% 连上 ——
 * 服务器明明是好的。这类失败多半是一次性的,所以先自己再试一两次,真连不上才让人看见。
 *
 * 不重试的:主机密钥 / 认证 / 口令这类"再试也没用"([ReconnectPolicy.isPermanent]),
 * 以及用户喊了「全部断开」([SessionRegistry.Cancelled])和协程取消。
 */
const val INITIAL_CONNECT_ATTEMPTS = 3

/** 第 [attempt] 次失败之后、下一次之前等多久:1 秒、2 秒。 */
fun initialRetryDelayMillis(attempt: Int): Long = 1000L * attempt

fun isRetryableInitialFailure(error: Throwable): Boolean =
    error !is kotlinx.coroutines.CancellationException &&
        error !is SessionRegistry.Cancelled &&
        !ReconnectPolicy.isPermanent(error)

/**
 * 跑 [block],遇到可重试的失败就按 [delayMillis] 等一下再来,最多 [attempts] 次;最后一次的异常原样抛出。
 *
 * [delayMillis] 拿到的是(第几次, 上一次的异常):被 PerSourcePenalties 挡住时,
 * 默认实现会把等待抬到至少 30 秒,别在惩罚窗口里越试越久。
 */
suspend fun <T> retryInitialConnect(
    attempts: Int = INITIAL_CONNECT_ATTEMPTS,
    delayMillis: (Int, Throwable) -> Long = { attempt, error ->
        maxOf(initialRetryDelayMillis(attempt), ReconnectPolicy.penaltyRetryDelayMs(error) ?: 0L)
    },
    onRetry: (attempt: Int, error: Throwable) -> Unit = { _, _ -> },
    block: () -> T,
): T {
    var attempt = 1
    while (true) {
        try {
            return block()
        } catch (e: Throwable) {
            if (attempt >= attempts || !isRetryableInitialFailure(e)) throw e
            onRetry(attempt, e)
            kotlinx.coroutines.delay(delayMillis(attempt, e))
            attempt++
        }
    }
}

/**
 * 一批服务端事件说明了什么:连接还在,还是**传输断了**(该自动重连),还是**正常结束**(不该)。
 *
 * 区分这两种结束是整件事的关键:用户敲了 `exit`、在 tmux 里 detach,远端会发 `Close`
 * (往往带着 `ExitStatus`)—— 这时候自动连回去就是和用户对着干。而网络断了,
 * 核心的心跳发不出去,报的是 `Disconnected`,那才是要重连的那种。
 */
enum class LinkOutcome { Alive, Ended, Dropped }

/** 按一批事件判断 [LinkOutcome]。同一批里既有 `Close` 又有 `Disconnected` 时按掉线算。 */
fun linkOutcome(events: List<ServerEvent>): LinkOutcome {
    var ended = false
    for (event in events) {
        when (event) {
            is ServerEvent.Disconnected -> return LinkOutcome.Dropped
            is ServerEvent.Close -> ended = true
            else -> Unit
        }
    }
    return if (ended) LinkOutcome.Ended else LinkOutcome.Alive
}

/**
 * 「连接后进入 tmux」时在远端执行的命令。
 *
 * - `new-session -A -s xssh`:有这个会话就接上,没有就新建 —— 断线重连回来还是原来那个画面,
 *   正在跑的命令不受影响。会话名固定,和桌面版的 `tmuxSessionName` 默认值无关,各管各的。
 * - 服务器上没装 tmux 时退回登录 shell,而不是直接失败把连接关掉。
 * - 整段交给 `sh -c`:这条命令由用户的登录 shell 来解释,可能是 bash、zsh 也可能是 fish,
 *   `if … then … fi` 只有 sh 系才认;单引号里的内容外层 shell 原样传给 sh。
 */
const val TMUX_COMMAND =
    "sh -c 'if command -v tmux >/dev/null 2>&1; then exec tmux new-session -A -s xssh; " +
        "else exec \"\${SHELL:-/bin/sh}\" -l; fi'"

/** 重连成功后写进终端的一行分隔:让人知道上面那些是断线前的输出。 */
/** [text] 是当前界面语言的「连接已恢复」;这里只加暗色和两边的横线。 */
fun reconnectedMarker(text: String): String = "\r\n\u001b[2m── $text ──\u001b[0m\r\n"
