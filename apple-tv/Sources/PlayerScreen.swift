import SwiftUI

/// Full-screen playback of one source with libmpv (`MpvPlayer`). The Siri Remote: Play/Pause or a
/// click pauses, left and right move 10 seconds, down opens audio and subtitles, up shows the bar,
/// Menu closes. Where it got to is saved every 10 seconds, on pause, when the app leaves the
/// screen and on closing.
struct PlayerScreen: View {
    let playing: Playing
    let source: Source

    var body: some View {
        PlayerStage(
            playing: playing,
            source: source,
            player: MpvPlayer(url: source.url, headers: headerFields(headers: source.headers), start: playing.resumeAt)
        )
    }
}

/// The player, made once per screen (`StateObject` keeps the first one).
private struct PlayerStage: View {
    let playing: Playing
    let source: Source
    @StateObject private var player: MpvPlayer
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var focused: Bool
    @State private var barShown = true
    @State private var picking = false
    @State private var hideBar: Task<Void, Never>?

    init(playing: Playing, source: Source, player: @autoclosure @escaping () -> MpvPlayer) {
        self.playing = playing
        self.source = source
        _player = StateObject(wrappedValue: player())
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let video = player.video, player.problem == nil {
                MpvVideo(view: video).ignoresSafeArea()
            }
            if let problem = player.problem {
                Notice(title: "This source didn't play", message: "\(problem) Press Menu to choose another.")
            } else {
                if player.buffering {
                    ProgressView()
                }
                if barShown || player.paused {
                    PlayerBar(heading: heading, position: player.position, duration: player.duration, paused: player.paused)
                        .transition(.opacity)
                }
            }
        }
        .animation(.easeOut(duration: 0.25), value: barShown || player.paused)
        .focusable()
        .focused($focused)
        .onAppear {
            focused = true
            showBar()
        }
        .onPlayPauseCommand { togglePause() }
        .onTapGesture { togglePause() }
        .onMoveCommand { direction in move(direction) }
        .onExitCommand { close() }
        .sheet(isPresented: $picking) {
            TrackPicker(tracks: player.tracks) { track, kind in player.choose(track, kind: kind) }
        }
        .onChange(of: player.paused) { _, paused in
            if paused { save() }
        }
        .onChange(of: player.ended) { _, ended in
            if ended { close() }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase != .active else { return }
            player.pause()
            save()
        }
        .task { await saveEveryTenSeconds() }
        .onDisappear {
            hideBar?.cancel()
            save()
            player.close()
            library.refreshProgress()
        }
    }

    private var heading: String {
        guard let episode = playing.episode else { return playing.card.name }
        let title = episode.title.isEmpty ? "" : " · \(episode.title)"
        return "\(playing.card.name) · S\(episode.season) E\(episode.episode)\(title)"
    }

    private func togglePause() {
        player.togglePause()
        showBar()
    }

    private func move(_ direction: MoveCommandDirection) {
        switch direction {
        case .left: player.seek(by: -10)
        case .right: player.seek(by: 10)
        case .down:
            if !player.tracks.isEmpty { picking = true }
        default: break
        }
        showBar()
    }

    /// Shows the bar, and hides it again after five seconds while playing.
    private func showBar() {
        barShown = true
        hideBar?.cancel()
        hideBar = Task {
            try? await Task.sleep(for: .seconds(5))
            if !Task.isCancelled { barShown = false }
        }
    }

    private func close() {
        save()
        dismiss()
    }

    private func saveEveryTenSeconds() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(10))
            if !player.paused { save() }
        }
    }

    /// Saves where it got to, once it's known how long the video is.
    private func save() {
        guard let core = library.core, player.duration > 0, player.position > 0 else { return }
        let resume = playing.resume(position: player.position, duration: player.duration, streamJson: source.streamJson)
        do {
            try core.saveProgress(resume: resume)
        } catch {
            NSLog("polar: progress not saved: %@", error.localizedDescription)
        }
    }
}

/// Title, the position in the video and what the remote does, at the foot of the screen.
private struct PlayerBar: View {
    let heading: String
    let position: Double
    let duration: Double
    let paused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Spacer()
            Text(heading).font(.title3).bold().lineLimit(1)
            if duration > 0 {
                ProgressView(value: min(max(position / duration, 0), 1))
            }
            HStack {
                Image(systemName: paused ? "pause.fill" : "play.fill")
                Text(timeText(position))
                Spacer()
                Text("◀ ▶ 10 s  ·  ▼ Audio and subtitles").foregroundStyle(.secondary)
                Spacer()
                Text(duration > 0 ? "-\(timeText(max(duration - position, 0)))" : "")
            }
            .font(.callout)
            .monospacedDigit()
        }
        .padding(.horizontal, 90)
        .padding(.bottom, 60)
        .background(alignment: .bottom) {
            LinearGradient(colors: [.clear, .black.opacity(0.8)], startPoint: .top, endPoint: .bottom)
                .frame(height: 360)
                .ignoresSafeArea()
        }
    }
}

/// `h:mm:ss`, or `m:ss` under an hour.
func timeText(_ seconds: Double) -> String {
    let total = Int(seconds.rounded(.down))
    let (h, m, s) = (total / 3600, total / 60 % 60, total % 60)
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
}

/// Audio and subtitle tracks of what's playing; Menu closes it.
private struct TrackPicker: View {
    let tracks: [Track]
    let choose: (Track?, String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let audio = tracks.filter { $0.kind == "audio" }
        let subtitles = tracks.filter { $0.kind == "sub" }
        List {
            if !audio.isEmpty {
                Section("Audio") {
                    ForEach(audio) { track in row(track.label, selected: track.selected) { choose(track, "audio") } }
                }
            }
            Section("Subtitles") {
                row("Off", selected: !subtitles.contains { $0.selected }) { choose(nil, "sub") }
                ForEach(subtitles) { track in row(track.label, selected: track.selected) { choose(track, "sub") } }
            }
        }
        .frame(maxWidth: 900)
    }

    private func row(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            action()
            dismiss()
        } label: {
            HStack {
                Text(label)
                Spacer()
                if selected { Image(systemName: "checkmark") }
            }
        }
    }
}
