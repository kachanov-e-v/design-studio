import type { ComponentInfo, ElementPayload, SourceRule } from "../../../packages/preview-runtime/src/protocol";
import type { SourceHint } from "../../infrastructure/source-analysis/SourceHintFinder";
import type { DesignEdit } from "./DesignEdit";
import type { Language } from "../../shared/i18n";

export interface ElementSelectionContext {
  selector: string;
  selectors?: string[];
  tag: string;
  styles: Record<string, string>;
  classes?: string[];
  id?: string;
  tailwind?: boolean;
  text?: string;
  rules?: SourceRule[];
  /** React owner components, nearest first; files resolved against the workspace. */
  components?: ComponentInfo[];
  sourceHints?: SourceHint[];
}

export function toSelectionContext(payload: ElementPayload, sourceHints?: SourceHint[]): ElementSelectionContext {
  const ctx: ElementSelectionContext = {
    selector: payload.selector,
    selectors: payload.selectors,
    tag: payload.tag,
    styles: payload.styles,
  };
  if (payload.text) ctx.text = payload.text;
  if (payload.classes && payload.classes.length > 0) ctx.classes = payload.classes;
  const idFromSelector = /^#([^.#\s>]+)$/.exec(payload.selector);
  if (idFromSelector) ctx.id = idFromSelector[1];
  if (payload.tailwind === true) ctx.tailwind = true;
  if (payload.rules && payload.rules.length > 0) ctx.rules = payload.rules;
  if (payload.component && payload.component.length > 0) ctx.components = payload.component;
  if (sourceHints && sourceHints.length > 0) ctx.sourceHints = sourceHints;
  return ctx;
}

function shortHref(href: string): string {
  // Dev-server hrefs often come through the Design Studio proxy; strip its prefix.
  const legacy = /\/proxy\/(https?:\/\/.+)/.exec(href);
  const structured = /\/proxy\/(https?)\/([^/]+)(\/.*)$/.exec(href);
  const clean = legacy ? legacy[1] : structured ? `${structured[1]}://${structured[2]}${structured[3]}` : href;
  try {
    const u = new URL(clean);
    return u.pathname + u.search;
  } catch {
    return clean.length > 120 ? clean.slice(0, 117) + "..." : clean;
  }
}

export function contextToPrompt(
  ctx: ElementSelectionContext | null,
  instruction: string,
  edits: DesignEdit[] = [],
  language: Language = "ru",
  framework = "Next.js"
): string {
  const styles = Object.entries(ctx?.styles ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  const ownerChain = (ctx?.components ?? [])
    .map((c) => c.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .join(" > ");
  const first = ctx?.components?.find((c) => c.name || c.file);
  const componentLine =
    first && (first.name || first.file)
      ? `${language === "ru" ? "Компонент React" : "React component"}: ${first.name ?? "<anonymous>"}${first.file ? ` — ${first.file}${first.line ? `:${first.line}` : ""}` : ""}`
      : null;
  const editLines = edits.length
    ? [
        language === "ru" ? "Изменения, выполненные в визуальном редакторе:" : "Changes made in the visual editor:",
        ...edits.map((edit, index) => {
          const where = edit.component?.file
            ? `${edit.component.file}${edit.component.line ? `:${edit.component.line}` : ""}`
            : edit.component?.name ?? edit.selector;
          if (edit.kind === "style") {
            return `${index + 1}. CSS ${edit.property}: ${JSON.stringify(edit.before ?? "")} → ${JSON.stringify(edit.after ?? "")} (${where}; ${edit.selector})`;
          }
          if (edit.kind === "classes") {
            return `${index + 1}. ${language === "ru" ? "Классы" : "Classes"}: ${JSON.stringify(edit.before ?? "")} → ${JSON.stringify(edit.after ?? "")} (${where}; ${edit.selector})`;
          }
          if (edit.kind === "text") {
            return `${index + 1}. ${language === "ru" ? "Текст" : "Text"}: ${JSON.stringify(edit.before ?? "")} → ${JSON.stringify(edit.after ?? "")} (${where}; ${edit.selector})`;
          }
          return `${index + 1}. ${language === "ru" ? "Структура" : "Structure"}: ${edit.operation ?? "change"} (${where}; ${edit.selector})`;
        }),
      ].join("\n")
    : language === "ru"
      ? "Визуальные изменения пока не выполнялись."
      : "No visual changes have been made yet.";
  const lines = [
    language === "ru" ? "Инструкция для ИИ-кодового агента · Дизайн-студия" : "AI coding agent instruction · Design Studio",
    language === "ru" ? `Проект: ${framework}. Изучи существующие соглашения и внеси изменения в исходный код.` : `Project: ${framework}. Follow existing conventions and update the source code.`,
    ctx
      ? `${language === "ru" ? "Выбранный элемент" : "Selected element"}: ${ctx.tag}${ctx.id ? `#${ctx.id}` : ""}${ctx.classes?.length ? `.${ctx.classes.join(".")}` : ""} (${ctx.selector})`
      : language === "ru" ? "Область изменений: текущая страница или проект в целом." : "Change scope: the current page or project as a whole.",
    componentLine,
    ownerChain && (ctx?.components?.length ?? 0) > 1 ? `${language === "ru" ? "Цепочка компонентов" : "Component chain"}: ${ownerChain}` : null,
    ctx?.tailwind ? (language === "ru" ? "Tailwind CSS обнаружен: отражай правки стилей в классах элемента." : "Tailwind CSS detected: express style edits through the element classes.") : null,
    ctx?.text ? `${language === "ru" ? "Текст" : "Text"}: ${ctx.text}` : null,
    `${language === "ru" ? "Вычисленные стили" : "Computed styles"}: ${styles}`,
    ctx?.rules?.length
      ? `${language === "ru" ? "Подходящие правила CSS" : "Matched CSS rules"}:\n${ctx.rules.map((r) => `- ${shortHref(r.href)} :: ${r.selectorText}`).join("\n")}`
      : null,
    ctx?.sourceHints?.length
      ? [
          language === "ru" ? "Возможные исходные файлы (проверь содержимое перед изменением):" : "Possible source files (verify the file contents before editing):",
          ...ctx.sourceHints.map((h) => `- ${h.file}:${h.line} — ${h.snippet} (matched ${h.token})`),
        ].join("\n")
      : null,
    editLines,
    `${language === "ru" ? "Пожелание пользователя" : "User request"}: ${instruction || (language === "ru" ? "Синхронизируй с исходным кодом перечисленные визуальные изменения." : "Synchronize the listed visual changes with the source code.")}`,
    "",
    language === "ru"
      ? `${ctx ? "Найди указанный компонент" : "Найди подходящие страницы и компоненты"} и внеси перечисленные изменения в исходный код. Сохрани структуру проекта${framework === "Next.js" ? " Next.js, границы Server/Client Components" : ""}, доступность и существующий стиль кода. Не меняй несвязанные файлы. В конце перечисли изменённые файлы и кратко опиши результат.`
      : `${ctx ? "Locate the referenced component" : "Locate the relevant pages and components"} and apply the listed changes in source. Preserve the project structure${framework === "Next.js" ? " and Next.js Server/Client Component boundaries" : ""}, accessibility, and existing code style. Avoid unrelated files. Finish by listing changed files and summarizing the result.`,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}
