import SwiftUI
import UIKit

/// iPhone Duo 的折叠状态:铰链角度 + 系统划出来的「接缝」(division 保留区)和遮挡区(occlusion 保留区)。
/// 全部坐标都是窗口坐标,和 SwiftUI 的 `.global` 空间一致。
/// 接缝只有在铰链半开时才是 active;完全展开时没有接缝,界面和普通 iPhone 一样。
@MainActor @Observable
final class FoldState {
    enum Hinge { case unknown, closed, partiallyOpen, fullyOpen }

    struct Seam: Equatable {
        /// 接缝带的范围。折线横着(笔记本姿态)时是一条横带,竖着(书本姿态)时是一条竖带。
        var frame: CGRect
        var isHorizontal: Bool { frame.width >= frame.height }
    }

    private(set) var hinge: Hinge = .unknown
    private(set) var seam: Seam?
    private(set) var occlusions: [CGRect] = []
    private(set) var windowHeight: CGFloat = 0

    /// 折线横着:屏幕分成上下两半,终端放上半、键盘落在下半。
    var horizontalSeam: CGRect? { seam.flatMap { $0.isHorizontal ? $0.frame : nil } }
    /// 折线竖着:屏幕分成左右两半,主机列表在左、终端在右。
    var verticalSeam: CGRect? { seam.flatMap { $0.isHorizontal ? nil : $0.frame } }

    /// 笔记本姿态下,从窗口顶到接缝上沿的高度;其余情况 nil。
    var heightAboveSeam: CGFloat? { horizontalSeam?.minY }

    /// 接缝下面那一截(含接缝本身)的高度,用来给详情页的底部让位。
    var heightBelowSeam: CGFloat { horizontalSeam.map { max(0, windowHeight - $0.minY) } ?? 0 }

    func apply(hinge: Hinge, seam: Seam?, occlusions: [CGRect], windowHeight: CGFloat) {
        if self.windowHeight != windowHeight { self.windowHeight = windowHeight }
        if self.hinge != hinge { self.hinge = hinge }
        if self.seam != seam { self.seam = seam }
        if self.occlusions != occlusions { self.occlusions = occlusions }
    }

    #if DEBUG
    /// 模拟器没法把铰链掰到半开:`-simulateSeam horizontal|vertical` 在窗口正中造一条 40pt 的接缝。
    static let simulatedAxis: String? = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-simulateSeam"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }()
    #endif
}

/// 铺满窗口的透明探测视图:读系统的保留区域和铰链,写进 `FoldState`。
/// 保留区域没有变更通知,窗口尺寸 / 朝向一变就会重新布局,所以在 layoutSubviews 里重读;
/// 铰链开合本身走 `UIHingeInteraction`。
struct FoldTracker: UIViewRepresentable {
    let state: FoldState

    func makeUIView(context: Context) -> TrackerView { TrackerView(state: state) }
    func updateUIView(_ uiView: TrackerView, context: Context) {}

    @MainActor
    final class TrackerView: UIView {
        private let state: FoldState
        private var hinge: FoldState.Hinge = .unknown

        init(state: FoldState) {
            self.state = state
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            isAccessibilityElement = false
            if #available(iOS 27.1, *) {
                addInteraction(UIHingeInteraction { [weak self] _, update in
                    guard let self else { return }
                    hinge = switch update.hinge?.status {
                    case .closed: .closed
                    case .partiallyOpen: .partiallyOpen
                    case .fullyOpen: .fullyOpen
                    default: .unknown
                    }
                    refresh()
                })
            }
        }

        required init?(coder: NSCoder) { fatalError("not used") }

        override func layoutSubviews() {
            super.layoutSubviews()
            refresh()
        }

        private func refresh() {
            var seam: FoldState.Seam?
            var occlusions: [CGRect] = []
            if #available(iOS 27.1, *) {
                // 只取 active 的:没激活的区域不需要避让。
                seam = reservedRegions(kind: .division).first.map { .init(frame: convert($0.frame, to: nil)) }
                occlusions = reservedRegions(kind: .occlusion).map { convert($0.frame, to: nil) }
            }
            #if DEBUG
            if let axis = FoldState.simulatedAxis, let window {
                let b = window.bounds
                seam = .init(frame: axis == "vertical"
                    ? CGRect(x: b.midX - 20, y: 0, width: 40, height: b.height)
                    : CGRect(x: 0, y: b.midY - 20, width: b.width, height: 40))
            }
            #endif
            state.apply(hinge: hinge, seam: seam, occlusions: occlusions,
                        windowHeight: window?.bounds.height ?? 0)
        }
    }
}

#if DEBUG
/// 调试用:把接缝带画出来,看避让有没有对准。
struct SeamOutline: View {
    @Environment(FoldState.self) private var fold

    var body: some View {
        GeometryReader { geo in
            if let seam = fold.seam {
                let origin = geo.frame(in: .global).origin
                Rectangle()
                    .fill(.red.opacity(0.25))
                    .frame(width: seam.frame.width, height: seam.frame.height)
                    .position(x: seam.frame.midX - origin.x, y: seam.frame.midY - origin.y)
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }
}
#endif
