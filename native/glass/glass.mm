// machete-glass: Liquid Glass behind a window's page. Runs inside Machete's main process, because only it can reach its
// own windows. NSGlassEffectView is looked up when it runs, so this builds and loads on any macOS from 14 on.
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <cstddef>
#include <cstdint>

// The few pieces of Node-API it needs: a stable C interface that Electron exports.
extern "C" {
typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
napi_status napi_get_cb_info(napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **);
napi_status napi_is_buffer(napi_env, napi_value, bool *);
napi_status napi_get_buffer_info(napi_env, napi_value, void **, size_t *);
napi_status napi_is_array(napi_env, napi_value, bool *);
napi_status napi_get_array_length(napi_env, napi_value, uint32_t *);
napi_status napi_get_element(napi_env, napi_value, uint32_t, napi_value *);
napi_status napi_get_value_double(napi_env, napi_value, double *);
napi_status napi_get_boolean(napi_env, bool, napi_value *);
napi_status napi_create_function(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
napi_status napi_set_named_property(napi_env, napi_value, const char *, napi_value);
}

// What's used of NSGlassEffectView, for SDKs older than 26.
@protocol MacheteGlass
@property CGFloat cornerRadius;
@property(copy) NSColor *tintColor;
@property NSInteger style;
@end

// NSGlassEffectViewStyleClear: the one that lets what's behind through.
static constexpr NSInteger kClear = 1;

static const void *kGlass = &kGlass;
static constexpr uint32_t kShape = 6; // x, y, width, height, corner radius, stretches

static NSArray<NSNumber *> *numbers(napi_env env, napi_value value) {
  bool isArray = false;
  uint32_t length = 0;
  if (napi_is_array(env, value, &isArray) != 0 || !isArray) return nil;
  if (napi_get_array_length(env, value, &length) != 0 || length > 256) return nil;
  NSMutableArray<NSNumber *> *list = [NSMutableArray arrayWithCapacity:length];
  for (uint32_t i = 0; i < length; i++) {
    napi_value item;
    double n = 0;
    if (napi_get_element(env, value, i, &item) != 0 || napi_get_value_double(env, item, &n) != 0) return nil;
    [list addObject:@(n)];
  }
  return list;
}

static BOOL apply(NSView *content, NSArray<NSNumber *> *shapes, NSArray<NSNumber *> *tint) {
  Class Glass = NSClassFromString(@"NSGlassEffectView");
  if (!Glass || content.window == nil) return NO;
  NSMutableArray<NSView *> *views = objc_getAssociatedObject(content, kGlass);
  if (!views) {
    views = [NSMutableArray array];
    objc_setAssociatedObject(content, kGlass, views, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  NSColor *color = [NSColor colorWithSRGBRed:tint[0].doubleValue
                                       green:tint[1].doubleValue
                                        blue:tint[2].doubleValue
                                       alpha:tint[3].doubleValue];
  const NSUInteger count = shapes.count / kShape;
  while (views.count > count) {
    [views.lastObject removeFromSuperview];
    [views removeLastObject];
  }
  for (NSUInteger i = 0; i < count; i++) {
    const double n[kShape] = {
        shapes[i * kShape].doubleValue,     shapes[i * kShape + 1].doubleValue, shapes[i * kShape + 2].doubleValue,
        shapes[i * kShape + 3].doubleValue, shapes[i * kShape + 4].doubleValue, shapes[i * kShape + 5].doubleValue,
    };
    const BOOL added = i >= views.count;
    NSView *view = added ? [[Glass alloc] initWithFrame:NSZeroRect] : views[i];
    if (!view) return NO;
    // From the top left, like the page.
    const CGFloat y = content.isFlipped ? n[1] : NSHeight(content.bounds) - n[1] - n[3];
    view.frame = NSMakeRect(n[0], y, n[2], n[3]);
    const NSAutoresizingMaskOptions stretch = NSViewWidthSizable | NSViewHeightSizable;
    const NSAutoresizingMaskOptions pinned = NSViewMaxXMargin | (content.isFlipped ? NSViewMaxYMargin : NSViewMinYMargin);
    view.autoresizingMask = n[5] != 0 ? stretch : pinned;
    // The text on it is white.
    view.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    ((id<MacheteGlass>)view).cornerRadius = n[4];
    // No color asked for is no tint at all, rather than a transparent one.
    ((id<MacheteGlass>)view).tintColor = color.alphaComponent > 0 ? color : nil;
    if ([view respondsToSelector:@selector(setStyle:)]) ((id<MacheteGlass>)view).style = kClear;
    if (added) {
      [views addObject:view];
      [content addSubview:view positioned:NSWindowBelow relativeTo:nil];
    }
  }
  [content.window invalidateShadow];
  return YES;
}

// setGlass(getNativeWindowHandle(), [x, y, width, height, radius, stretches, …], [r, g, b, a]) → whether it's there.
static napi_value setGlass(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_get_boolean(env, false, &result);
  size_t argc = 3;
  napi_value argv[3];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != 0 || argc < 3) return result;
  bool isBuffer = false;
  void *data = nullptr;
  size_t length = 0;
  if (napi_is_buffer(env, argv[0], &isBuffer) != 0 || !isBuffer) return result;
  if (napi_get_buffer_info(env, argv[0], &data, &length) != 0 || length != sizeof(void *)) return result;
  @autoreleasepool {
    NSArray<NSNumber *> *shapes = numbers(env, argv[1]);
    NSArray<NSNumber *> *tint = numbers(env, argv[2]);
    if (!shapes || shapes.count % kShape != 0 || tint.count != 4 || !NSThread.isMainThread) return result;
    const void *wanted = *static_cast<void **>(data);
    @try {
      // Only a pointer that is one of our own windows' content view is ever used.
      for (NSWindow *window in NSApp.windows) {
        if ((__bridge const void *)window.contentView != wanted) continue;
        napi_get_boolean(env, apply(window.contentView, shapes, tint), &result);
        break;
      }
    } @catch (NSException *problem) {
      NSLog(@"machete-glass: %@", problem);
      napi_get_boolean(env, false, &result);
    }
  }
  return result;
}

extern "C" __attribute__((visibility("default"))) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "setGlass", SIZE_MAX, setGlass, nullptr, &fn) == 0)
    napi_set_named_property(env, exports, "setGlass", fn);
  return exports;
}
extern "C" __attribute__((visibility("default"))) int32_t node_api_module_get_api_version_v1() { return 8; }
