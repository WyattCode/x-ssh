package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransferQueueTest {
    @Test
    fun idleOfferStartsImmediately() {
        val q = TransferQueue<String>()
        assertNull(q.offer("a"))
        assertTrue(q.isRunning)
        assertEquals(0, q.pendingCount)
    }

    @Test
    fun busyOfferReturnsPositionFifo() {
        val q = TransferQueue<String>()
        assertNull(q.offer("a"))
        assertEquals(1, q.offer("b"))
        assertEquals(2, q.offer("c"))
        assertEquals(2, q.pendingCount)
        assertEquals("b", q.poll())
        assertEquals(1, q.pendingCount)
        assertTrue(q.isRunning)
        assertEquals("c", q.poll())
        assertEquals(0, q.pendingCount)
        assertNull(q.poll())
        assertFalse(q.isRunning)
    }

    @Test
    fun cancelPendingLeavesRunningFlag() {
        val q = TransferQueue<String>()
        assertNull(q.offer("a"))
        q.offer("b")
        q.offer("c")
        assertEquals(listOf("b", "c"), q.cancelPending())
        assertEquals(0, q.pendingCount)
        assertTrue(q.isRunning) // current still "running" until poll
        assertNull(q.poll())
        assertFalse(q.isRunning)
    }

    @Test
    fun pollWhenIdleStaysIdle() {
        val q = TransferQueue<Int>()
        assertNull(q.poll())
        assertFalse(q.isRunning)
    }
}
