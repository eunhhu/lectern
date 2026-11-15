import AVFAudio
import Foundation
import os

/// A source of audio buffers, always in `format` (the file's format: the input converts).
public protocol AudioInput: AnyObject, Sendable {
    var format: AVAudioFormat { get }
    func start(onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws
    func stop()
}

/// Turns buffers in whatever format the hardware gives (48 kHz stereo, say) into one fixed
/// format. Rate conversion keeps filter state between buffers, so one converter serves a stream
/// of buffers; a new one is made only when the incoming format changes. Not thread-safe: one
/// tap thread uses it.
public final class BufferConverter {
    public let outputFormat: AVAudioFormat
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?

    public init(outputFormat: AVAudioFormat) {
        self.outputFormat = outputFormat
    }

    /// The converted audio, or nil when the converter is still filling (it can hold back a few
    /// frames).
    public func convert(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer? {
        if buffer.format == outputFormat { return buffer }
        guard buffer.format.sampleRate > 0, buffer.format.channelCount > 0 else { throw RecorderError.noInputDevice }
        if converter == nil || inputFormat != buffer.format {
            guard let made = AVAudioConverter(from: buffer.format, to: outputFormat) else { throw RecorderError.formatMismatch }
            made.downmix = true  // stereo → mono mixes both channels instead of taking the first
            converter = made
            inputFormat = buffer.format
        }
        let ratio = outputFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 64
        guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
            throw RecorderError.formatMismatch
        }
        // Hand the buffer over once, then say "no data for now" (not "end of stream", which
        // would finish the converter after the first buffer).
        let handedOver = Box(false)
        var conversionError: NSError?
        let status = converter!.convert(to: output, error: &conversionError) { _, inputStatus in
            if handedOver.value {
                inputStatus.pointee = .noDataNow
                return nil
            }
            handedOver.value = true
            inputStatus.pointee = .haveData
            return buffer
        }
        if status == .error { throw conversionError ?? RecorderError.formatMismatch }
        return output.frameLength > 0 ? output : nil
    }
}

private final class Box<Value>: @unchecked Sendable {
    var value: Value
    init(_ value: Value) { self.value = value }
}

/// The microphone through `AVAudioEngine`: a tap on the input node, converted to `format`.
///
/// When the hardware changes under it (AirPods connected, a USB mic unplugged), the engine stops
/// itself and posts a configuration change; the input then installs a new tap and starts again on
/// its own (on a private queue, not the engine's notification thread), so a recording that the
/// state table leaves at `recording` keeps getting audio. If it cannot start again, `onInputLost`
/// is called: the app passes that to `Recorder.handle(.routeLost)` (macOS has no audio session
/// to say so).
public final class EngineAudioInput: AudioInput, @unchecked Sendable {
    public let format: AVAudioFormat
    private let engine = AVAudioEngine()
    private let engineLock = NSLock()  // engine calls: start/stop and the configuration observer
    private let callbackLock = NSLock()  // only around `onBuffer`, never across engine calls
    private var onBuffer: (@Sendable (AVAudioPCMBuffer) -> Void)?
    private var lostHandler: (@Sendable () -> Void)?
    private var observer: NSObjectProtocol?
    private let restartQueue = DispatchQueue(label: "com.qucord.lectern.recorder.input-restart")
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "recorder")

    public init(sampleRate: Double = 44_100, channels: AVAudioChannelCount = 1) {
        format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: channels, interleaved: false)!
    }

    /// Called (on a background queue) when the input stopped and could not start again.
    public var onInputLost: (@Sendable () -> Void)? {
        get { callbackLock.withLock { lostHandler } }
        set { callbackLock.withLock { lostHandler = newValue } }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    public func start(onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws {
        callbackLock.withLock { self.onBuffer = onBuffer }
        do {
            try engineLock.withLock {
                try startEngine()
                if observer == nil {
                    observer = NotificationCenter.default.addObserver(
                        forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
                    ) { [weak self] _ in
                        // Not here: this runs on the engine's own queue, and stop() may be waiting
                        // on that queue while holding engineLock.
                        self?.restartQueue.async { [weak self] in self?.restartAfterConfigurationChange() }
                    }
                }
            }
        } catch {
            callbackLock.withLock { self.onBuffer = nil }
            throw error
        }
    }

    public func stop() {
        callbackLock.withLock { onBuffer = nil }
        engineLock.withLock {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
    }

    /// Call with `engineLock` held.
    private func startEngine() throws {
        let node = engine.inputNode
        node.removeTap(onBus: 0)  // installing over an existing tap raises an exception
        let hardware = node.outputFormat(forBus: 0)
        guard hardware.sampleRate > 0, hardware.channelCount > 0 else { throw RecorderError.noInputDevice }
        let converter = BufferConverter(outputFormat: format)  // fresh per tap: the format may have changed
        node.installTap(onBus: 0, bufferSize: 4096, format: nil) { [weak self] buffer, _ in
            guard let self else { return }
            let converted: AVAudioPCMBuffer?
            do {
                converted = try converter.convert(buffer)
            } catch {
                Self.log.error("recorder: conversion failed: \(error.localizedDescription, privacy: .public)")
                return
            }
            guard let converted, let deliver = self.callbackLock.withLock({ self.onBuffer }) else { return }
            deliver(converted)
        }
        engine.prepare()
        try engine.start()
    }

    private func restartAfterConfigurationChange() {
        let restarted: Bool = engineLock.withLock {
            // Checked under engineLock: a stop() that got here first has already cleared it.
            guard callbackLock.withLock({ onBuffer != nil }) else { return true }
            do {
                try startEngine()
                Self.log.info("recorder: input restarted after a configuration change")
                return true
            } catch {
                Self.log.error("recorder: input restart failed: \(error.localizedDescription, privacy: .public)")
                return false
            }
        }
        if !restarted, let lost = onInputLost {
            lost()
        }
    }
}
