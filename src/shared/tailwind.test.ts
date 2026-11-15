import { describe, expect, it } from "vitest";
import { resolveTailwindClassList, styleToUtilities, tailwindColor } from "./tailwind";

describe("tailwindColor", () => {
  it("maps palette colors", () => {
    expect(tailwindColor("rgb(59, 130, 246)")).toBe("blue-500");
    expect(tailwindColor("#3B82F6")).toBe("blue-500");
    expect(tailwindColor("#fff")).toBe("white");
    expect(tailwindColor("rgba(0, 0, 0, 0)")).toBe("#00000000");
  });

  it("falls back to arbitrary hex", () => {
    expect(tailwindColor("rgb(12, 34, 56)")).toBe("#0c2238");
  });

  it("returns null for untranslatable colors", () => {
    expect(tailwindColor("var(--x)")).toBeNull();
    expect(tailwindColor("")).toBeNull();
  });
});

describe("styleToUtilities", () => {
  it("maps display, text-align and font-weight", () => {
    expect(styleToUtilities("display", "flex")).toEqual(["flex"]);
    expect(styleToUtilities("display", "none")).toEqual(["hidden"]);
    expect(styleToUtilities("text-align", "center")).toEqual(["text-center"]);
    expect(styleToUtilities("font-weight", "700")).toEqual(["font-bold"]);
    expect(styleToUtilities("font-weight", "bold")).toEqual(["font-bold"]);
  });

  it("maps colors", () => {
    expect(styleToUtilities("color", "rgb(239, 68, 68)")).toEqual(["text-red-500"]);
    expect(styleToUtilities("background-color", "#3B82F6")).toEqual(["bg-blue-500"]);
    expect(styleToUtilities("color", "rgb(1, 2, 3)")).toEqual(["text-[#010203]"]);
  });

  it("maps font sizes on the default scale and arbitrary sizes", () => {
    expect(styleToUtilities("font-size", "16px")).toEqual(["text-base"]);
    expect(styleToUtilities("font-size", "13px")).toEqual(["text-[13px]"]);
    expect(styleToUtilities("font-size", "1rem")).toEqual(["text-base"]);
  });

  it("maps padding shorthand", () => {
    expect(styleToUtilities("padding", "16px")).toEqual(["p-4"]);
    expect(styleToUtilities("padding", "8px 16px")).toEqual(["py-2", "px-4"]);
    expect(styleToUtilities("padding", "9px")).toEqual(["p-[9px]"]);
    expect(styleToUtilities("padding", "4px 8px 12px 16px")).toEqual(["pt-1", "pr-2", "pb-3", "pl-4"]);
  });

  it("maps negative margins", () => {
    expect(styleToUtilities("margin", "-8px")).toEqual(["-m-2"]);
    expect(styleToUtilities("margin", "0px")).toEqual(["m-0"]);
  });

  it("maps border-radius, sizes and gap", () => {
    expect(styleToUtilities("border-radius", "9999px")).toEqual(["rounded-full"]);
    expect(styleToUtilities("border-radius", "50%")).toEqual(["rounded-full"]);
    expect(styleToUtilities("border-radius", "10px")).toEqual(["rounded-[10px]"]);
    expect(styleToUtilities("width", "100%")).toEqual(["w-full"]);
    expect(styleToUtilities("width", "32px")).toEqual(["w-8"]);
    expect(styleToUtilities("height", "37px")).toEqual(["h-[37px]"]);
    expect(styleToUtilities("gap", "24px")).toEqual(["gap-6"]);
  });

  it("returns null for unsupported values and properties", () => {
    expect(styleToUtilities("width", "auto")).toBeNull();
    expect(styleToUtilities("width", "fit-content")).toBeNull();
    expect(styleToUtilities("box-shadow", "0 0 0 red")).toBeNull();
    expect(styleToUtilities("unknown-prop", "1px")).toBeNull();
  });
});

describe("resolveTailwindClassList", () => {
  it("replaces classes in the same property group", () => {
    expect(resolveTailwindClassList(["kanban-card", "p-4", "bg-white"], ["p-2"])).toEqual(["kanban-card", "bg-white", "p-2"]);
    expect(resolveTailwindClassList(["p-4", "px-6"], ["py-2"])).toEqual(["py-2"]);
    expect(resolveTailwindClassList(["ml-2", "-mr-1"], ["my-4"])).toEqual(["my-4"]);
  });

  it("keeps other prefix groups intact", () => {
    expect(resolveTailwindClassList(["text-sm", "text-left"], ["text-red-500"])).toEqual(["text-sm", "text-left", "text-red-500"]);
    expect(resolveTailwindClassList(["text-base", "text-red-500"], ["text-lg"])).toEqual(["text-red-500", "text-lg"]);
    expect(resolveTailwindClassList(["w-full"], ["w-8"])).toEqual(["w-8"]);
    expect(resolveTailwindClassList(["rounded-lg"], ["rounded-full"])).toEqual(["rounded-full"]);
    expect(resolveTailwindClassList(["hover:p-4"], ["p-2"])).toEqual(["hover:p-4", "p-2"]);
  });

  it("deduplicates and preserves order", () => {
    expect(resolveTailwindClassList(["a", "b"], ["b"])).toEqual(["a", "b"]);
  });
});
