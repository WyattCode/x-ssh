import SwiftUI

/// SSH 的「指纹图案」(randomart,OpenSSH 的 drunken bishop 算法):同一把密钥永远画出同一幅图,
/// 比对一长串字符更容易一眼认出「是不是上次那台」。输入是 `SHA256:<base64>` 形式的指纹,别的格式返回 nil(只显示文字)。
enum RandomArt {
    static let width = 17
    static let height = 9

    static func lines(fingerprint fp: String) -> [String]? {
        guard fp.hasPrefix("SHA256:") else { return nil }
        var b64 = String(fp.dropFirst("SHA256:".count))
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64), !data.isEmpty else { return nil }

        var grid = Array(repeating: Array(repeating: 0, count: width), count: height)
        let startX = width / 2, startY = height / 2
        var x = startX, y = startY
        for byte in data {
            var bits = byte
            for _ in 0..<4 {
                x = min(max(x + ((bits & 1) != 0 ? 1 : -1), 0), width - 1)
                y = min(max(y + ((bits & 2) != 0 ? 1 : -1), 0), height - 1)
                grid[y][x] += 1
                bits >>= 2
            }
        }
        let symbols = Array(" .o+=*BOX@%&#/^")
        var rows = grid.map { row in row.map { symbols[min($0, symbols.count - 1)] } }
        rows[startY][startX] = "S"
        rows[y][x] = "E"
        return rows.map { String($0) }
    }

    /// 指纹文字:去掉 `SHA256:` 前缀,每 12 个字符一行(四行,方便逐行核对)。
    static func wrapped(_ fp: String, perLine: Int = 12) -> [String] {
        let body = fp.hasPrefix("SHA256:") ? String(fp.dropFirst("SHA256:".count)) : fp
        return stride(from: 0, to: body.count, by: perLine).map {
            let start = body.index(body.startIndex, offsetBy: $0)
            let end = body.index(start, offsetBy: min(perLine, body.count - $0))
            return String(body[start..<end])
        }
    }
}

/// 一把密钥的指纹图案(黑底细框的小方块,底边嵌一个 `[SHA256]` 标签)。
private struct HostKeyArt: View {
    let lines: [String]
    var tint: Color = Color(red: 0.5, green: 0.89, blue: 0.63)

    var body: some View {
        Text(verbatim: lines.joined(separator: "\n"))
            .font(.system(size: 10.5, design: .monospaced))
            .lineSpacing(-0.8)
            .foregroundStyle(tint)
            .fixedSize()
            .padding(.horizontal, 7).padding(.vertical, 6)
            .background(Color.black, in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.white.opacity(0.25), lineWidth: 1))
            .overlay(alignment: .bottomLeading) {
                Text(verbatim: "[SHA256]")
                    .font(.system(size: 9, design: .monospaced)).foregroundStyle(Color.white.opacity(0.55))
                    .padding(.horizontal, 4)
                    .background(Color(white: 0.075))
                    .offset(x: 8, y: 7)
            }
            .accessibilityHidden(true)
    }
}

/// 「未知的主机密钥」/「主机密钥变了」确认卡:钥匙图标 + 标题,指纹图案 + 分行指纹,绿色(或红色)主按钮 + 取消。
struct HostKeyCard: View {
    enum Kind {
        case unknown(fingerprint: String)
        case changed(new: String, old: String?)
    }

    let host: String
    let kind: Kind
    let onPrimary: () -> Void
    let onCancel: () -> Void

    private static let danger = Color(red: 1.0, green: 0.27, blue: 0.23)

    /// 小字跟着系统字号走(指纹、主机名、`SHA256` 标注),指纹图案本身是图,不缩放。
    @ScaledMetric(relativeTo: .footnote) private var hostFont: CGFloat = 12
    @ScaledMetric(relativeTo: .footnote) private var tagFont: CGFloat = 10
    @ScaledMetric(relativeTo: .footnote) private var fpFont: CGFloat = 11.5
    @ScaledMetric(relativeTo: .footnote) private var fpFontSmall: CGFloat = 10

    private var isChanged: Bool { if case .changed = kind { true } else { false } }
    private var accent: Color { isChanged ? Color.orange : Color.green }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            Text(isChanged
                 ? "The server presented a different key than the one you trusted. This can mean the server was reinstalled — or that someone is intercepting the connection."
                 : "Check that this fingerprint belongs to the server before trusting it.")
                .font(.footnote).foregroundStyle(Color.white.opacity(0.62))
                .fixedSize(horizontal: false, vertical: true)
            content.padding(.bottom, 6)   // 指纹图案底边的 [SHA256] 标签往下探出一点,给它留位置
            buttons
        }
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var header: some View {
        HStack(spacing: 12) {
            CardIconRing(systemImage: isChanged ? "exclamationmark.triangle.fill" : "key.fill", tint: accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(isChanged ? "Host key changed" : "Unknown host key").font(.headline)
                HStack(spacing: 6) {
                    if !isChanged { Text("First connection") }
                    Text(verbatim: host)
                }
                .font(.system(size: hostFont, design: .monospaced)).foregroundStyle(Color.white.opacity(0.55)).lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private var content: some View {
        switch kind {
        case .unknown(let fp):
            // 字号很大、一行放不下图案 + 指纹时,改成上下排。
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 14) {
                    if let art = RandomArt.lines(fingerprint: fp) { HostKeyArt(lines: art) }
                    fingerprintText(fp, size: fpFont)
                }
                VStack(alignment: .leading, spacing: 12) {
                    if let art = RandomArt.lines(fingerprint: fp) { HostKeyArt(lines: art) }
                    fingerprintText(fp, size: fpFont)
                }
            }
        case .changed(let new, let old):
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    if let old { keyColumn("Trusted key", old, tint: Color.white.opacity(0.55)) }
                    keyColumn("Presented key", new, tint: Color(red: 1.0, green: 0.55, blue: 0.5))
                }
                VStack(alignment: .leading, spacing: 16) {
                    if let old { keyColumn("Trusted key", old, tint: Color.white.opacity(0.55)) }
                    keyColumn("Presented key", new, tint: Color(red: 1.0, green: 0.55, blue: 0.5))
                }
            }
        }
    }

    private func keyColumn(_ title: LocalizedStringKey, _ fp: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption2).foregroundStyle(Color.white.opacity(0.55))
            if let art = RandomArt.lines(fingerprint: fp) { HostKeyArt(lines: art, tint: tint).padding(.bottom, 8) }
            fingerprintText(fp, size: fpFontSmall)
        }
    }

    private func fingerprintText(_ fp: String, size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: "SHA256")
                .font(.system(size: tagFont, design: .monospaced)).foregroundStyle(Color.white.opacity(0.45))
                .padding(.bottom, 2)
            ForEach(Array(RandomArt.wrapped(fp).enumerated()), id: \.offset) { _, line in
                Text(verbatim: line).font(.system(size: size, design: .monospaced))
            }
        }
        .contextMenu {
            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = fp }
        }
        // 读屏:整条指纹一次念完(不是四段);长按可以整条复制(拆成四行显示后,系统的文字选择只能选一行)。
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Fingerprint"))
        .accessibilityValue(Text(verbatim: fp))
    }

    private var buttons: some View {
        VStack(spacing: 6) {
            CardPrimaryButton(title: isChanged ? "Replace key and connect" : "Trust and connect", danger: isChanged, action: onPrimary)
            CardGhostButton(title: "Cancel", action: onCancel)
        }
        .padding(.top, 4)
    }
}


/// 状态卡片里共用的按钮:绿色(或红色)的胶囊主按钮 + 无底色的取消。
struct CardPrimaryButton: View {
    let title: LocalizedStringKey
    var danger = false
    var compact = false
    let action: () -> Void
    @ScaledMetric(relativeTo: .body) private var regularFont: CGFloat = 16
    @ScaledMetric(relativeTo: .body) private var compactFont: CGFloat = 15

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: compact ? compactFont : regularFont, weight: .bold))
                .foregroundStyle(danger ? Color.white : Color(red: 0.016, green: 0.13, blue: 0.047))
                .padding(.horizontal, compact ? 18 : 0)
                .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 40 : 50)
                .background(danger ? Color(red: 1.0, green: 0.27, blue: 0.23) : Color(red: 0.19, green: 0.82, blue: 0.345), in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct CardGhostButton: View {
    let title: LocalizedStringKey
    let action: () -> Void
    @ScaledMetric(relativeTo: .body) private var font: CGFloat = 15

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: font))
                .foregroundStyle(Color.white.opacity(0.65))
                .frame(maxWidth: .infinity, minHeight: 42)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// 卡片标题前的细圆环图标(钥匙 / 警告 / 断网),带一点同色的光晕。
struct CardIconRing: View {
    let systemImage: String
    var tint: Color = .green

    var body: some View {
        ZStack {
            Circle().stroke(tint, lineWidth: 1.5).frame(width: 42, height: 42)
                .shadow(color: tint.opacity(0.4), radius: 8)
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .medium)).foregroundStyle(tint)
        }
    }
}

/// 状态卡片 / 状态条的背景:暗色渐变 + 细边(和主机列表同一套终端风格)。
extension View {
    func cardChrome(cornerRadius: CGFloat) -> some View {
        background(LinearGradient(colors: [Color(white: 0.09), Color(white: 0.065)], startPoint: .top, endPoint: .bottom),
                   in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).stroke(Color.white.opacity(0.12), lineWidth: 1))
    }
}
