package dev.xssh.android

/** Drop terminal C0/C1 controls from pasted text (tab + CR/LF kept). Matches desktop sanitizePasteText. */
object PasteSanitize {
    fun sanitize(text: String): String {
        if (text.isEmpty()) return text
        val out = StringBuilder(text.length)
        for (ch in text) {
            val c = ch.code
            val drop = c <= 0x08 || c == 0x0B || c == 0x0C || (c in 0x0E..0x1F) || (c in 0x7F..0x9F)
            if (!drop) out.append(ch)
        }
        return out.toString()
    }
}
