// iOS's own buttons for a few of the web app's (native_buttons.rs; src/components/NativeButtons.tsx).
//
// System buttons laid over the web app's where the web app says they stand: Liquid Glass on iOS 26 and
// later (the main one the prominent kind), the filled and grey kinds before. The featured card's Watch Now
// and Save on a phone's Home use them. A tap goes back to the web app with the button's id.
//
// They sit beside the web view, in a view that clips them below the web app's top bar, and follow the page's
// scrolling themselves: the scroll view under them is found once (the page's own, which WebKit draws as a
// scroll view of its own inside the web view), their places are kept in its content, and on each frame
// they're put where that content now is. Nothing waits on the web app while the page scrolls. The web app
// hides them whenever its page isn't the one showing, or something covers it.

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

// native_buttons.rs
extern void polar_button_pressed(const char *id);
// dialogs.m
extern WKWebView *polar_web_view(void);

@interface PolarButtonsTicker : NSObject
- (void)tick:(CADisplayLink *)displayLink;
@end

/// Covers most of the page: a touch anywhere but on a button goes through to the web view under it.
@interface PolarButtonsClip : UIView
@end

@implementation PolarButtonsClip
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    UIView *hit = [super hitTest:point withEvent:event];
    return hit == self ? nil : hit;
}
@end

/// Clips the buttons below the web app's top bar, and to the scroll view they're in.
static PolarButtonsClip *clip;
static NSMutableDictionary<NSString *, UIButton *> *buttons;
/// Each button's place in the scroll view's content.
static NSMutableDictionary<NSString *, NSValue *> *places;
/// What each button was last drawn as, to leave it alone when that hasn't changed.
static NSMutableDictionary<NSString *, NSString *> *looks;
static __weak UIScrollView *scroller;
/// The web app's top bar ends here (CSS pixels, which are the web view's points).
static CGFloat clip_top;
static CADisplayLink *frames;
static PolarButtonsTicker *ticker;

static double number(id value) { return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : 0; }
static NSString *text(id value) { return [value isKindOfClass:NSString.class] ? value : @""; }

/// Every scroll view of the web view's under `point`, the deepest last; `web`'s own isn't one.
static void scrollers_under(UIView *view, WKWebView *web, CGPoint point, UIScrollView **found) {
    for (UIView *sub in view.subviews) {
        if (sub.hidden || sub.alpha < 0.01) continue;
        if ([sub isKindOfClass:UIScrollView.class] && sub != web.scrollView &&
            CGRectContainsPoint([sub convertRect:sub.bounds toView:web], point))
            *found = (UIScrollView *)sub;
        scrollers_under(sub, web, point, found);
    }
}

/// The scroll view that moves what's at `point` (web view points): the page's own, or the web view's.
static UIScrollView *scroller_at(WKWebView *web, CGPoint point) {
    for (UIView *v = [web hitTest:point withEvent:nil]; v && v != web; v = v.superview)
        if ([v isKindOfClass:UIScrollView.class] && v != web.scrollView) return (UIScrollView *)v;
    UIScrollView *found = nil;
    scrollers_under(web, web, point, &found);
    return found ?: web.scrollView;
}

/// Puts the buttons where their places in the scroll view's content are now.
static void place(void) {
    WKWebView *web = polar_web_view();
    UIScrollView *s = scroller;
    UIView *host = clip.superview;
    if (!web || !s || !s.window || !host) {
        clip.hidden = YES;
        return;
    }
    CGRect area = [s convertRect:s.bounds toView:host];
    CGSize size = web.bounds.size;
    CGRect below = [web convertRect:CGRectMake(0, clip_top, size.width, MAX(0, size.height - clip_top)) toView:host];
    area = CGRectIntersection(area, below);
    if (CGRectIsNull(area) || CGRectIsEmpty(area)) {
        clip.hidden = YES;
        return;
    }
    clip.hidden = NO;
    clip.frame = area;
    for (NSString *bid in buttons) buttons[bid].frame = [s convertRect:places[bid].CGRectValue toView:clip];
}

@implementation PolarButtonsTicker
- (void)tick:(CADisplayLink *)l {
    place();
}
@end

static void hide(void) {
    clip.hidden = YES;
    [frames invalidate];
    frames = nil;
    scroller = nil;
}

static UIButton *make_button(NSString *bid) {
    UIButton *b = [UIButton buttonWithConfiguration:[UIButtonConfiguration plainButtonConfiguration]
                                      primaryAction:[UIAction actionWithHandler:^(__kindof UIAction *a) { polar_button_pressed(bid.UTF8String); }]];
    b.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
    return b;
}

static void style(UIButton *b, NSString *title, NSString *symbol, NSString *label, BOOL prominent) {
    UIButtonConfiguration *c;
    if (@available(iOS 26.0, *)) {
        c = prominent ? [UIButtonConfiguration prominentGlassButtonConfiguration] : [UIButtonConfiguration glassButtonConfiguration];
    } else {
        c = prominent ? [UIButtonConfiguration filledButtonConfiguration] : [UIButtonConfiguration grayButtonConfiguration];
    }
    // The main action light with dark type, as the web app's own; the other plain glass with light type.
    if (prominent) {
        c.baseBackgroundColor = UIColor.whiteColor;
        c.baseForegroundColor = UIColor.blackColor;
        b.tintColor = UIColor.whiteColor;
    } else {
        c.baseForegroundColor = UIColor.whiteColor;
    }
    c.cornerStyle = UIButtonConfigurationCornerStyleCapsule;
    c.title = title;
    c.titleTextAttributesTransformer = ^NSDictionary<NSAttributedStringKey, id> *(NSDictionary<NSAttributedStringKey, id> *attributes) {
        NSMutableDictionary *out = [attributes mutableCopy];
        out[NSFontAttributeName] = [UIFont systemFontOfSize:16 weight:UIFontWeightSemibold];
        return out;
    };
    UIImageSymbolConfiguration *glyph = [UIImageSymbolConfiguration configurationWithPointSize:15 weight:UIImageSymbolWeightSemibold];
    c.image = symbol.length ? [UIImage systemImageNamed:symbol withConfiguration:glyph] : nil;
    c.imagePadding = 7;
    b.configuration = c;
    b.accessibilityLabel = label.length ? label : title;
}

static void apply(NSDictionary *state) {
    WKWebView *web = polar_web_view();
    NSArray *items = [state[@"items"] isKindOfClass:NSArray.class] ? state[@"items"] : @[];
    BOOL shown = [state[@"shown"] isKindOfClass:NSNumber.class] && [state[@"shown"] boolValue];
    UIView *host = web.superview;
    if (!web || !host || !shown || !items.count) {
        hide();
        return;
    }
    if (!clip) {
        clip = [PolarButtonsClip new];
        clip.clipsToBounds = YES;
        buttons = [NSMutableDictionary dictionary];
        places = [NSMutableDictionary dictionary];
        looks = [NSMutableDictionary dictionary];
    }
    // Over the web view, under everything else (the tab bar, Back, the video's controls).
    if (clip.superview != host || [host.subviews indexOfObject:clip] != [host.subviews indexOfObject:web] + 1)
        [host insertSubview:clip aboveSubview:web];
    clip_top = number(state[@"clip_top"]);

    UIScrollView *s = nil;
    NSMutableSet<NSString *> *seen = [NSMutableSet set];
    for (id item in items) {
        if (![item isKindOfClass:NSDictionary.class]) continue;
        NSString *bid = text(item[@"id"]);
        NSDictionary *r = [item[@"rect"] isKindOfClass:NSDictionary.class] ? item[@"rect"] : nil;
        if (!bid.length || !r) continue;
        CGRect frame = CGRectMake(number(r[@"x"]), number(r[@"y"]), number(r[@"width"]), number(r[@"height"]));
        if (!s) s = scroller_at(web, CGPointMake(CGRectGetMidX(frame), CGRectGetMidY(frame)));
        UIButton *b = buttons[bid];
        if (!b) {
            b = make_button(bid);
            buttons[bid] = b;
        }
        if (b.superview != clip) [clip addSubview:b];
        NSString *title = text(item[@"title"]), *symbol = text(item[@"symbol"]), *label = text(item[@"label"]);
        BOOL prominent = [item[@"prominent"] isKindOfClass:NSNumber.class] && [item[@"prominent"] boolValue];
        NSString *look = [NSString stringWithFormat:@"%@|%@|%@|%d", title, symbol, label, prominent];
        if (![looks[bid] isEqualToString:look]) {
            style(b, title, symbol, label, prominent);
            looks[bid] = look;
        }
        places[bid] = [NSValue valueWithCGRect:[web convertRect:frame toView:s]];
        [seen addObject:bid];
    }
    for (NSString *bid in buttons.allKeys) {
        if ([seen containsObject:bid]) continue;
        [buttons[bid] removeFromSuperview];
        [buttons removeObjectForKey:bid];
        [places removeObjectForKey:bid];
        [looks removeObjectForKey:bid];
    }
    if (!seen.count || !s) {
        hide();
        return;
    }
    scroller = s;
    if (!frames) {
        if (!ticker) ticker = [PolarButtonsTicker new];
        frames = [CADisplayLink displayLinkWithTarget:ticker selector:@selector(tick:)];
        [frames addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    }
    place();
}

/// Show, move or hide the buttons as `json` (native_buttons.rs's `Buttons`) says. Any thread.
void polar_buttons_set(const char *json) {
    NSData *data = [NSData dataWithBytes:json length:strlen(json)];
    dispatch_async(dispatch_get_main_queue(), ^{
        id state = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([state isKindOfClass:NSDictionary.class]) apply(state);
    });
}
