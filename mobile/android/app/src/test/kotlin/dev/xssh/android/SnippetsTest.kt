package dev.xssh.android

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 命令片段发出去的字节和"哪台主机能看到哪些片段"。
 *
 * 发错的代价:该只填进去的被直接执行了(比如一条改完参数才该跑的 `rm`),
 * 或者多行命令只跑了第一行。
 */
class SnippetsTest {

    @Test
    fun `run appends exactly one enter`() {
        assertEquals("nvidia-smi\r", snippetPayload("nvidia-smi", run = true))
    }

    @Test
    fun `insert only never submits even with a trailing newline`() {
        // 用户在编辑框里多敲了一个回车:不能因此变成"直接执行"。
        assertEquals("tail -n 100 app.log", snippetPayload("tail -n 100 app.log\n", run = false))
        assertEquals("tail -n 100 app.log", snippetPayload("tail -n 100 app.log\r\n\n", run = false))
    }

    @Test
    fun `newlines become carriage returns so every line runs`() {
        assertEquals("cd /srv\rgit pull\r", snippetPayload("cd /srv\ngit pull", run = true))
        assertEquals("cd /srv\rgit pull\r", snippetPayload("cd /srv\r\ngit pull\n", run = true))
        // 不执行时中间的行照样是回车(那几行本来就要跑),只有最后一行留给用户改。
        assertEquals("cd /srv\rgit pull", snippetPayload("cd /srv\ngit pull", run = false))
    }

    @Test
    fun `a host sees global snippets and its own, in saved order`() {
        val all = listOf(
            Snippet(id = "1", text = "uptime"),
            Snippet(id = "2", text = "nvidia-smi", hostId = "dgx"),
            Snippet(id = "3", text = "docker ps", hostId = "web"),
            Snippet(id = "4", text = "df -h"),
        )
        assertEquals(listOf("1", "2", "4"), snippetsFor(all, "dgx").map { it.id })
        assertEquals(listOf("1", "3", "4"), snippetsFor(all, "web").map { it.id })
        assertEquals(listOf("1", "4"), snippetsFor(all, "other").map { it.id })
    }

    @Test
    fun `label falls back to the first line of the command`() {
        assertEquals("看 GPU", Snippet(title = "看 GPU", text = "nvidia-smi").label)
        assertEquals("cd /srv", Snippet(title = "  ", text = "cd /srv\ngit pull").label)
    }
}
