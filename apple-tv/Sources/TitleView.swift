import SwiftUI

/// A title page: backdrop, facts and Play for a movie; seasons and their episodes for a show.
struct TitleView: View {
    let card: Card
    @EnvironmentObject private var library: Library
    @State private var title: Title?
    @State private var problem: String?
    @State private var season: UInt32?
    @State private var progress: [String: Resume] = [:]

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 32) {
                header
                if let title, !title.episodes.isEmpty {
                    episodes(of: title)
                }
                if let problem {
                    Text(problem).foregroundStyle(.secondary)
                }
            }
            .padding(80)
        }
        .background(alignment: .top) {
            Artwork(url: (title?.card ?? card).background, label: "")
                .opacity(0.35)
                .ignoresSafeArea()
        }
        .task { await load() }
        .onAppear { reloadProgress() }
    }

    private var header: some View {
        let shown = title?.card ?? card
        return VStack(alignment: .leading, spacing: 20) {
            Text(shown.name).font(.largeTitle).bold()
            Text(facts(of: shown)).foregroundStyle(.secondary)
            if let description = title?.description {
                Text(description)
                    .frame(maxWidth: 1200, alignment: .leading)
                    .lineLimit(5)
            }
            if let title, title.episodes.isEmpty {
                NavigationLink(value: moviePlaying) {
                    Label(resumeLabel(for: progress[card.id]), systemImage: "play.fill")
                }
            } else if title == nil, problem == nil {
                ProgressView()
            }
        }
        .focusSection()
    }

    private var moviePlaying: Playing {
        Playing(card: title?.card ?? card, videoId: card.id, episode: nil, resumeAt: resumeAt(progress[card.id]))
    }

    @ViewBuilder
    private func episodes(of title: Title) -> some View {
        let seasons = Array(Set(title.episodes.map(\.season))).sorted { ($0 == 0 ? UInt32.max : $0) < ($1 == 0 ? UInt32.max : $1) }
        let shown = season ?? seasons.first ?? 1
        VStack(alignment: .leading, spacing: 24) {
            if seasons.count > 1 {
                ScrollView(.horizontal) {
                    HStack(spacing: 20) {
                        ForEach(seasons, id: \.self) { s in
                            Button(s == 0 ? "Specials" : "Season \(s)") { season = s }
                                .buttonStyle(.bordered)
                                .tint(s == shown ? Color.accentColor : nil)
                        }
                    }
                    .padding(.vertical, 20)
                }
                .scrollClipDisabled()
                .focusSection()
            }
            LazyVStack(alignment: .leading, spacing: 16) {
                ForEach(title.episodes.filter { $0.season == shown }, id: \.id) { episode in
                    NavigationLink(value: Playing(card: title.card, videoId: episode.id, episode: episode, resumeAt: resumeAt(progress[episode.id]))) {
                        EpisodeRow(episode: episode, resume: progress[episode.id])
                    }
                    .buttonStyle(.card)
                }
            }
            .focusSection()
        }
    }

    private func load() async {
        guard let core = library.core, title == nil else { return }
        do {
            title = try await core.title(kind: card.kind, id: card.id)
        } catch {
            problem = "This title's details couldn't be loaded: \(error.localizedDescription)"
        }
        reloadProgress()
    }

    private func reloadProgress() {
        guard let core = library.core else { return }
        progress = Dictionary(core.progressFor(metaId: card.id).map { ($0.videoId, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private func facts(of card: Card) -> String {
        var parts: [String] = []
        if let year = card.releaseInfo { parts.append(year) }
        if let runtime = title?.runtime { parts.append(runtime) }
        if let genres = title?.genres, !genres.isEmpty { parts.append(genres.prefix(3).joined(separator: ", ")) }
        if let rating = card.rating { parts.append("★ \(rating)") }
        return parts.joined(separator: " · ")
    }
}

/// Where to start a video again: from its progress, unless it was watched to the end.
func resumeAt(_ resume: Resume?) -> Double {
    guard let resume, resume.duration > 0, resume.position / resume.duration < 0.92 else { return 0 }
    return resume.position
}

func resumeLabel(for resume: Resume?) -> String {
    resumeAt(resume) > 0 ? "Resume" : "Play"
}

/// One episode in a show's list.
struct EpisodeRow: View {
    let episode: Episode
    let resume: Resume?

    var body: some View {
        HStack(alignment: .top, spacing: 28) {
            Artwork(url: episode.thumbnail, label: "\(episode.episode)")
                .frame(width: 320, height: 180)
                .overlay(alignment: .bottom) {
                    if let resume, resume.duration > 0 {
                        ProgressView(value: min(resume.position / resume.duration, 1)).padding(12)
                    }
                }
            VStack(alignment: .leading, spacing: 8) {
                Text("\(episode.episode). \(episode.title)").font(.headline)
                if let overview = episode.overview {
                    Text(overview).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(20)
    }
}
