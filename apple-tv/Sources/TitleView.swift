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
        let seasons: [UInt32] = seasonNumbers(of: title)
        let shown: UInt32 = season ?? seasons.first ?? 1
        VStack(alignment: .leading, spacing: 24) {
            if seasons.count > 1 {
                SeasonPicker(seasons: seasons, shown: shown) { season = $0 }
            }
            LazyVStack(alignment: .leading, spacing: 16) {
                ForEach(title.episodes.filter { $0.season == shown }, id: \.id) { (episode: Episode) in
                    episodeLink(episode, of: title)
                }
            }
            .focusSection()
        }
    }

    private func episodeLink(_ episode: Episode, of title: Title) -> some View {
        let resume: Resume? = progress[episode.id]
        let playing = Playing(card: title.card, videoId: episode.id, episode: episode, resumeAt: resumeAt(resume))
        return NavigationLink(value: playing) {
            EpisodeRow(episode: episode, resume: resume)
        }
        .buttonStyle(.card)
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

/// A show's season numbers in order, specials (season 0) last.
func seasonNumbers(of title: Title) -> [UInt32] {
    let numbers: Set<UInt32> = Set(title.episodes.map { (episode: Episode) -> UInt32 in episode.season })
    return numbers.sorted { (a: UInt32, b: UInt32) -> Bool in seasonOrder(a) < seasonOrder(b) }
}

/// Where a season sorts: its number, specials after every other.
private func seasonOrder(_ season: UInt32) -> UInt32 {
    season == 0 ? UInt32.max : season
}

/// Where to start a video again: from its progress, unless it was watched to the end.
func resumeAt(_ resume: Resume?) -> Double {
    guard let resume, resume.duration > 0, resume.position / resume.duration < 0.92 else { return 0 }
    return resume.position
}

func resumeLabel(for resume: Resume?) -> String {
    resumeAt(resume) > 0 ? "Resume" : "Play"
}

/// A show's seasons as a row of buttons, the one shown tinted.
struct SeasonPicker: View {
    let seasons: [UInt32]
    let shown: UInt32
    let choose: (UInt32) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 20) {
                ForEach(seasons, id: \.self) { (s: UInt32) in
                    Button(s == 0 ? "Specials" : "Season \(s)") { choose(s) }
                        .buttonStyle(.bordered)
                        .tint(s == shown ? Color.accentColor : nil)
                }
            }
            .padding(.vertical, 20)
        }
        .scrollClipDisabled()
        .focusSection()
    }
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
