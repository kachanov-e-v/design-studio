/**
 * Serializable definitions of inspector property editors. Validators and handlers
 * stay in the webview; only data crosses the postMessage boundary when needed.
 */
import type { MessageKey } from "@design-studio/shared/i18n";
import type { EditableAttribute } from "@design-studio/preview-runtime/protocol";

export type PropertyEditorKind = "text" | "textarea" | "select" | "color" | "slider" | "unit";

export type PropertyGroup = "layout" | "text" | "size" | "spacing" | "border" | "advanced";

export interface PropertyDefinition {
  /** CSS property name as used by `element.style.setProperty`. */
  key: string;
  group: PropertyGroup;
  editor: PropertyEditorKind;
  options?: string[];
  units?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export const PROPERTY_GROUP_LABEL_KEYS: Record<PropertyGroup, MessageKey> = {
  layout: "inspector.groupLayout",
  text: "inspector.groupText",
  size: "inspector.groupSize",
  spacing: "inspector.groupSpacing",
  border: "inspector.groupBorder",
  advanced: "inspector.groupAdvanced",
};

const LENGTH_UNITS = ["px", "rem", "em", "%", "vw", "vh"];

export const PROPERTY_DEFINITIONS: PropertyDefinition[] = [
  // layout
  { key: "display", group: "layout", editor: "select", options: ["", "block", "inline", "inline-block", "flex", "inline-flex", "grid", "inline-grid", "none", "contents"] },
  { key: "position", group: "layout", editor: "select", options: ["", "static", "relative", "absolute", "fixed", "sticky"] },
  { key: "flex-direction", group: "layout", editor: "select", options: ["", "row", "row-reverse", "column", "column-reverse"] },
  { key: "justify-content", group: "layout", editor: "select", options: ["", "flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"] },
  { key: "align-items", group: "layout", editor: "select", options: ["", "stretch", "flex-start", "center", "flex-end", "baseline"] },
  { key: "align-self", group: "layout", editor: "select", options: ["", "auto", "stretch", "flex-start", "center", "flex-end"] },
  { key: "grid-template-columns", group: "layout", editor: "textarea" },
  { key: "overflow", group: "layout", editor: "select", options: ["", "visible", "hidden", "auto", "scroll", "clip"] },
  { key: "z-index", group: "layout", editor: "unit", units: [""] },
  // text
  { key: "color", group: "text", editor: "color" },
  { key: "font-family", group: "text", editor: "text" },
  { key: "font-size", group: "text", editor: "unit", units: LENGTH_UNITS },
  { key: "font-weight", group: "text", editor: "select", options: ["", "normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"] },
  { key: "line-height", group: "text", editor: "unit", units: ["", ...LENGTH_UNITS] },
  { key: "letter-spacing", group: "text", editor: "unit", units: ["", "px", "em", "rem"] },
  { key: "text-align", group: "text", editor: "select", options: ["", "start", "end", "left", "center", "right", "justify"] },
  { key: "text-decoration", group: "text", editor: "select", options: ["", "none", "underline", "overline", "line-through"] },
  { key: "text-transform", group: "text", editor: "select", options: ["", "none", "uppercase", "lowercase", "capitalize"] },
  // size
  { key: "width", group: "size", editor: "unit", units: ["auto", ...LENGTH_UNITS] },
  { key: "height", group: "size", editor: "unit", units: ["auto", ...LENGTH_UNITS] },
  { key: "min-width", group: "size", editor: "unit", units: ["", "auto", ...LENGTH_UNITS] },
  { key: "max-width", group: "size", editor: "unit", units: ["", "auto", ...LENGTH_UNITS] },
  { key: "min-height", group: "size", editor: "unit", units: ["", "auto", ...LENGTH_UNITS] },
  { key: "max-height", group: "size", editor: "unit", units: ["", "auto", ...LENGTH_UNITS] },
  { key: "opacity", group: "size", editor: "slider", min: 0, max: 1, step: 0.01 },
  { key: "aspect-ratio", group: "size", editor: "text" },
  { key: "object-fit", group: "size", editor: "select", options: ["", "fill", "contain", "cover", "none", "scale-down"] },
  // spacing
  { key: "margin", group: "spacing", editor: "unit", units: ["auto", ...LENGTH_UNITS] },
  { key: "padding", group: "spacing", editor: "unit", units: LENGTH_UNITS },
  { key: "gap", group: "spacing", editor: "unit", units: LENGTH_UNITS },
  // border
  { key: "border", group: "border", editor: "text" },
  { key: "border-color", group: "border", editor: "color" },
  { key: "border-width", group: "border", editor: "unit", units: ["", ...LENGTH_UNITS] },
  { key: "border-style", group: "border", editor: "select", options: ["", "none", "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset", "hidden"] },
  { key: "border-radius", group: "border", editor: "unit", units: LENGTH_UNITS },
  { key: "outline", group: "border", editor: "text" },
  { key: "box-shadow", group: "border", editor: "textarea" },
  // advanced
  { key: "background-color", group: "advanced", editor: "color" },
  { key: "transition", group: "advanced", editor: "textarea" },
  { key: "transform", group: "advanced", editor: "textarea" },
  { key: "filter", group: "advanced", editor: "textarea" },
  { key: "cursor", group: "advanced", editor: "select", options: ["", "auto", "default", "pointer", "text", "grab", "grabbing", "not-allowed", "wait", "crosshair", "move", "zoom-in", "zoom-out"] },
];

/** CSS color of any format converted to a hex string for `<input type="color">`, or null. */
export function cssColorToHex(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*(\d*\.?\d+)\s*)?\)$/i.exec(v);
  if (!match) return null;
  const [, r, g, b] = match;
  return `#${[r, g, b].map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Parses a CSS length like `16px` into a numeric value and a unit, honoring allowed units. */
export function parseUnitValue(value: string, units: string[]): { number: number; unit: string } | null {
  const match = /^(-?\d*\.?\d+)([a-z%]*)$/i.exec(value.trim());
  if (!match) return null;
  const unit = match[2];
  if (unit !== "" && !units.includes(unit)) return null;
  return { number: Number(match[1]), unit };
}

export type AttributeEditorKind = "text" | "textarea" | "select" | "toggle" | "number" | "url";

export interface AttributeDefinition {
  /** Attribute name, must be listed in EDITABLE_ATTRIBUTES (P2-1: typed, not cast). */
  name: EditableAttribute;
  editor: AttributeEditorKind;
  options?: { label: string; value: string }[];
  /** Element tags the attribute applies to; empty array means every tag. */
  tags: string[];
}

const TRUE_TOGGLE = [{ label: "on", value: "true" }];

const INPUT_TYPES = [
  "text", "password", "email", "number", "tel", "url", "search",
  "date", "time", "datetime-local", "month", "week", "color",
  "checkbox", "radio", "range", "file", "hidden", "submit", "button", "reset", "image",
].map((value) => ({ label: value, value }));

const BINARY_TOGGLE = (name: EditableAttribute, tags: string[]): AttributeDefinition => ({ name, editor: "toggle", options: TRUE_TOGGLE, tags });

export const ATTRIBUTE_DEFINITIONS: AttributeDefinition[] = [
  // universal
  { name: "id", editor: "text", tags: [] },
  { name: "title", editor: "text", tags: [] },
  { name: "role", editor: "text", tags: [] },
  { name: "tabindex", editor: "number", tags: [] },
  { name: "aria-label", editor: "text", tags: [] },
  { name: "name", editor: "text", tags: ["input", "textarea", "select", "button", "form"] },
  // inputs, textarea, select, option
  { name: "type", editor: "select", options: INPUT_TYPES, tags: ["input"] },
  { name: "value", editor: "textarea", tags: ["input", "textarea", "select", "option", "button"] },
  { name: "placeholder", editor: "text", tags: ["input", "textarea"] },
  { name: "min", editor: "text", tags: ["input"] },
  { name: "max", editor: "text", tags: ["input"] },
  { name: "step", editor: "text", tags: ["input"] },
  { name: "minlength", editor: "number", tags: ["input", "textarea"] },
  { name: "maxlength", editor: "number", tags: ["input", "textarea"] },
  { name: "autocomplete", editor: "text", tags: ["input", "form"] },
  { name: "rows", editor: "number", tags: ["textarea"] },
  { name: "cols", editor: "number", tags: ["textarea"] },
  BINARY_TOGGLE("required", ["input", "textarea", "select", "button"]),
  BINARY_TOGGLE("disabled", ["input", "textarea", "select", "button"]),
  BINARY_TOGGLE("readonly", ["input", "textarea"]),
  BINARY_TOGGLE("checked", ["input"]),
  BINARY_TOGGLE("multiple", ["select", "input"]),
  { name: "selected", editor: "toggle", options: TRUE_TOGGLE, tags: ["option"] },
  // button
  { name: "type", editor: "select", options: [{ label: "button", value: "button" }, { label: "submit", value: "submit" }, { label: "reset", value: "reset" }], tags: ["button"] },
  // links and media
  { name: "href", editor: "url", tags: ["a"] },
  { name: "target", editor: "select", options: [{ label: "_self", value: "_self" }, { label: "_blank", value: "_blank" }, { label: "_parent", value: "_parent" }, { label: "_top", value: "_top" }], tags: ["a"] },
  { name: "rel", editor: "text", tags: ["a"] },
  { name: "src", editor: "url", tags: ["img", "video", "audio", "source"] },
  { name: "alt", editor: "text", tags: ["img", "area"] },
  { name: "width", editor: "number", tags: ["img", "video", "iframe"] },
  { name: "height", editor: "number", tags: ["img", "video", "iframe"] },
  { name: "loading", editor: "select", options: [{ label: "eager", value: "eager" }, { label: "lazy", value: "lazy" }], tags: ["img", "iframe"] },
  { name: "poster", editor: "url", tags: ["video"] },
  { name: "controls", editor: "toggle", options: TRUE_TOGGLE, tags: ["video", "audio"] },
  { name: "autoplay", editor: "toggle", options: TRUE_TOGGLE, tags: ["video", "audio"] },
  { name: "loop", editor: "toggle", options: TRUE_TOGGLE, tags: ["video", "audio"] },
  { name: "muted", editor: "toggle", options: TRUE_TOGGLE, tags: ["video", "audio"] },
  // forms
  { name: "action", editor: "url", tags: ["form"] },
  { name: "method", editor: "select", options: [{ label: "get", value: "get" }, { label: "post", value: "post" }, { label: "dialog", value: "dialog" }], tags: ["form"] },
  { name: "novalidate", editor: "toggle", options: TRUE_TOGGLE, tags: ["form"] },
  { name: "for", editor: "text", tags: ["label"] },
];

/** Relevant attribute definitions for a tag, deduplicated by name. */
export function attributeDefinitionsForTag(tag: string): AttributeDefinition[] {
  const seen = new Set<string>();
  const result: AttributeDefinition[] = [];
  for (const def of ATTRIBUTE_DEFINITIONS) {
    if (def.tags.length > 0 && !def.tags.includes(tag)) continue;
    if (seen.has(def.name)) continue;
    seen.add(def.name);
    result.push(def);
  }
  return result;
}
