import Foundation

/// A global shortcut: a virtual key code and Carbon modifier flags (what `RegisterEventHotKey`
/// takes). The default is the old menu bar app's ⌥Space.
public struct HotKeyCombo: Equatable, Sendable {
    // Carbon's modifier masks (HIToolbox Events.h), so this file needs no Carbon.
    public static let command: UInt32 = 0x0100
    public static let shift: UInt32 = 0x0200
    public static let option: UInt32 = 0x0800
    public static let control: UInt32 = 0x1000

    public static let keyCodeKey = "hotkey_keycode"
    public static let modifiersKey = "hotkey_modifiers"
    public static let spaceKeyCode: UInt32 = 0x31
    public static let `default` = HotKeyCombo(keyCode: spaceKeyCode, modifiers: option)

    public var keyCode: UInt32
    public var modifiers: UInt32

    public init(keyCode: UInt32, modifiers: UInt32) {
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    /// Modifiers from the four flags (AppKit's event flags, translated by the caller).
    public init(keyCode: UInt32, command: Bool, shift: Bool, option: Bool, control: Bool) {
        var mask: UInt32 = 0
        if command { mask |= Self.command }
        if shift { mask |= Self.shift }
        if option { mask |= Self.option }
        if control { mask |= Self.control }
        self.init(keyCode: keyCode, modifiers: mask)
    }

    /// A global shortcut needs ⌘, ⌥ or ⌃ (shift alone would take a letter from every app).
    public var isUsable: Bool {
        modifiers & (Self.command | Self.option | Self.control) != 0
    }

    /// "⌥⌘R", "⌥Space": modifiers in the system's order (⌃⌥⇧⌘), then the key.
    public var displayString: String {
        var text = ""
        if modifiers & Self.control != 0 { text += "⌃" }
        if modifiers & Self.option != 0 { text += "⌥" }
        if modifiers & Self.shift != 0 { text += "⇧" }
        if modifiers & Self.command != 0 { text += "⌘" }
        return text + Self.keyName(keyCode)
    }

    public static func load(from defaults: UserDefaults) -> HotKeyCombo {
        guard defaults.object(forKey: keyCodeKey) != nil, defaults.object(forKey: modifiersKey) != nil else { return .default }
        return HotKeyCombo(keyCode: UInt32(defaults.integer(forKey: keyCodeKey)), modifiers: UInt32(defaults.integer(forKey: modifiersKey)))
    }

    public func save(to defaults: UserDefaults) {
        defaults.set(Int(keyCode), forKey: Self.keyCodeKey)
        defaults.set(Int(modifiers), forKey: Self.modifiersKey)
    }

    /// The key's label on a US layout (virtual key codes are positions, not characters).
    public static func keyName(_ keyCode: UInt32) -> String {
        keyNames[keyCode] ?? "키 \(keyCode)"
    }

    private static let keyNames: [UInt32: String] = [
        0x00: "A", 0x01: "S", 0x02: "D", 0x03: "F", 0x04: "H", 0x05: "G", 0x06: "Z", 0x07: "X", 0x08: "C", 0x09: "V",
        0x0B: "B", 0x0C: "Q", 0x0D: "W", 0x0E: "E", 0x0F: "R", 0x10: "Y", 0x11: "T", 0x12: "1", 0x13: "2", 0x14: "3",
        0x15: "4", 0x16: "6", 0x17: "5", 0x18: "=", 0x19: "9", 0x1A: "7", 0x1B: "-", 0x1C: "8", 0x1D: "0", 0x1E: "]",
        0x1F: "O", 0x20: "U", 0x21: "[", 0x22: "I", 0x23: "P", 0x24: "↩", 0x25: "L", 0x26: "J", 0x27: "'", 0x28: "K",
        0x29: ";", 0x2A: "\\", 0x2B: ",", 0x2C: "/", 0x2D: "N", 0x2E: "M", 0x2F: ".", 0x30: "⇥", 0x31: "Space",
        0x32: "`", 0x33: "⌫", 0x35: "⎋", 0x60: "F5", 0x61: "F6", 0x62: "F7", 0x63: "F3", 0x64: "F8", 0x65: "F9",
        0x67: "F11", 0x6D: "F10", 0x6F: "F12", 0x76: "F4", 0x78: "F2", 0x7A: "F1", 0x7B: "←", 0x7C: "→", 0x7D: "↓",
        0x7E: "↑",
    ]
}
