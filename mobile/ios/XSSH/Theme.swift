import SwiftUI

/// 终端配色:和主题查询(OSC 10/11)的应答、画屏幕用的默认色保持同一份。
enum TermTheme {
    static let foreground: UInt32 = 0xE6E6E6
    /// 整个 App 的背景统一纯黑,和主页一致(会话页也是)。ANSI 黑(palette[0])也是 #000000。
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

extension Color {
    /// 页面背景:深色模式纯黑(和主页一致),浅色模式沿用系统浅灰。
    /// 不能直接用 `systemGroupedBackground`:在弹层(sheet)里 iOS 会把它抬成弹层专用的深灰 #1C1C1E,和主页对不上。
    static let appBackground = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? .black : .systemGroupedBackground })
    /// 卡片 / 表单行:深色 #1C1C1E(主页列表卡片的颜色),浅色白。
    static let appCard = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.11, alpha: 1) : .secondarySystemGroupedBackground })
}

extension Color {
    /// 展开成两栏时左边主机列表那一栏的背景:深色模式 #171717(比右边纯黑的终端亮一档,整栏通高),一眼分得开。
    static let appSidebar = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.09, alpha: 1) : .systemGroupedBackground })
    /// 侧栏里的主机卡片(每台一张独立的圆角卡):比侧栏底再亮一档(#212121)。
    static let appSidebarCard = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.13, alpha: 1) : .secondarySystemGroupedBackground })
    /// 正在连着的那台:卡片再亮一档并描一圈细边。
    static let appSidebarSelected = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.26, alpha: 1) : .systemGray5 })
}
