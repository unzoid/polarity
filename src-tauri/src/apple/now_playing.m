// Now Playing on macOS and iOS (media_session/apple.rs): what plays in MPNowPlayingInfoCenter (macOS's
// Now Playing in Control Center and the menu bar; the iPhone's Lock Screen and Control Center), and the
// media keys, headset buttons and those controls through MPRemoteCommandCenter, sent back to Rust.

#import <Foundation/Foundation.h>
#import <MediaPlayer/MediaPlayer.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <AppKit/AppKit.h>
#endif

// media_session/apple.rs. 0 play, 1 pause, 2 toggle, 3 next, 4 previous, 5 seek to `position`.
extern void polar_media_command(int action, double position);

static BOOL registered = NO;
// The artwork link shown (or being fetched): a picture that arrives for an older one is dropped.
static NSString *artworkLink = nil;

static void handle(MPRemoteCommand *command, int action) {
    [command addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
        polar_media_command(action, 0);
        return MPRemoteCommandHandlerStatusSuccess;
    }];
}

static void register_commands(void) {
    if (registered) return;
    registered = YES;
    MPRemoteCommandCenter *c = [MPRemoteCommandCenter sharedCommandCenter];
    handle(c.playCommand, 0);
    handle(c.pauseCommand, 1);
    handle(c.togglePlayPauseCommand, 2);
    handle(c.nextTrackCommand, 3);
    handle(c.previousTrackCommand, 4);
    [c.changePlaybackPositionCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
        MPChangePlaybackPositionCommandEvent *seek = (MPChangePlaybackPositionCommandEvent *)event;
        polar_media_command(5, seek.positionTime);
        return MPRemoteCommandHandlerStatusSuccess;
    }];
}

static void set_artwork(NSString *link) {
    NSURL *url = [NSURL URLWithString:link];
    if (!url) return;
    [[[NSURLSession sharedSession] dataTaskWithURL:url
                                 completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (!data || error) return;
#if TARGET_OS_IPHONE
        UIImage *image = [UIImage imageWithData:data];
#else
        NSImage *image = [[NSImage alloc] initWithData:data];
#endif
        if (!image) return;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (![artworkLink isEqualToString:link]) return;
            MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
            if (!center.nowPlayingInfo) return;
            NSMutableDictionary *info = [center.nowPlayingInfo mutableCopy];
            info[MPMediaItemPropertyArtwork] = [[MPMediaItemArtwork alloc] initWithBoundsSize:image.size
                                                                               requestHandler:^id(CGSize size) {
                return image;
            }];
            center.nowPlayingInfo = info;
        });
    }] resume];
}

void polar_now_playing_set(const char *title, const char *subtitle, const char *artwork, int playing, double position,
                           double duration, double rate, int can_next, int can_previous) {
    NSString *t = [NSString stringWithUTF8String:title] ?: @"";
    NSString *s = [NSString stringWithUTF8String:subtitle] ?: @"";
    NSString *a = artwork ? [NSString stringWithUTF8String:artwork] : nil;
    dispatch_async(dispatch_get_main_queue(), ^{
        register_commands();
        MPRemoteCommandCenter *c = [MPRemoteCommandCenter sharedCommandCenter];
        c.nextTrackCommand.enabled = can_next != 0;
        c.previousTrackCommand.enabled = can_previous != 0;
        c.changePlaybackPositionCommand.enabled = duration > 0;
        MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
        NSMutableDictionary *info = center.nowPlayingInfo ? [center.nowPlayingInfo mutableCopy] : [NSMutableDictionary dictionary];
        info[MPMediaItemPropertyTitle] = t;
        info[MPMediaItemPropertyArtist] = s;
        info[MPMediaItemPropertyPlaybackDuration] = @(duration);
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(position);
        // The system moves the time on from here at this rate, until the next update.
        info[MPNowPlayingInfoPropertyPlaybackRate] = @(playing ? rate : 0.0);
        info[MPNowPlayingInfoPropertyMediaType] = @(MPNowPlayingInfoMediaTypeVideo);
        BOOL newArtwork = !(a == artworkLink || [a isEqualToString:artworkLink]);
        if (newArtwork) {
            artworkLink = a;
            [info removeObjectForKey:MPMediaItemPropertyArtwork];
        }
        center.nowPlayingInfo = info;
#if !TARGET_OS_IPHONE
        center.playbackState = playing ? MPNowPlayingPlaybackStatePlaying : MPNowPlayingPlaybackStatePaused;
#endif
        if (newArtwork && a) set_artwork(a);
    });
}

void polar_now_playing_clear(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        artworkLink = nil;
        MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
        center.nowPlayingInfo = nil;
#if !TARGET_OS_IPHONE
        center.playbackState = MPNowPlayingPlaybackStateStopped;
#endif
        MPRemoteCommandCenter *c = [MPRemoteCommandCenter sharedCommandCenter];
        c.nextTrackCommand.enabled = NO;
        c.previousTrackCommand.enabled = NO;
    });
}
