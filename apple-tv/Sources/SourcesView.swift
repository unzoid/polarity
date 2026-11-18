import SwiftUI

/// The sources the account's add-ons have for one video, best first, as the core ranks them.
struct SourcesView: View {
    let playing: Playing
    @EnvironmentObject private var library: Library
    @State private var sources: Sources?
    @State private var chosen: Source?

    var body: some View {
        Group {
            if let sources {
                if sources.sources.isEmpty {
                    Notice(title: "No sources", message: emptyReason(sources))
                } else {
                    list(sources)
                }
            } else {
                VStack(spacing: 24) {
                    ProgressView()
                    Text("Looking for sources…").foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(heading)
        .task { await load() }
        .fullScreenCover(item: $chosen) { source in
            PlayerScreen(playing: playing, source: source)
        }
    }

    private var heading: String {
        guard let episode = playing.episode else { return playing.card.name }
        return "\(playing.card.name) · S\(episode.season) E\(episode.episode)"
    }

    private func list(_ sources: Sources) -> some View {
        List {
            if !sources.failed.isEmpty {
                Text("Didn't answer: \(sources.failed.joined(separator: ", "))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(sources.sources, id: \.url) { source in
                Button {
                    chosen = source
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(source.label.isEmpty ? source.addon : "\(source.label) · \(source.addon)")
                            .font(.headline)
                        if !source.text.isEmpty {
                            Text(source.text).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                        }
                        if source.otherEpisode {
                            Text("Its file names another episode").font(.caption).foregroundStyle(.orange)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 80)
    }

    private func emptyReason(_ sources: Sources) -> String {
        if sources.asked.isEmpty {
            return "None of the account's add-ons has sources for this. Add-ons are set up on the account from another device."
        }
        return "The add-ons asked (\(sources.asked.joined(separator: ", "))) have no source the Apple TV can play for this."
    }

    private func load() async {
        guard let core = library.core, sources == nil else { return }
        sources = await core.sources(kind: playing.card.kind, videoId: playing.videoId)
    }
}

extension Source: Identifiable {
    public var id: String { url }
}
