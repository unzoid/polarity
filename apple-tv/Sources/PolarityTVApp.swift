import SwiftUI

/// Polarity for Apple TV: a native app on the shared core (`crates/ffi`, through `PolarCore.swift`).
@main
struct PolarityTVApp: App {
    @StateObject private var library: Library
    @StateObject private var account: Account

    init() {
        let library = Library()
        _library = StateObject(wrappedValue: library)
        _account = StateObject(wrappedValue: Account(library: library))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
                .environmentObject(account)
        }
    }
}

/// Sign-in and Who's watching first; then Home, and every page opened from it, on one navigation
/// stack: Menu on the remote goes back.
struct RootView: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var account: Account

    var body: some View {
        Group {
            if let problem = library.startProblem {
                Notice(title: "Polarity can't start", message: problem)
            } else {
                switch account.state {
                case .starting:
                    ProgressView()
                case .signedOut, .requesting, .waiting:
                    SignInView()
                case let .choosing(profiles):
                    ProfilesView(profiles: profiles)
                case .watching, .unavailable:
                    NavigationStack {
                        HomeView()
                            .navigationDestination(for: Card.self) { card in
                                TitleView(card: card)
                            }
                            .navigationDestination(for: Playing.self) { playing in
                                SourcesView(playing: playing)
                            }
                            .navigationDestination(for: AccountPage.self) { _ in
                                AccountView()
                            }
                            .navigationDestination(for: LicencesPage.self) { _ in
                                LicencesView()
                            }
                    }
                }
            }
        }
        .task { await account.start() }
    }
}

/// Home's link to the Account page.
struct AccountPage: Hashable {}

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
