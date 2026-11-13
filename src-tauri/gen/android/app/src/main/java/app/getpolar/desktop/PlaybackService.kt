package app.getpolar.desktop

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Base64
import android.util.Log

/**
 * Playing on in the background (#461). While the player shows a title, Rust (src-tauri/src/player/background.rs)
 * puts it here: a media session for the system's controls (the lock screen, the notification shade, headphone
 * buttons) and a foreground service with its notification, which keeps the app running when it goes to the
 * background or the screen locks. mpv's picture goes with the surface then (player/android.rs); the sound plays on.
 * What the controls ask goes back to Rust, and from there to mpv.
 */
object NowPlaying {
  private const val TAG = "polar-playing"
  const val CHANNEL = "playback"
  const val NOTE_ID = 4610
  // player/background.rs: its `Remote` codes.
  const val PLAY = 1
  const val PAUSE = 2
  const val TOGGLE = 3
  const val SEEK_TO = 4
  const val SKIP_BY = 5
  const val CLOSED = 6
  /** How far the skip buttons go, in seconds. */
  const val SKIP = 10.0
  /** The longest side of the art kept, in pixels. */
  private const val ART_PX = 512
  /** Long enough for a film; renewed on each play. */
  private const val AWAKE_MS = 4 * 60 * 60 * 1000L

  private val main = Handler(Looper.getMainLooper())
  // Main thread only, from here on.
  private var app: Context? = null
  private var session: MediaSession? = null
  private var wake: PowerManager.WakeLock? = null
  private var title = ""
  private var subtitle = ""
  private var art: Bitmap? = null
  private var playing = false
  private var duration = 0L
  private var serviceOn = false

  /** Rust: to the media session and the playback service (the controls ask it). */
  private external fun command(code: Int, value: Double)

  fun send(code: Int, value: Double = 0.0) = command(code, value)

  /** Show what plays; the service starts. The app is in the foreground then: the player just started it. */
  @JvmStatic
  fun show(context: Context, title: String, subtitle: String, art: String?, playing: Boolean, position: Long, duration: Long, rate: Float) {
    val app = context.applicationContext
    val picture = art?.let { decodeArt(it) }
    main.post {
      this.app = app
      this.title = title
      this.subtitle = subtitle
      this.art = picture
      val s = session ?: newSession(app).also { session = it }
      s.isActive = true
      startService(app)
      setState(playing, position, duration, rate)
      setMetadata()
      refresh(app)
    }
  }

  /** Where playback is: the system counts on from `position` at `rate`. */
  @JvmStatic
  fun update(playing: Boolean, position: Long, duration: Long, rate: Float) {
    main.post {
      if (session == null) return@post
      val lengthChanged = duration != this.duration
      setState(playing, position, duration, rate)
      if (lengthChanged) setMetadata()
      app?.let { refresh(it) }
    }
  }

  /** Nothing plays any more: the controls and the service go. */
  @JvmStatic
  fun hide(context: Context) {
    val app = context.applicationContext
    main.post {
      session?.run {
        isActive = false
        release()
      }
      session = null
      art = null
      if (serviceOn) app.stopService(Intent(app, PlaybackService::class.java))
      serviceOn = false
      awake(false)
    }
  }

  private fun newSession(app: Context): MediaSession {
    val s = MediaSession(app, "Polarity")
    s.setCallback(object : MediaSession.Callback() {
      override fun onPlay() = send(PLAY)
      override fun onPause() = send(PAUSE)
      override fun onStop() = send(PAUSE)
      override fun onSeekTo(pos: Long) = send(SEEK_TO, pos / 1000.0)
      override fun onRewind() = send(SKIP_BY, -SKIP)
      override fun onFastForward() = send(SKIP_BY, SKIP)
    })
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      @Suppress("DEPRECATION")
      s.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
    }
    s.setSessionActivity(openApp(app))
    return s
  }

  private fun setState(playing: Boolean, position: Long, duration: Long, rate: Float) {
    this.playing = playing
    this.duration = duration
    val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
      PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_REWIND or PlaybackState.ACTION_FAST_FORWARD or
      PlaybackState.ACTION_STOP
    val state = PlaybackState.Builder()
      .setActions(actions)
      .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, position, rate, SystemClock.elapsedRealtime())
      .build()
    session?.setPlaybackState(state)
    awake(playing)
  }

  /** The processor stays on while sound plays in the background with the screen off; paused, it may sleep. */
  @SuppressLint("WakelockTimeout")
  private fun awake(on: Boolean) {
    val held = wake
    if (!on || !serviceOn) {
      if (held?.isHeld == true) held.release()
      return
    }
    val power = app?.getSystemService(PowerManager::class.java) ?: return
    val lock = held ?: power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "polarity:playback").also {
      it.setReferenceCounted(false)
      wake = it
    }
    lock.acquire(AWAKE_MS)
  }

  /** Back to the app, as it was left. */
  private fun openApp(context: Context): PendingIntent {
    val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, NOTE_ID, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** The app was swiped away (PlaybackService): mpv pauses, the service goes. */
  fun closed() {
    send(CLOSED)
    main.post {
      serviceOn = false
      awake(false)
    }
  }

  private fun setMetadata() {
    val meta = MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, title)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, subtitle)
      .putLong(MediaMetadata.METADATA_KEY_DURATION, if (duration > 0) duration else -1L)
    art?.let { meta.putBitmap(MediaMetadata.METADATA_KEY_ART, it) }
    session?.setMetadata(meta.build())
  }

  private fun decodeArt(base64: String): Bitmap? = try {
    val bytes = Base64.decode(base64, Base64.DEFAULT)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= ART_PX) sample *= 2
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
  } catch (e: IllegalArgumentException) {
    null
  }

  // A TV keeps to what it did before: a video stops being seen when the app is left, and no notification shows.
  private fun isTelevision(context: Context): Boolean {
    val uiMode = context.getSystemService(UiModeManager::class.java)
    return uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
      context.packageManager.hasSystemFeature("android.software.leanback")
  }

  private fun startService(app: Context) {
    if (serviceOn || isTelevision(app)) return
    val intent = Intent(app, PlaybackService::class.java)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(intent) else app.startService(intent)
      serviceOn = true
    } catch (e: IllegalStateException) {
      // Not allowed from the background (Android 12 and later): the controls still show, the app may be stopped.
      Log.w(TAG, "playback service not started: ${e.javaClass.simpleName}")
    }
  }

  /** The notification shows the play or pause button as it is now. */
  private fun refresh(app: Context) {
    if (!serviceOn) return
    val note = notification(app) ?: return
    app.getSystemService(NotificationManager::class.java)?.notify(NOTE_ID, note)
  }

  private fun channel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL) != null) return
    val channel = NotificationChannel(CHANNEL, "Playing now", NotificationManager.IMPORTANCE_LOW)
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  private fun builder(context: Context): Notification.Builder {
    channel(context)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL)
    else @Suppress("DEPRECATION") Notification.Builder(context)
  }

  /** For a service that ends as it starts. */
  fun blank(context: Context): Notification = builder(context).setSmallIcon(R.drawable.ic_notification).build()

  /** The media notification: art, title, back 10 s, play or pause, on 10 s. Null when nothing plays. */
  fun notification(context: Context): Notification? {
    val s = session ?: return null
    val builder = builder(context)
    fun action(icon: Int, label: String, what: String) = Notification.Action.Builder(
      Icon.createWithResource(context, icon), label, PlaybackService.pending(context, what)
    ).build()
    val toggle = if (playing) action(android.R.drawable.ic_media_pause, "Pause", PlaybackService.PAUSE)
    else action(android.R.drawable.ic_media_play, "Play", PlaybackService.PLAY)
    builder
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(subtitle)
      .setLargeIcon(art)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .addAction(action(android.R.drawable.ic_media_rew, "Back 10 seconds", PlaybackService.REWIND))
      .addAction(toggle)
      .addAction(action(android.R.drawable.ic_media_ff, "On 10 seconds", PlaybackService.FORWARD))
      .setStyle(Notification.MediaStyle().setMediaSession(s.sessionToken).setShowActionsInCompactView(0, 1, 2))
      .setContentIntent(openApp(context))
    return builder.build()
  }
}

/**
 * Keeps the app running while the player shows a title (#461), with the media notification ([NowPlaying]). Its
 * buttons come back here. Swiping the app away from the recent apps pauses playback and ends it.
 */
class PlaybackService : Service() {
  companion object {
    const val PLAY = "app.getpolar.desktop.playback.PLAY"
    const val PAUSE = "app.getpolar.desktop.playback.PAUSE"
    const val REWIND = "app.getpolar.desktop.playback.REWIND"
    const val FORWARD = "app.getpolar.desktop.playback.FORWARD"
    fun pending(context: Context, action: String): PendingIntent = PendingIntent.getService(
      context, action.hashCode(), Intent(context, PlaybackService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE
    )
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      PLAY -> NowPlaying.send(NowPlaying.PLAY)
      PAUSE -> NowPlaying.send(NowPlaying.PAUSE)
      REWIND -> NowPlaying.send(NowPlaying.SKIP_BY, -NowPlaying.SKIP)
      FORWARD -> NowPlaying.send(NowPlaying.SKIP_BY, NowPlaying.SKIP)
    }
    // A service started for the foreground must go there even when the player closed meanwhile; it ends at once then.
    val note = NowPlaying.notification(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NowPlaying.NOTE_ID, note ?: NowPlaying.blank(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NowPlaying.NOTE_ID, note ?: NowPlaying.blank(this))
    }
    if (note == null) stopSelf()
    return START_NOT_STICKY
  }

  // The app was swiped away: nothing would show the video or close it any more.
  override fun onTaskRemoved(rootIntent: Intent?) {
    NowPlaying.closed()
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }
}
