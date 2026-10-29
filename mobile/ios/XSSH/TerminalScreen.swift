import SwiftUI
import UIKit

struct TerminalScreen: View {
    @Environment(HostStore.self) private var store
    let model: TerminalModel

    private static let font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    private let cell: CGSize = {
        let w = ("M" as NSString).size(withAttributes: [.font: font]).width
        return CGSize(width: w, height: ceil(font.lineHeight))
    }()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch model.state {
            case .connected, .closed:
                GeometryReader { geo in
                    // 前景内容放在安全区里 —— 外屏竖向工具栏、折痕都靠它自动让开。
                    ZStack {
                        canvas
                        KeyCapture(model: model).frame(width: 1, height: 1).opacity(0.01)
                    }
                    .onChange(of: geo.size, initial: true) { _, size in
                        model.resize(cols: Int(size.width / cell.width), rows: Int(size.height / cell.height))
                    }
                }
                .padding(.horizontal, 4)
            case .connecting:
                ProgressView().tint(.white)
            case .needsTrust(let fp):
                notice("Unknown host key", fp, button: "Trust and connect") {
                    model.trustAndReconnect(fingerprint: fp, store: store)
                }
            case .keyChanged(let fp):
                notice("Host key changed", "\(fp)\n\nThe server presented a different key than the one you trusted. Connection refused.",
                       button: nil, action: {})
            case .failed(let message):
                notice("Connection failed", message, button: "Retry") {
                    model.start(known: store.knownKey(model.host))
                }
            }
        }
        .navigationTitle(model.title.isEmpty ? model.host.name : model.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar, .bottomBar)
        .toolbar {
            // 系统工具栏:iPhone Duo 外屏上带图标的按钮自动竖排到右侧,放不下的进溢出菜单。
            ToolbarItemGroup(placement: .bottomBar) {
                Button("Esc", systemImage: "escape") { model.press(.esc) }
                Button("Tab", systemImage: "arrow.right.to.line") { model.press(.tab) }
                Button("Ctrl", systemImage: "control") { model.ctrlArmed.toggle() }
                    .tint(model.ctrlArmed ? .accentColor : nil)
                Button("Up", systemImage: "arrow.up") { model.press(.up) }
                Button("Down", systemImage: "arrow.down") { model.press(.down) }
                Button("Left", systemImage: "arrow.left") { model.press(.left) }
                Button("Right", systemImage: "arrow.right") { model.press(.right) }
            }
        }
        .task { model.start(known: store.knownKey(model.host)) }
        .onDisappear { model.disconnect() }
    }

    private var canvas: some View {
        Canvas { ctx, _ in
            let cw = cell.width, ch = cell.height
            for (y, row) in model.rows.enumerated() {
                for run in row.runs {
                    draw(run, in: &ctx, x: CGFloat(run.col) * cw, y: CGFloat(y) * ch)
                }
            }
            let c = model.cursor
            if c.visible {
                ctx.fill(Path(CGRect(x: CGFloat(c.col) * cw, y: CGFloat(c.row) * ch, width: cw, height: ch)),
                         with: .color(.white.opacity(0.6)))
            }
        }
    }

    private func draw(_ run: StyledRun, in ctx: inout GraphicsContext, x: CGFloat, y: CGFloat) {
        var fg = run.fg == 0 ? Color.white : Color(argb: run.fg)
        var bg: Color? = run.bg == 0 ? nil : Color(argb: run.bg)
        if run.flags & 16 != 0 {
            let newFg = bg ?? .black
            bg = fg
            fg = newFg
        }
        if run.flags & 2 != 0 { fg = fg.opacity(0.6) }
        // Rust 给的 cells 用 U+001F 分隔,第 i 项就是第 col+i 列;宽字符后面的占位格是空串。
        let cells = run.cells.split(separator: "\u{1F}", omittingEmptySubsequences: false)
        for (i, cellText) in cells.enumerated() {
            if cellText.isEmpty { continue }
            let wide = i + 1 < cells.count && cells[i + 1].isEmpty
            let w = cell.width * (wide ? 2 : 1)
            let cx = x + CGFloat(i) * cell.width
            if let bg { ctx.fill(Path(CGRect(x: cx, y: y, width: w, height: cell.height)), with: .color(bg)) }
            if cellText != " " {
                var t = Text(String(cellText)).font(.system(size: 13, design: .monospaced)).foregroundStyle(fg)
                if run.flags & 1 != 0 { t = t.bold() }
                if run.flags & 4 != 0 { t = t.italic() }
                if run.flags & 8 != 0 { t = t.underline() }
                ctx.draw(t, at: CGPoint(x: cx, y: y), anchor: .topLeading)
            }
        }
    }

    private func notice(_ title: String, _ detail: String, button: String?, action: @escaping () -> Void) -> some View {
        VStack(spacing: 12) {
            Text(title).font(.headline)
            Text(detail).font(.caption.monospaced()).multilineTextAlignment(.center)
            if let button { Button(button, action: action).buttonStyle(.borderedProminent) }
        }
        .foregroundStyle(.white).padding()
    }
}

extension Color {
    init(argb: UInt32) {
        self.init(.sRGB, red: Double((argb >> 16) & 0xFF) / 255, green: Double((argb >> 8) & 0xFF) / 255,
                  blue: Double(argb & 0xFF) / 255, opacity: 1)
    }
}

/// 隐形的第一响应者:接软键盘文字和实体键盘的方向键 / Esc / Tab。
/// 用 UITextField 而不是裸 UIKeyInput:拼音等输入法要靠它的「标记文本」组字,
/// 只有组字结束(没有 markedTextRange)才把定稿的文字发给服务器 —— 裸 UIKeyInput 会把拼音字母整个吞掉。
struct KeyCapture: UIViewRepresentable {
    let model: TerminalModel

    func makeUIView(context: Context) -> CaptureField {
        let f = CaptureField()
        f.model = model
        f.delegate = context.coordinator
        f.autocorrectionType = .no
        f.autocapitalizationType = .none
        f.spellCheckingType = .no
        f.smartQuotesType = .no
        f.smartDashesType = .no
        f.smartInsertDeleteType = .no
        f.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        DispatchQueue.main.async { f.becomeFirstResponder() }
        return f
    }

    func updateUIView(_ uiView: CaptureField, context: Context) { uiView.model = model }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UITextFieldDelegate {
        @objc func changed(_ field: UITextField) {
            guard let field = field as? CaptureField, field.markedTextRange == nil,
                  let text = field.text, !text.isEmpty else { return }
            field.text = ""
            MainActor.assumeIsolated { field.model?.send(text) }
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            MainActor.assumeIsolated { (textField as? CaptureField)?.model?.send("\r") }
            return false
        }
    }

    final class CaptureField: UITextField {
        weak var model: TerminalModel?

        override func deleteBackward() {
            if (text ?? "").isEmpty && markedTextRange == nil {
                MainActor.assumeIsolated { model?.send("\u{7F}") }
            } else {
                super.deleteBackward()
            }
        }

        override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
            var handled = Set<UIPress>()
            for press in presses {
                guard let key = press.key else { continue }
                let k: TerminalModel.Key?
                switch key.keyCode {
                case .keyboardUpArrow: k = .up
                case .keyboardDownArrow: k = .down
                case .keyboardLeftArrow: k = .left
                case .keyboardRightArrow: k = .right
                case .keyboardEscape: k = .esc
                case .keyboardTab: k = .tab
                default: k = nil
                }
                if let k { MainActor.assumeIsolated { model?.press(k) }; handled.insert(press) }
            }
            if handled.count != presses.count { super.pressesBegan(presses.subtracting(handled), with: event) }
        }
    }
}
