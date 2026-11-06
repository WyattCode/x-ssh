import XCTest
@testable import XSSH

final class HostColorTests: XCTestCase {
    private func host(_ name: String, color: Int? = nil) -> Host {
        var h = Host(name: name, address: "10.0.0.1", username: "u")
        h.colorIndex = color
        return h
    }

    func testFreeIndexPicksSmallestUnused() {
        let hosts = [host("a", color: 0), host("b", color: 1), host("c", color: 3)]
        XCTAssertEqual(HostStore.freeColorIndex(among: hosts), 2)
    }

    func testFreeIndexPicksLeastUsedWhenAllTaken() {
        var hosts: [Host] = (0..<Host.paletteSize).map { host("h\($0)", color: $0) }
        hosts.append(host("extra", color: 0))
        XCTAssertEqual(HostStore.freeColorIndex(among: hosts), 1)
    }

    func testFreeIndexIgnoresOutOfRangeValues() {
        XCTAssertEqual(HostStore.freeColorIndex(among: [host("a", color: 99), host("b", color: -1)]), 0)
    }

    func testOldFileWithoutColorDecodes() throws {
        let json = #"[{"name":"old","address":"example.com","username":"u"}]"#
        let hosts = try JSONDecoder().decode([Host].self, from: Data(json.utf8))
        XCTAssertNil(hosts[0].colorIndex)
        XCTAssertEqual(hosts[0].port, 22)
    }

    func testStoreFillsMissingColorsWithoutDuplicates() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let json = #"[{"name":"a","address":"a.test","username":"u"},{"name":"b","address":"b.test","username":"u"},{"name":"c","address":"c.test","username":"u"}]"#
        try Data(json.utf8).write(to: dir.appendingPathComponent("hosts.json"))
        let store = HostStore(directory: dir)
        let colors = store.hosts.compactMap(\.colorIndex)
        XCTAssertEqual(colors.count, 3)
        XCTAssertEqual(Set(colors).count, 3)
        // 第二次启动读到的是存下来的值,不再变。
        XCTAssertEqual(HostStore(directory: dir).hosts.compactMap(\.colorIndex), colors)
    }

    func testSaveGivesNewHostAFreeColor() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = HostStore(directory: dir)
        // 存主机会把密码写进系统钥匙串:测完要删掉,不留垃圾。
        defer { for h in store.hosts { store.delete(h) } }
        var first = host("one"); first.address = "one.test"
        var second = host("two"); second.address = "two.test"
        _ = store.save(first, credentials: Credentials(password: "x"))
        _ = store.save(second, credentials: Credentials(password: "x"))
        XCTAssertEqual(store.hosts.compactMap(\.colorIndex), [0, 1])
        // 编辑不换颜色。
        var edited = store.hosts[0]; edited.name = "renamed"
        _ = store.save(edited, credentials: Credentials(password: "x"))
        XCTAssertEqual(store.hosts[0].colorIndex, 0)
    }
}
