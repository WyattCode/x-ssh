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
    /// 主机列表收起时(竖向)给个按钮把它拉出来;列表已经在屏幕上就不显示。
    var showHosts: (() -> Void)?

    var body: some View {
        VStack(spacing: 20) {
            BrandMark(size: 112)
            VStack(spacing: 6) {
                Text("No session").font(.title2.weight(.semibold))
                Text("Pick a host to connect.").font(.body).foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            if let showHosts {
                Button("Hosts", systemImage: "list.bullet", action: showHosts)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea(.container, edges: .trailing)
    }
}

/// 开屏页:先是和系统启动画面一模一样的 logo(同大小同位置,所以交接时看不出换了一层),
/// 稍停一下,再淡出、同时轻轻放大,露出下面已经加载好的主程序。
struct SplashView: View {
    @State private var settled = false

    static let logoSize: CGFloat = 120

    var body: some View {
        ZStack {
            Color.black
            BrandMark(size: Self.logoSize)
                .scaleEffect(settled ? 1.04 : 1)
                .animation(.easeOut(duration: 1.2), value: settled)
        }
        // 整块屏幕居中:外屏右侧竖条占着安全区,不忽略的话 logo 会被挤向左,和系统启动画面(居中在整屏)对不上。
        .ignoresSafeArea()
        .onAppear { settled = true }
        .accessibilityHidden(true)
    }
}
