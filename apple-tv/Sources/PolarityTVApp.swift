import SwiftUI

/// Polarity for Apple TV: a native app on the shared core (`crates/ffi`, through `PolarCore.swift`).
@main
struct PolarityTVApp: App {
    @StateObject private var library = Library()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
        }
    }
}

/// Home, and every page opened from it, on one navigation stack: Menu on the remote goes back.
struct RootView: View {
    @EnvironmentObject private var library: Library

    var body: some View {
        NavigationStack {
            Group {
                if let problem = library.startProblem {
                    Notice(title: "Polarity can't start", message: problem)
                } else {
                    HomeView()
                }
            }
            .navigationDestination(for: Card.self) { card in
                TitleView(card: card)
            }
            .navigationDestination(for: Playing.self) { playing in
                SourcesView(playing: playing)
            }
        }
    }
}

/// A full-screen message.
struct Notice: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 24) {
            Text(title).font(.title2).bold()
            Text(message)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 1100)
        }
        .padding(80)
    }
}
