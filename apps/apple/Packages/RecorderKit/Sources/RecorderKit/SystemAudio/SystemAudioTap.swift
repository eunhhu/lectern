#if os(macOS)
import AVFAudio
import CoreAudio
import Foundation
import os

/// Everything the Mac plays, except this app's own sound, as mono samples: a Core Audio process
/// tap (macOS 14.2+) in a private aggregate device whose IO block hands the buffers over. The tap
/// does not mute anything; the user hears the call as before.
///
/// Made, in order: the tap, the aggregate device holding it, the IO proc; `stop()` undoes them in
/// reverse and is safe to call twice. A start that fails halfway undoes what it made. Used from
/// one queue at a time (`DualInput`'s); the IO block runs on its own queue.
public final class SystemAudioTap: SystemAudioSource, @unchecked Sendable {
    public let sampleRate: Double
    private let lock = NSLock()
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let ioQueue = DispatchQueue(label: "com.qucord.lectern.recorder.system-io", qos: .userInitiated)
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "recorder")

    /// `sampleRate`: what the samples are converted to (the microphone's).
    public init(sampleRate: Double = 44_100) {
        self.sampleRate = sampleRate
    }

    public func start(onSamples: @escaping @Sendable ([Float]) -> Void) throws {
        stop()
        do {
            try open(onSamples: onSamples)
        } catch {
            stop()  // whatever was made before the failure
            throw error
        }
    }

    public func stop() {
        let (aggregate, proc, tap) = lock.withLock { () -> (AudioObjectID, AudioDeviceIOProcID?, AudioObjectID) in
            defer {
                aggregateID = AudioObjectID(kAudioObjectUnknown)
                procID = nil
                tapID = AudioObjectID(kAudioObjectUnknown)
            }
            return (aggregateID, procID, tapID)
        }
        if aggregate != kAudioObjectUnknown {
            if let proc {
                AudioDeviceStop(aggregate, proc)
                AudioDeviceDestroyIOProcID(aggregate, proc)
            }
            AudioHardwareDestroyAggregateDevice(aggregate)
        }
        if tap != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tap)
        }
    }

    // MARK: - Internals

    private func open(onSamples: @escaping @Sendable ([Float]) -> Void) throws {
        // 1. The tap: a mono mix of every process but this one, nothing muted.
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: Self.ownProcessObject().map { [$0] } ?? [])
        description.uuid = UUID()
        description.name = "Lectern"
        description.muteBehavior = .unmuted
        description.isPrivate = true
        var tap = AudioObjectID(kAudioObjectUnknown)
        try Self.check(AudioHardwareCreateProcessTap(description, &tap), creatingTap: true)
        lock.withLock { tapID = tap }

        var streamFormat = AudioStreamBasicDescription()
        var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var formatAddress = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain
        )
        try Self.check(AudioObjectGetPropertyData(tap, &formatAddress, 0, nil, &formatSize, &streamFormat))
        guard let tapFormat = AVAudioFormat(streamDescription: &streamFormat) else {
            throw SystemAudioError.unavailable(Int32(kAudioHardwareUnsupportedOperationError))
        }

        // 2. A private aggregate device made of the tap alone. Not "tap auto start": that would
        // make AudioDeviceStart wait until something plays.
        let aggregateDescription: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Lectern System Audio",
            kAudioAggregateDeviceUIDKey: "com.qucord.lectern.system-audio.\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: false,
            kAudioAggregateDeviceTapListKey: [
                [kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true],
            ],
        ]
        var aggregate = AudioObjectID(kAudioObjectUnknown)
        try Self.check(AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregate))
        lock.withLock { aggregateID = aggregate }

        // 3. The IO block: the tap's buffers → mono Float at `sampleRate`.
        let converter = BufferConverter(outputFormat: AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!)
        let expectedBuffers = tapFormat.isInterleaved ? 1 : Int(tapFormat.channelCount)
        Self.log.info("recorder: system audio tap format \(tapFormat.sampleRate, privacy: .public) Hz, \(tapFormat.channelCount, privacy: .public) ch")
        // On a Mac a silent right channel can mean three things (the device never ran, buffer
        // lists of another shape, a refusal that shows up as silence): say which, once each.
        let firstCallback = OnceFlag(), firstSkip = OnceFlag()
        var proc: AudioDeviceIOProcID?
        try Self.check(AudioDeviceCreateIOProcIDWithBlock(&proc, aggregate, ioQueue) { _, inputData, _, _, _ in
            // Only a buffer list that matches the tap's format: AVAudioPCMBuffer trusts it.
            let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
            if firstCallback.claim() {
                Self.log.info("recorder: system audio first callback: \(list.count, privacy: .public) buffers, \(list.first?.mDataByteSize ?? 0, privacy: .public) bytes")
            }
            guard list.count == expectedBuffers, list.allSatisfy({ $0.mData != nil && $0.mDataByteSize > 0 }),
                  let buffer = AVAudioPCMBuffer(pcmFormat: tapFormat, bufferListNoCopy: inputData, deallocator: nil),
                  buffer.frameLength > 0 else {
                if firstSkip.claim() {
                    Self.log.error("recorder: system audio buffer list skipped: \(list.count, privacy: .public) buffers, expected \(expectedBuffers, privacy: .public)")
                }
                return
            }
            do {
                guard let converted = try converter.convert(buffer), let channel = converted.floatChannelData?[0] else { return }
                onSamples(Array(UnsafeBufferPointer(start: channel, count: Int(converted.frameLength))))
            } catch {
                Self.log.error("recorder: system audio conversion failed: \(error.localizedDescription, privacy: .public)")
            }
        })
        lock.withLock { procID = proc }
        try Self.check(AudioDeviceStart(aggregate, proc))
    }

    /// True the first time only.
    private final class OnceFlag: @unchecked Sendable {
        private let lock = NSLock()
        private var done = false
        func claim() -> Bool {
            lock.withLock {
                defer { done = true }
                return !done
            }
        }
    }

    /// This process's Core Audio object, to leave its own sound out of the tap. Nil before the
    /// process has used audio (nothing of its own to leave out then).
    private static func ownProcessObject() -> AudioObjectID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain
        )
        var pid = getpid()
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object
        )
        return status == noErr && object != kAudioObjectUnknown ? object : nil
    }

    /// Which status a refused permission gives is not documented: `'nope'` from creating the
    /// tap is taken as one (MANUAL_CHECKS: the device check confirms it); anything else is
    /// `unavailable` with its status.
    private static func check(_ status: OSStatus, creatingTap: Bool = false) throws {
        guard status != noErr else { return }
        log.error("recorder: system audio call failed: \(status, privacy: .public)")
        if creatingTap, status == OSStatus(kAudioHardwareIllegalOperationError) {
            throw SystemAudioError.permissionDenied
        }
        throw SystemAudioError.unavailable(status)
    }
}
#endif
