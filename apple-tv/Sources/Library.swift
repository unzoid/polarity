import Foundation
import SwiftUI

/// What the app shows and keeps: one `Core` for the whole app, Home's rows and Continue Watching.
/// The add-ons and keys come from the signed-in profile (`Account`).
@MainActor
final class Library: ObservableObject {
    /// `nil` only when the core couldn't open its folder (`startProblem` says why).
    let core: Core?
    let startProblem: String?

    @Published private(set) var rows: [Row] = []
    @Published private(set) var continueWatching: [Resume] = []
    @Published private(set) var loading = false
    /// Counts Home's loads, so only the latest one's rows are kept.
    private var homeLoads = 0

    init() {
        do {
            core = try Core(dataDir: Library.dataDir().path)
            startProblem = nil
        } catch {
            core = nil
            startProblem = error.localizedDescription
        }
    }

    /// The app's own folder for its data: Application Support, made if it isn't there.
    private static func dataDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Polarity", isDirectory: true)
    }

    /// Loads Home's rows once; Continue Watching comes from the TV's own progress, at once.
    func loadHome() async {
        guard rows.isEmpty, !loading else { return }
        await reloadHome()
    }

    /// Loads Home's rows again, dropping an earlier load still under way (its rows came from the
    /// add-ons and keys before).
    func reloadHome() async {
        guard let core else { return }
        homeLoads += 1
        let load = homeLoads
        loading = true
        continueWatching = core.continueWatching()
        let fresh = await core.home()
        guard load == homeLoads else { return }
        rows = fresh
        loading = false
    }

    /// A profile's add-ons, TMDB key and language (`Account`), or none after signing out; then Home again.
    func useSettings(_ settings: AccountSettings) async {
        guard let core else { return }
        core.setTmdb(key: settings.tmdbKey, language: settings.language)
        _ = await core.setAddons(urls: settings.addons)
        await reloadHome()
    }

    /// Continue Watching again, after something played.
    func refreshProgress() {
        guard let core else { return }
        continueWatching = core.continueWatching()
    }
}

/// One video to find sources for and play: a movie, or one episode of a show.
struct Playing: Hashable {
    let card: Card
    /// The movie's id, or the episode's (`tt…:1:5`): what add-ons are asked for.
    let videoId: String
    let episode: Episode?
    /// Where to start, in seconds (from Continue Watching).
    let resumeAt: Double

    /// The progress entry for this video at `position` of `duration`.
    func resume(position: Double, duration: Double, streamJson: String) -> Resume {
        Resume(
            metaId: card.id,
            videoId: videoId,
            kind: card.kind,
            name: card.name,
            poster: card.poster,
            background: card.background,
            season: episode?.season,
            episode: episode?.episode,
            episodeTitle: episode?.title,
            position: position,
            duration: duration,
            streamJson: streamJson,
            updatedAt: 0
        )
    }
}

extension Resume {
    /// The title's card, as far as progress knows it.
    var card: Card {
        Card(
            id: metaId,
            kind: kind,
            name: name,
            poster: poster,
            background: background,
            logo: nil,
            releaseInfo: nil,
            rating: nil
        )
    }

    /// What to play to carry on.
    var playing: Playing {
        let ep = season.flatMap { s in
            episode.map { e in
                Episode(id: videoId, season: s, episode: e, title: episodeTitle ?? "", overview: nil, thumbnail: nil, released: nil)
            }
        }
        return Playing(card: card, videoId: videoId, episode: ep, resumeAt: position)
    }
}
