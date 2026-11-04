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

    /// 在 `rect`(窗口坐标)里扣掉接缝和遮挡区之后,终端这类「整块排版」的内容能用的最大矩形。
    /// 接缝横着只取上半;接缝竖着穿过 rect 时取宽的那一边;遮挡区从离它最近、损失面积最小的那条边削掉。
    func usableRect(in rect: CGRect) -> CGRect {
        var r = rect
        if let seam = horizontalSeam, seam.minY > r.minY, seam.minY < r.maxY {
            r.size.height = seam.minY - r.minY
        }
        if let seam = verticalSeam, seam.minX > r.minX, seam.maxX < r.maxX {
            let left = CGRect(x: r.minX, y: r.minY, width: seam.minX - r.minX, height: r.height)
            let right = CGRect(x: seam.maxX, y: r.minY, width: r.maxX - seam.maxX, height: r.height)
            r = left.width >= right.width ? left : right
        }
        for hole in occlusions where r.intersects(hole) {
            // 四种削法各自损失的面积,取最小的。
            let cuts: [(area: CGFloat, rect: CGRect)] = [
                ((hole.maxY - r.minY) * r.width,
                 CGRect(x: r.minX, y: hole.maxY, width: r.width, height: r.maxY - hole.maxY)),
                ((r.maxY - hole.minY) * r.width,
                 CGRect(x: r.minX, y: r.minY, width: r.width, height: hole.minY - r.minY)),
                ((hole.maxX - r.minX) * r.height,
                 CGRect(x: hole.maxX, y: r.minY, width: r.maxX - hole.maxX, height: r.height)),
                ((r.maxX - hole.minX) * r.height,
                 CGRect(x: r.minX, y: r.minY, width: hole.minX - r.minX, height: r.height)),
            ]
            if let best = cuts.filter({ $0.rect.width > 0 && $0.rect.height > 0 }).min(by: { $0.area < $1.area }) {
                r = best.rect
            }
        }
        return r
    }

    func apply(hinge: Hinge, seam: Seam?, occlusions: [CGRect], windowHeight: CGFloat) {
        if self.windowHeight != windowHeight { self.windowHeight = windowHeight }
        if self.hinge != hinge { self.hinge = hinge }
        if self.seam != seam { self.seam = seam }
        if self.occlusions != occlusions { self.occlusions = occlusions }
    }

    #if DEBUG
    static let simulatesOcclusion = ProcessInfo.processInfo.arguments.contains("-simulateOcclusion")

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
        fileprivate let state: FoldState
        private var hinge: FoldState.Hinge = .unknown
        #if DEBUG
        fileprivate var lastDiagnostics = ""
        #endif

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
            if FoldState.simulatesOcclusion, let window {
                // 真机上读到的那块遮挡区大约 58×37pt,这里放在窗口上部偏右、肯定压到终端画布的位置。
                let b = window.bounds
                occlusions = [CGRect(x: b.maxX * 0.62, y: 200, width: 58, height: 37)]
            }
            #endif
            state.apply(hinge: hinge, seam: seam, occlusions: occlusions,
                        windowHeight: window?.bounds.height ?? 0)
            #if DEBUG
            logDiagnostics()
            #endif
        }
    }
}

#if DEBUG
extension FoldTracker.TrackerView {
    /// 真机上没法截图,把系统实际报的铰链 / 保留区域 / 窗口尺寸打到控制台,事后对照。
    fileprivate func logDiagnostics() {
        var lines = ["FOLDDIAG hinge=\(state.hinge) window=\(window?.bounds.debugDescription ?? "nil") safe=\(safeAreaInsets)"]
        if let scene = window?.windowScene {
            lines.append("  scene=\(scene.coordinateSpace.bounds) orient=\(scene.interfaceOrientation.rawValue) h=\(scene.traitCollection.horizontalSizeClass.rawValue) v=\(scene.traitCollection.verticalSizeClass.rawValue)")
        }
        if #available(iOS 27.1, *) {
            for (name, kind) in [("division", UIView.ReservedRegion.Kind.division), ("occlusion", .occlusion)] {
                let all = reservedRegions(kind: kind, options: [.includeInactive])
                if all.isEmpty { lines.append("  \(name): none") }
                for r in all {
                    lines.append("  \(name) active=\(r.isActive) frame=\(convert(r.frame, to: nil)) margins=\(r.margins)")
                }
            }
        }
        lines.append("  seam=\(state.seam.map { "\($0.frame)" } ?? "nil") usedOcclusions=\(state.occlusions.count)")
        let text = lines.joined(separator: "\n")
        if text != lastDiagnostics { lastDiagnostics = text; NSLog("%@", text) }
    }
}

/// 调试用:把接缝带画出来,看避让有没有对准。
struct SeamOutline: View {
    @Environment(FoldState.self) private var fold

    /// 只在模拟假数据时才画:真机上状态栏那一条本身就是一块 active 的遮挡区,画出来只会是一块碍眼的蓝块。
    private let simulating = FoldState.simulatedAxis != nil || FoldState.simulatesOcclusion

    var body: some View {
        GeometryReader { geo in
            let origin = geo.frame(in: .global).origin
            if simulating {
            if let seam = fold.seam {
                Rectangle()
                    .fill(.red.opacity(0.25))
                    .frame(width: seam.frame.width, height: seam.frame.height)
                    .position(x: seam.frame.midX - origin.x, y: seam.frame.midY - origin.y)
            }
            ForEach(Array(fold.occlusions.enumerated()), id: \.offset) { _, hole in
                Rectangle()
                    .fill(.blue.opacity(0.4))
                    .frame(width: hole.width, height: hole.height)
                    .position(x: hole.midX - origin.x, y: hole.midY - origin.y)
            }
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }
}
#endif
