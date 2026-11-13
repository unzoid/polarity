import SwiftUI

/// Full-screen playback of one source. The player (libmpv for tvOS) is the next step of #504; until
/// then this says so. Menu on the remote closes it.
struct PlayerScreen: View {
    let playing: Playing
    let source: Source

    var body: some View {
        Notice(
            title: "The player isn't in this build yet",
            message: "\(source.label.isEmpty ? source.addon : source.label) was chosen. Playback comes with the next version of the Apple TV app."
        )
    }
}
