// Machete's design: every color, size and corner, once. The build turns them into the `--variables` of machete.css,
// the native glass takes its corners and its color from here, and a test keeps raw colors out of the apps.

/** What darkens the panels behind white text. Neutral: the color comes from what's behind the glass. */
const INK = [22, 22, 25] as const;
const ink = (alpha: number) => `rgb(${INK.join(' ')} / ${alpha})`;
const white = (alpha: number) => `rgb(255 255 255 / ${alpha})`;

export const RADIUS = {
  /** A floating panel of glass. */
  panel: 24,
  /** Without glass, macOS rounds the window itself: the page follows it. */
  system: 12,
  /** The Copilot's bar is a capsule, and stays one as its answers unfold. */
  copilot: 29,
  pill: 26,
  card: 18,
  /** Opaque content set into a panel. Concentric: the panel's corner minus the gap around it. */
  sheet: 16,
} as const;

/** The gap between a panel's edge and what's in it. */
export const GAP = 8;

/** What NSGlassEffectView leans to: red, green, blue and alpha, from 0 to 1. Nothing: clear glass takes its color from
 * what's behind it. */
export const GLASS_TINT: readonly [number, number, number, number] = [0, 0, 0, 0];

export const TOKENS = {
  // Text
  text: '#ffffff',
  'text-soft': '#eaebee',
  'text-dim': '#cfd1d6',
  // Surfaces. Over glass they let more through; without it they hold the text by themselves.
  surface: ink(0.84),
  'surface-glass': ink(0.1),
  'surface-opaque': `rgb(${INK.join(' ')})`,
  'copilot-rgb': INK.join(' '),
  /** What Settings says (set by the page), see ON_GLASS. */
  'copilot-alpha': 'var(--body-alpha, 0.775)',
  // Content is never glass.
  sheet: '#17181b',
  // On a surface
  rim: white(0.2),
  line: white(0.14),
  fill: white(0.12),
  'fill-hover': white(0.2),
  'fill-strong': white(0.26),
  'fill-selected': white(0.2),
  bubble: white(0.18),
  code: 'rgb(0 0 0 / 0.35)',
  // Color, sparingly: what a panel is for, what's on, what's wrong.
  accent: '#2667f0',
  'accent-hover': '#3c78f5',
  on: '#9cc6ff',
  focus: '#8fc0ff',
  selection: 'rgb(120 170 255 / 0.5)',
  record: '#ff5952',
  warn: '#ffbf80',
  'warn-fill': 'rgb(255 159 10 / 0.2)',
  bad: '#ffa096',
  light: '#f1f3f6',
  'on-light': '#141414',
  // On a picture, where any color can be behind.
  veil: 'rgb(16 17 19 / 0.84)',
  'veil-hover': '#3a3c42',
  /** Clear glass over a white page has no contrast of its own: there, letters bring a little. */
  'text-shadow': 'none',
  shadow: '0 6px 14px rgb(0 0 0 / 0.38)',
  'shadow-soft': '0 8px 26px rgb(0 0 0 / 0.35)',
  // The calculator's ink
  'calc-text': '#eceef2',
  'calc-heading': '#f9c54e',
  'calc-comment': '#a4a7ad',
  'calc-variable': '#82c7ec',
  'calc-result': '#a0ce4c',
  // Type
  sans: "'Inter', -apple-system, system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace",
  // Corners and gaps
  gap: `${GAP}px`,
  'radius-panel': `${RADIUS.system}px`,
  'radius-copilot': `${RADIUS.copilot}px`,
  'radius-pill': `${RADIUS.system}px`,
  'radius-card': `${RADIUS.card}px`,
  'radius-sheet': `${RADIUS.system - GAP}px`,
  ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

/** What changes once the window really has glass behind it. */
export const ON_GLASS = {
  surface: TOKENS['surface-glass'],
  'radius-panel': `${RADIUS.panel}px`,
  'radius-pill': `${RADIUS.pill}px`,
  'radius-sheet': `${RADIUS.sheet}px`,
  // Copilot is dark glass: there's a lot to read in it, often over a white page.
  'copilot-alpha': 'calc(var(--body-alpha) * 1.5 - 0.42)',
  'text-shadow': '0 0 1px rgb(0 0 0 / 0.5), 0 1px 4px rgb(0 0 0 / 0.45)',
} as const;

const variables = (tokens: Readonly<Record<string, string>>) =>
  Object.entries(tokens)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join('\n');

/** The top of machete.css. */
export const tokensCss = (): string =>
  `/* From core/design/tokens.ts: change them there. */\n:root {\n${variables(TOKENS)}\n}\n`;

/** Given to a page when its window gets glass. Transparency or contrast settings still win over it. */
export const glassCss = (): string => `:root:root {\n${variables(ON_GLASS)}\n}\n`;
