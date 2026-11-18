import Foundation
import Supabase

/// The account on this Apple TV: signing in with a code approved on a phone or computer ("Sign in a
/// TV", #133: supabase/functions/tv-sign-in), who's watching, and what that profile's settings give
/// the core (its add-ons, TMDB key and language). The session stays in the keychain, where
/// supabase-swift keeps it; the TV gets one of its own, so signing out here leaves the other device
/// signed in.
@MainActor
final class Account: ObservableObject {
    enum State: Equatable {
        /// This build has no account server (`PolaritySupabaseURL` empty): Home with the index's rows.
        case unavailable
        /// Reading the kept session.
        case starting
        /// Not signed in; `problem` says why the last try didn't work.
        case signedOut(problem: String?)
        /// Asking the server for a code.
        case requesting
        /// Showing `code` until it's approved on another device or `expires`.
        case waiting(code: String, expires: Date)
        /// Signed in, with more than one profile to pick from.
        case choosing([Profile])
        /// Signed in, or not signing in at all (`profile` nil): Home.
        case watching(Profile?)
    }

    @Published private(set) var state: State = .starting
    /// A profile's settings the TV can't use, said once Home shows (sealed keys, no add-ons).
    @Published private(set) var notice: String?

    private let client: SupabaseClient?
    private let library: Library
    private var waiting: Task<Void, Never>?

    /// How often the TV asks whether its code was approved (`TV_POLL_MS` in src/lib/account/tvSignIn.ts).
    private static let poll: Duration = .seconds(3)
    private static let profileKey = "polar.profile"
    private static let skippedKey = "polar.signInSkipped"

    init(library: Library) {
        self.library = library
        client = Account.makeClient()
    }

    /// The account server this build was made for (Info.plist, from the build settings
    /// `POLAR_SUPABASE_URL` and `POLAR_SUPABASE_KEY`), or nil when it names none.
    private static func makeClient() -> SupabaseClient? {
        let info = Bundle.main.infoDictionary ?? [:]
        let url = (info["PolaritySupabaseURL"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        let key = (info["PolaritySupabaseKey"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        guard !key.isEmpty, let server = URL(string: url), server.scheme == "https" else { return nil }
        return SupabaseClient(
            supabaseURL: server,
            supabaseKey: key,
            options: SupabaseClientOptions(auth: .init(emitLocalSessionAsInitialSession: true))
        )
    }

    /// Whether a session is kept on this Apple TV (it may still have ended on the server).
    var signedIn: Bool { client?.auth.currentSession != nil }

    /// At launch: the kept session and profile, else the sign-in screen (unless it was skipped before).
    func start() async {
        guard state == .starting else { return }
        guard let client else {
            state = .unavailable
            return
        }
        if client.auth.currentSession != nil {
            await loadProfiles()
        } else if UserDefaults.standard.bool(forKey: Account.skippedKey) {
            state = .watching(nil)
        } else {
            state = .signedOut(problem: nil)
        }
    }

    /// Asks the server for a code and waits for it to be approved on another device.
    func signIn() {
        guard client != nil else { return }
        waiting?.cancel()
        state = .requesting
        waiting = Task { await self.requestAndWait() }
    }

    /// Home without an account: the index's rows, no add-ons. Remembered until the next sign-in.
    func skip() {
        waiting?.cancel()
        UserDefaults.standard.set(true, forKey: Account.skippedKey)
        state = .watching(nil)
    }

    /// Back to the sign-in screen from Home (after skipping it).
    func showSignIn() {
        state = .signedOut(problem: nil)
    }

    /// Who's watching again, from Home.
    func switchProfile() async {
        UserDefaults.standard.removeObject(forKey: Account.profileKey)
        await loadProfiles(pickSaved: false)
    }

    func choose(_ profile: Profile) async {
        UserDefaults.standard.set(profile.id, forKey: Account.profileKey)
        state = .watching(profile)
        await applySettings(of: profile)
    }

    /// Signs this Apple TV out (only this one) and forgets its profile, add-ons and key.
    func signOut() async {
        waiting?.cancel()
        try? await client?.auth.signOut(scope: .local)
        UserDefaults.standard.removeObject(forKey: Account.profileKey)
        UserDefaults.standard.removeObject(forKey: Account.skippedKey)
        notice = nil
        state = .signedOut(problem: nil)
        await library.useSettings(AccountSettings(addons: [], tmdbKey: nil, language: nil, sealed: false))
    }

    // MARK: - Signing in

    private struct StartAnswer: Decodable {
        let code: String
        let poll: String
        let expiresIn: Double
    }

    private struct ClaimAnswer: Decodable {
        let state: String
        let tokenHash: String?
    }

    private func requestAndWait() async {
        guard let client else { return }
        let started: StartAnswer
        do {
            // What the other device asks: "Sign in on Apple TV?". The kind of device, never a name.
            started = try await client.functions.invoke(
                "tv-sign-in",
                options: FunctionInvokeOptions(body: ["action": "start", "device": "Apple TV"])
            )
        } catch {
            if !Task.isCancelled { state = .signedOut(problem: Account.describe(error)) }
            return
        }
        // Counted on this clock: the server says how long, not until when.
        let expires = Date().addingTimeInterval(started.expiresIn)
        state = .waiting(code: Account.format(started.code), expires: expires)

        while !Task.isCancelled {
            try? await Task.sleep(for: Account.poll)
            if Task.isCancelled { return }
            // A little after the expiry: the server's clock decides, and it says "expired" itself.
            if Date() > expires.addingTimeInterval(6) {
                state = .signedOut(problem: "The code expired. Get a new one to try again.")
                return
            }
            // A failed ask (offline for a moment) is just tried again.
            guard let answer: ClaimAnswer = try? await client.functions.invoke(
                "tv-sign-in",
                options: FunctionInvokeOptions(body: ["action": "claim", "poll": started.poll])
            ) else { continue }
            if Task.isCancelled { return }
            switch answer.state {
            case "pending":
                continue
            case "approved":
                guard let tokenHash = answer.tokenHash else { break }
                do {
                    _ = try await client.auth.verifyOTP(tokenHash: tokenHash, type: .magiclink)
                    UserDefaults.standard.removeObject(forKey: Account.skippedKey)
                    await loadProfiles()
                } catch {
                    state = .signedOut(problem: Account.describe(error))
                }
                return
            case "denied":
                state = .signedOut(problem: "The sign-in was declined on the other device.")
                return
            default:
                break
            }
            state = .signedOut(problem: "The code expired. Get a new one to try again.")
            return
        }
    }

    // MARK: - Profiles and settings

    /// The account's profiles: the kept one, the only one, or Who's watching.
    private func loadProfiles(pickSaved: Bool = true) async {
        guard let client else { return }
        let profiles: [Profile]
        do {
            profiles = try await client.from("profiles")
                .select("id, name, avatar")
                .order("position")
                .order("created_at")
                .execute()
                .value
        } catch {
            if client.auth.currentSession == nil {
                state = .signedOut(problem: "Your sign-in on this Apple TV has ended. Sign in again.")
            } else {
                // Offline at launch: Home works without the account, which is tried again next time.
                state = .watching(nil)
                notice = "Your account couldn't be reached, so your add-ons aren't here this time. \(Account.describe(error))"
            }
            return
        }
        let saved = UserDefaults.standard.string(forKey: Account.profileKey)
        if pickSaved, let kept = profiles.first(where: { $0.id == saved }) {
            await choose(kept)
        } else if profiles.count == 1 {
            await choose(profiles[0])
        } else if profiles.isEmpty {
            state = .watching(nil)
            notice = "This account has no profiles yet. Make one on another device, then pick it here from Account."
        } else {
            state = .choosing(profiles)
        }
    }

    /// The profile's add-ons, TMDB key and language, read by the core from its settings document.
    private func applySettings(of profile: Profile) async {
        guard let client else { return }
        let settings: AccountSettings
        do {
            let answer = try await client.from("profile_settings")
                .select("data")
                .eq("profile_id", value: profile.id)
                .limit(1)
                .execute()
            settings = accountSettings(answer: String(decoding: answer.data, as: UTF8.self))
        } catch {
            notice = "This profile's settings couldn't be read, so its add-ons aren't here this time. \(Account.describe(error))"
            return
        }
        if settings.sealed {
            notice = "This profile's add-ons and keys are sealed with a passphrase, which the Apple TV can't open yet. Home shows the standard rows until then."
        } else if settings.addons.isEmpty {
            notice = "This profile has no add-ons, so there are no sources to play. Add-ons are added on another device, in Settings → Add-ons."
        } else {
            notice = nil
        }
        await library.useSettings(settings)
    }

    // MARK: - Words

    /// "ABCD-EFGH", as the other device's field formats it.
    static func format(_ code: String) -> String {
        code.count > 4 ? "\(code.prefix(4))-\(code.dropFirst(4))" : code
    }

    /// What a failed call means for the user (as `tvSignInError` in src/lib/account/supabase.ts).
    static func describe(_ error: Error) -> String {
        if let error = error as? FunctionsError {
            switch error {
            case .relayError:
                return "Can't reach the server. Check the Apple TV's network connection."
            case let .httpError(code, data):
                let answer = try? JSONDecoder().decode([String: String].self, from: data)
                switch answer?["error"] ?? "" {
                case "rate_limited": return "Too many attempts. Try again in a few minutes."
                case "invalid_code": return "That code is wrong or has expired."
                // No answer of the function's own: it isn't deployed on this server.
                case "" where code == 404: return "Signing in with a code isn't set up on this account server yet."
                default: return "Something went wrong. Try again."
                }
            }
        }
        if error is URLError {
            return "Can't reach the server. Check the Apple TV's network connection."
        }
        if error is AuthError {
            return "The sign-in didn't go through. Get a new code to try again."
        }
        return "Something went wrong. Try again."
    }
}

/// One of the account's profiles (the `profiles` table).
struct Profile: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    /// The other apps' avatar id (src/lib/account/avatars.ts); the TV shows the name's first letter for now.
    let avatar: String?
}
