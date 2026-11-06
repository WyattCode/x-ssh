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
                    .preferredColorScheme(.dark)
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

/// 侧栏 = 主机列表,详情 = 终端。
/// - 外屏(窄,紧凑宽度):系统的 `NavigationSplitView` 折成单栈翻页,按钮放系统工具栏(Duo 外屏上自动竖到右侧)。
/// - 内屏(宽,常规宽度):**自己排两栏**(`regularLayout`)—— 系统的导航容器改列可见性是一步到位、没有过渡,
///   系统工具栏里按钮的增减也没有过渡;自己排才能让「抽屉滑出 / 收起、会话跟着滑、右边的玻璃竖条里按钮缩放着出现 / 消失」
///   全部走同一条弹簧曲线。
/// 会话由这里持有:视图被折叠 / 旋转重建时连接不受影响,只有「断开」或换主机才会收掉。
struct RootView: View {
    @Environment(HostStore.self) private var hosts
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(FoldState.self) private var fold
    @State private var active: TerminalModel?
    @State private var addHostRequested = false
    @State private var searching = false
    /// 拖把手时侧栏内容跟手滑出去的位移(0 = 原位,-侧栏宽度 = 完全滑出)。
    @State private var slide: CGFloat = 0
    @State private var containerSize: CGSize = .zero
    // 外屏(紧凑)用:
    @State private var columns: NavigationSplitViewVisibility = .automatic
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar
    // 内屏(常规)用:
    /// 抽屉(主机列表)展开了没有。会话在抽屉右边,抽屉收起时占满整屏。
    @State private var drawerOpen = true
    /// 会话左边让出多宽(跟着抽屉的弹簧一起变)。
    @State private var detailInset: CGFloat = SidebarHandle.width
    /// 两栏时侧栏的宽度:固定 334pt,不让用户自己拖到别的位置 ——
    /// 只有「展开(这个宽度)」和「收起」两种状态。
    private let sidebarWidth = SidebarHandle.width
    @State private var handleShown = true
    @State private var handleToken = 0
    @State private var pokeClock = PokeClock()

    /// 半折(铰链半开)时侧栏(主机列表)和内容(会话)各占整个宽度的一半;其余时候用固定宽度。
    private var halfFolded: Bool { sizeClass == .regular && fold.hinge == .partiallyOpen && containerSize.width > 0 }
    /// 最多占窗口的 60%(竖屏、小窗口里 334pt 会把会话挤没)。
    private var effectiveSidebarWidth: Double {
        if halfFolded { return Double(containerSize.width) / 2 }
        guard containerSize.width > 0 else { return sidebarWidth }
        return min(sidebarWidth, Double(containerSize.width) * 0.6)
    }
    /// 实际的侧栏宽度:半折 ↔ 展开 / 合上切换时整体淡出 → 换宽度 → 淡入;拖把手时不变。
    @State private var shownSidebarWidth: Double = SidebarHandle.width
    @State private var widthTween: Task<Void, Never>?
    @State private var dip = false
    private func syncSidebarWidth(animated: Bool) {
        if animated {
            widthTween?.cancel()
            widthTween = Task { @MainActor in
                withAnimation(.easeIn(duration: 0.18)) { dip = true }
                // `try?` 会吞掉取消:被新一次切换取消的旧任务必须在每次等待后自己退出。
                try? await Task.sleep(for: .milliseconds(190))
                if Task.isCancelled { return }
                shownSidebarWidth = effectiveSidebarWidth
                detailInset = drawerOpen ? CGFloat(shownSidebarWidth) : 0
                try? await Task.sleep(for: .milliseconds(60))
                if Task.isCancelled { return }
                withAnimation(.easeOut(duration: 0.35)) { dip = false }
                widthTween = nil
            }
        } else if widthTween == nil, abs(shownSidebarWidth - effectiveSidebarWidth) > 0.5 {
            shownSidebarWidth = effectiveSidebarWidth
            detailInset = drawerOpen ? CGFloat(shownSidebarWidth) : 0
        }
    }

    /// 抽屉展开 / 收起 —— 整个界面最重要的一条过渡。几件事走同一条弹簧曲线,同时发生:
    /// ① 侧栏滑入 / 滑出;② 会话左边让出的宽度跟着变(会话顺滑地变宽 / 变窄;终端的 PTY 尺寸有 150 毫秒防抖,
    /// 动画走完才重排一次,不会逐帧折腾服务器);③ 右边玻璃竖条里的按钮缩放着增减(见 `rightBar`)。
    /// 可选 `swap`:在同一条动画里把会话换成另一台(淡入淡出)。
    private func setDrawer(_ open: Bool, swapping swap: (() -> Void)? = nil) {
        guard open != drawerOpen || swap != nil else { return }
        widthTween?.cancel()
        withAnimation(Self.drawerSpring) {
            drawerOpen = open
            detailInset = open ? CGFloat(shownSidebarWidth) : 0
            slide = 0
            swap?()
        }
        if open { pokeHandle() }
    }

    static let drawerSpring = Animation.spring(duration: 0.46, bounce: 0.12)

    /// 抽屉(侧栏)现在是展开的。外屏用系统导航容器的列状态。
    private var listVisible: Bool {
        sizeClass == .regular ? drawerOpen : (columns == .all || columns == .doubleColumn)
    }

    /// 正在连着的会话还没连上(连接中 / 等确认主机密钥)。
    private var activeConnecting: Bool {
        switch active?.state {
        case .connecting, .needsTrust, .keyChanged: true
        default: false
        }
    }

    /// App 启动的时刻。启动后头 3.5 秒里的把手不淡出(开屏盖着,不然用户还没看到它就没了)。
    private static let launchTime = Date()

    /// 把手(抽屉展开时是分界线上的竖条,收起时是左边缘的小条)的显示逻辑,只有一条规则:
    /// **有「该让用户看到它」的事情发生就显示,两秒后没人再动就淡出。**
    private func pokeHandle() {
        pokeClock.last = Date()
        if !handleShown { handleShown = true }
        handleToken += 1
    }

    var body: some View {
        content
            .opacity(dip ? 0 : 1)
            .allowsHitTesting(!dip)   // 过渡里内容是看不见的,别让手指点到看不见的东西
            // 容器尺寸只用来判断横 / 竖,必须不受软键盘影响:搜索 / 输入时键盘把可用高度压矮,
            // 竖屏会被误判成横屏,侧栏跟着来回跳。所以量一块忽略键盘的背景。
            .background {
                GeometryReader { geo in
                    Color.clear
                        .onChange(of: layoutKey(geo.size), initial: true) { _, _ in
                            containerSize = geo.size
                            updateLayout(geo.size)
                            pokeHandle()
                        }
                        // 宽高比没变但宽度变了(半折的一半宽度要跟着走)也要更新。
                        .onChange(of: geo.size) { _, size in containerSize = size }
                }
                // 连侧边的状态竖条那块安全区也算进来:整块屏幕的宽度(半折时侧栏取它的一半)。
                .ignoresSafeArea()
            }
    }

    /// 内屏横向(宽 > 高)有地方让主机列表和会话并排,抽屉默认展开;竖向抽屉默认收起,会话占满整屏(左上角的按钮 / 左边缘的小把手能拉出来)。
    /// 半折一律并排(不看宽高比:折的过程里宽高比会来回变)。按容器宽高比判断,不看设备朝向。
    private func layoutKey(_ size: CGSize) -> String { "\(sizeClass == .compact)-\(size.width > size.height)" }

    private func updateLayout(_ size: CGSize) {
        if sizeClass == .compact { columns = .automatic; return }
        let open = halfFolded || size.width > size.height
        if open != drawerOpen { setDrawer(open) }
        else { detailInset = open ? CGFloat(shownSidebarWidth) : 0 }
    }

    // MARK: 版面

    @ViewBuilder private var content: some View {
        Group {
            if sizeClass == .regular { regularLayout } else { compactSplit }
        }
        // 紧凑 ↔ 常规(合上 ↔ 展开 / 半折)切换时按尺寸类重建;会话和主机数据都在这里(RootView)持有,重建不会断连接。
        .id(sizeClass == .compact)
        // 输入框放在被重建的容器外面:姿态切换时它不会被拆掉,焦点和「要不要键盘」都保持。
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
        // 有人在会话区域(分界线右边)碰 / 滑,把手重新显示。UIKit 手势识别器只旁听触摸,不影响终端自己的手势。
        .background {
            TouchSpy { point in
                let x = point.x
                pokeClock.lastTouch = point
                pokeClock.lastTouchAt = Date()
                // 抽屉展开时只有碰会话区域(分界线右边)才算;收起时碰屏幕任何地方都让左边缘的小把手出来。
                guard sizeClass == .regular, !listVisible || x > sidebarWidth else { return }
                if !handleShown || Date().timeIntervalSince(pokeClock.last) > 0.5 { pokeHandle() }
            }
            .frame(width: 0, height: 0)
        }
        .onChange(of: halfFolded) { _, _ in
            updateLayout(containerSize)
            syncSidebarWidth(animated: true)
            pokeHandle()
        }
        // 启动时直接用固定宽度(开屏盖着,不做淡出淡入)。
        .onAppear {
            shownSidebarWidth = effectiveSidebarWidth
            detailInset = drawerOpen ? CGFloat(shownSidebarWidth) : 0
            pokeHandle()
        }
        .onChange(of: containerSize) { _, _ in syncSidebarWidth(animated: false) }
        .task(id: handleToken) {
            let launchRemaining = 3.5 - Date().timeIntervalSince(Self.launchTime)
            try? await Task.sleep(for: .seconds(max(2.0, launchRemaining)))
            if !Task.isCancelled { handleShown = false }
        }
        // 抽屉展开 ↔ 收起、姿态 / 尺寸变化:都让把手出来一下。
        .onChange(of: listVisible) { _, _ in if sizeClass == .regular { pokeHandle() } }
        .onChange(of: sizeClass) { _, _ in pokeHandle() }
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

    private var hostsView: some View {
        HostsView(splitLayout: sizeClass == .regular, activeID: active.flatMap { $0.isEnded ? nil : $0.host.id },
                  activeConnecting: activeConnecting, connectedSince: active?.connectedAt, addRequested: $addHostRequested, searching: $searching, onConnect: open,
                  onCollapse: { setDrawer(false) }, slideOffset: 0)
    }

    /// 外屏(单栏翻页):系统导航容器。
    private var compactSplit: some View {
        NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $compactColumn) {
            hostsView
        } detail: {
            if let active {
                TerminalScreen(model: active, onBack: { compactColumn = .sidebar }, onClose: close)
                    .id(active.id)
            } else {
                EmptySessionView()
            }
        }
    }

    /// 内屏:自己排的两栏。会话在底层(左边让出 `detailInset`),侧栏盖在上面,按钮竖条和标题行再盖在最上面。
    private var regularLayout: some View {
        let w = CGFloat(shownSidebarWidth)
        return ZStack(alignment: .topLeading) {
            // 会话
            ZStack {
                if let active {
                    TerminalScreen(model: active, onBack: { setDrawer(true) }, onClose: close, embedded: true)
                        .id(active.id)
                        .transition(.opacity)
                } else {
                    EmptySessionView()
                        .transition(.opacity)
                }
            }
            .padding(.leading, detailInset)

            // 侧栏(抽屉)
            hostsView
                .frame(width: w)
                .frame(maxHeight: .infinity)
                .background(Color.appSidebar.ignoresSafeArea())
                .offset(x: (drawerOpen ? 0 : -w) + slide)
                .opacity(1 - min(1, abs(slide) / max(w, 1)) * 0.4)
                .allowsHitTesting(drawerOpen)

            // 左上角:侧栏开关;会话标题
            headerRow(width: w)

            // 分界线上的把手 / 收起后左边缘的小把手
            if drawerOpen, !halfFolded {
                SidebarHandle(visible: handleShown, width: w, slide: $slide, onTouch: pokeHandle,
                              onCollapse: { setDrawer(false) })
                    .offset(x: w + SidebarHandle.gap - SidebarHandle.hitWidth / 2 + slide)
                    .frame(maxHeight: .infinity)   // 上下居中(ZStack 是顶对齐的)
                    // 软键盘弹出时竖向居中的位置不能跟着挪(中间线不动)。
                    .ignoresSafeArea(.keyboard)
            } else if !drawerOpen {
                EdgeRevealHandle(visible: handleShown) { setDrawer(true) }
                    .frame(maxHeight: .infinity)   // 上下居中
                    .ignoresSafeArea(.keyboard)
            }

            // 右边的玻璃竖条
            Color.clear
                .overlay(alignment: .bottomTrailing) { rightBar.padding(.trailing, 25).padding(.bottom, 25) }
                .ignoresSafeArea(.container)
        }
    }

    /// 左上角一行:侧栏开关(跟着抽屉左右滑)+ 会话标题。
    private func headerRow(width w: CGFloat) -> some View {
        // 连上之后(或用户开始用这台终端:敲字 / 按键 / 粘贴 / 滚动),(抽屉收起时的)侧栏开关收起来(竖条里有「‹」);会话名一直在。抽屉展开时侧栏开关是侧栏标题栏的一部分,一直在。
        let typing = active.map { $0.userActive || $0.state == .connected } ?? false
        let showToggle = drawerOpen || !typing
        return ZStack(alignment: .topLeading) {
            Button { setDrawer(!drawerOpen) } label: {
                Image(systemName: "sidebar.leading")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: Circle())
            .offset(x: drawerOpen ? w - 16 - 48 + slide : 16, y: 24)
            .opacity(showToggle ? 1 : 0)
            .allowsHitTesting(showToggle)
            .animation(.easeOut(duration: 0.25), value: showToggle)
            .accessibilityLabel(Text("Hosts"))

            // 会话名一直显示(和外屏一样:左上角是主机名,终端从它下面开始)。侧栏开关收起时名字靠到最左,和终端文字对齐。
            if let active {
                Text(verbatim: active.title.isEmpty ? active.host.displayName : active.title)
                    .font(.headline).lineLimit(1).truncationMode(.tail)
                    // shell 发来的标题可以很长:限宽(同外屏),不压到右上角的时间 / 信号。
                    .frame(maxWidth: 280, alignment: .leading)
                    .foregroundStyle(.white)
                    // 用户开始操作之后淡成半透明(不隐藏):不抢终端内容,又一直知道在哪台上。
                    .opacity((active.userActive) ? 0.45 : 1)
                    .animation(.easeOut(duration: 0.3), value: active.userActive)
                    .offset(x: drawerOpen ? w + 16 : (showToggle ? 76 : 16), y: 24 + 14)
                    .animation(.easeOut(duration: 0.25), value: showToggle)
                    .transition(.opacity)
            }
        }
    }

    // MARK: 右边的玻璃竖条

    private struct BarItem: Identifiable {
        let id: String
        let icon: String
        let label: LocalizedStringKey
        var on = false
        var role: ButtonRole?
        let action: () -> Void
    }

    /// 竖条里现在该有哪些按钮:只有会话按钮(快捷键 / 键盘 / 粘贴 / 断开),抽屉收起时多一颗「回主机列表」;没会话就没有竖条。
    /// 主机列表自己的「搜索 / 新建」在列表底部(和列表在一起)。
    private var barItems: [BarItem] {
        var items: [BarItem] = []
        if let active {
            if !drawerOpen { items.append(BarItem(id: "hosts", icon: "chevron.left", label: "Hosts") { setDrawer(true) }) }
            items.append(BarItem(id: "keys", icon: "command", label: "Shortcuts", on: active.showsKeys) {
                withAnimation(.smooth(duration: 0.25)) { active.showsKeys.toggle() }
            })
            items.append(BarItem(id: "kbd", icon: "keyboard", label: "Keyboard", on: active.wantsKeyboard) { active.wantsKeyboard.toggle() })
            items.append(BarItem(id: "paste", icon: "clipboard", label: "Paste") { active.paste() })
            items.append(BarItem(id: "close", icon: "xmark", label: "Disconnect", role: .destructive) { close() })
        }
        return items
    }

    @ViewBuilder private var rightBar: some View {
        let items = barItems
        if !items.isEmpty {
            VStack(spacing: 2) {
                ForEach(items) { item in
                    Button(role: item.role, action: item.action) {
                        Image(systemName: item.icon)
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(item.on ? Color.accentColor : Color.white)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(item.label))
                    .transition(.scale(scale: 0.5).combined(with: .opacity))
                }
            }
            .padding(5)
            // 液态玻璃,整条可交互:按住时整条像系统工具栏那样放大、随手指流动。
            .glassEffect(.regular.interactive(), in: Capsule())
            // 按钮增减(抽屉展开 / 收起、连上 / 断开)用同一条弹簧,缩放着出现 / 消失,竖条随之伸缩。
            .animation(Self.drawerSpring, value: items.map(\.id))
            .transition(.scale(scale: 0.6, anchor: .bottomTrailing).combined(with: .opacity))
        }
    }

    #if DEBUG
    /// `-autoOpen <主机名>`:启动后自动打开那台主机,命令行起的模拟器没法点屏幕时用。
    private func autoOpenFromLaunchArguments() async {
        guard let name = DebugLaunch.value("-autoOpen") else { return }
        try? await Task.sleep(for: .seconds(1))
        if let host = hosts.hosts.first(where: { $0.displayName == name }) { open(host) }
    }
    #endif

    /// 点一台主机:内屏横屏 / 展开时**立刻**收起抽屉,会话顺着滑进来(抽屉、会话、按钮竖条一条弹簧);
    /// 半折是并排设计、竖屏抽屉本来就是收起的,都不用收;外屏是翻页。
    private func open(_ host: Host) {
        let collapse = sizeClass == .regular && drawerOpen && !halfFolded
        // 点的就是正在跑的那台:直接回到它,别断了重连。
        if let current = active, current.host.id == host.id, !current.isEnded {
            compactColumn = .detail
            if collapse { setDrawer(false) }
            return
        }
        active?.disconnect()
        let model = TerminalModel(host: host, credentials: hosts.credentials(for: host), knownKey: hosts.knownKey(host))
        if sizeClass == .regular {
            compactColumn = .detail
            if collapse { setDrawer(false, swapping: { active = model }) }
            else { withAnimation(.smooth(duration: 0.25)) { active = model } }
        } else {
            // 外屏(翻页):先把会话放好、再翻到详情页,而且放在同一个无动画事务里。以前先翻页后换会话,
            // 翻进去的那一瞬间详情页还是「没有会话」的空页面,换成终端时就闪一下。
            var t = Transaction(animation: nil)
            t.disablesAnimations = true
            withTransaction(t) { active = model }
            compactColumn = .detail
        }
    }

    private func close() {
        active?.disconnect()
        compactColumn = .sidebar
        // 断开 / 取消之后回到主机列表:横屏 / 展开时抽屉是收起的,要滑出来让人重新选。
        if sizeClass == .regular {
            if !drawerOpen, !halfFolded { setDrawer(true, swapping: { active = nil }) }
            else { withAnimation(.smooth(duration: 0.25)) { active = nil } }
        } else {
            // 外屏:等翻回列表的动画走完再清掉会话;立刻清的话,翻回去的过程中详情页会先变成「没有会话」的空页面,闪一下。
            let leaving = active?.id
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(550))
                if active?.id == leaving { active = nil }
            }
        }
    }
}

/// 列表收起后贴在屏幕左边缘的小把手:和分界线上的把手同一套显示逻辑(出现、两秒后淡出);
/// 淡出后触摸区域还在(几乎透明的矩形撑着),点一下 / 往右拖照样拉得出列表。
struct EdgeRevealHandle: View {
    let visible: Bool
    let onReveal: () -> Void

    var body: some View {
        Color.black.opacity(0.001)
            .frame(width: 24, height: 140)
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.28))
                    .frame(width: 4, height: 40)
                    .padding(.leading, 4)
                    .opacity(visible ? 1 : 0)
                    .animation(.easeOut(duration: visible ? 0.15 : 0.7), value: visible)
                    .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
            .onTapGesture(perform: onReveal)
            .gesture(DragGesture(minimumDistance: 8).onEnded { v in
                if v.translation.width > 30 { onReveal() }
            })
            .accessibilityLabel(Text("Hosts"))
            .accessibilityAddTraits(.isButton)
    }
}

final class PokeClock {
    var last = Date.distantPast
    /// 最近一次触摸的位置(窗口坐标)和时间:判断「列表被收起」是不是用户点了系统的侧栏按钮造成的。
    var lastTouch = CGPoint(x: -1, y: -1)
    var lastTouchAt = Date.distantPast
}

/// 挂在窗口上的「只听不管」手势识别器:收到触摸就把横坐标报出去,自己永远不进入识别状态,
/// 所以不会拦截 / 延迟任何别的手势。
struct TouchSpy: UIViewRepresentable {
    let onTouch: (CGPoint) -> Void

    func makeUIView(context: Context) -> UIView { Anchor(onTouch: onTouch) }
    func updateUIView(_ view: UIView, context: Context) { (view as? Anchor)?.onTouch = onTouch }

    private final class Anchor: UIView {
        var onTouch: (CGPoint) -> Void
        private var spy: Spy?
        init(onTouch: @escaping (CGPoint) -> Void) { self.onTouch = onTouch; super.init(frame: .zero); isUserInteractionEnabled = false }
        required init?(coder: NSCoder) { fatalError("not used") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let spy, spy.view != nil { spy.view?.removeGestureRecognizer(spy) }
            spy = nil
            guard let window else { return }
            let g = Spy { [weak self] p in self?.onTouch(p) }
            window.addGestureRecognizer(g)
            spy = g
        }
    }

    private final class Spy: UIGestureRecognizer, UIGestureRecognizerDelegate {
        let report: (CGPoint) -> Void
        init(report: @escaping (CGPoint) -> Void) {
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
            if let t = touches.first, let v = view { report(t.location(in: v)) }
        }
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}

/// 侧栏和会话之间的分界线把手。侧栏宽度是固定的,只有「展开」和「收起」两个位置:
/// 往左拖时侧栏内容跟着手指滑出去(`slide`),松手时过了三成(或甩得够快)就接着滑走并收起,
/// 没过就带一点回弹滑回原位。默认显示,两秒没人用就慢慢淡出;点它所在的位置、碰会话区域会让它重新出现。
struct SidebarHandle: View {
    /// 系统默认 320pt,再宽 10%,再减 5%。
    static let width = 334.4
    static let hitWidth: CGFloat = 20
    /// 胶囊在分界线右边 7pt(参考图里胶囊和侧栏边缘之间有一条缝)。
    static let gap: CGFloat = 7

    let visible: Bool
    /// 侧栏现在的宽度(滑出的最大距离)。
    let width: CGFloat
    @Binding var slide: CGFloat
    let onTouch: () -> Void
    /// 松手时决定收起:调用方负责接着把侧栏滑走并真正收起。
    let onCollapse: () -> Void
    @State private var dragging = false
    @State private var crossedThreshold = false

    var body: some View {
        // 触摸区域用一块几乎透明但不是「全透明」的矩形撑出来:淡出后胶囊的透明度是 0,系统对「看不见的」视图不一定派发触摸。
        Color.black.opacity(0.001)
            .frame(width: Self.hitWidth, height: 160)
            .overlay {
                Capsule()
                    .fill(Color.white.opacity(dragging ? 0.7 : 0.4))
                    .frame(width: dragging ? 5 : 4, height: dragging ? 48 : 40.3)
                    .opacity(visible || dragging ? 1 : 0)
                    .animation(.easeOut(duration: visible ? 0.15 : 0.7), value: visible)
                    .animation(.spring(duration: 0.25), value: dragging)
                    .allowsHitTesting(false)   // 胶囊本身不接触摸:一切交给下面那块触摸区域
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .onChanged { v in
                    onTouch()
                    dragging = true
                    // 只跟着往左的位移;往右拖有一点点阻力感(1/6)但不能把侧栏拉宽。
                    let dx = v.translation.width
                    slide = dx < 0 ? max(dx, -width) : min(dx / 6, 10)
                    let crossed = slide < -width * 0.3
                    if crossed != crossedThreshold {
                        crossedThreshold = crossed
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()   // 过了「松手就收起」的线,轻震一下
                    }
                }
                .onEnded { v in
                    dragging = false
                    let collapse = slide < -width * 0.3 || v.predictedEndTranslation.width < -width * 0.7
                    crossedThreshold = false
                    onTouch()
                    if collapse {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        onCollapse()
                    } else {
                        withAnimation(.spring(duration: 0.4, bounce: 0.3)) { slide = 0 }
                    }
                })
            // 读屏:一个「收起侧栏」的操作。
            .accessibilityElement()
            .accessibilityLabel(Text("Sidebar"))
            .accessibilityAction(named: Text("Collapse sidebar")) { onCollapse() }
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

