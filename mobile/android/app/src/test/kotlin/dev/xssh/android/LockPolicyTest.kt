package dev.xssh.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [LockPolicy.afterKeyAdded] 的取舍:有门禁、用户没碰过 → 默认上锁;用户关过就听用户的;
 * 没有门禁时绝不悄悄拨成 true(`enableLock` 会抛)。
 */
class LockPolicyTest {
    @Test
    fun availableAndUntouchedTurnsLockOn() {
        assertTrue(
            LockPolicy.afterKeyAdded(lockAvailable = true, userChoice = null, currentlyLocked = false),
        )
    }

    @Test
    fun userTurnedItOffStaysOff() {
        assertFalse(
            LockPolicy.afterKeyAdded(lockAvailable = true, userChoice = false, currentlyLocked = false),
        )
    }

    @Test
    fun userTurnedItOnStaysOn() {
        assertTrue(
            LockPolicy.afterKeyAdded(lockAvailable = true, userChoice = true, currentlyLocked = false),
        )
    }

    @Test
    fun noGateKeepsUnlocked() {
        assertFalse(
            LockPolicy.afterKeyAdded(lockAvailable = false, userChoice = null, currentlyLocked = false),
        )
    }

    @Test
    fun noGateKeepsLocked() {
        assertTrue(
            LockPolicy.afterKeyAdded(lockAvailable = false, userChoice = null, currentlyLocked = true),
        )
    }

    @Test
    fun alreadyLockedReimportStaysLockedWhenUntouched() {
        assertTrue(
            LockPolicy.afterKeyAdded(lockAvailable = true, userChoice = null, currentlyLocked = true),
        )
    }
}
