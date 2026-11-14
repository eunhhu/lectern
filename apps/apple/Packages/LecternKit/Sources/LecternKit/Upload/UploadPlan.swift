import Foundation

/// Byte ranges of a file's parts: `partSize` each, the last one shorter. An empty file has none.
public func partRanges(byteCount: Int64, partSize: Int) -> [Range<Int64>] {
    guard byteCount > 0, partSize > 0 else { return [] }
    let size = Int64(partSize)
    return stride(from: Int64(0), to: byteCount, by: partSize).map { start in start..<min(start + size, byteCount) }
}

/// Part numbers (1-based, like the server) of `1...total` not in `done`, ascending.
public func remainingParts(total: Int, done: [Int]) -> [Int] {
    guard total > 0 else { return [] }
    let have = Set(done)
    return (1...total).filter { !have.contains($0) }
}
