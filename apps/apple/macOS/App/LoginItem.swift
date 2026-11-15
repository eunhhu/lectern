import ServiceManagement

/// "로그인할 때 Lectern 실행": the app itself as a login item (`SMAppService.mainApp`).
enum LoginItem {
    static let failedText = "로그인 항목을 바꾸지 못했습니다."
    static let needsApprovalText = "시스템 설정 > 일반 > 로그인 항목에서 Lectern을 허용해 주세요."

    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }
    /// Registered, but the user has to allow it in System Settings first.
    static var needsApproval: Bool { SMAppService.mainApp.status == .requiresApproval }

    static func set(_ enabled: Bool) throws {
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }

    static func openSystemSettings() {
        SMAppService.openSystemSettingsLoginItems()
    }
}
