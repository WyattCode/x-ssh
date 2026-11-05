import SwiftUI

/// 应用图标(圆角方块 X)。尺寸按调用处的版面定,圆角已经画在图里,不再裁。
struct BrandMark: View {
    let size: CGFloat

    var body: some View {
        Image("Logo")
            .resizable()
            .interpolation(.high)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// 展开后(宽尺寸)没选会话时的详情页:logo + 文案居中。
/// 内容不带可点击的东西,所以放开右侧竖条那一边的安全区,按整块详情区居中,不偏向左。
struct EmptySessionView: View {
    /// 最近连过的几台,点一下直接连。
    var recents: [Host] = []
    var onConnect: ((Host) -> Void)?

    var body: some View {
        VStack(spacing: 18) {
            BrandMark(size: 72)
            VStack(spacing: 6) {
                Text("No session").font(.title3.weight(.semibold))
                Text("Pick a host to connect.").font(.subheadline).foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            if !recents.isEmpty, let onConnect {
                VStack(spacing: 8) {
                    Text("Recent").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 6)
                    ForEach(recents) { host in
                        Button { onConnect(host) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "clock.arrow.circlepath").font(.footnote).foregroundStyle(.secondary)
                                Text(verbatim: host.displayName).font(.subheadline.weight(.medium))
                            }
                            .padding(.horizontal, 16).frame(height: 40)
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .glassEffect(.regular.interactive(), in: Capsule())
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.appBackground)
        .ignoresSafeArea(.container, edges: .trailing)
    }
}

/// 横向 logo(X-SSH 字标,和桌面端 / 安卓同一份素材)。整个 App 是深色界面,用深色底上的白色版本。
struct BrandLockup: View {
    var height: CGFloat = 28
    @Environment(\.colorScheme) private var scheme
    /// 素材 500×112。工具栏只给自定义视图很窄的宽度,`scaledToFit` 会按那个宽度把 logo 缩成一小条,所以宽高都显式给出。
    private static let aspect: CGFloat = 500.0 / 112.0

    var body: some View {
        // 深色界面用白色字标,浅色界面用深色字标(同一份桌面端 / 安卓的素材)。
        Image(scheme == .dark ? "LogoLockup" : "LogoLockupLight")
            .resizable()
            .interpolation(.high)
            .frame(width: height * Self.aspect, height: height)
            .fixedSize()
            .accessibilityLabel(Text(verbatim: "X-SSH"))
    }
}

/// 开屏页:先是和系统启动画面一模一样的 logo(同大小同位置,所以交接时看不出换了一层),
/// 稍停一下,再淡出、同时轻轻放大,露出下面已经加载好的主程序。
struct SplashView: View {
    /// 开始淡出(同时主程序淡入)。
    var fading = false
    @State private var settled = false

    static let logoSize: CGFloat = 120

    var body: some View {
        ZStack {
            Color.black
            BrandMark(size: Self.logoSize)
                // 先轻轻放大一点;淡出时再多放大一点、同时变透明。
                .scaleEffect(fading ? 1.18 : (settled ? 1.04 : 1))
                .animation(.easeOut(duration: 0.7), value: settled)
        }
        // 整块屏幕居中:外屏右侧竖条占着安全区,不忽略的话 logo 会被挤向左,和系统启动画面(居中在整屏)对不上。
        .ignoresSafeArea()
        .opacity(fading ? 0 : 1)
        .onAppear { settled = true }
        .accessibilityHidden(true)
    }
}

/// 隐藏了返回按钮之后,系统自带的「左边缘右滑返回」被关掉,而且在 NavigationSplitView 的紧凑栈里
/// 重新打开它也不会真的返回。这里自己挂一个屏幕边缘拖动手势到导航控制器的视图上:
/// 从左边缘向右滑过 60pt 就等同于点底部的「主机」按钮(会话保留)。
struct EdgeSwipeBack: UIViewControllerRepresentable {
    let onBack: () -> Void

    func makeUIViewController(context: Context) -> Holder { Holder(onBack: onBack) }
    func updateUIViewController(_ vc: Holder, context: Context) { vc.onBack = onBack }

    final class Holder: UIViewController, UIGestureRecognizerDelegate {
        var onBack: () -> Void
        private weak var host: UIView?
        private var recognizer: UIScreenEdgePanGestureRecognizer?

        init(onBack: @escaping () -> Void) {
            self.onBack = onBack
            super.init(nibName: nil, bundle: nil)
        }
        required init?(coder: NSCoder) { fatalError("not used") }

        override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); attach() }
        override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); detach() }

        private func attach() {
            guard recognizer == nil, let view = navigationController?.view ?? view.window else { return }
            let g = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(pan(_:)))
            g.edges = .left
            g.cancelsTouchesInView = false
            g.delegate = self
            view.addGestureRecognizer(g)
            recognizer = g
            host = view
        }

        private func detach() {
            if let g = recognizer { host?.removeGestureRecognizer(g) }
            recognizer = nil
        }

        @objc private func pan(_ g: UIScreenEdgePanGestureRecognizer) {
            guard g.state == .ended || g.state == .changed else { return }
            let t = g.translation(in: g.view), v = g.velocity(in: g.view)
            if t.x > 60 || (g.state == .ended && t.x > 24 && v.x > 500) {
                g.isEnabled = false; g.isEnabled = true   // 本次手势到此为止,只触发一次
                onBack()
            }
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}

