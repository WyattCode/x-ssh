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
                Button("Hosts", systemImage: "sidebar.leading", action: showHosts)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea(.container, edges: .trailing)
    }
}
