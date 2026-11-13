import Foundation
import Libmpv
import OpenGLES
import QuartzCore
import SwiftUI
import UIKit

/// The view mpv draws into, through its render API with OpenGL ES (deprecated on tvOS, still what
/// libmpv's render API offers there), as the iPhone app's `ios/mpv_view.m` does.
///
/// A display link on the main thread asks for a frame each screen refresh; drawing runs on a
/// serial queue of its own with the GL context current there. tvOS ends apps that use OpenGL ES in
/// the background, so drawing stops before the app goes there and starts again when it comes back.
final class MpvVideoView: UIView {
    override class var layerClass: AnyClass { CAEAGLLayer.self }

    private let renderer: MpvRenderer
    private var link: CADisplayLink?

    init(handle: OpaquePointer) throws {
        renderer = try MpvRenderer(handle: handle)
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        isOpaque = true
        backgroundColor = .black
        contentScaleFactor = UIScreen.main.nativeScale
        let layer = self.layer as! CAEAGLLayer
        layer.isOpaque = true
        layer.drawableProperties = [
            kEAGLDrawablePropertyRetainedBacking: false,
            kEAGLDrawablePropertyColorFormat: kEAGLColorFormatRGBA8,
        ]
        renderer.setActive(UIApplication.shared.applicationState != .background)

        let tick = Tick(view: self)
        let link = CADisplayLink(target: tick, selector: #selector(Tick.tick))
        link.add(to: .main, forMode: .common)
        self.link = link
        let centre = NotificationCenter.default
        centre.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        centre.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a storyboard") }

    override func layoutSubviews() {
        super.layoutSubviews()
        renderer.resized()
    }

    @objc private func didEnterBackground() { renderer.setActive(false) }

    @objc private func willEnterForeground() { renderer.setActive(true) }

    /// Each screen refresh, on the main thread.
    fileprivate func tick() {
        guard window != nil else { return }
        renderer.drawIfNeeded(on: layer as! CAEAGLLayer)
    }

    /// Stops drawing and frees the render context. On the main thread, before the core goes.
    func invalidate() {
        link?.invalidate()
        link = nil
        NotificationCenter.default.removeObserver(self)
        renderer.free()
    }
}

/// mpv's render context and the GL state it draws with, used on a serial queue of its own.
private final class MpvRenderer: @unchecked Sendable {
    enum Failure: LocalizedError {
        case context
        case render(String)

        var errorDescription: String? {
            switch self {
            case .context: return "no OpenGL ES context"
            case let .render(reason): return reason
            }
        }
    }

    private let context: EAGLContext
    private let queue = DispatchQueue(label: "polarity.mpv-draw")
    private let flags = DrawFlags()
    private var flagsRef: Unmanaged<DrawFlags>?
    private var render: OpaquePointer? // `queue` only, after init
    private var framebuffer: GLuint = 0, colour: GLuint = 0 // `queue` only
    private var width: GLint = 0, height: GLint = 0 // `queue` only

    init(handle: OpaquePointer) throws {
        guard let context = EAGLContext(api: .openGLES3) else { throw Failure.context }
        self.context = context
        let previous = EAGLContext.current()
        EAGLContext.setCurrent(context)
        var made: OpaquePointer?
        let r: Int32 = "opengl".withCString { api in
            var gl = mpv_opengl_init_params(get_proc_address: glProcAddress, get_proc_address_ctx: nil)
            return withUnsafeMutablePointer(to: &gl) { glPointer in
                var params = [
                    mpv_render_param(type: MPV_RENDER_PARAM_API_TYPE, data: UnsafeMutableRawPointer(mutating: api)),
                    mpv_render_param(type: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, data: UnsafeMutableRawPointer(glPointer)),
                    mpv_render_param(type: MPV_RENDER_PARAM_INVALID, data: nil),
                ]
                return mpv_render_context_create(&made, handle, &params)
            }
        }
        EAGLContext.setCurrent(previous)
        guard r >= 0, let made else { throw Failure.render(String(cString: mpv_error_string(r))) }
        render = made
        let retained = Unmanaged.passRetained(flags)
        flagsRef = retained
        mpv_render_context_set_update_callback(made, { ctx in
            guard let ctx else { return }
            Unmanaged<DrawFlags>.fromOpaque(ctx).takeUnretainedValue().frame = true
        }, retained.toOpaque())
        flags.resize = true
        flags.redraw = true
    }

    func resized() {
        flags.resize = true
        flags.redraw = true
    }

    /// Off: no GL call may follow, so this waits for a draw in flight. On: the last frame again.
    func setActive(_ active: Bool) {
        flags.active = active
        if active {
            flags.redraw = true
            return
        }
        queue.sync {
            EAGLContext.setCurrent(context)
            glFinish()
            EAGLContext.setCurrent(nil)
        }
    }

    /// Queues a draw when there's something new and none is queued.
    func drawIfNeeded(on layer: CAEAGLLayer) {
        guard flags.active, flags.frame || flags.redraw, flags.startDrawing() else { return }
        queue.async {
            self.draw(on: layer)
            self.flags.drawing = false
        }
    }

    /// (Re)makes the framebuffer at the layer's current size. On `queue`, context current.
    private func makeBuffers(on layer: CAEAGLLayer) {
        if framebuffer == 0 {
            glGenFramebuffers(1, &framebuffer)
            glGenRenderbuffers(1, &colour)
        }
        glBindFramebuffer(GLenum(GL_FRAMEBUFFER), framebuffer)
        glBindRenderbuffer(GLenum(GL_RENDERBUFFER), colour)
        context.renderbufferStorage(Int(GL_RENDERBUFFER), from: layer)
        glFramebufferRenderbuffer(GLenum(GL_FRAMEBUFFER), GLenum(GL_COLOR_ATTACHMENT0), GLenum(GL_RENDERBUFFER), colour)
        glGetRenderbufferParameteriv(GLenum(GL_RENDERBUFFER), GLenum(GL_RENDERBUFFER_WIDTH), &width)
        glGetRenderbufferParameteriv(GLenum(GL_RENDERBUFFER), GLenum(GL_RENDERBUFFER_HEIGHT), &height)
        if glCheckFramebufferStatus(GLenum(GL_FRAMEBUFFER)) != GLenum(GL_FRAMEBUFFER_COMPLETE) {
            width = 0
            height = 0
        }
    }

    private func draw(on layer: CAEAGLLayer) {
        guard flags.active, let render else { return }
        EAGLContext.setCurrent(context)
        defer { EAGLContext.setCurrent(nil) }
        if flags.takeResize() { makeBuffers(on: layer) }
        flags.frame = false
        flags.redraw = false
        guard width > 0, height > 0 else { return }
        mpv_render_context_update(render)
        glBindFramebuffer(GLenum(GL_FRAMEBUFFER), framebuffer)
        var target = mpv_opengl_fbo(fbo: Int32(framebuffer), w: width, h: height, internal_format: 0)
        var flip: Int32 = 1
        let r: Int32 = withUnsafeMutablePointer(to: &target) { targetPointer in
            withUnsafeMutablePointer(to: &flip) { flipPointer in
                var params = [
                    mpv_render_param(type: MPV_RENDER_PARAM_OPENGL_FBO, data: UnsafeMutableRawPointer(targetPointer)),
                    mpv_render_param(type: MPV_RENDER_PARAM_FLIP_Y, data: UnsafeMutableRawPointer(flipPointer)),
                    mpv_render_param(type: MPV_RENDER_PARAM_INVALID, data: nil),
                ]
                return mpv_render_context_render(render, &params)
            }
        }
        // A frame mpv couldn't draw shows black, never what the buffer held before.
        if r < 0 {
            glClearColor(0, 0, 0, 1)
            glClear(GLbitfield(GL_COLOR_BUFFER_BIT))
        }
        glBindRenderbuffer(GLenum(GL_RENDERBUFFER), colour)
        context.presentRenderbuffer(Int(GL_RENDERBUFFER))
        mpv_render_context_report_swap(render)
    }

    /// Frees the render context with its GL context current, as mpv requires.
    func free() {
        flags.active = false
        queue.sync {
            EAGLContext.setCurrent(context)
            if let render {
                mpv_render_context_free(render)
                self.render = nil
            }
            if framebuffer != 0 {
                glDeleteFramebuffers(1, &framebuffer)
                glDeleteRenderbuffers(1, &colour)
                framebuffer = 0
                colour = 0
            }
            glFinish()
            EAGLContext.setCurrent(nil)
        }
        flagsRef?.release()
        flagsRef = nil
    }
}

/// What the main thread, the draw queue and mpv's update callback tell each other.
private final class DrawFlags: @unchecked Sendable {
    private let lock = NSLock()
    private var _frame = false, _redraw = false, _resize = false, _drawing = false, _active = false

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    /// mpv has a new frame.
    var frame: Bool {
        get { locked { _frame } }
        set { locked { _frame = newValue } }
    }

    /// Size changed or shown again: draw the last frame again.
    var redraw: Bool {
        get { locked { _redraw } }
        set { locked { _redraw = newValue } }
    }

    /// The layer's size changed: new buffers first.
    var resize: Bool {
        get { locked { _resize } }
        set { locked { _resize = newValue } }
    }

    /// A draw is queued or running.
    var drawing: Bool {
        get { locked { _drawing } }
        set { locked { _drawing = newValue } }
    }

    /// The app is in the foreground: GL may be used.
    var active: Bool {
        get { locked { _active } }
        set { locked { _active = newValue } }
    }

    /// True when no draw was queued or running, and marks one so.
    func startDrawing() -> Bool {
        locked {
            if _drawing { return false }
            _drawing = true
            return true
        }
    }

    func takeResize() -> Bool {
        locked {
            let was = _resize
            _resize = false
            return was
        }
    }
}

/// The display link's target: it holds the view weakly, so the link (which retains its target)
/// doesn't keep the view alive. The link calls it on the main thread.
@MainActor
private final class Tick: NSObject {
    weak var view: MpvVideoView?

    init(view: MpvVideoView) { self.view = view }

    @objc func tick() { view?.tick() }
}

/// OpenGL ES's functions for mpv, by name.
private func glProcAddress(_ ctx: UnsafeMutableRawPointer?, _ name: UnsafePointer<CChar>?) -> UnsafeMutableRawPointer? {
    guard let name, let gl = openGLES else { return nil }
    return dlsym(gl, name)
}

private let openGLES: UnsafeMutableRawPointer? = dlopen("/System/Library/Frameworks/OpenGLES.framework/OpenGLES", RTLD_LAZY | RTLD_LOCAL)

/// The player's video for SwiftUI.
struct MpvVideo: UIViewRepresentable {
    let view: MpvVideoView

    func makeUIView(context: Context) -> MpvVideoView { view }

    func updateUIView(_ uiView: MpvVideoView, context: Context) {}
}
