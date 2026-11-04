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

        // 键盘被系统收起 / 我们收起时,同步回模型,按钮图标和点击唤起才对得上。
        override func becomeFirstResponder() -> Bool {
            let ok = super.becomeFirstResponder()
            if ok, !syncing { MainActor.assumeIsolated { if model?.wantsKeyboard == false { model?.wantsKeyboard = true } } }
            return ok
        }

        override func resignFirstResponder() -> Bool {
            let ok = super.resignFirstResponder()
            if ok, !syncing { MainActor.assumeIsolated { if model?.wantsKeyboard == true { model?.wantsKeyboard = false } } }
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

/// 终端专用键行:Esc / Tab / Ctrl / 方向键 / 常用符号 / 粘贴,最右固定一颗「收起键盘」。
/// 不再用系统的键盘附件栏:它铺满整个窗口宽度,内屏上会盖住左边的主机列表、半折时还横跨折痕。
/// 现在它在终端那一栏的底部(`safeAreaInset`),软键盘弹起时跟着键盘上沿走,实体键盘时贴栏底。
/// 点击区域 ≥44×44pt,看得见的键帽 40×40,按键之间留 2pt。
struct TerminalKeyRow: View {
    let model: TerminalModel
    @State private var haptic = UIImpactFeedbackGenerator(style: .light)

    var body: some View {
        HStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    text("Esc") { model.press(.esc) }
                    text("Tab") { model.press(.tab) }
                    ctrl
                    symbol("arrow.up", "Up") { model.press(.up) }
                    symbol("arrow.down", "Down") { model.press(.down) }
                    symbol("arrow.left", "Left") { model.press(.left) }
                    symbol("arrow.right", "Right") { model.press(.right) }
                    text("|") { model.send("|") }
                    text("~") { model.send("~") }
                    text("/") { model.send("/") }
                    text("-") { model.send("-") }
                    symbol("doc.on.clipboard", "Paste") { model.paste() }
                }
                .padding(.horizontal, 4)
            }
            Divider().frame(height: 24).padding(.horizontal, 2)
            symbol("keyboard.chevron.compact.down", "Hide Keyboard") { model.wantsKeyboard = false }
                .padding(.trailing, 4)
        }
        .frame(height: 52)
        // 底色只铺在终端这一栏的安全区里,不铺到右边的系统竖条下面。
        .background(.bar, ignoresSafeAreaEdges: [])
        .environment(\.colorScheme, .dark)
    }

    private var ctrl: some View {
        Button { haptic.impactOccurred(); model.ctrlArmed.toggle() } label: {
            Text("Ctrl")
        }
        .buttonStyle(KeyCapStyle(highlighted: model.ctrlArmed))
        .accessibilityLabel(Text("Control"))
        .accessibilityValue(model.ctrlArmed ? Text("On") : Text(verbatim: ""))
    }

    private func text(_ title: String, _ action: @escaping () -> Void) -> some View {
        Button { haptic.impactOccurred(); action() } label: { Text(verbatim: title) }
            .buttonStyle(KeyCapStyle())
            .accessibilityLabel(Text(verbatim: title))
    }

    private func symbol(_ name: String, _ label: LocalizedStringKey, _ action: @escaping () -> Void) -> some View {
        Button { haptic.impactOccurred(); action() } label: { Image(systemName: name) }
            .buttonStyle(KeyCapStyle())
            .accessibilityLabel(Text(label))
    }
}

private struct KeyCapStyle: ButtonStyle {
    var highlighted = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body)
            .foregroundStyle(.white)
            .frame(minWidth: 40, minHeight: 40)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(highlighted ? Color.accentColor : Color(white: configuration.isPressed ? 0.4 : 0.24)))
            .padding(2)                 // 点击区域 44×44
            .contentShape(Rectangle())
    }
}
