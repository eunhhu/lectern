import Foundation
import LecternKit

/// The old menu bar app's sign-in, carried over once: on the first launch whose new store has no
/// credential. The old item is never deleted (the old app keeps working), so without the flag a
/// sign-out, a server change or a token the server refuses would bring it back on every launch.
/// The old `lectern_course` default is not carried over.
enum LegacyMigration {
    static let settledKey = "legacy_token_settled"

    static func run(client: LiveClient, defaults: UserDefaults = .standard) async {
        guard !defaults.bool(forKey: settledKey) else { return }
        let hasCredential = await client.isSignedIn()
        // Reading another app's item may show a Keychain prompt: not on the main thread.
        let legacy = hasCredential ? nil : await Task.detached(priority: .userInitiated) { LegacyMacToken.read() }.value
        if case let .adopt(token) = legacyMigrationPlan(newStoreHasCredential: hasCredential, legacyToken: legacy) {
            await client.adoptAPIToken(token)
        }
        defaults.set(true, forKey: settledKey)
    }

    /// The new store has held a credential (or the user signed out): never look again.
    static func markSettled(defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: settledKey)
    }
}
