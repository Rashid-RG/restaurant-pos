import Foundation
import Security
import Capacitor

// GastroFlow Food only. Local Keychain plugin for future tenant-scoped customer
// sessions. Not activated for login/API until device-level migration acceptance.
@objc(GastroFoodSecureSessionPlugin)
public class GastroFoodSecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GastroFoodSecureSessionPlugin"
    public let jsName = "GastroFoodSecureSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.rstechnologies.gastrofood.customer-session.v1"
    private let prefix = "gastroflow_customer_token:"

    private func validatedKey(_ call: CAPPluginCall) -> String? {
        guard let key = call.getString("key"), key.hasPrefix(prefix),
              key.count > prefix.count, key.utf8.count <= 256 else {
            call.reject("Invalid customer session key")
            return nil
        }
        return key
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any
        ]
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = validatedKey(call) else { return }
        var query = baseQuery(key)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }
        guard status == errSecSuccess, let value = item as? Data,
              let token = String(data: value, encoding: .utf8) else {
            call.reject("Unable to read secure customer session")
            return
        }
        call.resolve(["value": token])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = validatedKey(call) else { return }
        guard let token = call.getString("value"), !token.isEmpty,
              token.utf8.count <= 8192 else {
            call.reject("Invalid customer session token")
            return
        }
        let encoded = Data(token.utf8)
        var query = baseQuery(key)
        query[kSecValueData as String] = encoded
        // Keys cannot be synchronised to iCloud and cannot be restored to a
        // different device. Available after first unlock for foreground resume.
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let update: [String: Any] = [kSecValueData as String: encoded]
            let replaceStatus = SecItemUpdate(baseQuery(key) as CFDictionary,
                                              update as CFDictionary)
            if replaceStatus != errSecSuccess {
                call.reject("Unable to update secure customer session")
                return
            }
        } else if status != errSecSuccess {
            call.reject("Unable to save secure customer session")
            return
        }
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = validatedKey(call) else { return }
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            call.reject("Unable to remove secure customer session")
            return
        }
        call.resolve()
    }
}
