// The screen's brightness on iOS, for the player's swipe on the left half
// (src/lib/platform/brightness.ts, player/commands.rs).
//
// UIScreen's brightness is the whole device's and stays where an app leaves it,
// so the level from before the player changed it is kept here: it goes back
// when the player closes, and also whenever the app stops being active (the
// Home Screen, the app switcher, Control Centre). Back in front, the player's
// level comes back over whatever the screen has then.

#import <UIKit/UIKit.h>

/// The level before the player changed it; below 0 while it hasn't.
static CGFloat original = -1;
/// The level the player set; below 0 while it hasn't.
static CGFloat ours = -1;
static BOOL observing;

static UIScreen *app_screen(void) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if ([scene isKindOfClass:UIWindowScene.class]) return ((UIWindowScene *)scene).screen;
    }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    return UIScreen.mainScreen;
#pragma clang diagnostic pop
}

static void observe(void) {
    if (observing) return;
    observing = YES;
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserverForName:UIApplicationWillResignActiveNotification
                        object:nil
                         queue:NSOperationQueue.mainQueue
                    usingBlock:^(NSNotification *note) {
                        if (original >= 0) app_screen().brightness = original;
                    }];
    [center addObserverForName:UIApplicationDidBecomeActiveNotification
                        object:nil
                         queue:NSOperationQueue.mainQueue
                    usingBlock:^(NSNotification *note) {
                        if (original < 0 || ours < 0) return;
                        // Changed in Control Centre meanwhile: that is the one to give back later.
                        original = app_screen().brightness;
                        app_screen().brightness = ours;
                    }];
}

/// The screen's brightness now, 0 to 1. Any thread.
double polar_screen_brightness(void) {
    if (NSThread.isMainThread) return app_screen().brightness;
    __block double level = -1;
    dispatch_sync(dispatch_get_main_queue(), ^{
        level = app_screen().brightness;
    });
    return level;
}

/// Set the brightness (0 to 1) while the player is open, or give back the one from before (below 0). Any thread.
void polar_set_screen_brightness(double level) {
    dispatch_async(dispatch_get_main_queue(), ^{
        observe();
        UIScreen *screen = app_screen();
        if (level < 0) {
            if (original >= 0) screen.brightness = original;
            original = -1;
            ours = -1;
            return;
        }
        if (original < 0) original = screen.brightness;
        ours = level;
        screen.brightness = level;
    });
}
