import Foundation
import SwiftUI

/// Threshold at which a video counts as watched (matches `WATCHED` in `crates/ffi/src/lib.rs`).
private let watchedThreshold = 0.92

/// A title page: vibrant top-trailing backdrop, logo/title, facts, credits and Play/Resume CTA; seasons and episodes for a show.
struct TitleView: View {
    let card: Card
    @EnvironmentObject private var library: Library
    @State private var title: Title?
    @State private var problem: String?
    @State private var season: UInt32?
    @State private var userPickedSeason = false
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
            .padding(.vertical, 24)
        }
        .background(alignment: .topTrailing) {
            backdrop
        }
        .task { await load() }
        .onAppear { reloadProgress() }
    }

    @ViewBuilder
    private var backdrop: some View {
        if let bg = (title?.card ?? card).background, !bg.isEmpty {
            Artwork(url: bg, label: "")
                .frame(width: 1380, height: 840)
                .mask {
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: .black.opacity(0.55), location: 0.28),
                            .init(color: .black, location: 0.52)
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .mask {
                        LinearGradient(
                            stops: [
                                .init(color: .black, location: 0),
                                .init(color: .black.opacity(0.75), location: 0.55),
                                .init(color: .clear, location: 1)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    }
                }
                .ignoresSafeArea()
        }
    }

    private var header: some View {
        let shown = title?.card ?? card
        return VStack(alignment: .leading, spacing: 20) {
            heading(of: shown)
            let factLine = facts(of: shown)
            if !factLine.isEmpty {
                Text(factLine).foregroundStyle(.secondary)
            }
            if let description = title?.description, !description.isEmpty {
                Text(description)
                    .frame(maxWidth: 1080, alignment: .leading)
                    .lineLimit(5)
            }
            if let title {
                credits(of: title, kind: shown.kind)
                if title.episodes.isEmpty {
                    NavigationLink(value: moviePlaying) {
                        Label(resumeLabel(for: progress[card.id]), systemImage: "play.fill")
                    }
                } else if let target = upNextTarget(in: title, progress: progress) {
                    NavigationLink(value: target.playing) {
                        Label(target.label, systemImage: "play.fill")
                    }
                }
            } else if problem == nil {
                ProgressView()
            }
        }
        .focusSection()
    }

    @ViewBuilder
    private func heading(of shown: Card) -> some View {
        if let logoURL = (shown.logo ?? card.logo).flatMap(URL.init(string:)) {
            AsyncImage(url: logoURL) { phase in
                if let image = phase.image {
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(maxWidth: 560, maxHeight: 160, alignment: .leading)
                        .shadow(color: .black.opacity(0.6), radius: 12, y: 2)
                        .accessibilityLabel(shown.name)
                } else if phase.error != nil {
                    Text(shown.name).font(.largeTitle).bold()
                } else {
                    Color.clear
                        .frame(height: 110)
                        .accessibilityLabel(shown.name)
                }
            }
        } else {
            Text(shown.name).font(.largeTitle).bold()
        }
    }

    @ViewBuilder
    private func credits(of title: Title, kind: String) -> some View {
        if !title.director.isEmpty || !title.cast.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                if !title.director.isEmpty {
                    let role = kind == "series" ? "Created by" : "Director"
                    Text("\(role): \(title.director.prefix(2).joined(separator: ", "))")
                }
                if !title.cast.isEmpty {
                    Text("Starring: \(title.cast.prefix(4).joined(separator: ", "))")
                }
            }
            .font(.callout)
            .foregroundStyle(.secondary)
        }
    }

    private var moviePlaying: Playing {
        Playing(card: title?.card ?? card, videoId: card.id, episode: nil, resumeAt: resumeAt(progress[card.id]))
    }

    @ViewBuilder
    private func episodes(of title: Title) -> some View {
        let seasons: [UInt32] = seasonNumbers(of: title)
        let activeSeason: UInt32? = upNextTarget(in: title, progress: progress)?.episode.season
        let shown: UInt32 = season ?? activeSeason ?? seasons.first ?? 1
        VStack(alignment: .leading, spacing: 24) {
            if seasons.count > 1 {
                SeasonPicker(seasons: seasons, shown: shown) { picked in
                    userPickedSeason = true
                    season = picked
                }
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
        let updated = Dictionary(core.progressFor(metaId: card.id).map { ($0.videoId, $0) }, uniquingKeysWith: { a, _ in a })
        progress = updated
        if !userPickedSeason, let title, let target = upNextTarget(in: title, progress: updated) {
            season = target.episode.season
        }
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

/// Primary Play / Resume target for a series, resolved from watch history (`upNext`).
struct SeriesTarget {
    let episode: Episode
    let playing: Playing
    let label: String
}

func upNextTarget(in title: Title, progress: [String: Resume]) -> SeriesTarget? {
    guard !title.episodes.isEmpty else { return nil }
    let regular = title.episodes.filter { $0.season > 0 }
    let candidates = regular.isEmpty ? title.episodes : regular
    let latestRegular = candidates.compactMap { progress[$0.id] }.max { $0.updatedAt < $1.updatedAt }
    let latestAny = title.episodes.compactMap { progress[$0.id] }.max { $0.updatedAt < $1.updatedAt }

    if let latestAny, !isWatched(latestAny), latestAny.position > 0,
       let current = title.episodes.first(where: { $0.id == latestAny.videoId }) {
        let playing = Playing(card: title.card, videoId: current.id, episode: current, resumeAt: latestAny.position)
        return SeriesTarget(episode: current, playing: playing, label: "Resume S\(current.season) E\(current.episode)")
    }

    if let latest = latestRegular ?? latestAny,
       let idx = candidates.firstIndex(where: { $0.id == latest.videoId }) {
        let after = candidates[(idx + 1)...].first { !isWatched(progress[$0.id]) && isEpisodeReleased($0) }
        if let next = after ?? candidates.first(where: { !isWatched(progress[$0.id]) && isEpisodeReleased($0) }) {
            let start = resumeAt(progress[next.id])
            let verb = start > 0 ? "Resume" : "Play"
            let playing = Playing(card: title.card, videoId: next.id, episode: next, resumeAt: start)
            return SeriesTarget(episode: next, playing: playing, label: "\(verb) S\(next.season) E\(next.episode)")
        }
    }

    guard let first = candidates.first(where: isEpisodeReleased) ?? candidates.first else { return nil }
    let start = resumeAt(progress[first.id])
    let label: String
    if start > 0 {
        label = "Resume S\(first.season) E\(first.episode)"
    } else if first.season == 1, first.episode == 1, latestAny == nil {
        label = "Play First Episode"
    } else {
        label = "Play S\(first.season) E\(first.episode)"
    }
    return SeriesTarget(
        episode: first,
        playing: Playing(card: title.card, videoId: first.id, episode: first, resumeAt: start),
        label: label
    )
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

/// Whether a video has reached the 92% watched threshold.
func isWatched(_ resume: Resume?) -> Bool {
    guard let resume, resume.duration > 0 else { return false }
    return resume.position / resume.duration >= watchedThreshold
}

/// Where to start a video again: from its progress, unless it was watched to the end.
func resumeAt(_ resume: Resume?) -> Double {
    guard let resume, resume.duration > 0, !isWatched(resume) else { return 0 }
    return resume.position
}

func resumeLabel(for resume: Resume?) -> String {
    resumeAt(resume) > 0 ? "Resume" : "Play"
}

private let releaseIsoFractionalFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

private let releaseIsoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

private let releaseLocalDayFormatter: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = .autoupdatingCurrent
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

private func parseReleaseDate(_ raw: String?) -> Date? {
    guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
    if let d = releaseIsoFractionalFormatter.date(from: raw) { return d }
    if let d = releaseIsoFormatter.date(from: raw) { return d }
    return releaseLocalDayFormatter.date(from: String(raw.prefix(10)))
}

private func isEpisodeReleased(_ episode: Episode) -> Bool {
    guard let date = parseReleaseDate(episode.released) else { return true }
    return date <= Date()
}

private func formattedRelease(_ raw: String?) -> String? {
    guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
    if let date = parseReleaseDate(raw) {
        return date.formatted(date: .abbreviated, time: .omitted)
    }
    return raw
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

/// One episode in a show's list, showing watched state (>= 92%), progress, and release date.
struct EpisodeRow: View {
    let episode: Episode
    let resume: Resume?

    var body: some View {
        let watched = isWatched(resume)
        HStack(alignment: .top, spacing: 28) {
            Artwork(url: episode.thumbnail, label: "\(episode.episode)")
                .frame(width: 320, height: 180)
                .overlay(alignment: .bottom) {
                    if let resume, resume.duration > 0, resume.position > 0, !watched {
                        ProgressView(value: min(resume.position / resume.duration, 1)).padding(12)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if watched {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(.white)
                            .padding(6)
                            .background(Circle().fill(.black.opacity(0.6)))
                            .padding(10)
                            .accessibilityLabel("Watched")
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 12) {
                    Text("\(episode.episode). \(episode.title)").font(.headline)
                    if let released = formattedRelease(episode.released) {
                        Text(released)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if let overview = episode.overview, !overview.isEmpty {
                    Text(overview).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(20)
    }
}
