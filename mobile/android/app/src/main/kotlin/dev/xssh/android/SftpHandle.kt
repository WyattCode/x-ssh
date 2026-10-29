package dev.xssh.android

/**
 * 通道坏了之后要不要丢掉这个句柄:只有当它还是当前那一个时才丢。
 *
 * 并发的 `reset()` / `rebind()` 可能已经把 `sftp` 换成新的了 —— 那时再按失败的
 * 旧句柄去清空,会把刚开好的通道也一起丢掉。
 */
fun shouldDropSftpHandle(current: Any?, failed: Any?): Boolean = current === failed
