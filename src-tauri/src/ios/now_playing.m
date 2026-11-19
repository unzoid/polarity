// The system's Now Playing controls on iOS and iPadOS (#461): the lock screen, Control Center, and the
// buttons of headphones and cars. Rust (player/background.rs) says what plays and where playback is;
// what the controls ask goes back to it, and from there to mpv. Playing on in the background itself is
// the audio background mode (Info.ios.plist) with the audio session mpv_view.m sets up.

#import <UIKit/UIKit.h>
#import <MediaPlayer/MediaPlayer.h>

// player/background.rs: the numbers are its `Remote` codes.
extern void polar_now_playing_command(int code, double value);
enum { PLAY = 1, PAUSE = 2, TOGGLE = 3, SEEK_TO = 4, SKIP_BY = 5 };

/// How far the skip buttons go, in seconds.
static const double SKIP = 10;

/// What the controls show now; nil while nothing plays. Main thread only.
static NSMutableDictionary<NSString *, id> *shown;

static void later_on_main(dispatch_block_t block) {
    if ([NSThread isMainThread]) block();
    else dispatch_async(dispatch_get_main_queue(), block);
}

static MPRemoteCommandHandlerStatus send(int code, double value) {
    polar_now_playing_command(code, value);
    return MPRemoteCommandHandlerStatusSuccess;
}

/// The controls this player answers, handed to Rust once. On the main thread.
static NSArray<MPRemoteCommand *> *commands(void) {
    static NSArray<MPRemoteCommand *> *list;
    if (list) return list;
    MPRemoteCommandCenter *c = MPRemoteCommandCenter.sharedCommandCenter;
    [c.playCommand addTargetWithHandler:^(MPRemoteCommandEvent *e) { return send(PLAY, 0); }];
    [c.pauseCommand addTargetWithHandler:^(MPRemoteCommandEvent *e) { return send(PAUSE, 0); }];
    [c.togglePlayPauseCommand addTargetWithHandler:^(MPRemoteCommandEvent *e) { return send(TOGGLE, 0); }];
    c.skipBackwardCommand.preferredIntervals = @[ @(SKIP) ];
    [c.skipBackwardCommand addTargetWithHandler:^(MPRemoteCommandEvent *e) {
        return send(SKIP_BY, -((MPSkipIntervalCommandEvent *)e).interval);
    }];
    c.skipForwardCommand.preferredIntervals = @[ @(SKIP) ];
    [c.skipForwardCommand addTargetWithHandler:^(MPRemoteCommandEvent *e) {
        return send(SKIP_BY, ((MPSkipIntervalCommandEvent *)e).interval);
    }];
    [c.changePlaybackPositionCommand addTargetWithHandler:^(MPRemoteCommandEvent *e) {
        return send(SEEK_TO, ((MPChangePlaybackPositionCommandEvent *)e).positionTime);
    }];
    // The skip buttons take the place of next and previous.
    c.nextTrackCommand.enabled = NO;
    c.previousTrackCommand.enabled = NO;
    list = @[ c.playCommand, c.pauseCommand, c.togglePlayPauseCommand, c.skipBackwardCommand, c.skipForwardCommand,
              c.changePlaybackPositionCommand ];
    return list;
}

static NSString *text(const char *s) {
    NSString *t = s ? [NSString stringWithUTF8String:s] : nil;
    return t ?: @"";
}

/// Show `title` (and `subtitle` under it, and `art`, a base64 JPEG) on the controls. Any thread.
void polar_now_playing_show(const char *title, const char *subtitle, const char *art) {
    NSString *t = text(title), *s = text(subtitle);
    NSData *picture = art ? [[NSData alloc] initWithBase64EncodedString:text(art) options:0] : nil;
    later_on_main(^{
        for (MPRemoteCommand *c in commands()) c.enabled = YES;
        NSMutableDictionary *next = [NSMutableDictionary dictionary];
        next[MPMediaItemPropertyTitle] = t;
        if (s.length) next[MPMediaItemPropertyArtist] = s;
        next[MPNowPlayingInfoPropertyMediaType] = @(MPNowPlayingInfoMediaTypeVideo);
        next[MPNowPlayingInfoPropertyDefaultPlaybackRate] = @1;
        UIImage *image = picture ? [UIImage imageWithData:picture] : nil;
        if (image)
            next[MPMediaItemPropertyArtwork] = [[MPMediaItemArtwork alloc] initWithBoundsSize:image.size
                                                                               requestHandler:^UIImage *(CGSize size) { return image; }];
        shown = next;
        MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = shown;
    });
}

/// Where playback is: the controls count on from `position` at `rate` (0: paused). Any thread.
void polar_now_playing_update(int playing, double position, double duration, double rate) {
    (void)playing; // iOS reads it from the rate
    later_on_main(^{
        if (!shown) return;
        shown[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(position);
        shown[MPNowPlayingInfoPropertyPlaybackRate] = @(rate);
        if (duration > 0) shown[MPMediaItemPropertyPlaybackDuration] = @(duration);
        else [shown removeObjectForKey:MPMediaItemPropertyPlaybackDuration];
        MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = shown;
    });
}

/// Nothing plays any more: the controls go. Any thread.
void polar_now_playing_hide(void) {
    later_on_main(^{
        shown = nil;
        MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil;
        for (MPRemoteCommand *c in commands()) c.enabled = NO;
    });
}
