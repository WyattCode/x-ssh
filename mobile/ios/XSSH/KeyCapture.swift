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
        field.wanted = wantsKeyboard
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
            guard let field = field as? CaptureField else { return }
            // 拼音等输入法正在组字:等定稿。
            guard field.markedTextRange == nil else { return }
            switch InputGate.decide(sinceKeyActivity: field.sinceKeyActivity) {
            case .sendNow:
                // 敲键盘:立刻把输入框相对「已发出去的」多出 / 少掉的部分发走,然后清空(没有听写会话要保护)。
                settle?.cancel()
                sync(field)
                // 有字被发走了(或垫底的占位符快用完了)才重置;只是删占位符时不能动输入框,否则按住退格的连发会被打断。
                if !field.content.isEmpty || field.padCount < CaptureField.padLow { field.resetField() }
            case .settle(let delay):
                // 听写 / 粘贴:**不清空输入框**。听写会话要回头改写、补全它写进去的字,清空就等于打断它(只剩第一个字、
                // 或者说着说着自己停了)。原生 iOS 听写一直录到用户自己点停止,这里也一样。
                // 等识别安静下来,只把新增的部分发出去;识别回头改了已发出的字,就退格再补。
                settle?.cancel()
                let item = DispatchWorkItem { [weak self, weak field] in
                    guard let self, let field, field.markedTextRange == nil else { return }
                    self.sync(field)
                    // 听写文字一直攒在隐形输入框里;长到没必要时才清(这时再断一次会话也不心疼)。
                    if field.content.count > 2000 { field.resetField() }
                }
                settle = item
                DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
            }
        }

        /// 把输入框现在的内容和「已经发给服务器的」对一下:公共前缀之外,已发出的多余部分发退格,新增部分照发。
        private func sync(_ field: CaptureField) {
            let now = field.content
            let (backspaces, insert) = InputGate.diff(sent: field.sentText, now: now)
            field.sentText = now
            MainActor.assumeIsolated {
                if backspaces > 0 { field.model?.sendRaw(Array(repeating: 0x7F, count: backspaces)) }
                if !insert.isEmpty { field.model?.send(insert) }
            }
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
        /// 此刻界面上是否该有终端键盘(紧凑布局里在主机列表页就不该有)。系统收走焦点后,只有它为真才会把焦点拿回来。
        var wanted = true

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
            resetField()
        }

        @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }


        /// 最近一次来自键盘的输入动作(敲字 / 组字 / 定稿 / 删除)的时间。听写不经过这些方法,见 `InputGate`。
        private var lastKeyActivity: CFTimeInterval = 0
        var sinceKeyActivity: TimeInterval { CACurrentMediaTime() - lastKeyActivity }
        private func stamp() { lastKeyActivity = CACurrentMediaTime() }

        /// 输入框里已经发给服务器的那部分(听写期间输入框不清空,靠它算增量)。
        var sentText = ""

        // MARK: 垫底的占位字符(让按住退格能连发)
        //
        // iOS 的键盘按住退格能不能连发,看的是输入框里光标前面**真有没有字**:空的时候只删一下就停(`hasText` 骗不过它)。
        // 终端的输入框平时是空的(字都立刻发给了服务器),所以在光标前垫一排零宽空格:
        // 每按一下退格,吃掉一个占位符、同时发一个退格给服务器,键盘一直觉得「还有字可删」,按住就连发。
        static let padChar: Character = "\u{200B}"
        static let padSize = 200
        /// 占位符少于这个数就补满(只在不影响连发的时候补)。
        static let padLow = 16

        /// 输入框里真正的内容(去掉占位符)。
        var content: String { (text ?? "").filter { $0 != Self.padChar } }
        var padCount: Int { (text ?? "").filter { $0 == Self.padChar }.count }

        /// 清空内容、补满占位符,光标落在最后。
        func resetField() {
            text = String(repeating: Self.padChar, count: Self.padSize)
            sentText = ""
        }

        override func insertText(_ text: String) {
            stamp()
            super.insertText(text)
        }

        override func setMarkedText(_ markedText: String?, selectedRange: NSRange) {
            stamp()
            super.setMarkedText(markedText, selectedRange: selectedRange)
        }

        override func unmarkText() {
            stamp()
            super.unmarkText()
        }


        // 键盘被系统收起 / 我们收起时,同步回模型,按钮图标和点击唤起才对得上。
        override func becomeFirstResponder() -> Bool {
            let ok = super.becomeFirstResponder()
            if ok, !syncing { MainActor.assumeIsolated { if model?.wantsKeyboard == false { model?.wantsKeyboard = true } } }
            if ok, content.isEmpty, padCount < Self.padLow { resetField() }
            return ok
        }

        /// 键盘显示与否只由用户的按钮(`wantsKeyboard`)决定。系统因为换屏 / 姿态切换 / 导航容器重建把焦点收走时,
        /// 不能当成用户要收键盘;用户还想要键盘的话,稍后把焦点拿回来。
        override func resignFirstResponder() -> Bool {
            let ok = super.resignFirstResponder()
            if ok, !syncing, wanted, model?.wantsKeyboard == true {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                    guard let self, self.window != nil, !self.isFirstResponder else { return }
                    guard self.wanted, MainActor.assumeIsolated({ self.model?.wantsKeyboard == true }) else { return }
                    self.syncing = true
                    _ = self.becomeFirstResponder()
                    self.syncing = false
                }
            }
            return ok
        }

        override func deleteBackward() {
            stamp()
            if markedTextRange != nil { super.deleteBackward(); return }   // 正在组字:删的是拼音字母
            if content.isEmpty {
                // 光标前只有占位符:这一下退格要删的是服务器上的一个字。吃掉一个占位符让键盘继续认为有字可删。
                if !(text ?? "").isEmpty { super.deleteBackward() } else { resetField() }
                MainActor.assumeIsolated { model?.send("\u{7F}") }
            } else {
                super.deleteBackward()   // 删的是听写 / 刚打的字:`changed` 里按增量把退格发出去
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
///
/// 听写(键盘上的麦克风)和敲键盘的区别不在输入语言(真机上听写时 `primaryLanguage` 一直是 zh-Hans),
/// 而在**来路**:敲键盘的字符一定经过 `insertText` / `setMarkedText` / `unmarkText` / `deleteBackward`;
/// 听写的结果是系统直接改写输入框内容,不经过这些方法。
/// 听写会话要回头改写、补全它刚写进去的文字,所以**听写时不能清空输入框**(清空 = 取消会话,只剩第一个字),
/// 要等识别停下来再整段发。
enum InputGate {
    enum Decision: Equatable {
        /// 敲键盘:立刻发,并清空输入框。
        case sendNow
        /// 听写 / 粘贴 / 其它不经键盘的改写:保留输入框内容,安静下来再整段发。
        case settle(TimeInterval)
    }

    /// 已发给服务器的 `sent` 变成现在的 `now`:公共前缀(按字符,不拆开组合字符)之外,
    /// `sent` 多出来的部分要用退格删掉,`now` 多出来的部分要补发。
    static func diff(sent: String, now: String) -> (backspaces: Int, insert: String) {
        let a = Array(sent), b = Array(now)
        var i = 0
        while i < a.count, i < b.count, a[i] == b[i] { i += 1 }
        return (a.count - i, String(b[i...]))
    }

    /// - `sinceKeyActivity`:距离最近一次键盘动作过了多久(秒)。
    static func decide(sinceKeyActivity: TimeInterval) -> Decision {
        sinceKeyActivity < 0.15 ? .sendNow : .settle(0.9)
    }
}
