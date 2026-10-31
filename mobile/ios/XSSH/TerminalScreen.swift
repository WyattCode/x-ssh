import SwiftUI
import UIKit

/// 字号决定单元格大小;用 UIFont 量 "M" 的宽度,和 SwiftUI 的等宽系统字体是同一个字形。
struct TermMetrics: Equatable {
    let fontSize: CGFloat
    let width: CGFloat
    let height: CGFloat

    init(fontSize: CGFloat) {
        self.fontSize = fontSize
        let font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        width = ("M" as NSString).size(withAttributes: [.font: font]).width
        height = ceil(font.lineHeight)
    }
}

struct TerminalScreen: View {
    @Environment(HostStore.self) private var store
    @Environment(\.displayScale) private var displayScale
    @AppStorage("terminalFontSize") private var fontSize = 13.0

    let model: TerminalModel
    let onClose: () -> Void

    @State private var pinchBase: Double?
    @State private var dragLast: CGFloat = 0
    @State private var confirmReplace = false

    private var metrics: TermMetrics { TermMetrics(fontSize: fontSize) }

    var body: some View {
        let m = metrics
        ZStack {
            Color(rgb: TermTheme.background).ignoresSafeArea()
            // 画布和输入框一直在 —— 连接前就量得到尺寸,PTY 一开始就是对的大小;状态卡片盖在上面。
            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    canvas(m)
                    KeyCapture(model: model, ctrlArmed: model.ctrlArmed,
                               wantsKeyboard: model.wantsKeyboard && !model.showsPrompt)
                        .frame(width: 1, height: 1)
                        .allowsHitTesting(false)
                }
                .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
                .contentShape(Rectangle())
                .onTapGesture { model.wantsKeyboard = true }
                .gesture(scrollGesture(m))
                .gesture(pinchGesture)
                .onChange(of: geo.size, initial: true) { _, size in
                    model.measured(
                        cols: Int(size.width / m.width), rows: Int(size.height / m.height),
                        cellPixels: (UInt32(m.width * displayScale), UInt32(m.height * displayScale)))
                }
                .onChange(of: fontSize) { _, _ in
                    let m = metrics
                    model.measured(
                        cols: Int(geo.size.width / m.width), rows: Int(geo.size.height / m.height),
                        cellPixels: (UInt32(m.width * displayScale), UInt32(m.height * displayScale)))
                }
            }
            .padding(.horizontal, 4)
            .accessibilityElement()
            .accessibilityLabel(Text("Terminal"))
            .accessibilityValue(UIAccessibility.isVoiceOverRunning ? model.screenText : "")
            overlay
        }
        .navigationTitle(model.title.isEmpty ? model.host.displayName : model.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar, .bottomBar)
        .toolbar {
            // 系统工具栏:iPhone Duo 外屏上带图标的按钮自动竖排到右侧,放不下的进溢出菜单。
            ToolbarItemGroup(placement: .bottomBar) {
                Button(model.wantsKeyboard ? "Hide Keyboard" : "Keyboard",
                       systemImage: model.wantsKeyboard ? "keyboard.chevron.compact.down" : "keyboard") {
                    model.wantsKeyboard.toggle()
                }
                Button("Paste", systemImage: "doc.on.clipboard") { model.paste() }
                Button("Disconnect", systemImage: "xmark.circle", role: .destructive, action: onClose)
            }
        }
    }

    // MARK: 画布

    private func canvas(_ m: TermMetrics) -> some View {
        TimelineView(.periodic(from: .now, by: 0.53)) { timeline in
            Canvas { ctx, _ in
                for (y, row) in model.rows.enumerated() {
                    for run in row.runs {
                        draw(run, in: &ctx, x: CGFloat(run.col) * m.width, y: CGFloat(y) * m.height, m: m)
                    }
                }
                let c = model.cursor
                let blinkOn = Int(timeline.date.timeIntervalSinceReferenceDate / 0.53) % 2 == 0
                if c.visible, blinkOn, model.state == .connected {
                    ctx.fill(Path(CGRect(x: CGFloat(c.col) * m.width, y: CGFloat(c.row) * m.height,
                                         width: m.width, height: m.height)),
                             with: .color(Color(rgb: TermTheme.cursor).opacity(0.7)))
                }
            }
        }
    }

    private func draw(_ run: StyledRun, in ctx: inout GraphicsContext, x: CGFloat, y: CGFloat, m: TermMetrics) {
        var fg = run.fg == 0 ? Color(rgb: TermTheme.foreground) : Color(argb: run.fg)
        var bg: Color? = run.bg == 0 ? nil : Color(argb: run.bg)
        if run.flags & 16 != 0 {
            let swapped = bg ?? Color(rgb: TermTheme.background)
            bg = fg
            fg = swapped
        }
        if run.flags & 2 != 0 { fg = fg.opacity(0.6) }
        // Rust 给的 cells 用 U+001F 分隔,第 i 项就是第 col+i 列;宽字符后面的占位格是空串。
        let cells = run.cells.split(separator: "\u{1F}", omittingEmptySubsequences: false)
        if let bg {
            ctx.fill(Path(CGRect(x: x, y: y, width: CGFloat(cells.count) * m.width, height: m.height)), with: .color(bg))
        }

        func styled(_ s: String) -> Text {
            var t = Text(s).font(.system(size: m.fontSize, design: .monospaced)).foregroundStyle(fg)
            if run.flags & 1 != 0 { t = t.bold() }
            if run.flags & 4 != 0 { t = t.italic() }
            if run.flags & 8 != 0 { t = t.underline() }
            if run.flags & 32 != 0 { t = t.strikethrough() }
            return t
        }

        // 全是窄的拉丁 / 希腊 / 西里尔字符:整段一次画(一帧 1600 次 Text 解析太贵)。
        // 带宽字符、制表符、符号的段逐格画 —— 字体回退的字宽对不上格子,整段画会把后面的全挤歪。
        let simple = cells.allSatisfy { cell in
            !cell.isEmpty && (cell.unicodeScalars.first.map { $0.value < 0x2000 } ?? false)
        }
        if simple {
            let text = cells.joined()
            if !text.allSatisfy({ $0 == " " }) || run.flags & (8 | 32) != 0 {
                ctx.draw(styled(text), at: CGPoint(x: x, y: y), anchor: .topLeading)
            }
            return
        }
        for (i, cell) in cells.enumerated() where !cell.isEmpty && cell != " " {
            ctx.draw(styled(String(cell)), at: CGPoint(x: x + CGFloat(i) * m.width, y: y), anchor: .topLeading)
        }
    }

    // MARK: 手势

    /// 竖向拖动 = 滚动回滚历史;一格一行。
    private func scrollGesture(_ m: TermMetrics) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                let steps = Int((value.translation.height - dragLast) / m.height)
                if steps != 0 {
                    model.scroll(lines: steps)
                    dragLast += CGFloat(steps) * m.height
                }
            }
            .onEnded { _ in dragLast = 0 }
    }

    private var pinchGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let base = pinchBase ?? fontSize
                pinchBase = base
                fontSize = min(24, max(9, (base * value.magnification).rounded()))
            }
            .onEnded { _ in pinchBase = nil }
    }

    // MARK: 状态卡片

    @ViewBuilder private var overlay: some View {
        switch model.state {
        case .idle, .connecting:
            card {
                ProgressView().tint(.white)
                Text("Connecting…").font(.headline)
                Button("Cancel", role: .cancel, action: onClose).buttonStyle(.bordered)
            }
        case .needsTrust(let fp):
            card {
                Text("Unknown host key").font(.headline)
                Text("Check that this fingerprint belongs to the server before trusting it.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                fingerprint(fp)
                Button("Trust and connect") { model.trust(fingerprint: fp, store: store) }
                    .buttonStyle(.borderedProminent)
                Button("Cancel", role: .cancel, action: onClose).buttonStyle(.bordered)
            }
        case .keyChanged(let new, let old):
            card {
                Label("Host key changed", systemImage: "exclamationmark.triangle.fill")
                    .font(.headline).foregroundStyle(.yellow)
                Text("The server presented a different key than the one you trusted. This can mean the server was reinstalled — or that someone is intercepting the connection.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                if let old { labeled("Trusted key", old) }
                labeled("Presented key", new)
                Button("Replace key and connect", role: .destructive) { confirmReplace = true }
                    .buttonStyle(.borderedProminent)
                Button("Cancel", role: .cancel, action: onClose).buttonStyle(.bordered)
            }
            .alert("Replace the trusted key?", isPresented: $confirmReplace) {
                Button("Cancel", role: .cancel) {}
                Button("Replace key and connect", role: .destructive) { model.trust(fingerprint: new, store: store) }
            } message: {
                Text("Only continue if you know why the key changed.")
            }
        case .failed(let message):
            card {
                Label("Connection failed", systemImage: "wifi.exclamationmark").font(.headline)
                Text(verbatim: message).font(.footnote.monospaced()).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).textSelection(.enabled)
                Button("Retry") { model.connect() }.buttonStyle(.borderedProminent)
                Button("Cancel", role: .cancel, action: onClose).buttonStyle(.bordered)
            }
        case .closed(let status):
            VStack {
                Spacer()
                HStack(spacing: 12) {
                    Image(systemName: "bolt.horizontal.circle")
                    if let status, status != 0 { Text("Session ended (exit \(Int(status)))") } else { Text("Session ended") }
                    Spacer(minLength: 8)
                    Button("Reconnect") { model.connect() }.buttonStyle(.borderedProminent)
                }
                .padding(12)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
                .padding(12)
            }
            .foregroundStyle(.white)
            .environment(\.colorScheme, .dark)
        case .connected:
            EmptyView()
        }
    }

    /// 内容矮就居中显示,高过可用区域(键盘弹起、横屏)就能滚动 —— 不再被截成「…」。
    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        let body = VStack(spacing: 12, content: content)
            .fixedSize(horizontal: false, vertical: true)
        return ViewThatFits(in: .vertical) {
            body
            ScrollView { body }.scrollBounceBehavior(.basedOnSize)
        }
            .padding(20)
            .frame(maxWidth: 420)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28))
            .padding(16)
            .foregroundStyle(.white)
            .environment(\.colorScheme, .dark)
    }

    private func fingerprint(_ fp: String) -> some View {
        Text(verbatim: fp).font(.caption.monospaced()).textSelection(.enabled).multilineTextAlignment(.center)
    }

    private func labeled(_ title: LocalizedStringKey, _ fp: String) -> some View {
        VStack(spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            fingerprint(fp)
        }
    }
}
