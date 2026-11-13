import AVFoundation
import Foundation
import Libmpv

/// One audio or subtitle track of what's playing, as mpv lists it.
struct Track: Identifiable, Hashable {
    let id: Int64
    /// "audio" or "sub".
    let kind: String
    let label: String
    let selected: Bool
}

/// libmpv in the app: one player for one source. mpv runs on its own threads; its events are read
/// on `events` and reach the published state on the main thread. Drawing is `MpvVideoView`'s.
///
/// `close()` must be called when the screen goes: it frees the render context before the core,
/// as mpv requires.
@MainActor
final class MpvPlayer: ObservableObject {
    @Published private(set) var position: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var paused = false
    /// Not drawing new frames yet, or waiting for the network.
    @Published private(set) var buffering = true
    @Published private(set) var tracks: [Track] = []
    /// Why it stopped, when it couldn't play.
    @Published private(set) var problem: String?
    /// Played to the end.
    @Published private(set) var ended = false

    /// What mpv draws into; `nil` when mpv couldn't start (`problem` says why).
    private(set) var video: MpvVideoView?

    private var handle: OpaquePointer?
    private var pump: Unmanaged<EventPump>?
    private var loaded = false
    private var waitingForCache = false

    /// Starts mpv with the core's options and the source's headers, and opens `url` at `start` seconds.
    init(url: String, headers: [String], start: Double) {
        // Sound plays as a film's does, over other apps' audio.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback)
        try? session.setActive(true)

        guard let h = mpv_create() else {
            problem = "The player couldn't start (mpv_create failed)."
            return
        }
        for option in playerOptions() {
            let r = mpv_set_option_string(h, option.name, option.value)
            if r < 0 { NSLog("polar: mpv option %@: %@", option.name, String(cString: mpv_error_string(r))) }
        }
        if !headers.isEmpty { MpvPlayer.setList(h, "http-header-fields", headers) }
        if start > 0 { mpv_set_option_string(h, "start", String(format: "%.3f", start)) }
        let r = mpv_initialize(h)
        if r < 0 {
            problem = "The player couldn't start: \(String(cString: mpv_error_string(r)))."
            mpv_terminate_destroy(h)
            return
        }
        handle = h
        mpv_observe_property(h, 0, "time-pos", MPV_FORMAT_DOUBLE)
        mpv_observe_property(h, 0, "duration", MPV_FORMAT_DOUBLE)
        mpv_observe_property(h, 0, "pause", MPV_FORMAT_FLAG)
        mpv_observe_property(h, 0, "paused-for-cache", MPV_FORMAT_FLAG)
        // A node property read as a string comes as JSON.
        mpv_observe_property(h, 0, "track-list", MPV_FORMAT_STRING)

        let pump = EventPump(handle: h) { [weak self] events in self?.apply(events) }
        let retained = Unmanaged.passRetained(pump)
        self.pump = retained
        mpv_set_wakeup_callback(h, { ctx in
            guard let ctx else { return }
            Unmanaged<EventPump>.fromOpaque(ctx).takeUnretainedValue().wake()
        }, retained.toOpaque())

        do {
            video = try MpvVideoView(handle: h)
        } catch {
            problem = "The player couldn't draw: \(error.localizedDescription)"
            return
        }
        command(["loadfile", url, "replace"])
    }

    // MARK: Controls

    func togglePause() { command(["cycle", "pause"]) }

    func pause() { command(["set", "pause", "yes"]) }

    /// Moves by `seconds` (back when negative), to the nearest keyframe.
    func seek(by seconds: Double) {
        command(["seek", String(format: "%.0f", seconds), "relative"])
    }

    /// Chooses an audio or subtitle track; `nil` turns subtitles off.
    func choose(_ track: Track?, kind: String) {
        let property = kind == "audio" ? "aid" : "sid"
        command(["set", property, track.map { String($0.id) } ?? "no"])
    }

    /// Stops drawing, frees the render context, then the core (off the main thread: terminating
    /// waits for mpv's threads).
    func close() {
        guard let h = handle else { return }
        handle = nil
        video?.invalidate()
        mpv_set_wakeup_callback(h, nil, nil)
        let pump = self.pump
        self.pump = nil
        DispatchQueue.global(qos: .utility).async {
            pump?.takeUnretainedValue().stop()
            mpv_terminate_destroy(h)
            pump?.release()
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: mpv

    /// Runs an mpv command without waiting for it.
    private func command(_ args: [String]) {
        guard let h = handle else { return }
        let strings = args.map { strdup($0) }
        defer { strings.forEach { free($0) } }
        var pointers: [UnsafePointer<CChar>?] = strings.map { UnsafePointer($0) }
        pointers.append(nil)
        let r = mpv_command_async(h, 0, &pointers)
        if r < 0 { NSLog("polar: mpv %@: %@", args.first ?? "", String(cString: mpv_error_string(r))) }
    }

    /// Sets a list option as a list (`MPV_FORMAT_NODE_ARRAY`): a value may hold a comma, which
    /// mpv's string form would split on.
    private static func setList(_ h: OpaquePointer, _ name: String, _ values: [String]) {
        let strings = values.map { strdup($0) }
        defer { strings.forEach { free($0) } }
        var items: [mpv_node] = strings.map { s in
            var node = mpv_node()
            node.format = MPV_FORMAT_STRING
            node.u.string = s
            return node
        }
        let r: Int32 = items.withUnsafeMutableBufferPointer { buffer in
            var list = mpv_node_list(num: Int32(buffer.count), values: buffer.baseAddress, keys: nil)
            return withUnsafeMutablePointer(to: &list) { listPointer in
                var node = mpv_node()
                node.format = MPV_FORMAT_NODE_ARRAY
                node.u.list = listPointer
                return mpv_set_option(h, name, MPV_FORMAT_NODE, &node)
            }
        }
        if r < 0 { NSLog("polar: mpv option %@: %@", name, String(cString: mpv_error_string(r))) }
    }

    private func apply(_ events: [PlayerEvent]) {
        for event in events {
            switch event {
            case let .position(value): position = value
            case let .duration(value): duration = value
            case let .paused(value): paused = value
            case let .waitingForCache(value):
                waitingForCache = value
                buffering = !loaded || value
            case .loaded:
                loaded = true
                buffering = waitingForCache
            case let .tracks(json): tracks = MpvPlayer.tracks(fromJSON: json)
            case .ended: ended = true
            case let .failed(reason): problem = reason
            }
        }
    }

    /// The audio and subtitle tracks in mpv's `track-list`.
    static func tracks(fromJSON json: String) -> [Track] {
        guard let data = json.data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return list.compactMap { item -> Track? in
            guard let kind = item["type"] as? String, kind == "audio" || kind == "sub",
                  let id = (item["id"] as? NSNumber)?.int64Value
            else { return nil }
            var parts: [String] = []
            if let title = item["title"] as? String, !title.isEmpty { parts.append(title) }
            if let lang = item["lang"] as? String, !lang.isEmpty { parts.append(lang.uppercased()) }
            if let codec = item["codec"] as? String, !codec.isEmpty { parts.append(codec) }
            let label = parts.isEmpty ? "Track \(id)" : parts.joined(separator: " · ")
            return Track(id: id, kind: kind, label: label, selected: (item["selected"] as? Bool) ?? false)
        }
    }
}

/// What the player's state takes from mpv's events.
enum PlayerEvent {
    case position(Double)
    case duration(Double)
    case paused(Bool)
    case waitingForCache(Bool)
    case loaded
    case tracks(String)
    case ended
    case failed(String)
}

/// Reads mpv's events on a queue of its own when mpv says there are some, and hands them to the
/// main thread in batches.
final class EventPump: @unchecked Sendable {
    private let handle: OpaquePointer
    private let queue = DispatchQueue(label: "polarity.mpv-events")
    private let deliver: @MainActor ([PlayerEvent]) -> Void
    private var stopped = false // on `queue` only

    init(handle: OpaquePointer, deliver: @escaping @MainActor ([PlayerEvent]) -> Void) {
        self.handle = handle
        self.deliver = deliver
    }

    /// From any of mpv's threads.
    func wake() {
        queue.async { self.drain() }
    }

    /// No event is read after this returns.
    func stop() {
        queue.sync { stopped = true }
    }

    private func drain() {
        guard !stopped else { return }
        var events: [PlayerEvent] = []
        while let event = mpv_wait_event(handle, 0), event.pointee.event_id != MPV_EVENT_NONE {
            if let converted = EventPump.convert(event.pointee) { events.append(converted) }
        }
        guard !events.isEmpty else { return }
        let deliver = self.deliver
        DispatchQueue.main.async { MainActor.assumeIsolated { deliver(events) } }
    }

    private static func convert(_ event: mpv_event) -> PlayerEvent? {
        switch event.event_id {
        case MPV_EVENT_FILE_LOADED:
            return .loaded
        case MPV_EVENT_END_FILE:
            guard let end = event.data?.assumingMemoryBound(to: mpv_event_end_file.self).pointee else { return nil }
            if end.reason == MPV_END_FILE_REASON_EOF { return .ended }
            if end.reason == MPV_END_FILE_REASON_ERROR {
                return .failed("The source couldn't be played: \(String(cString: mpv_error_string(end.error))).")
            }
            return nil
        case MPV_EVENT_PROPERTY_CHANGE:
            guard let property = event.data?.assumingMemoryBound(to: mpv_event_property.self).pointee,
                  let data = property.data
            else { return nil }
            let name = String(cString: property.name)
            switch (name, property.format) {
            case ("time-pos", MPV_FORMAT_DOUBLE):
                return .position(data.load(as: Double.self))
            case ("duration", MPV_FORMAT_DOUBLE):
                return .duration(data.load(as: Double.self))
            case ("pause", MPV_FORMAT_FLAG):
                return .paused(data.load(as: Int32.self) != 0)
            case ("paused-for-cache", MPV_FORMAT_FLAG):
                return .waitingForCache(data.load(as: Int32.self) != 0)
            case ("track-list", MPV_FORMAT_STRING):
                guard let string = data.load(as: UnsafePointer<CChar>?.self) else { return nil }
                return .tracks(String(cString: string))
            default:
                return nil
            }
        default:
            return nil
        }
    }
}
