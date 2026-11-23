// What Machete asks macOS for, why, and how each one is granted. Pure data and functions, shared by both sides.
import { Schema } from 'effect';

export const PermissionKey = Schema.Literals(['microphone', 'screen', 'accessibility', 'inputMonitoring']);
export type PermissionKey = typeof PermissionKey.Type;

export const PermissionStatus = Schema.Literals(['granted', 'denied', 'not-determined']);
export type PermissionStatus = typeof PermissionStatus.Type;

export const PermissionsSnapshot = Schema.Struct({
  microphone: PermissionStatus,
  screen: PermissionStatus,
  accessibility: PermissionStatus,
  inputMonitoring: PermissionStatus,
});
export type PermissionsSnapshot = typeof PermissionsSnapshot.Type;

/**
 * `prompt`: macOS shows its own dialog the first time. `drag`: the app has to be dropped into the
 * System Settings list (on macOS 26 the request APIs no longer add a new app there reliably).
 */
export type GrantMethod = 'prompt' | 'drag';

export interface Permission {
  readonly key: PermissionKey;
  readonly title: string;
  readonly why: string;
  readonly method: GrantMethod;
  /** The System Settings pane. */
  readonly pane: string;
}

const pane = (anchor: string) => `x-apple.systempreferences:com.apple.preference.security?${anchor}`;

export const PERMISSIONS: ReadonlyArray<Permission> = [
  {
    key: 'microphone',
    title: 'Microphone',
    why: 'Hears your side of the call, and your dictation.',
    method: 'prompt',
    pane: pane('Privacy_Microphone'),
  },
  {
    key: 'screen',
    title: 'Screen & System Audio Recording',
    why: 'Reads your screen and hears the other side of the call.',
    method: 'drag',
    pane: pane('Privacy_ScreenCapture'),
  },
  {
    key: 'accessibility',
    title: 'Accessibility',
    why: 'Types your dictation into the app you were using.',
    method: 'drag',
    pane: pane('Privacy_Accessibility'),
  },
  {
    key: 'inputMonitoring',
    title: 'Input Monitoring',
    why: 'Notices a modifier tapped on its own, like right ⌥ for dictation, and your snippets.',
    method: 'drag',
    pane: pane('Privacy_ListenEvent'),
  },
];

export const permission = (key: PermissionKey): Permission =>
  PERMISSIONS.find((p) => p.key === key) ?? (PERMISSIONS[0] as Permission);

export const missing = (status: PermissionsSnapshot): ReadonlyArray<PermissionKey> =>
  PERMISSIONS.filter((p) => status[p.key] !== 'granted').map((p) => p.key);

export const NOTHING_GRANTED: PermissionsSnapshot = {
  microphone: 'not-determined',
  screen: 'denied',
  accessibility: 'denied',
  inputMonitoring: 'denied',
};

/** A rectangle in screen points, top-left origin. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the guide goes: beside the System Settings window (right, else left), bottom-aligned so the
 * icon sits next to the list, and always on screen.
 */
export const besideSettings = (settings: Rect, guide: { width: number; height: number }, screen: Rect) => {
  const gap = 12;
  const right = settings.x + settings.width + gap;
  const left = settings.x - guide.width - gap;
  const x =
    right + guide.width <= screen.x + screen.width
      ? right
      : left >= screen.x
        ? left
        : screen.x + screen.width - guide.width - gap;
  const bottom = settings.y + settings.height - guide.height;
  const y = Math.min(Math.max(bottom, screen.y + gap), screen.y + screen.height - guide.height - gap);
  return { x: Math.round(x), y: Math.round(y) };
};
