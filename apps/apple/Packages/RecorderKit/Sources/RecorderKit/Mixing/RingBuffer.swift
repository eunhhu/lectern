import Foundation

/// A fixed-capacity FIFO of samples. Writing past the capacity drops the oldest samples rather
/// than refusing the new ones (a recording never stops for a full buffer). Thread-safe.
public final class RingBuffer: @unchecked Sendable {
    public let capacity: Int
    private let lock = NSLock()
    private var storage: [Float]
    private var head = 0  // index of the oldest sample
    private var count = 0

    public init(capacity: Int) {
        precondition(capacity > 0, "RingBuffer needs room for at least one sample")
        self.capacity = capacity
        storage = [Float](repeating: 0, count: capacity)
    }

    public var available: Int { lock.withLock { count } }

    /// Appends `samples`; returns how many old samples were dropped to make room.
    @discardableResult
    public func write(_ samples: [Float]) -> Int {
        lock.withLock {
            var dropped = 0
            var incoming = samples[...]
            if incoming.count > capacity {
                // Only the newest `capacity` samples can stay; the rest are dropped on arrival.
                dropped += incoming.count - capacity
                incoming = incoming.suffix(capacity)
            }
            let overflow = count + incoming.count - capacity
            if overflow > 0 {
                head = (head + overflow) % capacity
                count -= overflow
                dropped += overflow
            }
            var tail = (head + count) % capacity
            for sample in incoming {
                storage[tail] = sample
                tail += 1
                if tail == capacity { tail = 0 }
            }
            count += incoming.count
            return dropped
        }
    }

    /// Appends `count` zeros (same rules as `write`).
    @discardableResult
    public func writeSilence(_ count: Int) -> Int {
        guard count > 0 else { return 0 }
        return write([Float](repeating: 0, count: count))
    }

    /// Up to `count` of the oldest samples (fewer when fewer are there; the caller fills the
    /// rest).
    public func read(count wanted: Int) -> [Float] {
        lock.withLock {
            let n = min(max(wanted, 0), count)
            var out = [Float]()
            out.reserveCapacity(n)
            var index = head
            for _ in 0..<n {
                out.append(storage[index])
                index += 1
                if index == capacity { index = 0 }
            }
            head = index
            count -= n
            return out
        }
    }

    public func removeAll() {
        lock.withLock {
            head = 0
            count = 0
        }
    }
}
