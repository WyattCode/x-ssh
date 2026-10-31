import SwiftUI

/// 终端配色:和主题查询(OSC 10/11)的应答、画屏幕用的默认色保持同一份。
enum TermTheme {
    static let foreground: UInt32 = 0xE6E6E6
    static let background: UInt32 = 0x000000
    static let cursor: UInt32 = 0xFFFFFF
    /// ANSI 0..15(VS Code 深色那套,黑底上读得清)。
    static let palette: [UInt32] = [
        0x000000, 0xCD3131, 0x0DBC79, 0xE5E510, 0x2472C8, 0xBC3FBC, 0x11A8CD, 0xE5E5E5,
        0x666666, 0xF14C4C, 0x23D18B, 0xF5F543, 0x3B8EEA, 0xD670D6, 0x29B8DB, 0xFFFFFF,
    ]

    static func apply(to term: Term) {
        term.setTheme(foreground: foreground, background: background, cursor: cursor)
        term.setPalette(colors: palette)
    }
}

extension Color {
    init(rgb: UInt32) {
        self.init(.sRGB, red: Double((rgb >> 16) & 0xFF) / 255, green: Double((rgb >> 8) & 0xFF) / 255,
                  blue: Double(rgb & 0xFF) / 255, opacity: 1)
    }

    init(argb: UInt32) { self.init(rgb: argb) }
}
