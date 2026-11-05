import SwiftUI

@main
struct XSSHApp: App {
    @State private var hosts = HostStore()
    @State private var fold = FoldState()
    @State private var gate = LaunchGate()

    var body: some Scene {
        WindowGroup {
            LaunchContainer(gate: gate, fold: fold) {
                RootView()
                    .environment(hosts)
                    .environment(fold)
                    .environment(gate)
                    .background { FoldTracker(state: fold).ignoresSafeArea() }
            }
        }
    }
}

/// 开屏什么时候可以淡出:主界面排版稳定了才行。
///
/// 在 iPhone Duo 外屏上,启动后系统先把底部工具栏按横条排出来,过了约 1.7 秒才切成右侧竖条(右边多出 84pt 的安全区),
/// 整张列表紧接着重排好几次(变窄、变高、下移)。开屏要是在那之前淡出,用户就会在过渡中间看到这一连串重排 —— 一次「闪跳」。
/// 所以主机列表把每次尺寸 / 安全区变化报进来:
/// - 右侧安全区出现过(竖条来了)→ 之后安静 0.4 秒即可;
/// - 没出现过(不是 Duo 外屏、或展开态没有竖条)→ 等到 `maxWait` 为止,不无限等。
@Observable
final class LaunchGate {
    private(set) var lastChange = Date()
    private(set) var sawVerticalBar = false

    func touch(trailingInset: CGFloat) {
        lastChange = Date()
        if trailingInset > 20 { sawVerticalBar = true }
    }

    /// 可以开始过渡了吗。`elapsed` 是开屏已经显示的时间。
    /// `expectsVerticalBar`:这是 iPhone Duo 合上(外屏)—— 竖条一定会来,必须等它;
    /// 其它设备(普通 iPhone / 展开竖屏)没有竖条,不能陪着等,过 `quietAfter` 安静就走。
    func isReady(elapsed: TimeInterval, expectsVerticalBar: Bool) -> Bool {
        let quiet = Date().timeIntervalSince(lastChange)
        if expectsVerticalBar {
            if elapsed >= 6 { return true }                  // 保险:竖条迟迟不来也不能卡死在开屏
            return sawVerticalBar && quiet >= 0.25
        }
        return quiet >= 0.25 || elapsed >= 3
    }
}

/// 开屏 → 主程序的过渡。状态必须放在普通视图里:放在 `App` 的场景闭包里时,`withAnimation` 的动画事务传不下去,
/// 开屏会直接消失、主界面一帧蹦出来(没有任何过渡)。
///
/// 主程序在开屏下面已经加载好;开屏停一会儿后淡出并略放大,同时主程序从略小一点慢慢放大、淡入。
struct LaunchContainer<Content: View>: View {
    let gate: LaunchGate
    let fold: FoldState
    @ViewBuilder let content: () -> Content
    @State private var splash = true
    @State private var revealed = false

    var body: some View {
        ZStack {
            // 主程序一直是完全显示的,只是被不透明的开屏盖在下面:这样它从第一帧起就按真实状态排版
            // (连外屏的竖条工具栏也会照常建出来)。给它设透明度 / 缩放,系统会把它当隐藏的、推迟排版,
            // 排版就跑到淡入的过程里去了 —— 那正是用户看到的「闪跳」。
            content()
            if splash {
                SplashView(fading: revealed)
                    .allowsHitTesting(false)
                    .zIndex(1)
            }
        }
        .background(Color.black.ignoresSafeArea())
        .task {
            #if DEBUG
            if DebugLaunch.flag("-noSplash") { revealed = true; splash = false; return }
            let k = DebugLaunch.flag("-slowSplash") ? 4.0 : 1.0   // 把过渡拉长 4 倍,方便在模拟器里逐帧看
            #else
            let k = 1.0
            #endif
            let started = Date()
            try? await Task.sleep(for: .milliseconds(Int(450 * k)))
            // 至少停 0.45 秒;之后等主界面排版稳定(见 `LaunchGate`)。
            while !gate.isReady(elapsed: Date().timeIntervalSince(started) / k, expectsVerticalBar: fold.hinge == .closed) {
                try? await Task.sleep(for: .milliseconds(100))
            }
            withAnimation(.easeInOut(duration: 0.45 * k)) { revealed = true }
            try? await Task.sleep(for: .milliseconds(Int(500 * k)))
            splash = false
        }
    }
}

/// 侧栏 = 主机列表,详情 = 终端。窄的时候(外屏)系统自动折成单栈,内屏摊开成两栏,
/// 不按设备类型分支 —— Apple 对 iPhone Duo 的要求就是靠尺寸类自适应;半开时导航容器自己避让折痕,
/// 这里不再手工摆栏宽。只有终端画布这种整块排版的内容才自己避开接缝(见 `FoldState.usableRect`)。
/// 会话由这里持有:视图被折叠 / 旋转重建时连接不受影响,只有「断开」或换主机才会收掉。
struct RootView: View {
    @Environment(HostStore.self) private var hosts
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(FoldState.self) private var fold
    @State private var active: TerminalModel?
    @State private var addHostRequested = false
    @State private var containerSize: CGSize = .zero
    @State private var columns: NavigationSplitViewVisibility = .automatic
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar
    /// 两栏时侧栏的宽度(可拖分界线上的把手调整,记住)。系统默认 320pt。
    @AppStorage("sidebarWidth") private var sidebarWidth = SidebarHandle.defaultWidth
    @State private var handleShown = true
    @State private var handleToken = 0
    @State private var pokeClock = PokeClock()

    /// 半折(铰链半开)时侧栏(主机列表)和内容(会话)各占整个宽度的一半;其余时候用记住的宽度。
    private var halfFolded: Bool { sizeClass == .regular && fold.hinge == .partiallyOpen && containerSize.width > 0 }
    /// 记住的宽度最多占窗口的 60%(竖屏、小窗口里 480pt 会把会话挤没)。
    private var effectiveSidebarWidth: Double {
        if halfFolded { return Double(containerSize.width) / 2 }
        let saved = max(sidebarWidth, SidebarHandle.range.lowerBound)
        guard containerSize.width > 0 else { return saved }
        return min(saved, Double(containerSize.width) * 0.6)
    }
    /// 实际给导航容器的侧栏宽度:半折 ↔ 展开 / 合上切换时带动画滑过去,拖把手时跟手(不带动画)。
    @State private var shownSidebarWidth: Double = SidebarHandle.defaultWidth
    @State private var widthTween: Task<Void, Never>?
    @State private var dip = false
    /// 半折 ↔ 展开 / 合上切换时的过渡。系统的导航容器不给「栏宽变化」做动画(直接跳),逐帧改栏宽又会把详情栏弄丢
    /// (折一次再折平,会话区就空白了),所以用「淡出 → 换宽度 → 淡入」:整块内容先快速淡下去,宽度在看不见的时候一次到位,再淡回来。
    /// 拖把手时 `animated` 为 false,直接跟手。
    private func syncSidebarWidth(animated: Bool) {
        if animated {
            widthTween?.cancel()
            widthTween = Task { @MainActor in
                withAnimation(.easeIn(duration: 0.18)) { dip = true }
                // `try?` 会吞掉取消:被新一次切换取消的旧任务必须在每次等待后自己退出,
                // 否则它会抢先把 `dip` 放回去、把 `widthTween` 清掉,新的过渡就被打断(闪一下)。
                try? await Task.sleep(for: .milliseconds(190))
                if Task.isCancelled { return }
                shownSidebarWidth = effectiveSidebarWidth
                try? await Task.sleep(for: .milliseconds(60))
                if Task.isCancelled { return }
                withAnimation(.easeOut(duration: 0.35)) { dip = false }
                widthTween = nil
            }
        } else if widthTween == nil, abs(shownSidebarWidth - effectiveSidebarWidth) > 0.5 {
            shownSidebarWidth = effectiveSidebarWidth
        }
    }

    /// 列表(侧栏)现在是展开的。两栏的 NavigationSplitView 里系统会把 `.all` 改写成 `.doubleColumn`(用户点系统按钮展开后尤其会),
    /// 只认 `.all` 的话,把手、收起手势都会在系统改写之后失效。
    private var listVisible: Bool { columns == .all || columns == .doubleColumn }

    /// 正在连着的会话还没连上(连接中 / 等确认主机密钥)。
    private var activeConnecting: Bool {
        switch active?.state {
        case .connecting, .needsTrust, .keyChanged: true
        default: false
        }
    }

    /// 显示把手,两秒没人碰就慢慢淡出(开屏盖着时第一次多等一会儿,不然用户还没看到就没了)。
    private func pokeHandle() {
        pokeClock.last = Date()
        if !handleShown { handleShown = true }
        handleToken += 1
    }

    var body: some View {
        split
            .opacity(dip ? 0 : 1)
            .allowsHitTesting(!dip)   // 过渡的 0.5 秒里内容是看不见的,别让手指点到看不见的东西
            // 容器尺寸只用来判断横 / 竖,必须不受软键盘影响:搜索 / 输入时键盘把可用高度压矮,
            // 竖屏会被误判成横屏,侧栏跟着来回跳(搜索时的过渡不顺就是这个)。所以量一块忽略键盘的背景。
            .background {
                GeometryReader { geo in
                    Color.clear
                        .onChange(of: layoutKey(geo.size), initial: true) { _, _ in
                            containerSize = geo.size
                            updateColumns(geo.size)
                        }
                        // 宽高比没变但宽度变了(半折的一半宽度要跟着走)也要更新。
                        .onChange(of: geo.size) { _, size in containerSize = size }
                        .onChange(of: active?.id) { _, _ in updateColumns(geo.size) }
                }
                // 连侧边的状态竖条那块安全区也算进来:整块屏幕的宽度(半折时侧栏取它的一半)。
                .ignoresSafeArea()
            }
    }

    /// 内屏横向(宽 > 高)有地方让主机列表和终端并排;竖向时系统让列表浮在详情上面、盖住它一半,
    /// 所以竖向(不算半折)先收起列表(左上角的系统按钮、空会话里的「主机」按钮、从左边缘右滑都能拉出来)。
    /// 按容器宽高比判断,不看设备朝向。
    private func layoutKey(_ size: CGSize) -> String { "\(sizeClass == .compact)-\(size.width > size.height)" }

    private func updateColumns(_ size: CGSize) {
        if sizeClass == .compact { columns = .automatic }
        // 内屏:横着拿、或者半折(铰链半开)时并排;完全展开又竖着拿时列表收起来,会话占满整屏。
        // 系统的导航容器在竖屏里并排放不下去,会让列表「浮」在会话上面,盖住会话(终端文字、底部按钮)的一半,
        // 所以竖屏不硬并排。半折时一律并排(不看宽高比):折的过程中宽高比会来回变,
        // 按比例判断会让侧栏一会收一会开,空会话的 logo 就一会在整屏中间、一会在右边。
        else if halfFolded || size.width > size.height { columns = .all }
        else { columns = .detailOnly }
    }

    private var split: some View {
        NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $compactColumn) {
            HostsView(splitLayout: sizeClass == .regular, activeID: active.flatMap { $0.isEnded ? nil : $0.host.id },
                      activeConnecting: activeConnecting, addRequested: $addHostRequested, onConnect: open,
                      onCollapse: { withAnimation(.smooth(duration: 0.3)) { columns = .detailOnly } })
                .navigationSplitViewColumnWidth(min: shownSidebarWidth, ideal: shownSidebarWidth, max: shownSidebarWidth)
        } detail: {
            if let active {
                TerminalScreen(model: active, onBack: { compactColumn = .sidebar; columns = .all }, onClose: close)
                    .id(active.id)
            } else {
                EmptySessionView(showHosts: listVisible ? nil : { columns = .all })
                    // 没会话时右侧竖条也要有按钮:内屏上主机列表在左边的侧栏里,详情这一侧的竖条放「新建主机」。
                    .toolbar {
                        ToolbarItem(placement: .bottomBar) {
                            Button("Add Host", systemImage: "plus") { addHostRequested = true }
                        }
                    }
            }
        }
        // 内屏(宽 × 高都是常规尺寸)是 iPad 布局的自然延伸:主机列表常驻在左边,不默认收起。
        // 紧凑 ↔ 常规(合上 ↔ 展开 / 半折)切换时,系统不会给已有的导航容器重新装上竖条工具栏,侧栏状态也会错乱。
        // 按尺寸类重建导航容器;会话和主机数据都在这里(RootView)持有,重建不会断连接。
        .id(sizeClass == .compact)
        // 输入框放在被重建的导航容器外面:姿态切换时它不会被拆掉,焦点和「要不要键盘」都保持。
        .background {
            if let active {
                KeyCapture(model: active, ctrlArmed: active.ctrlArmed,
                           wantsKeyboard: active.wantsKeyboard && !active.showsPrompt
                               && !(sizeClass == .compact && compactColumn == .sidebar))
                    .frame(width: 1, height: 1)
                    .allowsHitTesting(false)
            }
        }
        .onChange(of: scenePhase) { _, phase in active?.setForeground(phase == .active) }
        .overlay(alignment: .leading) {
            if sizeClass == .regular, listVisible, !halfFolded {
                SidebarHandle(width: $sidebarWidth, visible: handleShown, onTouch: pokeHandle,
                              onCollapse: { withAnimation(.smooth(duration: 0.3)) { columns = .detailOnly } })
                    .offset(x: shownSidebarWidth + SidebarHandle.gap - SidebarHandle.hitWidth / 2)
                    // 软键盘弹出时竖向居中的位置不能跟着挪(中间线不动)。
                    .ignoresSafeArea(.keyboard)
            }
        }
        // 列表被收起时,屏幕左边缘留一个淡淡的小把手:点一下或往右拖就把列表拉出来(不然只有左上角的系统按钮,看不出来能拉)。
        .overlay(alignment: .leading) {
            if sizeClass == .regular, columns == .detailOnly {
                EdgeRevealHandle { withAnimation(.smooth(duration: 0.3)) { columns = .all } }
                    .ignoresSafeArea(.keyboard)
            }
        }
        // 有人在会话区域(分界线右边)碰 / 滑,把手重新显示。UIKit 手势识别器只旁听触摸,不影响终端自己的手势。
        .background {
            TouchSpy { x in
                guard sizeClass == .regular, listVisible, x > sidebarWidth else { return }
                if !handleShown || Date().timeIntervalSince(pokeClock.last) > 0.5 { pokeHandle() }
            }
            .frame(width: 0, height: 0)
        }
        .onChange(of: halfFolded) { _, _ in
            updateColumns(containerSize)
            syncSidebarWidth(animated: true)
        }
        // 启动时直接用记住的宽度(开屏盖着,不做淡出淡入,免得开屏淡出时内容正好半透明)。
        .onAppear { shownSidebarWidth = effectiveSidebarWidth }
        .onChange(of: sidebarWidth) { _, _ in syncSidebarWidth(animated: false) }
        .onChange(of: containerSize) { _, _ in syncSidebarWidth(animated: false) }
        .task(id: handleToken) {
            try? await Task.sleep(for: .seconds(handleToken == 0 ? 3.5 : 2))
            if !Task.isCancelled { handleShown = false }
        }
        #if DEBUG
        .overlay { SeamOutline() }
        .task { await autoOpenFromLaunchArguments() }
        .onChange(of: active?.state) { _, state in
            // `-autoTrust`:首次连接的主机密钥确认也自动点掉,模拟器里不用手点。
            if case .needsTrust(let fingerprint) = state, DebugLaunch.flag("-autoTrust") {
                active?.trust(fingerprint: fingerprint, store: hosts)
            }
        }
        #endif
    }

    #if DEBUG
    /// `-autoOpen <主机名>`:启动后自动打开那台主机,命令行起的模拟器没法点屏幕时用。
    private func autoOpenFromLaunchArguments() async {
        guard let name = DebugLaunch.value("-autoOpen") else { return }
        try? await Task.sleep(for: .seconds(1))
        if let host = hosts.hosts.first(where: { $0.displayName == name }) { open(host) }
    }
    #endif

    private func open(_ host: Host) {
        // 点的就是正在跑的那台:直接回到它,别断了重连。
        if let current = active, current.host.id == host.id, !current.isEnded {
            compactColumn = .detail
            updateColumns(containerSize)
            return
        }
        active?.disconnect()
        active = TerminalModel(host: host, credentials: hosts.credentials(for: host), knownKey: hosts.knownKey(host))
        compactColumn = .detail
    }

    private func close() {
        active?.disconnect()
        active = nil
        compactColumn = .sidebar
    }
}

/// 列表收起后贴在屏幕左边缘的小把手。
struct EdgeRevealHandle: View {
    let onReveal: () -> Void

    var body: some View {
        Capsule()
            .fill(Color.white.opacity(0.28))
            .frame(width: 4, height: 40)
            .padding(.leading, 4)
            .frame(width: 24, height: 140, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture(perform: onReveal)
            .gesture(DragGesture(minimumDistance: 8).onEnded { v in
                if v.translation.width > 30 { onReveal() }
            })
            .accessibilityLabel(Text("Hosts"))
            .accessibilityAddTraits(.isButton)
    }
}

final class PokeClock { var last = Date.distantPast }

/// 挂在窗口上的「只听不管」手势识别器:收到触摸就把横坐标报出去,自己永远不进入识别状态,
/// 所以不会拦截 / 延迟任何别的手势。
struct TouchSpy: UIViewRepresentable {
    let onTouch: (CGFloat) -> Void

    func makeUIView(context: Context) -> UIView { Anchor(onTouch: onTouch) }
    func updateUIView(_ view: UIView, context: Context) { (view as? Anchor)?.onTouch = onTouch }

    private final class Anchor: UIView {
        var onTouch: (CGFloat) -> Void
        private var spy: Spy?
        init(onTouch: @escaping (CGFloat) -> Void) { self.onTouch = onTouch; super.init(frame: .zero); isUserInteractionEnabled = false }
        required init?(coder: NSCoder) { fatalError("not used") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let spy, spy.view != nil { spy.view?.removeGestureRecognizer(spy) }
            spy = nil
            guard let window else { return }
            let g = Spy { [weak self] x in self?.onTouch(x) }
            window.addGestureRecognizer(g)
            spy = g
        }
    }

    private final class Spy: UIGestureRecognizer, UIGestureRecognizerDelegate {
        let report: (CGFloat) -> Void
        init(report: @escaping (CGFloat) -> Void) {
            self.report = report
            super.init(target: nil, action: nil)
            cancelsTouchesInView = false
            delaysTouchesBegan = false
            delaysTouchesEnded = false
            delegate = self
        }
        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { forward(touches) }
        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { forward(touches) }
        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { state = .failed }
        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { state = .failed }
        private func forward(_ touches: Set<UITouch>) {
            if let t = touches.first, let v = view { report(t.location(in: v).x) }
        }
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}

/// 侧栏和会话之间的分界线把手:左右拖动调侧栏宽度。默认显示,两秒没人用就慢慢淡出;
/// 点它所在的位置、拖它、或在会话区域里碰 / 滑,都会让它重新出现。淡出之后触摸区域还在,点一下就回来。
struct SidebarHandle: View {
    static let defaultWidth = 320.0
    static let hitWidth: CGFloat = 20
    /// 胶囊在分界线右边 7pt(参考图里胶囊和侧栏边缘之间有一条缝)。
    static let gap: CGFloat = 7
    static let range = 240.0...480.0

    @Binding var width: Double
    let visible: Bool
    let onTouch: () -> Void
    /// 一直往左拖过最小宽度再多拖这么远,就把整个列表收起来。
    let onCollapse: () -> Void
    static let collapseOvershoot = 60.0
    @State private var base: Double?
    @State private var collapsed = false

    var body: some View {
        // 触摸区域用一块几乎透明但不是「全透明」的矩形撑出来:淡出后胶囊的透明度是 0,
        // 系统对「看不见的」视图不一定派发触摸,淡出之后就拖不动了(实测)。
        Color.black.opacity(0.001)
            .frame(width: Self.hitWidth, height: 160)
            .overlay {
                Capsule()
                    .fill(Color.white.opacity(0.4))
                    .frame(width: 4, height: 40.3)
                    .opacity(visible ? 1 : 0)
                    .animation(.easeOut(duration: visible ? 0.15 : 0.7), value: visible)
                    .allowsHitTesting(false)   // 胶囊本身不接触摸:一切交给下面那块触摸区域(正中间 4pt 以前会被胶囊「吃掉」)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .onChanged { v in
                    onTouch()
                    if base == nil { base = width }
                    if let base, abs(v.translation.width) > 3 {
                        let raw = base + v.translation.width
                        if raw < Self.range.lowerBound - Self.collapseOvershoot, !collapsed {
                            collapsed = true
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            width = base          // 收起之前拖到的宽度不能存下来,否则下次展开列表就是被压窄的
                            onCollapse()
                            return
                        }
                        if !collapsed { width = min(max(raw, Self.range.lowerBound), Self.range.upperBound) }
                    }
                }
                .onEnded { _ in base = nil; collapsed = false; onTouch() })
            // 读屏:把手是一个可调节的控件,上滑 / 下滑加宽 / 变窄 16pt。
            .accessibilityElement()
            .accessibilityLabel(Text("Sidebar width"))
            .accessibilityValue(Text(verbatim: "\(Int(width)) pt"))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: width = min(width + 16, Self.range.upperBound)
                case .decrement: width = max(width - 16, Self.range.lowerBound)
                @unknown default: break
                }
                onTouch()
            }
            // 双击把手 = 恢复默认宽度。
            .simultaneousGesture(TapGesture(count: 2).onEnded { withAnimation(.smooth(duration: 0.2)) { width = Self.defaultWidth }; onTouch() })
    }
}

#if DEBUG
/// 调试用启动参数的读取;只在 Debug 构建里存在。
enum DebugLaunch {
    static func flag(_ name: String) -> Bool { ProcessInfo.processInfo.arguments.contains(name) }
    static func value(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
}
#endif

