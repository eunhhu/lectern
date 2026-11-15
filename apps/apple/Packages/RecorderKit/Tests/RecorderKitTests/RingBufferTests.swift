@testable import RecorderKit
import XCTest

final class RingBufferTests: XCTestCase {
    func testRingBufferFifo() {
        let ring = RingBuffer(capacity: 8)
        ring.write([1, 2, 3])
        XCTAssertEqual(ring.read(count: 2), [1, 2])
        ring.write([4, 5])
        XCTAssertEqual(ring.read(count: 3), [3, 4, 5])
        XCTAssertEqual(ring.available, 0)
    }

    func testRingBufferDropsOldest() {
        let ring = RingBuffer(capacity: 4)
        let dropped = ring.write([1, 2, 3, 4, 5, 6])
        XCTAssertEqual(dropped, 2)
        XCTAssertEqual(ring.read(count: 10), [3, 4, 5, 6])
    }

    // MARK: - Beyond the spec

    func testRingBufferDropsOldestAcrossWrites() {
        let ring = RingBuffer(capacity: 4)
        ring.write([1, 2, 3])
        XCTAssertEqual(ring.write([4, 5, 6]), 2)
        XCTAssertEqual(ring.available, 4)
        XCTAssertEqual(ring.read(count: 4), [3, 4, 5, 6])
    }

    func testRingBufferReadsWhatIsThere() {
        let ring = RingBuffer(capacity: 4)
        ring.write([7])
        XCTAssertEqual(ring.read(count: 3), [7])
        XCTAssertEqual(ring.read(count: 3), [])
        ring.writeSilence(2)
        XCTAssertEqual(ring.read(count: 5), [0, 0])
    }

    func testRingBufferWrapsAround() {
        let ring = RingBuffer(capacity: 3)
        for i in 0..<10 {
            ring.write([Float(i)])
            XCTAssertEqual(ring.read(count: 1), [Float(i)])
        }
    }
}
