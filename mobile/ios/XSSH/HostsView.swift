import SwiftUI
import UniformTypeIdentifiers

struct HostsView: View {
    @Environment(HostStore.self) private var store
    @Environment(LaunchGate.self) private var gate
    /// 两栏布局(内屏展开):由外层按整个窗口的尺寸类传进来。不能在这里读 `horizontalSizeClass` ——
    /// 侧栏这一栏自己报的是紧凑,读出来永远是「单栏」,侧栏的背景就变不了色。
    let splitLayout: Bool
    let activeID: UUID?
    /// 正在连着的那台还在「连接中 / 等确认密钥」:行尾显示转圈而不是绿点。
    var activeConnecting = false
    /// 连着的那台是几点连上的(行里显示已连接时长)。
    var connectedSince: Date?
    /// 连着的那台正在等用户确认主机密钥(行上写「等待确认」,不是一直「连接中…」)。
    var activeNeedsConfirm = false
    /// 「已连接」那行是显示时刻还是时长(跟着会话走,由外层持有)。
    var showsClock = false
    var onToggleClock: (() -> Void)?
    /// 删掉了一台主机(外层据此断开正连着它的会话)。
    var onDeleted: ((Host) -> Void)?
    /// 详情那一侧的「新建主机」按钮通过它让这里弹出编辑页。
    @Binding var addRequested: Bool
    /// 搜索框开着没有。内屏里搜索 / 新建按钮放在右边会话那一侧的竖条里,状态由外层持有。
    @Binding var searching: Bool
    let onConnect: (Host) -> Void
    /// 在列表的空白处(不在任何一台主机卡片上、也不在标题区)用力往左一甩 = 收起列表。
    var onCollapse: (() -> Void)?
    /// 收起时侧栏内容滑出去的位移(见 `SidebarHandle`)。
    var slideOffset: CGFloat = 0

    /// 随系统字体大小缩放的尺寸(行字号、小字、行内留白、`❯` 宽度)。
    @ScaledMetric(relativeTo: .body) private var rowFont: CGFloat = 19
    @ScaledMetric(relativeTo: .caption) private var smallFont: CGFloat = 12
    @ScaledMetric(relativeTo: .body) private var rowPad: CGFloat = 21
    private var promptWidth: CGFloat { rowFont * 14 / 19 }
    @State private var editing: Host?
    @State private var isNew = false
    @State private var pendingDelete: Host?
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    /// 列表卡片的实际左边缘和宽度(量出来的,不是估的):搜索框按它对齐。
    @State private var cardX: CGFloat?
    @State private var cardWidth: CGFloat?
    @State private var listWidth: CGFloat = 320
    /// 量卡片位置是针对哪个列表宽度量的:滚动时行的位置会有瞬时抖动,只在列表宽度变了之后重新量,搜索框才不会跟着变形。
    @State private var measuredForWidth: CGFloat = 0
    /// 每张主机卡片的底边(整个列表视图坐标系里);所有卡片底边的最大值下面才是「空白处」。
    /// 按主机分别记:删掉最后一台之后,新的最后一台没有布局变化、不会重新量,单记「最后一张」会留着过期的值。
    @State private var rowBottoms: [UUID: CGFloat] = [:]
    private var lastRowBottom: CGFloat { shown.compactMap { rowBottoms[$0.id] }.max() ?? 0 }

    /// 按添加的先后顺序排,点哪台就选中哪台(高亮),列表不会因为连接了某台就把它顶到第一个。
    private var shown: [Host] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return store.hosts.filter {
            q.isEmpty || $0.displayName.localizedCaseInsensitiveContains(q)
                || $0.address.localizedCaseInsensitiveContains(q) || $0.username.localizedCaseInsensitiveContains(q)
        }
    }

    private var titleRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(verbatim: "$ hosts").font(.system(size: 26, weight: .semibold, design: .monospaced)).tracking(-0.4)
            if !store.hosts.isEmpty { Text("\(store.hosts.count)").font(.footnote).foregroundStyle(Color.white.opacity(0.45)) }
        }
        .padding(.horizontal, 16 + cardInset).padding(.top, splitLayout ? 2 : 6).padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(Color.clear).listRowSeparator(.hidden).listRowInsets(EdgeInsets())
        // 读屏:「Hosts,5」,不念 `$` 符号。
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Hosts"))
        .accessibilityValue(Text(verbatim: "\(store.hosts.count)"))
        .accessibilityAddTraits(.isHeader)
    }

    var body: some View {
        ScrollViewReader { proxy in
        List {
            // 聚光灯版式:标题 + 数量 → 每台一行(颜色点 + 名字),连着的那台在原位置变成一张大卡。
            titleRow
            // 连着的那台就在它原来的位置变成大卡,不往上提(主机的顺序一直按添加先后)。
            let rows = shown
            ForEach(rows) { host in
                hostRow(host, featured: host.id == activeID, last: host.id == rows.last?.id)
            }
        }
        // 连上一台时,让列表滚到那张卡片(它在视野外也能看到自己选中了哪台)。
        .onChange(of: activeID) { _, id in
            guard let id else { return }
            withAnimation(.smooth(duration: 0.3)) { proxy.scrollTo(id) }
        }
        // 触觉:开始连接给一下轻的,连上给一下「成功」。
        .sensoryFeedback(trigger: activeID) { _, new in new != nil ? .impact(weight: .light) : nil }
        .sensoryFeedback(trigger: connectedSince) { _, new in new != nil ? .success : nil }
        // 紧凑宽度(主页)背景纯黑;展开成两栏时左边这一栏要和右边的会话(终端纯黑)有颜色区分,用深灰。
        .scrollContentBackground(.hidden)
        // 两栏时去掉列表自带的左右边距(约 20pt),卡片才能占满侧栏宽度;窄屏单栏保持系统边距。
        .modifier(SplitListMargins(split: splitLayout))
        // 底部的玻璃工具条浮在列表上,最后一张卡片要能滚到它上面。
        .contentMargins(.bottom, splitLayout ? 76 : 0, for: .scrollContent)
        .background((splitLayout ? Color.appSidebar : Color.appBackground).ignoresSafeArea())
        .overlay {
            if store.hosts.isEmpty {
                // 没有主机:一行提示符,点一下就新建(和列表同一套终端风格)。
                Button { startAdding() } label: {
                    VStack(spacing: 10) {
                        HStack(spacing: 8) {
                            Text(verbatim: "❯").foregroundStyle(Color.green)
                            Text(verbatim: "ssh --new")
                            BlinkingCursor()
                        }
                        .font(.system(size: 22, design: .monospaced))
                        Text("Add a host to get started.").font(.footnote).foregroundStyle(.secondary)
                    }
                    .padding(24).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Add Host"))
            } else if shown.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        // 自己的搜索框,不用系统的 `.searchable`:系统搜索展开时整个标题区收起 / 重排,列表跟着跳,过渡不连贯。
        // 这里点一下搜索钮,顶部滑出一个搜索框,列表跟着平滑下移,标题和右侧竖条纹丝不动。
        // 内屏:搜索和新建就在列表底部(和列表在一起,不用够到屏幕另一头);外屏它们在系统竖条里。
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if splitLayout {
                HStack(spacing: 4) {
                    toolButton(searching ? "xmark" : "magnifyingglass", searching ? "Close Search" : "Search") { searching.toggle() }
                    toolButton("plus", "Add Host") { startAdding() }
                }
                .padding(4)
                .glassEffect(.regular.interactive(), in: Capsule())
                // 底边和右边按钮竖条同一条线(都离屏幕底 25pt);不吃底部安全区,不然会比竖条高一截。
                .padding(.bottom, 25)
                .ignoresSafeArea(.container, edges: .bottom)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                // 内屏(自己排的两栏)没有系统导航栏,logo 自己画在侧栏顶部(右边留给外层画的「侧栏开关」)。
                if splitLayout {
                    BrandLockup(height: 19)
                        // 左边和下面的 `$ hosts` 标题对齐(同一个起点),不贴着屏幕圆角。
                        .padding(.leading, 16 + cardInset).padding(.top, 38)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .frame(height: 57, alignment: .top)   // 上留白 38 + logo 19:框要装得下,不然 logo 溢出压到下面的搜索框
                }
                if searching { searchField.transition(.move(edge: .top).combined(with: .opacity)) }
            }
            // 顶部这一块要有实底:列表往上滚时卡片不能从 logo 后面透出来。
            .background(splitLayout ? Color.appSidebar : Color.clear)
        }
        .animation(.smooth(duration: 0.25), value: searching)
        .coordinateSpace(name: "hostsRoot")
        // 列表本身要能上下滑、有滚动条(主机多了要翻)。
        .scrollIndicators(.visible)
        // 只有从空白处(最后一张卡片下面)开始的向左滑才收起列表:滑主机卡片本身(删除 / 编辑)、标题区、会话内容都不算。
        // 用 UIKit 的横向拖动识别器,不用 SwiftUI 的 DragGesture:DragGesture 挂在列表上会和列表的上下滑动抢手势,滑不动。
        .background {
            HorizontalSwipeSpy { start in
                guard splitLayout, let onCollapse else { return }
                guard start.y > lastRowBottom + 8 else { return }
                onCollapse()
            }
        }        // 把排版变化告诉开屏:稳定之后开屏才淡出,过渡中间不会再有重排。
        .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.trailing } action: { gate.touch(trailingInset: $0) }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { listWidth = $0.width; gate.touch(trailingInset: 0) }
        .navigationTitle("Hosts")
        // 固定的小标题:大标题会在搜索展开时收起,整张列表跟着往上跳一截,过渡就不顺了。
        // 页面左上角直接放横向 logo(不是图标加文字)。系统标题只留给读屏用,不显示。
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(removing: .title)
        // 按钮全走系统工具栏:iPhone Duo 外屏上它们会自动竖到右侧。
        // 放底部工具栏:竖条里顶部那一段紧挨着状态区(灵动岛 / 信号 / 电量),「+」贴上去会和状态图标碰在一起,
        // 按下放大时还会压到它;HIG 里底部工具栏的按钮留在竖条下方,拇指也够得着。
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                BrandLockup(height: 19)
            }
            .sharedBackgroundVisibility(.hidden)
            // 内屏(两栏)里搜索和新建都放在右边那一侧的竖条里(RootView 的详情栏),只放一份,不在左栏再放一份;
            // 外屏(单栏)整个屏幕就是主机列表,按钮在它自己的竖条里。
            if !splitLayout {
                ToolbarItem(placement: .bottomBar) {
                    Button(searching ? "Close Search" : "Search", systemImage: searching ? "xmark" : "magnifyingglass") {
                        searching.toggle()
                    }
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("Add Host", systemImage: "plus") { startAdding() }
                }
            }
        }
        #if DEBUG
        // `-autoNewHost` / `-autoEditHost <名字>`:启动后直接弹出编辑页,命令行起的模拟器里核对弹层布局用。
        .task {
            try? await Task.sleep(for: .seconds(1))
            if DebugLaunch.flag("-autoNewHost") { startAdding() }
            else if let name = DebugLaunch.value("-autoEditHost"),
                    let host = store.hosts.first(where: { $0.displayName == name }) { startEditing(host) }
        }
        #endif
        .onChange(of: searching) { _, on in
            if on { searchFocused = true } else { query = ""; searchFocused = false }
        }
        .onChange(of: addRequested) { _, requested in
            if requested { addRequested = false; startAdding() }
        }
        .sheet(item: $editing) { host in
            HostEditor(host: host, credentials: isNew ? Credentials() : store.credentials(for: host), elevated: splitLayout) { saved, credentials in
                store.save(saved, credentials: credentials)
            }
            // 内屏:弹层是浮在黑色终端上的一张面,要比黑色亮一档、里面的卡片再亮一档,层次才出得来;窄屏沿用纯黑。
            .presentationBackground(splitLayout ? Color.appSheet : Color.appBackground)
        }
        .alert("Delete Host?", isPresented: Binding(get: { pendingDelete != nil },
                                                     set: { if !$0 { pendingDelete = nil } }),
               presenting: pendingDelete) { host in
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { store.delete(host); onDeleted?(host) }
        } message: { host in
            Text("“\(host.displayName)” and its saved password will be removed.")
        }
        }
        // 收起时整个侧栏内容顺着手势滑出去并渐隐(标题栏的 logo 和系统按钮是导航栏的,留到收起那一刻一起消失)。
        // 侧栏这一栏自己的底(系统默认是一块灰色材质):内容滑走之后它会露出来,换成和侧栏一样的深灰,再跟着内容一起渐隐。
        .containerBackground(splitLayout ? Color.appSidebar : Color.appBackground, for: .navigationSplitView)
        .offset(x: slideOffset)
        .opacity(1 - min(1, abs(slideOffset) / 300) * 0.5)
    }

    /// 一张主机卡(带点击、长按菜单、左滑操作、卡片背景):单独成函数,List 里的表达式才不会复杂到编译器类型推断超时。
    private func hostRow(_ host: Host, featured: Bool, last: Bool) -> some View {
        // 点一下 = 连接;长按 = 弹菜单(系统自带触觉反馈)。
        // 用 `.contextMenu` 带自定义 `preview:`:长按浮起来的是下面那张统一的圆角卡(每一行形状都一样),
        // 不是系统从列表单元格里取的形状(最上 / 最下一行变成胶囊、中间行是方的)。
        // 以前用 `Menu`:内屏的侧栏里菜单一弹出,整栏内容就被盖黑,看起来像「把会话收起来了」。
        Button { onConnect(host) } label: { row(host, featured: featured, last: last) }
            .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contextMenu {
                Button("Connect", systemImage: "play") { onConnect(host) }
                Button("Edit", systemImage: "pencil") { startEditing(host) }
                Button("Delete", systemImage: "trash", role: .destructive) { pendingDelete = host }
            } preview: {
                // 行本身没有底:浮起来的预览单独给一张卡,不然是一条悬空的字。
                HStack(spacing: 12) {
                    Text(verbatim: "❯").foregroundStyle(Color.white.opacity(0.4))
                    (Text(verbatim: "ssh ").foregroundStyle(Color.white.opacity(0.4)) + Text(verbatim: host.displayName))
                        .lineLimit(1).truncationMode(.tail)
                    Spacer(minLength: 12)
                    Circle().fill(HostColor.pip(host.colorIndex)).frame(width: 9, height: 9)
                }
                .font(.system(size: rowFont, design: .monospaced))
                .padding(.horizontal, 20).padding(.vertical, 22)
                .frame(width: 320)
                .background(Color.appSheetCard)
            }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        // 读屏:正在连着的那台报「已选中」(视觉上是更亮 + 描边 + 绿点)。
        .accessibilityAddTraits(host.id == activeID ? .isSelected : [])
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("hostsRoot")) } action: {
            if $0.width > 0, cardX == nil || abs(measuredForWidth - listWidth) > 0.5 {
                cardX = $0.minX; cardWidth = $0.width; measuredForWidth = listWidth
            }
            rowBottoms[host.id] = $0.maxY
        }
        // 不允许一滑到底直接触发(第一个动作是删除,太容易误触);只能点露出来的按钮。
        .swipeActions(allowsFullSwipe: false) {
            // 只要图标,不要文字(读屏仍然念「删除 / 编辑」)。
            Button("Delete", systemImage: "trash", role: .destructive) { pendingDelete = host }
                .labelStyle(.iconOnly)
            Button("Edit", systemImage: "pencil") { startEditing(host) }
                .labelStyle(.iconOnly).tint(Color(white: 0.3))
        }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .id(host.id)
    }

    private func row(_ host: Host, featured: Bool, last: Bool) -> some View {
        sshRow(host, featured: featured, last: last)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .padding(.horizontal, cardInset)
    }

    /// 每台一行,就是一条要敲的命令:`❯ ssh 名字`(等宽字体,`ssh` 淡、名字亮),行尾一个这台的颜色点,行与行之间一条虚线。
    /// 连着的那台:`❯` 变绿、名字后面一个闪烁的光标,下面多一行绿色的「✓ 已连接 · 时长」;连接中是「连接中…」,颜色点的位置转圈。
    /// 名字必须一行(太长截断)。不显示 IP / 端口。
    private func sshRow(_ host: Host, featured: Bool, last: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // 间距自己控制(HStack 间距为 0):名字和颜色点之间只留 8pt,长名字才不会被提前截断。
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(verbatim: "❯")
                    .foregroundStyle(featured ? Color.green : Color.white.opacity(0.4))
                    .frame(width: promptWidth, alignment: .leading)
                    .padding(.trailing, Self.promptGap)
                (Text(verbatim: "ssh ").foregroundStyle(Color.white.opacity(0.4))
                    + Text(verbatim: host.displayName).foregroundStyle(Color.white.opacity(0.93)))
                    .lineLimit(1).truncationMode(.tail)
                if featured && !activeConnecting { BlinkingCursor().padding(.leading, 8) }
                Spacer(minLength: 8)
                ZStack {
                    if featured && activeConnecting {
                        ProgressView().controlSize(.mini).tint(.white)
                            .transition(.opacity.animation(.easeOut(duration: 0.18)))
                    } else {
                        Circle().fill(HostColor.pip(host.colorIndex)).frame(width: 9, height: 9)
                    }
                }
                .frame(width: 14, height: 14)
            }
            .font(.system(size: rowFont, design: .monospaced))
            if let hint = matchHint(host) {
                Text(verbatim: hint)
                    .font(.system(size: smallFont, design: .monospaced)).foregroundStyle(Color.white.opacity(0.4))
                    .lineLimit(1).truncationMode(.middle)
                    .padding(.leading, promptWidth + Self.promptGap)
            }
            if featured {
                statusLine
                    .transition(.opacity.animation(.easeOut(duration: 0.2)))
            }
        }
        .animation(.easeOut(duration: 0.2), value: activeConnecting)
        // 读屏:一行 = 主机名;连着的报状态(`❯`、光标、颜色点都只是装饰)。
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: host.displayName))
        .accessibilityValue(featured ? (activeConnecting ? Text("Connecting…") : Text("Connected")) : Text(verbatim: ""))
        .padding(.horizontal, 10).padding(.vertical, rowPad)
        .overlay(alignment: .bottom) {
            if !last { DashedLine().stroke(Color.white.opacity(0.16), style: StrokeStyle(lineWidth: 1, dash: [3, 3])).frame(height: 1) }
        }
    }

    /// 搜索时,名字没匹配上、是地址 / 用户名匹配上的,在名字下面小字写出匹配到的那一项(平时列表不显示地址)。
    private func matchHint(_ host: Host) -> String? {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, !host.displayName.localizedCaseInsensitiveContains(q) else { return nil }
        if host.address.localizedCaseInsensitiveContains(q) { return host.address }
        if host.username.localizedCaseInsensitiveContains(q) { return host.username }
        return nil
    }

    /// `❯` 占的宽度和它到名字的间距:状态那一行的缩进用同一组数,才和名字的起点对齐。
    private static let promptGap: CGFloat = 12

    @ViewBuilder private var statusLine: some View {
        if activeConnecting {
            Text(activeNeedsConfirm ? "Waiting for confirmation" : "Connecting…").foregroundStyle(Color.white.opacity(activeNeedsConfirm ? 0.85 : 0.6))
                .font(.system(size: smallFont, design: .monospaced))
        } else {
            HStack(spacing: 0) {
                Text(verbatim: "✓ ")
                Text("Connected")
                if let connectedSince {
                    Text(verbatim: " · ")
                    if showsClock { Text(connectedSince, style: .time) }
                    else { Text(connectedSince, style: .timer).monospacedDigit() }
                }
            }
            .contentShape(Rectangle())
            .highPriorityGesture(TapGesture().onEnded { onToggleClock?() })
            .foregroundStyle(Color.green.opacity(0.95))
            .font(.system(size: smallFont, design: .monospaced))
            .lineLimit(1)
            // 和上面那行名字的起点对齐(❯ 的宽度 + 间距)。
            .padding(.leading, promptWidth + Self.promptGap)
        }
    }

    static let cardGap: CGFloat = 6
    /// 两栏时卡片宽 = 侧栏宽的 92%,左右各留 4%(参考图里卡片和分界线之间就是这么一条窄缝)。
    /// 按侧栏实际宽度算,拖动改宽后比例不变。列表自带的左右边距已去掉(见 `SplitListMargins`)。
    private var cardInset: CGFloat { splitLayout ? listWidth * 0.04 : 0 }

    /// 搜索框也是一行命令:`❯ grep ▍输入`,没有圆角底,下面一条虚线;文字和列表行的 `❯` 对齐(同样的左右 10pt)。
    private var searchField: some View {
        HStack(spacing: 10) {
            Text(verbatim: "❯").foregroundStyle(Color.green)
            Text(verbatim: "grep").foregroundStyle(Color.white.opacity(0.4))
            TextField("Search hosts", text: $query)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .focused($searchFocused).submitLabel(.search)
            if !query.isEmpty {
                Button("Clear", systemImage: "xmark.circle.fill") { query = "" }
                    .labelStyle(.iconOnly).foregroundStyle(.secondary).buttonStyle(.plain)
            }
        }
        .font(.system(size: rowFont, design: .monospaced))
        .padding(.horizontal, 10)
        .frame(minHeight: 48)
        .overlay(alignment: .bottom) {
            DashedLine().stroke(Color.white.opacity(0.16), style: StrokeStyle(lineWidth: 1, dash: [3, 3])).frame(height: 1)
        }
        // 左右边缘和宽度都取自下面列表行的实际位置(靠竖条那一侧边距更小,固定边距会对不齐);
        // 还没有行(列表为空)时退回到系统的场景边距。
        .modifier(MatchCard(x: cardX.map { $0 + (splitLayout ? cardInset : 0) }, width: cardWidth.map { $0 - (splitLayout ? cardInset * 2 : 0) }))
        .padding(.top, 10).padding(.bottom, 4)
    }

    private func toolButton(_ icon: String, _ label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.white)
                .frame(width: 52, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }

    private func startAdding() { isNew = true; editing = Host() }
    private func startEditing(_ host: Host) { isNew = false; editing = host }
}

private struct SectionSpacing: ViewModifier {
    let split: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if split { content.listSectionSpacing(.custom(10)) } else { content }
    }
}

private struct SplitListMargins: ViewModifier {
    let split: Bool
    func body(content: Content) -> some View {
        if split { content.contentMargins(.horizontal, 0, for: .scrollContent) } else { content }
    }
}

private struct MatchCard: ViewModifier {
    let x: CGFloat?
    let width: CGFloat?
    func body(content: Content) -> some View {
        if let x, let width {
            content.frame(width: width).frame(maxWidth: .infinity, alignment: .leading).padding(.leading, x)
        } else {
            content.scenePadding(.horizontal)
        }
    }
}

struct HostEditor: View {
    private enum Field { case name, address, port, user, password, passphrase }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var host: Host
    @State private var portText: String
    @State private var credentials: Credentials
    @State private var keyInfo: KeyInfo?
    @State private var keyProblem: String?
    @State private var importing = false
    @State private var copied = false
    @State private var saveFailed = false
    @FocusState private var focus: Field?
    let onSave: (Host, Credentials) -> Bool
    /// 内屏(两栏)里的弹层:换更亮的底和卡片(见 `Color.appSheet`)。
    let elevated: Bool
    private var pageColor: Color { elevated ? .appSheet : .appBackground }
    private var cardColor: Color { elevated ? .appSheetCard : .appCard }

    init(host: Host, credentials: Credentials, elevated: Bool = false, onSave: @escaping (Host, Credentials) -> Bool) {
        self.elevated = elevated
        _host = State(initialValue: host)
        _portText = State(initialValue: String(host.port))
        _credentials = State(initialValue: credentials)
        _keyInfo = State(initialValue: Self.inspect(credentials))
        self.onSave = onSave
    }

    private var port: Int? { Int(portText).flatMap { Host.portRange.contains($0) ? $0 : nil } }
    private var canSave: Bool {
        var h = host
        h.port = port ?? 0
        guard h.normalized().isValid else { return false }
        return host.authKind == .password || keyInfo != nil
    }

    private static func inspect(_ c: Credentials) -> KeyInfo? {
        guard !c.privateKey.isEmpty else { return nil }
        return try? inspectKey(pem: c.privateKey, passphrase: c.passphrase.isEmpty ? nil : c.passphrase)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $host.name)
                        .font(.system(.body, design: .monospaced))
                        .focused($focus, equals: .name).submitLabel(.next)
                        .onSubmit { focus = .address }
                    TextField("Address", text: $host.address)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.URL).textContentType(.URL)
                        .font(.system(.body, design: .monospaced))
                        .focused($focus, equals: .address).submitLabel(.next)
                        .onSubmit { applyTarget(); focus = .port }
                    TextField("Port", text: $portText)
                        // 数字键盘(numberPad)没有回车键,收键盘就得另放一个浮在键盘上方的「完成」,它的位置系统说了算:
                        // 右边缘既不对齐表单也不对齐右侧竖条,还盖住下面的内容。用带回车键的数字 / 符号键盘,回车键就是「完成」。
                        .keyboardType(.numbersAndPunctuation)
                        .font(.system(.body, design: .monospaced))
                        .focused($focus, equals: .port).submitLabel(.done)
                        .onSubmit { applyTarget(); focus = nil }
                } header: {
                    Text(verbatim: "# ") .foregroundStyle(Color.green) + Text("Server")
                } footer: {
                    if !portText.isEmpty, port == nil {
                        Text("Port must be between 1 and 65535.").foregroundStyle(.red)
                    }
                }
                .listRowBackground(cardColor)
                Section {
                    TextField("User", text: $host.username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .textContentType(.username)
                        .font(.system(.body, design: .monospaced))
                        .focused($focus, equals: .user).submitLabel(.next)
                        .onSubmit { focus = host.authKind == .password ? .password : nil }
                    AuthKindPicker(selection: $host.authKind)
                    if host.authKind == .password {
                        SecureField("Password", text: $credentials.password)
                            .textContentType(.password)
                            .font(.system(.body, design: .monospaced))
                        .focused($focus, equals: .password).submitLabel(.done)
                            .onSubmit { focus = nil }
                    }
                } header: {
                    Text(verbatim: "# ") .foregroundStyle(Color.green) + Text("Sign In")
                }
                .listRowBackground(cardColor)
                if host.authKind == .key { keySection }
            }
            .scrollContentBackground(.hidden)
            .background(pageColor)
            // 表单和列表同一套终端风格:等宽字体,小节标题前面一个绿色的 `# `。
            .font(.system(.body, design: .monospaced))
            // 上下拖表单就收键盘(各个输入框的回车键也都能收),不再需要键盘上方那颗悬浮的「完成」。
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(host.displayName.isEmpty ? String(localized: "New Host") : host.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .fileImporter(isPresented: $importing, allowedContentTypes: [.data, .plainText]) { result in
                importKey(from: result)
            }
            .toolbar {
                // 外屏(紧凑宽度)上弹层的按钮竖排进竖条:放底部工具栏,也就是右下角,和主机页一致;
                // 竖条最上面一格紧挨状态区,按钮放那儿会碰到状态图标。内屏居中弹层用同一套(也报紧凑宽度)。
                if sizeClass == .compact {
                    // 竖条里弹性空白是零尺寸;弹层是横向底栏时(内屏居中弹层)把这组按钮推到右下角。
                    ToolbarSpacer(.flexible, placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) {
                        Button("Cancel", systemImage: "xmark") { dismiss() }
                    }
                    ToolbarItem(placement: .bottomBar) {
                        Button("Save", systemImage: "checkmark", action: save).disabled(!canSave)
                    }
                } else {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", systemImage: "xmark") { dismiss() }
                    }
                    ToolbarItem(placement: .topBarPinnedTrailing) {
                        Button("Save", systemImage: "checkmark", action: save).disabled(!canSave)
                    }
                }
            }
            #if DEBUG
            .task {
                // `-autoFocus <字段>`:编辑页打开后让那个字段拿到焦点(弹出键盘),模拟器里核对键盘上方的「完成」用。
                try? await Task.sleep(for: .seconds(1.2))
                switch DebugLaunch.value("-autoFocus") {
                case "address": focus = .address
                case "port": focus = .port
                case "user": focus = .user
                case "name": focus = .name
                default: break
                }
            }
            #endif
            .alert("Couldn't Save", isPresented: $saveFailed) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("The host or its credentials couldn't be stored. Try again.")
            }
        }
    }

    // MARK: 私钥

    @ViewBuilder private var keySection: some View {
        Section {
            if let info = keyInfo {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: info.algorithm).font(.subheadline.weight(.semibold))
                    Text(verbatim: info.fingerprint).font(.caption.monospaced()).foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                Text(verbatim: info.publicKey).font(.caption.monospaced()).lineLimit(3)
                    .textSelection(.enabled)
                Button(copied ? "Copied" : "Copy Public Key", systemImage: copied ? "checkmark" : "square.on.square") {
                    UIPasteboard.general.string = info.publicKey
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(2)); copied = false }
                }
            } else {
                Text(keyProblem ?? String(localized: "No key yet. Generate one, or import an existing private key."))
                    .font(.footnote).foregroundStyle(keyProblem == nil ? Color.secondary : Color.red)
            }
            SecureField("Key passphrase (optional)", text: $credentials.passphrase)
                .font(.system(.body, design: .monospaced))
                        .focused($focus, equals: .passphrase).submitLabel(.done)
                .onSubmit { focus = nil; refreshKeyInfo() }
                .onChange(of: credentials.passphrase) { _, _ in refreshKeyInfo() }
            // 一行一个按钮:三个并排在窄的弹层里会把文字挤成竖排。
            Button("Generate", systemImage: "key", action: generate)
            Button("Import…", systemImage: "arrow.down.doc") { importing = true }
            Button("Paste", systemImage: "clipboard", action: pasteKey)
        } header: {
            Text(verbatim: "# ") .foregroundStyle(Color.green) + Text("Private Key")
        } footer: {
            Text("The key is stored in the Keychain on this device. Add the public key to ~/.ssh/authorized_keys on the server.")
        }
                .listRowBackground(cardColor)
    }

    private func refreshKeyInfo() {
        guard !credentials.privateKey.isEmpty else { keyInfo = nil; return }
        do {
            keyInfo = try inspectKey(pem: credentials.privateKey,
                                     passphrase: credentials.passphrase.isEmpty ? nil : credentials.passphrase)
            keyProblem = nil
        } catch let e as FfiError {
            keyInfo = nil
            if case .KeyEncrypted = e { keyProblem = String(localized: "This key is protected. Enter its passphrase below.") }
            else { keyProblem = String(localized: "Couldn't read this key: \(e.userMessage)") }
        } catch {
            keyInfo = nil
            keyProblem = String(localized: "Couldn't read this key: \(error.localizedDescription)")
        }
    }

    private func generate() {
        focus = nil
        do {
            let g = try generateKey(comment: "x-ssh-ios", passphrase: credentials.passphrase.isEmpty ? nil : credentials.passphrase)
            credentials.privateKey = g.pem
            keyInfo = g.info
            keyProblem = nil
            #if DEBUG
            NSLog("GENERATED_PUBKEY %@", g.info.publicKey)
            #endif
        } catch {
            keyInfo = nil
            keyProblem = String(localized: "Couldn't generate a key: \(error.localizedDescription)")
        }
    }

    private func pasteKey() {
        guard let text = UIPasteboard.general.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            keyProblem = String(localized: "The clipboard is empty.")
            return
        }
        credentials.privateKey = text
        refreshKeyInfo()
    }

    private func importKey(from result: Result<URL, Error>) {
        switch result {
        case .failure(let e):
            keyProblem = String(localized: "Couldn't read this key: \(e.localizedDescription)")
        case .success(let url):
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url), data.count < 64 * 1024,
                  let text = String(data: data, encoding: .utf8) else {
                keyProblem = String(localized: "That file doesn't look like a private key.")
                return
            }
            credentials.privateKey = text
            refreshKeyInfo()
        }
    }

    /// 地址里写了 `user@host:port` 就拆到各自的框里。
    private func applyTarget() {
        var h = host
        h.port = port ?? h.port
        let n = h.normalized()
        host.address = n.address
        if host.username.isEmpty { host.username = n.username }
        if n.port != h.port || port == nil { portText = String(n.port) }
    }

    private func save() {
        applyTarget()
        var h = host
        h.port = port ?? 0
        if onSave(h, credentials) { dismiss() } else { saveFailed = true }
    }
}

/// 「密码 / 私钥」切换。系统分段控件整体高约 31.4pt、没法单独调高,这里自己画:整体 34.5pt(高 10%),
/// 同样的胶囊形,选中那一格是高亮的胶囊。
private struct AuthKindPicker: View {
    @Binding var selection: AuthKind
    /// 每一格的高度。整个控件 = 38 + 上下内边距各 2 = 42pt(系统分段控件约 31.4pt → 34.5 → 38 → 40 → 42pt)。
    static let height: CGFloat = 38
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 0) {
            option("Password", .password)
            option("Private Key", .key)
        }
        .padding(2)
        .background(Capsule().fill(Color.primary.opacity(0.08)))
        .accessibilityElement(children: .contain)
    }

    private func option(_ title: LocalizedStringKey, _ kind: AuthKind) -> some View {
        let on = selection == kind
        return Button { withAnimation(.smooth(duration: 0.2)) { selection = kind } } label: {
            Text(title)
                .font(.subheadline.weight(on ? .semibold : .regular))
                .foregroundStyle(Color.primary)
                .frame(maxWidth: .infinity)
                .frame(height: Self.height)
                .background {
                    if on { Capsule().fill(Color.primary.opacity(0.16)).matchedGeometryEffect(id: "pill", in: pill) }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
    }
}


private struct DashedLine: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path(); p.move(to: CGPoint(x: 0, y: rect.midY)); p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY)); return p
    }
}

/// 连着的那台名字后面的光标:一个绿色的块,闪几下(约 5 秒)就常亮 —— 不无限循环,省电;滚出屏幕再回来会再闪一轮。
/// 系统开了「减弱动态效果」就不闪,常亮。
private struct BlinkingCursor: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var bright = true

    var body: some View {
        RoundedRectangle(cornerRadius: 1).fill(Color.green).frame(width: 8, height: 15)
            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
            .opacity(bright ? 1 : 0.15)
            .task {
                guard !reduceMotion else { return }
                for _ in 0..<8 {
                    try? await Task.sleep(for: .milliseconds(600))
                    if Task.isCancelled { return }
                    withAnimation(.easeInOut(duration: 0.5)) { bright.toggle() }
                }
                withAnimation(.easeInOut(duration: 0.5)) { bright = true }
            }
            .accessibilityHidden(true)
    }
}

/// 只听不管的「向左横滑」识别器:一开始就明显是横着的(横向位移远大于纵向)才开始,所以不会和列表的上下滑动抢手势;
/// 起手点换算成所在视图自己的坐标回报。滑过 60pt 才算。
struct HorizontalSwipeSpy: UIViewRepresentable {
    let onSwipeLeft: (CGPoint) -> Void

    func makeUIView(context: Context) -> UIView { Anchor(onSwipeLeft: onSwipeLeft) }
    func updateUIView(_ view: UIView, context: Context) { (view as? Anchor)?.onSwipeLeft = onSwipeLeft }

    private final class Anchor: UIView {
        var onSwipeLeft: (CGPoint) -> Void
        private var recognizer: UIPanGestureRecognizer?
        private var start: CGPoint?

        init(onSwipeLeft: @escaping (CGPoint) -> Void) {
            self.onSwipeLeft = onSwipeLeft
            super.init(frame: .zero)
            isUserInteractionEnabled = false
        }
        required init?(coder: NSCoder) { fatalError("not used") }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let recognizer { recognizer.view?.removeGestureRecognizer(recognizer) }
            recognizer = nil
            guard let window else { return }
            let g = HorizontalPan(target: self, action: #selector(pan(_:)))
            g.cancelsTouchesInView = false
            window.addGestureRecognizer(g)
            recognizer = g
        }

        @objc private func pan(_ g: UIPanGestureRecognizer) {
            switch g.state {
            case .began:
                // 起手点:手指按下的位置 = 现在的位置减去已经移动的量。
                guard let window = g.view else { return }
                let now = g.location(in: window)
                let moved = g.translation(in: window)
                start = convert(CGPoint(x: now.x - moved.x, y: now.y - moved.y), from: window)
            case .ended:
                let t = g.translation(in: g.view)
                defer { start = nil }
                guard let start, bounds.contains(start), t.x < -60 else { return }
                onSwipeLeft(start)
            default: break
            }
        }
    }

    /// 一开始就明显是横着的才开始;纵向为主就让给列表去滚。
    private final class HorizontalPan: UIPanGestureRecognizer, UIGestureRecognizerDelegate {
        override init(target: Any?, action: Selector?) {
            super.init(target: target, action: action)
            delegate = self
            maximumNumberOfTouches = 1
        }
        func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            guard let pan = g as? UIPanGestureRecognizer else { return false }
            let v = pan.velocity(in: pan.view)
            return abs(v.x) > abs(v.y) * 1.5
        }
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}


/// 主机行右边那个小圆点的颜色:6 种沉稳的色相,编号存在主机记录里(添加时挑一个还没被用的,见 `HostStore.freeColorIndex`),一眼认出哪台是哪台。
private enum HostColor {
    private static let palette: [Color] = [
        Color(red: 0.44, green: 0.55, blue: 1.00),   // 蓝
        Color(red: 0.31, green: 0.73, blue: 0.64),   // 青绿
        Color(red: 0.71, green: 0.55, blue: 0.94),   // 紫
        Color(red: 0.88, green: 0.54, blue: 0.36),   // 橙
        Color(red: 0.91, green: 0.45, blue: 0.56),   // 粉
        Color(red: 0.62, green: 0.76, blue: 0.40),   // 草绿
        Color(red: 0.36, green: 0.74, blue: 0.90),   // 天蓝
        Color(red: 0.90, green: 0.76, blue: 0.34),   // 黄
        Color(red: 0.80, green: 0.45, blue: 0.80),   // 洋红
        Color(red: 0.55, green: 0.66, blue: 0.66),   // 灰青
        Color(red: 0.86, green: 0.50, blue: 0.46),   // 珊瑚
        Color(red: 0.52, green: 0.52, blue: 0.92),   // 靛
    ]

    static func pip(_ index: Int?) -> Color {
        guard let index, palette.indices.contains(index) else { return palette[0] }
        return palette[index]
    }
}
