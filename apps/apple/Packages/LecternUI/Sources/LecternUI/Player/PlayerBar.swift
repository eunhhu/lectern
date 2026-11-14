import SwiftUI

/// Play/pause, 15 s back and forward, speed, a position slider, and `<현재> / <전체>`.
public struct PlayerBar: View {
    @ObservedObject private var model: PlayerViewModel
    /// The slider's value while it is dragged, so position updates do not pull the thumb back.
    @State private var draggingMs: Double?
    @State private var dragging = false

    public init(model: PlayerViewModel) {
        self.model = model
    }

    /// "0.75×", "1×", "1.25×".
    nonisolated static func rateText(_ rate: Float) -> String {
        "\(formatted(rate))×"
    }

    /// "재생 속도 1.25배".
    nonisolated static func rateAccessibilityLabel(_ rate: Float) -> String {
        "재생 속도 \(formatted(rate))배"
    }

    private nonisolated static func formatted(_ rate: Float) -> String {
        let text = String(format: "%.2f", rate)
        return text.replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression)
    }

    public var body: some View {
        VStack(spacing: LecternTokens.Space.s8) {
            if let error = model.errorMessage {
                Text(verbatim: error)
                    .lecternFont(.caption)
                    .foregroundStyle(Theme.tone(.danger).text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            slider
            HStack(spacing: LecternTokens.Space.s16) {
                iconButton("gobackward.15", label: "15초 뒤로") { model.skip(bySeconds: -15) }
                iconButton(model.isPlaying ? "pause.fill" : "play.fill", label: model.isPlaying ? "일시정지" : "재생") { model.toggle() }
                iconButton("goforward.15", label: "15초 앞으로") { model.skip(bySeconds: 15) }
                Button { model.rate = PlayerViewModel.nextRate(after: model.rate) } label: {
                    Text(verbatim: Self.rateText(model.rate))
                        .lecternFont(.label)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textPrimary)
                        .frame(minWidth: Theme.minTapTarget, minHeight: Theme.minTapTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Self.rateAccessibilityLabel(model.rate))
                Spacer(minLength: 0)
                Text(verbatim: "\(TimeText.timestamp(shownMs)) / \(TimeText.timestamp(model.durationMs))")
                    .lecternFont(.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityLabel("\(TimeText.spoken(shownMs)) / \(TimeText.spoken(model.durationMs))")
            }
        }
        .padding(.horizontal, LecternTokens.Space.s16)
        .padding(.vertical, LecternTokens.Space.s8)
        .background(Theme.raised)
    }

    private var shownMs: Int {
        draggingMs.map { Int($0) } ?? model.positionMs
    }

    private var slider: some View {
        Slider(
            value: Binding(
                get: { draggingMs ?? Double(model.positionMs) },
                set: { value in
                    // A change outside a drag (keyboard arrows) seeks at once; a drag seeks when it ends.
                    if dragging { draggingMs = value } else { model.seek(toMs: Int(value)) }
                }
            ),
            in: 0...Double(max(model.durationMs, 1)),
            onEditingChanged: { editing in
                dragging = editing
                guard !editing else { return }
                if let target = draggingMs { model.seek(toMs: Int(target)) }
                draggingMs = nil
            }
        )
        .tint(Theme.accent)
        .accessibilityLabel("재생 위치")
        .accessibilityValue(TimeText.spoken(shownMs))
        // VoiceOver's swipe up/down: 15 s, through seek (the drag path above waits for the drag to end).
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: model.skip(bySeconds: 15)
            case .decrement: model.skip(bySeconds: -15)
            @unknown default: break
            }
        }
    }

    private func iconButton(_ systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .imageScale(.large)
                .foregroundStyle(Theme.textPrimary)
                .frame(minWidth: Theme.minTapTarget, minHeight: Theme.minTapTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
