import SwiftUI
import UIKit

/// 隐形的第一响应者:接软键盘文字、实体键盘的组合键,并在键盘上方挂一排终端专用键。
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
        field.accessory.setCtrl(armed: ctrlArmed)
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
        let accessory: KeyAccessory
        /// 程序自己开关键盘时置位:这种焦点变化不该改写用户的「要不要键盘」偏好。
        var syncing = false

        init(model: TerminalModel) {
            self.model = model
            self.accessory = KeyAccessory(model: model)
            super.init(frame: .zero)
            autocorrectionType = .no
            autocapitalizationType = .none
            spellCheckingType = .no
            smartQuotesType = .no
            smartDashesType = .no
            smartInsertDeleteType = .no
            isAccessibilityElement = false
            alpha = 0.01
        }

        @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

        override var inputAccessoryView: UIView? { get { accessory } set {} }

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

/// 键盘上方那一排终端键。附件栏随键盘走、不会被系统挪到竖条里(Apple 的 iPhone Duo 指南里写明),
/// 所以 Esc / Tab / Ctrl / 方向键放这里,系统工具栏只放次要动作。
final class KeyAccessory: UIInputView {
    private weak var model: TerminalModel?
    private let haptic = UIImpactFeedbackGenerator(style: .light)

    init(model: TerminalModel) {
        self.model = model
        super.init(frame: CGRect(x: 0, y: 0, width: 0, height: 48), inputViewStyle: .keyboard)
        allowsSelfSizing = true
        translatesAutoresizingMaskIntoConstraints = false

        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 6
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false

        func key(_ title: String? = nil, symbol: String? = nil, label: String, action: @escaping @MainActor () -> Void) -> UIButton {
            var config = UIButton.Configuration.gray()
            config.title = title
            if let symbol { config.image = UIImage(systemName: symbol) }
            config.cornerStyle = .medium
            config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12)
            let b = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in
                self?.haptic.impactOccurred()
                MainActor.assumeIsolated { action() }
            })
            b.accessibilityLabel = label
            b.widthAnchor.constraint(greaterThanOrEqualToConstant: 40).isActive = true
            return b
        }

        let m = model
        let buttons: [UIButton] = [
            key("Esc", label: "Esc") { m.press(.esc) },
            key("Tab", label: "Tab") { m.press(.tab) },
            key("Ctrl", label: String(localized: "Control")) { m.ctrlArmed.toggle() },
            key(symbol: "arrow.up", label: String(localized: "Up")) { m.press(.up) },
            key(symbol: "arrow.down", label: String(localized: "Down")) { m.press(.down) },
            key(symbol: "arrow.left", label: String(localized: "Left")) { m.press(.left) },
            key(symbol: "arrow.right", label: String(localized: "Right")) { m.press(.right) },
            key("|", label: "|") { m.send("|") },
            key("~", label: "~") { m.send("~") },
            key("/", label: "/") { m.send("/") },
            key("-", label: "-") { m.send("-") },
            key(symbol: "doc.on.clipboard", label: String(localized: "Paste")) { m.paste() },
        ]
        for (i, b) in buttons.enumerated() {
            if i == 2 { ctrl = b }
            stack.addArrangedSubview(b)
        }

        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -8),
            stack.centerYAnchor.constraint(equalTo: scroll.frameLayoutGuide.centerYAnchor),
            heightAnchor.constraint(equalToConstant: 48),
        ])
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    private var ctrl: UIButton?

    /// Ctrl 待用时整颗按钮实心高亮,看得出下一个键会变成控制字符。
    func setCtrl(armed: Bool) {
        guard let ctrl else { return }
        var config = armed ? UIButton.Configuration.filled() : UIButton.Configuration.gray()
        config.title = "Ctrl"
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12)
        ctrl.configuration = config
        ctrl.accessibilityValue = armed ? String(localized: "On") : nil
    }
}
