import SwiftUI
import UIKit

/// 隐形的第一响应者:接软键盘文字和实体键盘的组合键。终端专用键行是 `TerminalKeyRow`(SwiftUI,放在终端自己那一栏里)。
/// 用 UITextField 而不是裸 UIKeyInput:拼音等输入法靠它的「标记文本」组字,
/// 只有组字结束(没有 markedTextRange)才把定稿的文字发给服务器 —— 裸 UIKeyInput 会把拼音字母整个吞掉。
struct KeyCapture: UIViewRepresentable {
    let model: TerminalModel
    let ctrlArmed: Bool
    let wantsKeyboard: Bool

    func makeUIView(context: Context) -> CaptureField {
        let f = CaptureField(model: model)
        f.delegate = context.coordinator
        f.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        return f
    }

    func updateUIView(_ field: CaptureField, context: Context) {
        // 等视图进了窗口再要焦点;键盘开关由 `wantsKeyboard` 决定。
        DispatchQueue.main.async {
            field.syncing = true
            defer { field.syncing = false }
            if wantsKeyboard, !field.isFirstResponder, field.window != nil { _ = field.becomeFirstResponder() }
            if !wantsKeyboard, field.isFirstResponder { _ = field.resignFirstResponder() }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UITextFieldDelegate {
        private var settle: DispatchWorkItem?

        @objc func changed(_ field: UITextField) {
            guard let field = field as? CaptureField, field.markedTextRange == nil,
                  let text = field.text, !text.isEmpty else { return }
            switch InputGate.decide(text: text, dictating: field.isDictating) {
            case .sendNow:
                settle?.cancel()
                flush(field)
            case .settle(let delay):
                // 听写 / 一次进来一整段:系统还在往这个输入框里写结果(后面的识别会改写前面的),
                // 这时清空输入框会把整个听写会话弄断,只剩第一个字。等一段时间没有新变化再整段发出去。
                settle?.cancel()
                let item = DispatchWorkItem { [weak self, weak field] in
                    guard let self, let field else { return }
                    if field.isDictating || field.markedTextRange != nil { self.changed(field); return }
                    self.flush(field)
                }
                settle = item
                DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
            }
        }

        private func flush(_ field: CaptureField) {
            guard let text = field.text, !text.isEmpty else { return }
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
        /// 程序自己开关键盘时置位:这种焦点变化不该改写用户的「要不要键盘」偏好。
        var syncing = false

        init(model: TerminalModel) {
            self.model = model
            super.init(frame: .zero)
            autocorrectionType = .no
            autocapitalizationType = .none
            spellCheckingType = .no
            smartQuotesType = .no
            smartDashesType = .no
            smartInsertDeleteType = .no
            // 终端整个 App 是深色的,键盘和键行也固定深色;否则系统浅色时键盘是白的,键行的深色按钮几乎看不见。
            keyboardAppearance = .dark
            isAccessibilityElement = false
            alpha = 0.01
        }

        @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

        /// 系统听写(键盘上的麦克风)进行中。听写模式的输入语言是 "dictation"。
        var isDictating: Bool { textInputMode?.primaryLanguage == "dictation" }

        // 键盘被系统收起 / 我们收起时,同步回模型,按钮图标和点击唤起才对得上。
        override func becomeFirstResponder() -> Bool {
            let ok = super.becomeFirstResponder()
            if ok, !syncing { MainActor.assumeIsolated { if model?.wantsKeyboard == false { model?.wantsKeyboard = true } } }
            return ok
        }

        /// 键盘显示与否只由用户的按钮(`wantsKeyboard`)决定。系统因为换屏 / 姿态切换 / 导航容器重建把焦点收走时,
        /// 不能当成用户要收键盘;用户还想要键盘的话,稍后把焦点拿回来。
        override func resignFirstResponder() -> Bool {
            let ok = super.resignFirstResponder()
            if ok, !syncing, model?.wantsKeyboard == true {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                    guard let self, self.window != nil, !self.isFirstResponder else { return }
                    guard MainActor.assumeIsolated({ self.model?.wantsKeyboard == true }) else { return }
                    self.syncing = true
                    _ = self.becomeFirstResponder()
                    self.syncing = false
                }
            }
            return ok
        }

        override func deleteBackward() {
            if (text ?? "").isEmpty && markedTextRange == nil {
                MainActor.assumeIsolated { model?.send("\u{7F}") }
            } else {
                super.deleteBackward()
            }
        }

        override func paste(_ sender: Any?) { MainActor.assumeIsolated { model?.paste() } }

        override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
            action == #selector(UIResponderStandardEditActions.paste(_:)) ? true : super.canPerformAction(action, withSender: sender)
        }

        // MARK: 实体键盘 —— UIKeyCommand 会随按住自动连发,pressesBegan 不会。

        private static let functionKeys: [String] = [
            UIKeyCommand.f1, UIKeyCommand.f2, UIKeyCommand.f3, UIKeyCommand.f4, UIKeyCommand.f5, UIKeyCommand.f6,
            UIKeyCommand.f7, UIKeyCommand.f8, UIKeyCommand.f9, UIKeyCommand.f10, UIKeyCommand.f11, UIKeyCommand.f12,
        ]

        private static let commands: [UIKeyCommand] = {
            var list: [UIKeyCommand] = []
            func add(_ input: String, _ mods: UIKeyModifierFlags = []) {
                let c = UIKeyCommand(action: #selector(CaptureField.handle(_:)), input: input, modifierFlags: mods)
                c.wantsPriorityOverSystemBehavior = true
                list.append(c)
            }
            for key in [UIKeyCommand.inputUpArrow, UIKeyCommand.inputDownArrow, UIKeyCommand.inputLeftArrow,
                        UIKeyCommand.inputRightArrow, UIKeyCommand.inputEscape, UIKeyCommand.inputHome,
                        UIKeyCommand.inputEnd, UIKeyCommand.inputPageUp, UIKeyCommand.inputPageDown, "\t"] {
                add(key)
            }
            add("\t", .shift)
            for f in functionKeys { add(f) }
            for ch in "abcdefghijklmnopqrstuvwxyz[]\\ " { add(String(ch), .control) }
            return list
        }()

        override var keyCommands: [UIKeyCommand]? { Self.commands }

        @objc func handle(_ command: UIKeyCommand) {
            guard let input = command.input else { return }
            MainActor.assumeIsolated { () -> Void in
                guard let model else { return }
                if command.modifierFlags.contains(.control) {
                    if let scalar = input.unicodeScalars.first, let bytes = TerminalModel.control(scalar) {
                        model.sendRaw(bytes)
                    }
                    return
                }
                if let n = Self.functionKeys.firstIndex(of: input) { model.press(.function(n + 1)); return }
                switch input {
                case UIKeyCommand.inputUpArrow: model.press(.up)
                case UIKeyCommand.inputDownArrow: model.press(.down)
                case UIKeyCommand.inputLeftArrow: model.press(.left)
                case UIKeyCommand.inputRightArrow: model.press(.right)
                case UIKeyCommand.inputEscape: model.press(.esc)
                case UIKeyCommand.inputHome: model.press(.home)
                case UIKeyCommand.inputEnd: model.press(.end)
                case UIKeyCommand.inputPageUp: model.press(.pageUp)
                case UIKeyCommand.inputPageDown: model.press(.pageDown)
                case "\t": model.press(command.modifierFlags.contains(.shift) ? .backTab : .tab)
                default: break
                }
            }
        }
    }
}

/// 快捷键面板,照安卓:浮起的圆角面板,默认收起,和系统键盘各自独立开关。
/// 窄(外屏)两行五列,`⋯` 翻到第二页;宽(内屏)两行九列全部露出。
///
///     窄:  Esc  Tab  ^C   ↑   ⏎          第二页:  Alt  ^D  ^Z   ⌫  ^L
///          Ctrl  ⋯   ←   ↓   →                    Ctrl  ⋯   |   /   -
///     宽:  Esc  Tab  ^C  ^D  ^Z  ^L   ⌫   ↑   ⏎
///          Ctrl Alt   |   /   -   ~   ←   ↓   →
///
/// 键帽一律是胶囊(和右侧竖条的玻璃胶囊同一种形状),要么这样要么无边框,不用「方块加小圆角」。
struct TerminalKeyPanel: View {
    let model: TerminalModel
    @State private var more = false

    private let gap: CGFloat = 6

    var body: some View {
        ViewThatFits(in: .horizontal) {
            frame { wide }
            frame { compact }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 12).padding(.bottom, 10)
        .environment(\.colorScheme, .dark)
    }

    private func frame<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: gap, content: content)
            .padding(8)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 30, style: .continuous).strokeBorder(.white.opacity(0.10), lineWidth: 0.5))
    }

    private func row<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: gap, content: content)
    }

    private var compact: some View {
        Group {
            row {
                if more {
                    key("Alt", active: model.altArmed) { model.altArmed.toggle() }
                    key("^D") { model.sendRaw([4]) }
                    key("^Z") { model.sendRaw([26]) }
                    key(symbol: "delete.left", label: "Delete", repeats: true) { model.sendRaw([0x7F]) }
                } else {
                    key("Esc") { model.press(.esc) }
                    key("Tab") { model.press(.tab) }
                    key("^C") { model.sendRaw([3]) }
                    key(symbol: "arrow.up", label: "Up", repeats: true) { model.press(.up) }
                }
                key(symbol: "return", label: "Return", emphasis: true) { model.sendRaw([13]) }
            }
            row {
                key("Ctrl", active: model.ctrlArmed) { model.ctrlArmed.toggle() }
                key("⋯", active: more) { more.toggle() }
                if more {
                    key("^L") { model.sendRaw([12]) }
                    key("|") { model.send("|") }
                    key("/") { model.send("/") }
                } else {
                    key(symbol: "arrow.left", label: "Left", repeats: true) { model.press(.left) }
                    key(symbol: "arrow.down", label: "Down", repeats: true) { model.press(.down) }
                    key(symbol: "arrow.right", label: "Right", repeats: true) { model.press(.right) }
                }
            }
        }
    }

    private var wide: some View {
        Group {
            row {
                key("Esc") { model.press(.esc) }
                key("Tab") { model.press(.tab) }
                key("^C") { model.sendRaw([3]) }
                key("^D") { model.sendRaw([4]) }
                key("^Z") { model.sendRaw([26]) }
                key("^L") { model.sendRaw([12]) }
                key(symbol: "delete.left", label: "Delete", repeats: true) { model.sendRaw([0x7F]) }
                key(symbol: "arrow.up", label: "Up", repeats: true) { model.press(.up) }
                key(symbol: "return", label: "Return", emphasis: true) { model.sendRaw([13]) }
            }
            row {
                key("Ctrl", active: model.ctrlArmed) { model.ctrlArmed.toggle() }
                key("Alt", active: model.altArmed) { model.altArmed.toggle() }
                key("|") { model.send("|") }
                key("/") { model.send("/") }
                key("-") { model.send("-") }
                key("~") { model.send("~") }
                key(symbol: "arrow.left", label: "Left", repeats: true) { model.press(.left) }
                key(symbol: "arrow.down", label: "Down", repeats: true) { model.press(.down) }
                key(symbol: "arrow.right", label: "Right", repeats: true) { model.press(.right) }
            }
        }
    }

    private func key(_ title: String, active: Bool = false, action: @escaping () -> Void) -> some View {
        KeyCap(face: .text(title), label: Text(verbatim: title), active: active, emphasis: false, repeats: false, action: action)
    }

    private func key(symbol: String, label: LocalizedStringKey, emphasis: Bool = false, repeats: Bool = false,
                     action: @escaping () -> Void) -> some View {
        KeyCap(face: .symbol(symbol), label: Text(label), active: false, emphasis: emphasis, repeats: repeats, action: action)
    }
}

/// 一颗键:按下立刻触发;能连发的(方向键 / 退格)按住 0.4 秒后每 0.08 秒重复。
private struct KeyCap: View {
    enum Face { case text(String), symbol(String) }

    let face: Face
    let label: Text
    let active: Bool
    let emphasis: Bool
    let repeats: Bool
    let action: () -> Void

    @State private var pressed = false
    @State private var repeating: Task<Void, Never>?
    private static let haptic = UIImpactFeedbackGenerator(style: .light)

    var body: some View {
        content
            .font(.body)
            .foregroundStyle(.white)
            .frame(width: 52, height: 44)
            .background(Capsule().fill(fill))
            .contentShape(Capsule())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !pressed else { return }
                    pressed = true
                    fire()
                    if repeats {
                        repeating = Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(400))
                            while !Task.isCancelled { fire(); try? await Task.sleep(for: .milliseconds(80)) }
                        }
                    }
                }
                .onEnded { _ in pressed = false; repeating?.cancel(); repeating = nil })
            .accessibilityElement()
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isButton)
            .accessibilityValue(active ? Text("On") : Text(verbatim: ""))
            .accessibilityAction { action() }
    }

    @ViewBuilder private var content: some View {
        switch face {
        case .text(let t): Text(verbatim: t)
        case .symbol(let name): Image(systemName: name)
        }
    }

    private var fill: Color {
        if emphasis || active { return Color.accentColor.opacity(pressed ? 0.8 : 1) }
        return Color.white.opacity(pressed ? 0.30 : 0.14)
    }

    private func fire() {
        Self.haptic.impactOccurred()
        action()
    }
}

/// 输入框里冒出新文字时,是立刻发给服务器,还是先等一等。纯逻辑,方便单独验证。
enum InputGate {
    enum Decision: Equatable { case sendNow, settle(TimeInterval) }

    /// - 听写中:一律等(识别还在改写前面的结果)。
    /// - 一次进来不止一个字:可能是听写的整段结果,等一小会儿让后续改写落定,再整段发。
    /// - 单个字符:是敲键盘,立刻发,不能让打字有延迟。
    static func decide(text: String, dictating: Bool) -> Decision {
        if dictating { return .settle(0.7) }
        if text.count > 1 { return .settle(0.3) }
        return .sendNow
    }
}
