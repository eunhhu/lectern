@testable import LecternKit
import XCTest

/// Records every push call in order, in one log shared with the test's sign-out.
final class FakePushAPI: PushAPI, @unchecked Sendable {
    private let lock = NSLock()
    private var log: [String] = []
    private var registrations: [PushDeviceRegistration] = []
    private var failure: Error?

    init(failing failure: Error? = nil) {
        self.failure = failure
    }

    var calls: [String] { lock.withLock { log } }
    var sent: [PushDeviceRegistration] { lock.withLock { registrations } }

    func note(_ call: String) { lock.withLock { log.append(call) } }

    func upsertPushDevice(deviceID: String, registration: PushDeviceRegistration) async throws {
        try lock.withLock {
            log.append("upsert \(deviceID)")
            if let failure { throw failure }
            registrations.append(registration)
        }
    }

    func deletePushDevice(deviceID: String) async throws { note("delete \(deviceID)") }
    func setLiveActivity(recordingID: String, deviceID: String, pushToken: String) async throws { note("set \(recordingID) \(pushToken)") }
    func endLiveActivity(recordingID: String, deviceID: String) async throws { note("end \(recordingID)") }
}

final class PushRegistrationTests: XCTestCase {
    private let tokenA = String(repeating: "ab", count: 32)
    private let tokenB = String(repeating: "cd", count: 32)

    func testRegistrationSendsOncePerToken() async {
        let api = FakePushAPI()
        let registration = PushRegistration(api: api, deviceID: "dev_1", name: "iPhone", appVersion: "1.0")
        await registration.apnsTokenChanged(tokenA)
        await registration.apnsTokenChanged(tokenA)
        await registration.apnsTokenChanged(tokenB)
        XCTAssertEqual(api.calls, ["upsert dev_1", "upsert dev_1"])
        XCTAssertEqual(api.sent.map(\.apnsToken), [tokenA, tokenB])
        XCTAssertEqual(api.sent.first?.name, "iPhone")
    }

    func testRegistrationIgnores501() async {
        let api = FakePushAPI(failing: APIError.server(status: 501, code: "not_implemented", message: nil))
        let registration = PushRegistration(api: api, deviceID: "dev_1", name: nil, appVersion: nil)
        await registration.apnsTokenChanged(tokenA)  // does not throw
        await registration.apnsTokenChanged(tokenA)  // not remembered as sent: tried again
        XCTAssertEqual(api.calls.count, 2)
    }

    func testLogoutDeletesDeviceBeforeTokens() async {
        let api = FakePushAPI()
        let registration = PushRegistration(api: api, deviceID: "dev_1", name: nil, appVersion: nil)
        await registration.apnsTokenChanged(tokenA)
        await registration.signOut { api.note("clear tokens") }
        XCTAssertEqual(api.calls, ["upsert dev_1", "delete dev_1", "clear tokens"])
    }

    // MARK: - Beyond the spec

    func testPushToStartWaitsForTheAPNsToken() async {
        let api = FakePushAPI()
        let registration = PushRegistration(api: api, deviceID: "dev_1", name: nil, appVersion: nil)
        await registration.pushToStartTokenChanged(tokenB)
        XCTAssertEqual(api.calls, [])  // the server needs apns_token
        await registration.apnsTokenChanged(tokenA)
        XCTAssertEqual(api.sent.last?.pushToStartToken, tokenB)
        await registration.pushToStartTokenChanged(tokenB)
        XCTAssertEqual(api.calls.count, 1)
    }

    func testSignInAgainSendsAgain() async {
        let api = FakePushAPI()
        let registration = PushRegistration(api: api, deviceID: "dev_1", name: nil, appVersion: nil)
        await registration.apnsTokenChanged(tokenA)
        await registration.signOut {}
        await registration.signedIn()
        XCTAssertEqual(api.calls, ["upsert dev_1", "delete dev_1", "upsert dev_1"])
    }

    func testHexToken() {
        XCTAssertEqual(PushRegistration.hex(Data([0x00, 0xAB, 0x10])), "00ab10")
    }

    func testDeviceIdentityIsMadeOnce() {
        let store = InMemoryTokenStore()
        let first = DeviceIdentity(store: store).id
        XCTAssertEqual(DeviceIdentity(store: store).id, first)
        XCTAssertTrue(DeviceIdentity.isValid(first))
        XCTAssertEqual(store.read(DeviceIdentity.key), first)
    }
}
