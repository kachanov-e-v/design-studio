import type { ElementPayload } from "./types";

type ComponentLike = NonNullable<ElementPayload["component"]>[number];

/**
 * The component "Reveal" opens: the nearest owner with a source file outside
 * node_modules. Keeps the popup title, the edit journal and the reveal target
 * consistent (styled wrappers like MuiPaperRoot must not shadow the app
 * component whose file actually opens).
 */
export function primaryComponent(components: ComponentLike[] | undefined): ComponentLike | undefined {
  if (!components || components.length === 0) return undefined;
  return (
    components.find((c) => c.name && c.file && !/(^|\/)node_modules\//.test(c.file)) ??
    components.find((c) => c.name && c.file) ??
    components.find((c) => c.name) ??
    components[0]
  );
}
