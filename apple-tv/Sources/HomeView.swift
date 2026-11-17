import SwiftUI

/// Home: Continue Watching, then the core's rows, each a shelf the remote moves along.
struct HomeView: View {
    @EnvironmentObject private var library: Library

    var body: some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 48) {
                if !library.continueWatching.isEmpty {
                    Shelf(title: "Continue Watching") {
                        ForEach(library.continueWatching, id: \.videoId) { resume in
                            NavigationLink(value: resume.playing) {
                                ResumeCard(resume: resume)
                            }
                            .buttonStyle(.card)
                        }
                    }
                }
                ForEach(library.rows, id: \.key) { row in
                    Shelf(title: row.title) {
                        ForEach(row.cards, id: \.id) { card in
                            NavigationLink(value: card) {
                                PosterCard(card: card)
                            }
                            .buttonStyle(.card)
                        }
                    }
                }
                if library.rows.isEmpty {
                    if library.loading {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Notice(
                            title: "Nothing to show yet",
                            message: "Home's rows couldn't be loaded. Check the Apple TV's network connection."
                        )
                    }
                }
            }
            .padding(.vertical, 40)
        }
        .task { await library.loadHome() }
        .onAppear { library.refreshProgress() }
    }
}

/// A titled row of cards, scrolling sideways.
struct Shelf<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(title)
                .font(.title3)
                .bold()
                .padding(.horizontal, 80)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 40) {
                    content
                }
                .padding(.horizontal, 80)
                .padding(.vertical, 30)
            }
            .scrollClipDisabled()
        }
        .focusSection()
    }
}

/// A title's poster, with its name below.
struct PosterCard: View {
    let card: Card

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Artwork(url: card.poster, label: card.name)
                .frame(width: 240, height: 360)
            Text(card.name)
                .font(.caption)
                .lineLimit(1)
                .frame(width: 240, alignment: .leading)
        }
    }
}

/// A Continue Watching card: the backdrop, the title, how far along.
struct ResumeCard: View {
    let resume: Resume

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Artwork(url: resume.background ?? resume.poster, label: resume.name)
                .frame(width: 480, height: 270)
                .overlay(alignment: .bottom) {
                    ProgressView(value: resume.duration > 0 ? min(resume.position / resume.duration, 1) : 0)
                        .padding(16)
                }
            Text(resume.subtitle)
                .font(.caption)
                .lineLimit(1)
                .frame(width: 480, alignment: .leading)
        }
    }
}

extension Resume {
    /// "Name" for a movie, "Name · S1 E5" for an episode.
    var subtitle: String {
        guard let season, let episode else { return name }
        return "\(name) · S\(season) E\(episode)"
    }
}

/// A picture from the web, or the title's name on a plain card while there's none.
struct Artwork: View {
    let url: String?
    let label: String

    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { phase in
            if let image = phase.image {
                image.resizable().aspectRatio(contentMode: .fill)
            } else {
                ZStack {
                    Rectangle().fill(.quaternary)
                    Text(label)
                        .font(.caption)
                        .multilineTextAlignment(.center)
                        .padding()
                }
            }
        }
        .clipped()
    }
}
