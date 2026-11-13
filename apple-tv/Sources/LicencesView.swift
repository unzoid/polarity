import SwiftUI

/// Account's link to the licences of the libraries in the app.
struct LicencesPage: Hashable {}

/// The licence texts that come with the app: libmpv's and its libraries' (`licenses/`, written by
/// scripts/ios-mpv.sh; BUNDLED.txt first, naming each library's version and where its sources are)
/// and the Swift packages' (`Notices/`, PACKAGES.txt first).
struct LicencesView: View {
    private let player: [URL] = LicencesView.files(in: "licenses", first: "BUNDLED.txt")
    private let packages: [URL] = LicencesView.files(in: "Notices", first: "PACKAGES.txt")

    var body: some View {
        List {
            Section("Player: libmpv and FFmpeg") {
                if player.isEmpty {
                    Text("This build carries no player licences: it was built without Vendor/.").foregroundStyle(.secondary)
                }
                ForEach(player, id: \.self) { file in link(file) }
            }
            Section("Swift packages") {
                ForEach(packages, id: \.self) { file in link(file) }
            }
        }
        .padding(.horizontal, 80)
        .navigationTitle("Licences")
        .navigationDestination(for: URL.self) { file in
            LicenceText(file: file)
        }
    }

    private func link(_ file: URL) -> some View {
        NavigationLink(value: file) {
            Text(file.deletingPathExtension().lastPathComponent)
        }
    }

    /// The files in one of the app's folders, `first` before the others.
    private static func files(in folder: String, first: String) -> [URL] {
        guard let url = Bundle.main.url(forResource: folder, withExtension: nil),
              let found = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)
        else { return [] }
        return found.sorted { (a: URL, b: URL) -> Bool in
            let aFirst: Bool = a.lastPathComponent == first
            let bFirst: Bool = b.lastPathComponent == first
            if aFirst != bFirst { return aFirst }
            return a.lastPathComponent.localizedStandardCompare(b.lastPathComponent) == .orderedAscending
        }
    }
}

/// One licence text. Each paragraph takes focus, so the remote scrolls through it.
private struct LicenceText: View {
    let file: URL

    var body: some View {
        let text = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
        let paragraphs: [String] = text.components(separatedBy: "\n\n").filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                ForEach(paragraphs.indices, id: \.self) { i in
                    Text(paragraphs[i])
                        .font(.caption)
                        .frame(maxWidth: 1400, alignment: .leading)
                        .focusable()
                }
            }
            .padding(80)
        }
        .navigationTitle(file.lastPathComponent)
    }
}
