/**
 * Pure Tailwind translation helpers: no DOM, no fs, fully testable.
 *
 * `styleToUtilities` converts a resolved CSS property/value into the Tailwind
 * utility classes that produce it; `resolveTailwindClassList` merges those
 * into an element's class list while removing classes of the same property
 * group. Untranslatable values return null so callers can fall back to the
 * raw-CSS editing path. Works with the Tailwind 3/4 default scales.
 */

const COLOR_SCALE: Record<string, string> = {
  "#f9fafb": "gray-50",
  "#f3f4f6": "gray-100",
  "#e5e7eb": "gray-200",
  "#d1d5db": "gray-300",
  "#9ca3af": "gray-400",
  "#6b7280": "gray-500",
  "#4b5563": "gray-600",
  "#374151": "gray-700",
  "#1f2937": "gray-800",
  "#111827": "gray-900",
  "#f8fafc": "slate-50",
  "#f1f5f9": "slate-100",
  "#e2e8f0": "slate-200",
  "#cbd5e1": "slate-300",
  "#94a3b8": "slate-400",
  "#64748b": "slate-500",
  "#475569": "slate-600",
  "#334155": "slate-700",
  "#1e293b": "slate-800",
  "#0f172a": "slate-900",
  "#fee2e2": "red-100",
  "#fca5a5": "red-300",
  "#ef4444": "red-500",
  "#dc2626": "red-600",
  "#b91c1c": "red-700",
  "#7f1d1d": "red-900",
  "#f97316": "orange-500",
  "#ea580c": "orange-600",
  "#f59e0b": "amber-500",
  "#d97706": "amber-600",
  "#eab308": "yellow-500",
  "#ca8a04": "yellow-600",
  "#84cc16": "lime-500",
  "#65a30d": "lime-600",
  "#22c55e": "green-500",
  "#16a34a": "green-600",
  "#15803d": "green-700",
  "#10b981": "emerald-500",
  "#059669": "emerald-600",
  "#14b8a6": "teal-500",
  "#0d9488": "teal-600",
  "#06b6d4": "cyan-500",
  "#0891b2": "cyan-600",
  "#0ea5e9": "sky-500",
  "#0284c7": "sky-600",
  "#3b82f6": "blue-500",
  "#2563eb": "blue-600",
  "#1d4ed8": "blue-700",
  "#6366f1": "indigo-500",
  "#4f46e5": "indigo-600",
  "#8b5cf6": "violet-500",
  "#7c3aed": "violet-600",
  "#a855f7": "purple-500",
  "#9333ea": "purple-600",
  "#d946ef": "fuchsia-500",
  "#ec4899": "pink-500",
  "#f43f5e": "rose-500",
  "#ffffff": "white",
  "#000000": "black",
};

const SPACING_SCALE: { name: string; px: number }[] = [
  { name: "0", px: 0 },
  { name: "px", px: 1 },
  { name: "0.5", px: 2 },
  { name: "1", px: 4 },
  { name: "1.5", px: 6 },
  { name: "2", px: 8 },
  { name: "2.5", px: 10 },
  { name: "3", px: 12 },
  { name: "3.5", px: 14 },
  { name: "4", px: 16 },
  { name: "5", px: 20 },
  { name: "6", px: 24 },
  { name: "7", px: 28 },
  { name: "8", px: 32 },
  { name: "9", px: 36 },
  { name: "10", px: 40 },
  { name: "11", px: 44 },
  { name: "12", px: 48 },
  { name: "14", px: 56 },
  { name: "16", px: 64 },
  { name: "20", px: 80 },
  { name: "24", px: 96 },
];

const FONT_SIZES_PX: Record<number, string> = {
  12: "text-xs",
  14: "text-sm",
  16: "text-base",
  18: "text-lg",
  20: "text-xl",
  24: "text-2xl",
  30: "text-3xl",
  36: "text-4xl",
  48: "text-5xl",
  60: "text-6xl",
  72: "text-7xl",
  96: "text-8xl",
  128: "text-9xl",
};

/** All classes that set a font size (text-size vs text-color share the `text-` prefix). */
const TEXT_SIZE_CLASSES = new Set(Object.values(FONT_SIZES_PX));

const FONT_WEIGHTS: Record<string, string> = {
  "100": "font-thin",
  "200": "font-extralight",
  "300": "font-light",
  "400": "font-normal",
  "500": "font-medium",
  "600": "font-semibold",
  "700": "font-bold",
  "800": "font-extrabold",
  "900": "font-black",
  normal: "font-normal",
  bold: "font-bold",
  light: "font-light",
  thin: "font-thin",
  medium: "font-medium",
  semibold: "font-semibold",
  extrabold: "font-extrabold",
  black: "font-black",
};

const RADII: Record<string, string> = {
  "0px": "rounded-none",
  "2px": "rounded-sm",
  "4px": "rounded",
  "6px": "rounded-md",
  "8px": "rounded-lg",
  "12px": "rounded-xl",
  "16px": "rounded-2xl",
  "24px": "rounded-3xl",
  "9999px": "rounded-full",
};

const DISPLAY: Record<string, string> = {
  block: "block",
  "inline-block": "inline-block",
  inline: "inline",
  flex: "flex",
  "inline-flex": "inline-flex",
  grid: "grid",
  "inline-grid": "inline-grid",
  table: "table",
  contents: "contents",
  "flow-root": "flow-root",
  "list-item": "list-item",
  none: "hidden",
};

const TEXT_ALIGN: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
  justify: "text-justify",
};

const BORDER_STYLES: Record<string, string> = {
  solid: "border-solid",
  dashed: "border-dashed",
  dotted: "border-dotted",
  double: "border-double",
  hidden: "border-hidden",
};

const BORDER_WIDTHS: Record<string, string> = {
  "0px": "border-0",
  "1px": "border",
  "2px": "border-2",
  "4px": "border-4",
  "8px": "border-8",
};

const WIDTH_FRACTIONS: Record<string, string> = {
  "50%": "w-1/2",
  "33.333%": "w-1/3",
  "66.667%": "w-2/3",
  "25%": "w-1/4",
  "75%": "w-3/4",
  "20%": "w-1/5",
  "40%": "w-2/5",
  "60%": "w-3/5",
  "80%": "w-4/5",
  "16.667%": "w-1/6",
  "100%": "w-full",
};

const HEIGHT_FRACTIONS: Record<string, string> = {
  "100%": "h-full",
};

interface Length {
  px: number;
  unit: string;
  raw: string;
}

/** Parse a CSS length into px (rem/em = 16px); null for anything else. */
function parseLength(value: string): Length | null {
  const m = /^(-?[\d.]+)(px|rem|em|%)$/.exec(value.trim());
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const px = m[2] === "rem" || m[2] === "em" ? n * 16 : n;
  return { px, unit: m[2], raw: m[1] + m[2] };
}

/** Spacing-scale name for a px amount, or null when outside the scale. */
function spacingName(px: number): string | null {
  if (px < 0) return null;
  for (const s of SPACING_SCALE) {
    if (Math.abs(s.px - px) < 0.01) return s.name;
  }
  return null;
}

/** Normalize any CSS color into a Tailwind color fragment (palette name or arbitrary hex); null when unknown. */
export function tailwindColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v === "transparent") return "transparent";
  if (v === "currentcolor") return "current";
  if (/^#[0-9a-f]{3,8}$/.test(v)) return normalizeHex(v);
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (!rgb) return null;
  const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number.parseFloat);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const to = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  if (parts[3] === undefined || parts[3] === 1) return normalizeHex("#" + to(parts[0]) + to(parts[1]) + to(parts[2]));
  const alpha = Math.round(Math.min(1, Math.max(0, parts[3])) * 255);
  return normalizeHex("#" + to(parts[0]) + to(parts[1]) + to(parts[2]) + alpha.toString(16).padStart(2, "0"));
}

function normalizeHex(hex: string): string {
  let h = hex.toLowerCase();
  if (/^#[0-9a-f]{4}$/.test(h) || /^#[0-9a-f]{3}$/.test(h)) {
    h = "#" + h.slice(1).split("").map((c) => c + c).join("");
  }
  return COLOR_SCALE[h] ?? h;
}

function colorClass(prefix: string, value: string): string | null {
  const color = tailwindColor(value);
  if (!color) return null;
  return color.startsWith("#") ? `${prefix}-[${color}]` : `${prefix}-${color}`;
}

/** One side of a padding/margin shorthand: scale class, negative-scale class or arbitrary value. */
function sideClass(prefix: string, len: Length): string {
  const scale = spacingName(len.px);
  if (scale !== null) return `${prefix}-${scale}`;
  if (len.px < 0) {
    const neg = spacingName(-len.px);
    if (neg !== null) return `-${prefix}-${neg}`;
  }
  return `${prefix}-[${formatLength(len)}]`;
}

function formatLength(len: Length): string {
  // rem/em values keep their unit (they scale with font size); px and % as-is.
  return len.raw;
}

/** Convert "8px 16px" | "8px 16px 24px" | full four-side shorthands into side pairs. */
function expandShorthand(value: string): { vertical: [Length, Length]; horizontal: [Length, Length] } | null {
  const lens = value.trim().split(/\s+/).map(parseLength);
  if (lens.some((l) => l === null)) return null;
  const sides = lens as Length[];
  if (sides.length === 1) return { vertical: [sides[0], sides[0]], horizontal: [sides[0], sides[0]] };
  if (sides.length === 2) return { vertical: [sides[0], sides[0]], horizontal: [sides[1], sides[1]] };
  if (sides.length === 3) return { vertical: [sides[0], sides[2]], horizontal: [sides[1], sides[1]] };
  if (sides.length === 4) return { vertical: [sides[0], sides[2]], horizontal: [sides[1], sides[3]] };
  return null;
}

function sameLength(a: Length, b: Length): boolean {
  return Math.abs(a.px - b.px) < 0.001 && a.unit === b.unit;
}

/** padding/margin shorthand -> one, two or four side classes (shorthand order: top right bottom left). */
function boxUtilities(base: "p" | "m", value: string): string[] | null {
  const sh = expandShorthand(value);
  if (!sh) return null;
  const [t, b] = sh.vertical;
  const [r, l] = sh.horizontal;
  if (sameLength(t, b) && sameLength(l, r)) {
    if (sameLength(t, l)) {
      return [sideClass(base, t)];
    }
    return [sideClass(`${base}y`, t), sideClass(`${base}x`, l)];
  }
  const per = [sideClass(`${base}t`, t), sideClass(`${base}r`, r), sideClass(`${base}b`, b), sideClass(`${base}l`, l)];
  return per;
}

function lengthUtility(prefix: string, value: string, fractionMap?: Record<string, string>): string | null {
  const v = value.trim();
  if (v === "auto") return null;
  if (fractionMap && fractionMap[v]) return fractionMap[v];
  const len = parseLength(v);
  if (!len) return null;
  const scale = spacingName(len.px);
  if (scale !== null) return `${prefix}-${scale}`;
  return `${prefix}-[${formatLength(len)}]`;
}

/**
 * Translate one CSS property/value into Tailwind utility classes to add.
 * Returns null when the value cannot be represented by Tailwind classes
 * (caller should fall back to raw-CSS editing).
 */
export function styleToUtilities(property: string, value: string): string[] | null {
  const v = value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  switch (property) {
    case "display":
      return DISPLAY[lower] ? [DISPLAY[lower]] : null;
    case "text-align":
      return TEXT_ALIGN[lower] ? [TEXT_ALIGN[lower]] : null;
    case "color":
    case "background-color":
    case "border-color": {
      const cls = colorClass(property === "color" ? "text" : property === "background-color" ? "bg" : "border", lower);
      return cls ? [cls] : null;
    }
    case "font-size": {
      const len = parseLength(lower);
      if (!len) return null;
      const px = Math.round(len.px);
      if (FONT_SIZES_PX[px]) return [FONT_SIZES_PX[px]];
      return [`text-[${px}px]`];
    }
    case "font-weight":
      return FONT_WEIGHTS[lower] ? [FONT_WEIGHTS[lower]] : null;
    case "padding":
      return boxUtilities("p", v);
    case "margin":
      return boxUtilities("m", v);
    case "border-radius": {
      const len = parseLength(lower);
      if (!len) return null;
      if (RADII[`${len.raw}`]) return [RADII[`${len.raw}`]];
      if (len.unit === "%" && len.raw === "50%") return ["rounded-full"];
      return [`rounded-[${formatLength(len)}]`];
    }
    case "width":
      return wrap(lengthUtility("w", v, WIDTH_FRACTIONS));
    case "height":
      return wrap(lengthUtility("h", v, HEIGHT_FRACTIONS));
    case "min-width":
      return wrap(lengthUtility("min-w", v));
    case "max-width":
      return wrap(lengthUtility("max-w", v));
    case "min-height":
      return wrap(lengthUtility("min-h", v));
    case "max-height":
      return wrap(lengthUtility("max-h", v));
    case "gap":
      return wrap(lengthUtility("gap", v));
    case "border-width":
      return BORDER_WIDTHS[lower] ? [BORDER_WIDTHS[lower]] : wrap(lengthUtility("border", lower));
    case "border-style":
      return BORDER_STYLES[lower] ? [BORDER_STYLES[lower]] : null;
    case "opacity": {
      const n = Number.parseFloat(v);
      if (!Number.isFinite(n)) return null;
      const pct = Math.round(n * 100);
      if (pct < 0 || pct > 100) return null;
      if (pct % 5 === 0) return [`opacity-${pct}`];
      return [`opacity-[${n}]`];
    }
    default:
      return null;
  }
}

function wrap(cls: string | null): string[] | null {
  return cls === null ? null : [cls];
}

/** Conflicts: an existing class is removed when it sets the same properties as one of the added classes. */
function conflicts(existing: string, added: string): boolean {
  const e = existing.trim();
  const a = added.trim();
  if (!e || !a) return false;
  if (e === a) return true;
  if (/^-?p([xytrbl])?-/.test(e) && /^-?p([xytrbl])?-/.test(a)) return true;
  if (/^-?m([xytrbl])?-/.test(e) && /^-?m([xytrbl])?-/.test(a)) return true;
  if (!e.startsWith("-") && /^w-/.test(e) && /^w-/.test(a)) return true;
  if (/^h-/.test(e) && /^h-/.test(a)) return true;
  if (/^min-w-/.test(e) && /^min-w-/.test(a)) return true;
  if (/^max-w-/.test(e) && /^max-w-/.test(a)) return true;
  if (/^min-h-/.test(e) && /^min-h-/.test(a)) return true;
  if (/^max-h-/.test(e) && /^max-h-/.test(a)) return true;
  if (/^gap-/.test(e) && /^gap-/.test(a)) return true;
  if (/^rounded(-|$)/.test(e) && /^rounded(-|$)/.test(a)) return true;
  if (/^opacity-/.test(e) && /^opacity-/.test(a)) return true;
  if (isBorderWidthClass(e) && isBorderWidthClass(a)) return true;
  if (isBorderStyleClass(e) && isBorderStyleClass(a)) return true;
  if (isBorderColorClass(e) && isBorderColorClass(a)) return true;
  if (isTextColorClass(e) && isTextColorClass(a)) return true;
  if (isBackgroundColorClass(e) && isBackgroundColorClass(a)) return true;
  if (isFontSizeClassOrArbitrary(e) && isFontSizeClassOrArbitrary(a)) return true;
  if (isFontWeightClass(e) && isFontWeightClass(a)) return true;
  if (isDisplayClass(e) && isDisplayClass(a)) return true;
  if (isTextAlignClass(e) && isTextAlignClass(a)) return true;
  return false;
}

function isBorderWidthClass(cls: string): boolean {
  return /^-?(border|border-(0|2|4|8))$/.test(cls) || /^border-\[\d/.test(cls);
}

function isBorderStyleClass(cls: string): boolean {
  return Object.values(BORDER_STYLES).includes(cls);
}

function isColorShadeOrKeyword(value: string): boolean {
  return (
    value === "white" || value === "black" || value === "transparent" || value === "current" || /^[a-z]+-\d{2,3}$/.test(value)
  );
}

function isPrefixedColorClass(cls: string, prefix: string): boolean {
  const m = new RegExp(`^${prefix}-(.+)$`).exec(cls);
  if (!m) return false;
  if (m[1].startsWith("[#") || m[1].startsWith("[rgb")) return true;
  return isColorShadeOrKeyword(m[1]);
}

function isBorderColorClass(cls: string): boolean {
  return isPrefixedColorClass(cls, "border") && !isBorderWidthClass(cls) && !isBorderStyleClass(cls);
}

function isTextColorClass(cls: string): boolean {
  return cls.startsWith("text-") && !isFontSizeClassOrArbitrary(cls) && !isTextAlignClass(cls) && isPrefixedColorClass(cls, "text");
}

function isBackgroundColorClass(cls: string): boolean {
  return isPrefixedColorClass(cls, "bg");
}

function isFontSizeClassOrArbitrary(cls: string): boolean {
  return TEXT_SIZE_CLASSES.has(cls) || /^text-\[\d/.test(cls);
}

function isFontWeightClass(cls: string): boolean {
  return Object.values(FONT_WEIGHTS).includes(cls);
}

function isDisplayClass(cls: string): boolean {
  return Object.values(DISPLAY).includes(cls);
}

function isTextAlignClass(cls: string): boolean {
  return Object.values(TEXT_ALIGN).includes(cls);
}

/**
 * Merge translated utilities into an element class list: classes conflicting
 * with any added utility are dropped, then the added ones are appended
 * (deduplicated). Class order of non-conflicting classes is preserved.
 */
export function resolveTailwindClassList(current: readonly string[], added: readonly string[]): string[] {
  const addList = added.filter((c) => c.length > 0);
  const kept = current.filter((c) => !addList.some((a) => conflicts(c, a)));
  const result = [...kept];
  for (const a of addList) {
    if (!result.includes(a)) result.push(a);
  }
  return result;
}

/** True for class names that are Tailwind utility names (not semantic component classes). */
export function isTailwindUtilityName(cls: string): boolean {
  return (
    isFontSizeClassOrArbitrary(cls) ||
    isFontWeightClass(cls) ||
    isDisplayClass(cls) ||
    isTextAlignClass(cls) ||
    /^(p|m|px|py|pt|pr|pb|pl|mx|my|mt|mr|mb|ml|w|h|min-w|max-w|min-h|max-h|gap|rounded|opacity|bg|text|border|font|flex|justify|items|leading|tracking|z|overflow|cursor|shadow|duration|transition)-/.test(cls) ||
    /^-[pm][ytrblx]?-/.test(cls)
  );
}

/**
 * True when an element's class list looks Tailwind-authored. Used as a
 * fallback when the runtime could not detect Tailwind at page level.
 */
export function looksLikeTailwindClasses(classes: readonly string[]): boolean {
  if (classes.length === 0) return false;
  let hits = 0;
  for (const c of classes) {
    if (isTailwindUtilityName(c)) {
      hits++;
    }
  }
  return hits / classes.length >= 0.5;
}
