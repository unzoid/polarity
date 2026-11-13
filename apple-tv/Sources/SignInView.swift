import SwiftUI

/// Signing in: a code to approve on a phone or computer, in Settings → Account → Sign in a TV.
struct SignInView: View {
    @EnvironmentObject private var account: Account

    var body: some View {
        VStack(spacing: 40) {
            Text("Sign in to Polarity").font(.title2).bold()
            switch account.state {
            case let .waiting(code, expires):
                Text("On your phone or computer, open Polarity, go to Settings → Account → Sign in a TV, and enter this code:")
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 1100)
                Text(code)
                    .font(.system(size: 96, weight: .bold, design: .monospaced))
                    .accessibilityLabel(code.map(String.init).joined(separator: " "))
                Text("The code works until \(expires.formatted(date: .omitted, time: .shortened)).")
                    .foregroundStyle(.secondary)
                Button("Get a New Code") { account.signIn() }
            case .requesting:
                ProgressView()
                Text("Getting a code…").foregroundStyle(.secondary)
            default:
                Text("Your account brings your add-ons and keys to this Apple TV.")
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 1100)
                if case let .signedOut(problem?) = account.state {
                    Text(problem).foregroundStyle(.orange).multilineTextAlignment(.center).frame(maxWidth: 1100)
                }
                Button("Sign In with a Code") { account.signIn() }
            }
            Button("Not Now") { account.skip() }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
        }
        .padding(80)
        .focusSection()
    }
}

/// Who's watching: one card per profile.
struct ProfilesView: View {
    let profiles: [Profile]
    @EnvironmentObject private var account: Account

    var body: some View {
        VStack(spacing: 60) {
            Text("Who's watching?").font(.title2).bold()
            HStack(spacing: 60) {
                ForEach(profiles) { profile in
                    Button {
                        Task { await account.choose(profile) }
                    } label: {
                        VStack(spacing: 20) {
                            Text(profile.name.prefix(1).uppercased())
                                .font(.system(size: 80, weight: .semibold))
                                .frame(width: 200, height: 200)
                                .background(Circle().fill(.quaternary))
                            Text(profile.name).font(.headline).lineLimit(1).frame(maxWidth: 260)
                        }
                        .padding(20)
                    }
                    .buttonStyle(.card)
                }
            }
            .focusSection()
        }
        .padding(80)
    }
}

/// Account, from Home: who's watching, what didn't come across, switching and signing out.
struct AccountView: View {
    @EnvironmentObject private var account: Account

    var body: some View {
        List {
            switch account.state {
            case let .watching(profile?):
                Section {
                    Text("Watching as \(profile.name)")
                    if let notice = account.notice {
                        Text(notice).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section {
                    Button("Switch Profile") { Task { await account.switchProfile() } }
                    Button("Sign Out of This Apple TV", role: .destructive) { Task { await account.signOut() } }
                }
            case .unavailable:
                Text("This build of Polarity has no account server, so it can't sign in. Home shows the standard rows.")
            default:
                if let notice = account.notice {
                    Text(notice).font(.caption).foregroundStyle(.secondary)
                }
                if account.signedIn {
                    Button("Switch Profile") { Task { await account.switchProfile() } }
                    Button("Sign Out of This Apple TV", role: .destructive) { Task { await account.signOut() } }
                } else {
                    Button("Sign In") { account.showSignIn() }
                }
            }
        }
        .padding(.horizontal, 80)
        .navigationTitle("Account")
    }
}
