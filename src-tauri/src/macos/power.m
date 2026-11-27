// Keep a Mac's display from dimming and sleeping while a video plays (player/commands.rs).
//
// mpv only stops the screensaver from its own windows: drawing through the render API
// (`vo=libmpv`, macos/mpv_view.m) it leaves that to the app, so without this the display dims
// on the system's idle timer mid-film. One activity at a time, held from Play to pause or close.

#import <Foundation/Foundation.h>

static id<NSObject> activity;

/// Hold the display awake (1) or let it dim and sleep on its own timer again (0). Any thread.
void polar_macos_set_keep_awake(int on) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (on && !activity) {
            activity = [NSProcessInfo.processInfo
                beginActivityWithOptions:NSActivityIdleDisplaySleepDisabled | NSActivityUserInitiated
                                  reason:@"Playing a video"];
        } else if (!on && activity) {
            [NSProcessInfo.processInfo endActivity:activity];
            activity = nil;
        }
    });
}
