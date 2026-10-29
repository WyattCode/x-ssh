import Foundation
import Security

struct Host: Identifiable, Codable, Hashable {
    var id = UUID()
    var name = ""
    var address = ""
    var port = 22
    var username = ""
}

/// 主机列表存 Application Support/hosts.json;密码只进钥匙串,不落在 JSON 里。
/// 已信任的主机密钥指纹存 known_hosts.json(键是 host:port)。
@Observable
final class HostStore {
    private(set) var hosts: [Host] = []
    private var known: [String: String] = [:]

    private let dir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("X-SSH", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    init() {
        hosts = load("hosts.json") ?? []
        known = load("known_hosts.json") ?? [:]
        #if DEBUG
        seedFromLaunchArguments()
        #endif
    }

    #if DEBUG
    /// 模拟器里没法顺手敲表单:`-seedHost name:address:port:user:password` 直接塞一台主机(只在 Debug 构建里有)。
    private func seedFromLaunchArguments() {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-seedHost"), i + 1 < args.count else { return }
        let f = args[i + 1].split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard f.count == 5, let port = Int(f[2]) else { return }
        let host = Host(name: f[0], address: f[1], port: port, username: f[3])
        hosts.removeAll { $0.address == host.address && $0.port == host.port }
        save(host, password: f[4])
    }
    #endif

    func save(_ host: Host, password: String?) {
        if let i = hosts.firstIndex(where: { $0.id == host.id }) { hosts[i] = host } else { hosts.append(host) }
        if let password { Keychain.set(password, for: host.id.uuidString) }
        persist("hosts.json", hosts)
    }

    func delete(_ host: Host) {
        hosts.removeAll { $0.id == host.id }
        Keychain.remove(host.id.uuidString)
        persist("hosts.json", hosts)
    }

    func password(for host: Host) -> String { Keychain.get(host.id.uuidString) ?? "" }

    func knownKey(_ host: Host) -> String? { known["\(host.address):\(host.port)"] }

    func trust(_ host: Host, fingerprint: String) {
        known["\(host.address):\(host.port)"] = fingerprint
        persist("known_hosts.json", known)
    }

    private func load<T: Decodable>(_ name: String) -> T? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private func persist<T: Encodable>(_ name: String, _ value: T) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: dir.appendingPathComponent(name), options: [.atomic, .completeFileProtection])
    }
}

enum Keychain {
    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "dev.xssh.ios",
         kSecAttrAccount as String: account]
    }

    static func set(_ value: String, for account: String) {
        remove(account)
        var q = query(account)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func get(_ account: String) -> String? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func remove(_ account: String) { SecItemDelete(query(account) as CFDictionary) }
}
