// iOS's own back button (native_back.rs; src/lib/platform/nativeBack.ts).
//
// A system button laid over the web app's Back, where the web app says it stands: Liquid Glass on
// iOS 26 and later, the classic chevron before. A tap goes back one page; a long press opens a menu
// of the pages behind it, as a navigation bar's back button does, and picking one goes back to it.
// The web app hides its own Back while this one shows, and hides this one whenever something covers
// the page (a sheet, a menu, the player).
//
// The swipe in from the left edge is Back too, as in iOS's apps: iOS's edge recognizer sees it, so it
// wins over the page's scrolling (the web view's scroll views wait for it to fail, and the page's
// touches are cancelled once it starts), and every step goes to the web app, which moves its pages
// with the finger (src/lib/platform/backSwipe.ts). It only starts while the web app says a swipe is
// Back; otherwise the edge is the page's.

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

// native_back.rs
extern void polar_back_pressed(uint32_t steps);
extern void polar_back_swipe(uint32_t phase, double x, double width, double velocity);
// tabs.m, dialogs.m
extern UIWindow *polar_app_window(void);
extern WKWebView *polar_web_view(void);

static UIButton *button;
static BOOL swipe_on;

@interface PolarBackSwipe : NSObject <UIGestureRecognizerDelegate>
@property(nonatomic, strong) UIScreenEdgePanGestureRecognizer *pan;
@end

static PolarBackSwipe *swipe;

@implementation PolarBackSwipe

/// Every step of the swipe to the web app: 0 began, 1 moved, 2 lifted, 3 cancelled.
- (void)panned:(UIScreenEdgePanGestureRecognizer *)pan {
    UIView *view = pan.view;
    uint32_t phase;
    switch (pan.state) {
        case UIGestureRecognizerStateBegan: phase = 0; break;
        case UIGestureRecognizerStateChanged: phase = 1; break;
        case UIGestureRecognizerStateEnded: phase = 2; break;
        case UIGestureRecognizerStateCancelled:
        case UIGestureRecognizerStateFailed: phase = 3; break;
        default: return;
    }
    polar_back_swipe(phase, [pan translationInView:view].x, view.bounds.size.width, [pan velocityInView:view].x);
}

- (BOOL)gestureRecognizerShouldBegin:(UIGestureRecognizer *)recognizer {
    return swipe_on;
}

/// The web view's scrolling (the page's and each scrolling part's) waits for the swipe to fail.
- (BOOL)gestureRecognizer:(UIGestureRecognizer *)recognizer shouldBeRequiredToFailByGestureRecognizer:(UIGestureRecognizer *)other {
    UIView *web = polar_web_view();
    return web && [other isKindOfClass:UIPanGestureRecognizer.class] && [other.view isKindOfClass:UIScrollView.class] &&
           [other.view isDescendantOfView:web];
}

@end

/// The edge recognizer on the window, once.
static void watch_edge(UIWindow *window) {
    if (!swipe) {
        swipe = [PolarBackSwipe new];
        swipe.pan = [[UIScreenEdgePanGestureRecognizer alloc] initWithTarget:swipe action:@selector(panned:)];
        swipe.pan.edges = UIRectEdgeLeft;
        swipe.pan.delegate = swipe;
    }
    if (swipe.pan.view != window) [window addGestureRecognizer:swipe.pan];
}

static double number(id value) { return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : 0; }

static UIButton *make_button(void) {
    UIButtonConfiguration *config;
    if (@available(iOS 26.0, *)) {
        config = [UIButtonConfiguration glassButtonConfiguration];
        config.cornerStyle = UIButtonConfigurationCornerStyleCapsule;
    } else {
        config = [UIButtonConfiguration plainButtonConfiguration];
    }
    UIImageSymbolConfiguration *symbol = [UIImageSymbolConfiguration configurationWithPointSize:17 weight:UIImageSymbolWeightSemibold];
    config.image = [UIImage systemImageNamed:@"chevron.backward" withConfiguration:symbol];
    config.baseForegroundColor = UIColor.labelColor;
    UIButton *b = [UIButton buttonWithConfiguration:config
                                      primaryAction:[UIAction actionWithHandler:^(__kindof UIAction *a) { polar_back_pressed(1); }]];
    b.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
    b.accessibilityLabel = @"Back";
    b.hidden = YES;
    return b;
}

/// The long-press menu: the pages behind, nearest first, each going back that many steps.
static UIMenu *history_menu(NSArray *history) {
    NSMutableArray<UIAction *> *items = [NSMutableArray array];
    [history enumerateObjectsUsingBlock:^(id title, NSUInteger i, BOOL *stop) {
        if (![title isKindOfClass:NSString.class]) return;
        uint32_t steps = (uint32_t)i + 1;
        [items addObject:[UIAction actionWithTitle:title image:nil identifier:nil handler:^(__kindof UIAction *a) { polar_back_pressed(steps); }]];
    }];
    return items.count ? [UIMenu menuWithChildren:items] : nil;
}

static void apply(NSDictionary *state) {
    UIWindow *window = polar_app_window();
    UIView *root = window.rootViewController.view;
    if (!window || !root) return;
    swipe_on = [state[@"swipe"] isKindOfClass:NSNumber.class] && [state[@"swipe"] boolValue];
    watch_edge(window);
    if (!button) button = make_button();
    // On top of the root view controller's view, under anything it presents, so alerts and sheets stay on
    // top. The root changes once (tabs.m puts the tab bar controller in), and its view then covers what
    // was added to the window before it (#451): the button follows the root, and comes to the front.
    if (button.superview != root) [root addSubview:button];
    [root bringSubviewToFront:button];
    BOOL shown = [state[@"shown"] isKindOfClass:NSNumber.class] && [state[@"shown"] boolValue];
    NSDictionary *rect = [state[@"rect"] isKindOfClass:NSDictionary.class] ? state[@"rect"] : nil;
    if (!shown || !rect) {
        button.hidden = YES;
        return;
    }
    // CSS pixels are the web view's points.
    CGRect frame = CGRectMake(number(rect[@"x"]), number(rect[@"y"]), number(rect[@"width"]), number(rect[@"height"]));
    UIView *web = polar_web_view();
    button.frame = web ? [web convertRect:frame toView:root] : frame;
    NSArray *history = [state[@"history"] isKindOfClass:NSArray.class] ? state[@"history"] : @[];
    button.menu = history_menu(history);
    button.hidden = NO;
}

/// Show, move or hide the button as `json` (native_back.rs's `Back`) says. Any thread.
void polar_back_set(const char *json) {
    NSData *data = [NSData dataWithBytes:json length:strlen(json)];
    dispatch_async(dispatch_get_main_queue(), ^{
        id state = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([state isKindOfClass:NSDictionary.class]) apply(state);
    });
}
