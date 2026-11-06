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
            ZStack {
                Circle().stroke(accent, lineWidth: 1.5).frame(width: 42, height: 42)
                    .shadow(color: accent.opacity(0.4), radius: 8)
                Image(systemName: isChanged ? "exclamationmark.triangle.fill" : "key.fill")
                    .font(.system(size: 18, weight: .medium)).foregroundStyle(accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(isChanged ? "Host key changed" : "Unknown host key").font(.headline)
                HStack(spacing: 6) {
                    if !isChanged { Text("First connection") }
                    Text(verbatim: host)
                }
                .font(.system(size: 12, design: .monospaced)).foregroundStyle(Color.white.opacity(0.55)).lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private var content: some View {
        switch kind {
        case .unknown(let fp):
            HStack(alignment: .top, spacing: 14) {
                if let art = RandomArt.lines(fingerprint: fp) { HostKeyArt(lines: art) }
                fingerprintText(fp, size: 11.5)
            }
        case .changed(let new, let old):
            HStack(alignment: .top, spacing: 12) {
                if let old { keyColumn("Trusted key", old, tint: Color.white.opacity(0.55)) }
                keyColumn("Presented key", new, tint: Color(red: 1.0, green: 0.55, blue: 0.5))
            }
        }
    }

    private func keyColumn(_ title: LocalizedStringKey, _ fp: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption2).foregroundStyle(Color.white.opacity(0.55))
            if let art = RandomArt.lines(fingerprint: fp) { HostKeyArt(lines: art, tint: tint).padding(.bottom, 8) }
            fingerprintText(fp, size: 10)
        }
    }

    private func fingerprintText(_ fp: String, size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: "SHA256")
                .font(.system(size: 10, design: .monospaced)).foregroundStyle(Color.white.opacity(0.45))
                .padding(.bottom, 2)
            ForEach(Array(RandomArt.wrapped(fp).enumerated()), id: \.offset) { _, line in
                Text(verbatim: line).font(.system(size: size, design: .monospaced))
            }
        }
        .textSelection(.enabled)
    }

    private var buttons: some View {
        VStack(spacing: 6) {
            Button(action: onPrimary) {
                Text(isChanged ? "Replace key and connect" : "Trust and connect")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(isChanged ? Color.white : Color(red: 0.016, green: 0.13, blue: 0.047))
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(isChanged ? Self.danger : Color(red: 0.19, green: 0.82, blue: 0.345), in: Capsule())
                    .contentShape(Capsule())
            }
            Button(action: onCancel) {
                Text("Cancel")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.white.opacity(0.65))
                    .frame(maxWidth: .infinity, minHeight: 42)
                    .contentShape(Capsule())
            }
        }
        .buttonStyle(.plain)
        .padding(.top, 4)
    }
}
