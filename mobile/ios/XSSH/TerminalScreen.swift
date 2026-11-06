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
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(FoldState.self) private var fold
    @AppStorage("terminalFontSize") private var fontSize = 13.0

    let model: TerminalModel
    /// 回到主机列表,会话保留(和「断开」不同)。
    let onBack: () -> Void
    let onClose: () -> Void
    /// 内屏(自己排的两栏布局)里嵌着用:标题、右边的玻璃竖条、返回手势都由外层 `RootView` 画,这里不挂系统导航栏 / 工具栏。
    var embedded = false

    /// 内屏终端顶部让出的高度(会话名那一行),随字体大小缩放,不压到标题。
    @ScaledMetric(relativeTo: .headline) private var titleHeight: CGFloat = 22
    private var embeddedTop: CGFloat { 52 + titleHeight }   // 52 = 标题上方的固定留白 + 标题下面到终端的间距
    @State private var pinchBase: Double?
    @State private var dragLast: CGFloat = 0
    @State private var confirmReplace = false
    @State private var container: CGRect = .zero
    /// 长按选择:正在选(手指还按着)、编辑菜单的锚点(终端画布坐标;nil = 不显示)、滚动条什么时候淡出。
    @State private var selecting = false
    @State private var menuAnchor: CGPoint?
    @State private var pressTask: Task<Void, Never>?
    @State private var pressStart: CGPoint?
    @State private var scrolling = false
    @State private var barVisible = false
    @State private var barDragging = false

    private var metrics: TermMetrics { TermMetrics(fontSize: fontSize) }

    var body: some View {
        if embedded { core } else {
            // 关闭会话时整页先淡出、略微缩小(`leaving`,动画由 `RootView.close` 编排),再翻回列表。
            navChrome(core.opacity(model.leaving ? 0 : 1).scaleEffect(model.leaving ? 0.965 : 1))
        }
    }

    @ViewBuilder private var core: some View {
        let m = metrics
        ZStack {
            Color(rgb: TermTheme.background).ignoresSafeArea()
            // 画布和输入框一直在 —— 连接前就量得到尺寸,PTY 一开始就是对的大小;状态卡片盖在上面。
            GeometryReader { geo in
                // 避开接缝和遮挡区:笔记本姿态只用接缝上半,书本姿态只用一侧,遮挡区从最省的那条边削掉。
                let full = geo.frame(in: .global)
                let area = fold.usableRect(in: full)
                let size = area.size
                ZStack(alignment: .topLeading) {
                    canvas(m)
                    scrollBar(size: size, m: m)
                    editMenu(size: size, m: m)
                }
                .frame(width: size.width, height: size.height, alignment: .topLeading)
                // 长按选择文字(再拖动扩展),松手弹出「复制 / 粘贴」。放在高优先级:长按成功之后的拖动归它,不当成滚动。
                .contentShape(Rectangle())
                #if DEBUG
                .border(FoldState.simulatedAxis == nil && !FoldState.simulatesOcclusion ? .clear : .green.opacity(0.6))
                #endif
                .padding(.leading, area.minX - full.minX)
                .padding(.top, area.minY - full.minY)
                .contentShape(Rectangle())
                .onTapGesture { model.wantsKeyboard = true; model.selectClear(); menuAnchor = nil }
                .gesture(terminalDrag(m))
                .gesture(pinchGesture)
                .onChange(of: size, initial: true) { _, size in
                    model.measured(
                        cols: Int(size.width / m.width), rows: Int(size.height / m.height),
                        cellPixels: (UInt32(m.width * displayScale), UInt32(m.height * displayScale)))
                }
                .onChange(of: fontSize) { _, _ in
                    let m = metrics
                    model.measured(
                        cols: Int(size.width / m.width), rows: Int(size.height / m.height),
                        cellPixels: (UInt32(m.width * displayScale), UInt32(m.height * displayScale)))
                }
            }
            // 内屏(常规宽度)左边紧挨着侧栏的分界线,文字贴着边太挤:多留一些;外屏窄,保持 4pt。
            // 外屏:20pt,和主机列表页的对齐线(logo / `$ hosts` / `❯`)同一条竖线,从列表点进会话左边缘不跳;
            // 内屏:16pt(左边紧挨着侧栏的分界线,文字贴着边太挤)。
            .padding(.horizontal, sizeClass == .regular ? 16 : 20)
            // 内屏自己排版没有导航栏:终端从会话名下面开始(和外屏导航栏下面的位置一致)。
            .padding(.top, embedded ? embeddedTop : 0)
            .accessibilityElement()
            .accessibilityLabel(Text("Terminal"))
            .accessibilityValue(UIAccessibility.isVoiceOverRunning ? model.screenText : "")
            // 状态卡片和画布用同一块可用区域:不跨接缝、不压遮挡区。
            overlay
                .frame(width: usable?.width, height: usable?.height)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(.leading, usable.map { $0.minX - container.minX } ?? 0)
                .padding(.top, usable.map { $0.minY - container.minY } ?? 0)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                if model.showsKeys, model.state == .connected { TerminalKeyPanel(model: model) }
                // 直板机:系统的底部工具栏是横的,软键盘一弹就盖住了,控制按钮自己放在键盘上方。
                if fold.isStandardPhone, showsControlBar { controlBar }
            }
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { container = $0 }
    }

    /// 外屏 / 直板机:用系统导航栏 + 工具栏(Duo 外屏上带图标的按钮自动竖排到右侧)。
    private func navChrome<V: View>(_ content: V) -> some View {
        content
        .navigationTitle(model.title.isEmpty ? model.host.displayName : model.title)
        .navigationBarTitleDisplayMode(.inline)
        // 标题由左上角的主机名自己画,去掉系统标题,否则主机名出现两遍。
        .toolbar(removing: .title)
        .toolbarColorScheme(.dark, for: .navigationBar, .bottomBar)
        // 系统返回键在外屏竖条最上面,紧贴状态区;改成底部工具栏里的「主机」按钮。
        // 工具栏结构不随尺寸类变:姿态切换时(折叠 / 展开)内容变了,系统会丢掉竖条。
        .navigationBarBackButtonHidden(true)
        // 会话名画在页面里,不放系统工具栏(原因见 `OuterTitleBar`):关闭 / 返回时它跟着页面一起滑走,不再和列表的 logo 做模糊交接。
        .overlay(alignment: .topLeading) {
            OuterTitleBar {
                Text(verbatim: model.title.isEmpty ? model.host.displayName : model.title)
                    .font(.headline).lineLimit(1).truncationMode(.tail)
                    .foregroundStyle(.white)
                    .frame(maxWidth: 280, alignment: .leading)
                    // 关闭时会话名往左飘一点、淡出,和整页的淡出一起。
                    .offset(x: model.leaving ? -18 : 0).opacity(model.leaving ? 0 : 1)
            }
        }
        // 隐藏了系统返回键,系统的「从屏幕左边缘右滑返回」也就跟着没了。自己补一条:屏幕最左边一条窄带,右滑回主机列表。
        .background { EdgeSwipeBack(onBack: onBack).frame(width: 0, height: 0) }
        .toolbar {
            // 看不见的占位项:撑住导航栏的高度(会话名画在页面里,见 `OuterTitleBar`),终端才从原来的位置开始。
            ToolbarItem(placement: .topBarLeading) { Color.clear.frame(width: 1, height: 1).accessibilityHidden(true) }
                .sharedBackgroundVisibility(.hidden)
            if !fold.isStandardPhone {
                // 返回主机列表是导航,键盘弹着、竖条放不下时让位:进溢出菜单。这时最需要的是键盘 / 快捷键两颗开关。
                ToolbarItem(placement: .bottomBar) {
                    Button("Hosts", systemImage: "chevron.left", action: onBack)
                }
                // 系统工具栏:iPhone Duo 外屏上带图标的按钮自动竖排到右侧,放不下的从下往上收进溢出菜单。
                // 键盘开关是终端里最常用的,最后才收;断开最不常用,最先收。每颗都带标题,溢出菜单里才看得懂。
                // 快捷键面板和系统键盘是两颗独立的按钮,各自亮着(蓝)表示开着 —— 同安卓的 ⌘ / ⌨。
                ToolbarItem(placement: .bottomBar) {
                    Button("Shortcuts", systemImage: "command") { withAnimation(.smooth(duration: 0.25)) { model.showsKeys.toggle() } }
                        .tint(model.showsKeys ? Color.accentColor : nil)
                }
                .visibilityPriority(.high)
                ToolbarItem(placement: .bottomBar) {
                    Button("Keyboard", systemImage: "keyboard") { model.wantsKeyboard.toggle() }
                        .tint(model.wantsKeyboard ? Color.accentColor : nil)
                }
                .visibilityPriority(.high)
                ToolbarItem(placement: .bottomBar) {
                    Button("Paste", systemImage: "clipboard") { model.paste() }
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("Disconnect", systemImage: "xmark", role: .destructive, action: onClose)
                }
                .visibilityPriority(.low)
            }
        }
    }

    /// 连接中 / 出错 / 要确认主机密钥时,状态卡片自带「取消」,不显示控制条(卡片和控制条同时占着底部,会互相撑来撑去、布局死循环)。
    private var showsControlBar: Bool {
        switch model.state {
        case .connected, .closed: true
        default: false
        }
    }

    /// 直板机上的控制条:和 Duo 外屏竖条里的是同一组按钮。
    private var controlBar: some View {
        HStack(spacing: 4) {
            barButton("chevron.left", "Hosts", action: onBack)
            barButton("command", "Shortcuts", on: model.showsKeys) { withAnimation(.smooth(duration: 0.25)) { model.showsKeys.toggle() } }
            barButton("keyboard", "Keyboard", on: model.wantsKeyboard) { model.wantsKeyboard.toggle() }
            barButton("clipboard", "Paste") { model.paste() }
            barButton("xmark", "Disconnect", role: .destructive, action: onClose)
        }
        .padding(4)
        // 液态玻璃,可交互:按住时整条会像系统工具栏那样微微放大、随手指流动。
        .glassEffect(.regular.interactive(), in: Capsule())
        .environment(\.colorScheme, .dark)
        .padding(.horizontal, 12).padding(.bottom, 8)
    }

    private func barButton(_ icon: String, _ label: LocalizedStringKey, on: Bool = false, role: ButtonRole? = nil,
                           action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(on ? Color.accentColor : (role == .destructive ? Color.red : Color.white))
                .frame(width: 56, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }

    /// 整个页面扣掉接缝和遮挡区之后的可用矩形;还没量到页面尺寸时不限制。
    private var usable: CGRect? {
        container.isEmpty ? nil : fold.usableRect(in: container)
    }

    // MARK: 画布

    private func canvas(_ m: TermMetrics) -> some View {
        TimelineView(.periodic(from: .now, by: 0.53)) { timeline in
            Canvas { ctx, canvasSize in
                for (y, row) in model.rows.enumerated() {
                    for run in row.runs {
                        draw(run, in: &ctx, x: CGFloat(run.col) * m.width, y: CGFloat(y) * m.height, m: m)
                    }
                }
                // 选区高亮(闭区间:起止行 / 列都包含,中间的行整行)。
                if let sel = model.selection {
                    let cols = max(1, Int(canvasSize.width / m.width))
                    for row in Int(sel.startRow)...Int(sel.endRow) {
                        let from = row == Int(sel.startRow) ? Int(sel.startCol) : 0
                        let to = row == Int(sel.endRow) ? Int(sel.endCol) : cols - 1
                        guard to >= from else { continue }
                        ctx.fill(Path(CGRect(x: CGFloat(from) * m.width, y: CGFloat(row) * m.height,
                                             width: CGFloat(to - from + 1) * m.width, height: m.height)),
                                 with: .color(Color.accentColor.opacity(0.4)))
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

    /// 终端上的单指手势,一个拖动手势管两件事(分开挂两个手势会互相抢,滚动就失灵了):
    /// - 按下后 0.4 秒内没有明显移动(<10pt)= 长按 → 开始选择(默认选一个词),手指不抬继续拖就扩展选区,松手弹出「复制 / 粘贴」;
    /// - 0.4 秒内手指动了 → 竖向拖动 = 滚动回滚历史,一格一行。
    private func terminalDrag(_ m: TermMetrics) -> some Gesture {
        func cell(_ p: CGPoint) -> (row: Int, col: Int, right: Bool) {
            (max(0, Int(p.y / m.height)), max(0, Int(p.x / m.width)),
             p.x.truncatingRemainder(dividingBy: m.width) > m.width / 2)
        }
        return DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { v in
                let p = v.location
                if selecting {
                    let c = cell(p)
                    model.selectUpdate(row: c.row, col: c.col, rightHalf: c.right)
                    return
                }
                if pressStart == nil {
                    pressStart = v.startLocation
                    scrolling = false
                    pressTask = Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(400))
                        guard !Task.isCancelled, !scrolling, let start = pressStart else { return }
                        selecting = true
                        menuAnchor = nil
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        let c = cell(start)
                        model.selectStart(row: c.row, col: c.col, rightHalf: c.right)
                    }
                }
                if !scrolling, hypot(p.x - v.startLocation.x, p.y - v.startLocation.y) > 10 {
                    scrolling = true
                    pressTask?.cancel()
                    menuAnchor = nil
                }
                if scrolling {
                    let steps = Int((v.translation.height - dragLast) / m.height)
                    if steps != 0 {
                        model.scroll(lines: steps)
                        dragLast += CGFloat(steps) * m.height
                    }
                }
            }
            .onEnded { v in
                pressTask?.cancel()
                pressStart = nil
                scrolling = false
                dragLast = 0
                if selecting {
                    selecting = false
                    menuAnchor = v.location     // 弹出的位置:最后手指落点
                }
            }
    }

    /// 滚动条:回滚历史有内容、不在备用屏时才有;滚动时出现,停下 1.2 秒后淡出;按住右边 28pt 宽的触摸条拖动可以直接定位。
    @ViewBuilder private func scrollBar(size: CGSize, m: TermMetrics) -> some View {
        let history = CGFloat(model.barHistory)
        if history > 0 {
            let rows = max(1, CGFloat(Int(size.height / m.height)))
            let thumbH = max(36, size.height * rows / (rows + history))
            let travel = max(1, size.height - thumbH)
            // 离底部 offset 行 → 滑块位置:offset 0 在最下面,offset == history 在最上面。
            let thumbY = travel * (1 - CGFloat(model.barOffset) / history)
            ZStack(alignment: .topTrailing) {
                Color.black.opacity(0.001)
                    .frame(width: 28, height: size.height)
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .local)
                        .onChanged { v in
                            barDragging = true
                            // 手指在轨道里的位置 → 离底部多少行(上 = 历史最早)。
                            let f = min(1, max(0, (v.location.y - thumbH / 2) / travel))
                            model.scrollTo(offset: Int(((1 - f) * history).rounded()))
                        }
                        .onEnded { _ in barDragging = false })
                // 轨道:有历史可翻就一直淡淡地在(让人知道能滚);滚动 / 按住时变亮变粗。
                // 不滚动的时候滚动条彻底消失(轨道和滑块都不画);滚动 / 手指按在右边缘时才出现,停下 1.2 秒后淡出。
                let shown = barVisible || barDragging
                Capsule()
                    .fill(Color.white.opacity(0.07))
                    .frame(width: 3, height: size.height - 12)
                    .padding(.trailing, 3.5).padding(.top, 6)
                    .opacity(shown ? 1 : 0)
                    .animation(.easeOut(duration: shown ? 0.12 : 0.5), value: shown)
                Capsule()
                    .fill(Color.white.opacity(barDragging ? 0.85 : 0.6))
                    .frame(width: barDragging ? 6 : 4, height: thumbH)
                    .padding(.trailing, 3)
                    .offset(y: thumbY)
                    .opacity(shown ? 1 : 0)
                    .animation(.easeOut(duration: shown ? 0.12 : 0.5), value: shown)
                    .animation(.spring(duration: 0.2), value: barDragging)
                    .allowsHitTesting(false)
            }
            .frame(width: size.width, height: size.height, alignment: .topTrailing)
            .task(id: model.barOffset) {
                barVisible = true
                try? await Task.sleep(for: .milliseconds(1200))
                if !Task.isCancelled { barVisible = false }
            }
        }
    }

    /// 长按之后的编辑菜单:复制(有选中的文字时)、粘贴。玻璃胶囊,出现在手指附近;点别处 / 滚动 / 操作之后消失。
    @ViewBuilder private func editMenu(size: CGSize, m: TermMetrics) -> some View {
        if let anchor = menuAnchor, !selecting {
            let hasText = !(model.selectedText ?? "").isEmpty
            HStack(spacing: 2) {
                if hasText {
                    menuButton("Copy", "doc.on.doc") {
                        model.copySelection()
                        model.selectClear()
                        menuAnchor = nil
                    }
                }
                menuButton("Paste", "clipboard") {
                    model.paste()
                    model.selectClear()
                    menuAnchor = nil
                }
            }
            .padding(4)
            .glassEffect(.regular.interactive(), in: Capsule())
            .environment(\.colorScheme, .dark)
            .fixedSize()
            // 在手指上方 56pt 处;上面放不下(按在会话区最上面几行)就放到手指下面;左右上下都收在会话区里,不会伸到外面。
            .position(x: min(max(anchor.x, 80), max(80, size.width - 80)),
                      y: min(max(30, anchor.y >= 86 ? anchor.y - 56 : anchor.y + 52), max(30, size.height - 30)))
            .transition(.scale(scale: 0.85).combined(with: .opacity))
        }
    }

    private func menuButton(_ title: LocalizedStringKey, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 14).frame(height: 38)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
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
                CardGhostButton(title: "Cancel", action: onClose)
            }
        case .needsTrust(let fp):
            card {
                HostKeyCard(host: model.host.displayName, kind: .unknown(fingerprint: fp),
                            onPrimary: { model.trust(fingerprint: fp, store: store) }, onCancel: onClose)
            }
        case .keyChanged(let new, let old):
            card {
                HostKeyCard(host: model.host.displayName, kind: .changed(new: new, old: old),
                            onPrimary: { confirmReplace = true }, onCancel: onClose)
            }
            .alert("Replace the trusted key?", isPresented: $confirmReplace) {
                Button("Cancel", role: .cancel) {}
                Button("Replace key and connect", role: .destructive) { model.trust(fingerprint: new, store: store) }
            } message: {
                Text("Only continue if you know why the key changed.")
            }
        case .failed(let message):
            card {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 12) {
                        CardIconRing(systemImage: "wifi.exclamationmark", tint: .orange)
                        Text("Connection failed").font(.headline)
                    }
                    Text(verbatim: message).font(.footnote.monospaced())
                        .foregroundStyle(Color.white.opacity(0.62)).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    VStack(spacing: 6) {
                        CardPrimaryButton(title: "Retry") { model.connect() }
                        CardGhostButton(title: "Cancel", action: onClose)
                    }
                    .padding(.top, 4)
                }
            }
        case .closed(let status):
            VStack {
                Spacer()
                HStack(spacing: 12) {
                    Image(systemName: "bolt.slash")
                    if let status, status != 0 { Text("Session ended (exit \(Int(status)))") } else { Text("Session ended") }
                    Spacer(minLength: 8)
                    CardPrimaryButton(title: "Reconnect", compact: true) { model.connect() }
                }
                .padding(12)
                .cardChrome(cornerRadius: 24)
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
            .controlSize(.large)
            .padding(20)
            .frame(maxWidth: 420)
            // 暗色渐变卡片 + 细边(和主机列表同一套终端风格),取代系统的毛玻璃。
            .cardChrome(cornerRadius: 26)
            // 卡片最大跟到「辅助功能 1」档:再大按钮和指纹就塞不进屏幕了。
            .dynamicTypeSize(...DynamicTypeSize.accessibility1)
            .padding(16)
            .foregroundStyle(.white)
            .environment(\.colorScheme, .dark)
    }
}
