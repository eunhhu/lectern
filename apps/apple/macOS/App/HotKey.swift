import AppKit
import Carbon.HIToolbox
import LecternUI

/// The global shortcut that starts and stops a recording from any app, registered with Carbon's
/// `RegisterEventHotKey` (no Input Monitoring permission, works in the sandbox), the same way and
/// with the same default (⌥Space) as the old menu bar app.
@MainActor
final class GlobalHotKey {
    static let unavailableText = "이 단축키는 사용할 수 없습니다. 다른 조합을 골라 주세요."
    private static let signature: OSType = 0x4C45_4354  // 'LECT'

    var onPress: (() -> Void)?
    private var hotKeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?

    /// Replaces the registered combination. False when the system refuses it (another app has
    /// it, or it is not a combination a global shortcut can use); nothing is registered then.
    func register(_ combo: HotKeyCombo) -> Bool {
        unregister()
        guard combo.isUsable, installHandler() else { return false }
        var ref: EventHotKeyRef?
        let id = EventHotKeyID(signature: Self.signature, id: 1)
        let status = RegisterEventHotKey(combo.keyCode, combo.modifiers, id, GetApplicationEventTarget(), 0, &ref)
        guard status == noErr, let ref else { return false }
        hotKeyRef = ref
        return true
    }

    func unregister() {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        hotKeyRef = nil
    }

    private func installHandler() -> Bool {
        if handlerRef != nil { return true }
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        // Lives as long as the process (`MacServices.shared` holds it).
        let context = Unmanaged.passUnretained(self).toOpaque()
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            let read = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
            guard read == noErr, id.signature == GlobalHotKey.signature else { return OSStatus(eventNotHandledErr) }
            let hotKey = Unmanaged<GlobalHotKey>.fromOpaque(context).takeUnretainedValue()
            // Carbon delivers application events on the main thread.
            MainActor.assumeIsolated { hotKey.onPress?() }
            return noErr
        }, 1, &eventType, context, &handlerRef)
        return status == noErr
    }
}
