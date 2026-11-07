package dev.xssh.android

import java.util.Base64

/**
 * SSH 的「指纹图案」(randomart,OpenSSH 的 drunken bishop 算法):同一把密钥永远画出同一幅图,
 * 比对一长串字符更容易一眼认出「是不是上次那台」。
 *
 * 和 iOS 版 `HostKeyCard.swift` 里的 `RandomArt` 是同一个算法、同一组测试数据。
 * 输入是 `SHA256:<base64>` 形式的指纹,别的格式返回 null(只显示文字)。
 */
object RandomArt {
    const val WIDTH = 17
    const val HEIGHT = 9

    private const val SYMBOLS = " .o+=*BOX@%&#/^"
    private const val PREFIX = "SHA256:"

    fun lines(fingerprint: String): List<String>? {
        if (!fingerprint.startsWith(PREFIX)) return null
        var b64 = fingerprint.removePrefix(PREFIX)
        while (b64.length % 4 != 0) b64 += "="
        val data = runCatching { Base64.getDecoder().decode(b64) }.getOrNull() ?: return null
        if (data.isEmpty()) return null

        val grid = Array(HEIGHT) { IntArray(WIDTH) }
        val startX = WIDTH / 2
        val startY = HEIGHT / 2
        var x = startX
        var y = startY
        for (byte in data) {
            var bits = byte.toInt() and 0xFF
            repeat(4) {
                x = (x + if (bits and 1 != 0) 1 else -1).coerceIn(0, WIDTH - 1)
                y = (y + if (bits and 2 != 0) 1 else -1).coerceIn(0, HEIGHT - 1)
                grid[y][x] += 1
                bits = bits shr 2
            }
        }
        val rows = Array(HEIGHT) { r ->
            CharArray(WIDTH) { c -> SYMBOLS[minOf(grid[r][c], SYMBOLS.length - 1)] }
        }
        rows[startY][startX] = 'S'
        rows[y][x] = 'E'
        return rows.map { String(it) }
    }

    /** 指纹文字:去掉 `SHA256:` 前缀,每 [perLine] 个字符一行(默认 12,四行,方便逐行核对)。 */
    fun wrapped(fingerprint: String, perLine: Int = 12): List<String> {
        val body = fingerprint.removePrefix(PREFIX)
        return body.chunked(perLine)
    }
}
