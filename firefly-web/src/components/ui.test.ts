import React from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "./ui";

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (full.endsWith(".tsx") && !full.endsWith(".test.tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("Select design system consistency", () => {
  it("renders with appearance-none, custom ChevronDown indicator, and rounded-xl borders", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Select,
        { "aria-label": "Payment currency", defaultValue: "BHD" },
        React.createElement("option", { value: "BHD" }, "BHD (account currency)"),
      ),
    );

    expect(html).toContain("appearance-none");
    expect(html).toContain("rounded-xl");
    expect(html).toContain("pe-9");
    expect(html).toContain("<svg");
    expect(html).toContain("lucide-chevron-down");
  });

  it("routes layout/sizing classes to wrapper and preserves compact chevron spacing", () => {
    const autoWidthHtml = renderToStaticMarkup(
      React.createElement(
        Select,
        { className: "h-8 min-w-[145px] w-auto pl-2.5 pr-7 text-xs font-medium", "aria-label": "Period" },
        React.createElement("option", { value: "30" }, "Last 30 days"),
      ),
    );
    expect(autoWidthHtml).toContain('class="relative min-w-[145px] w-auto"');
    expect(autoWidthHtml).toContain("end-2 size-3.5");
    expect(autoWidthHtml).toContain("pr-7");

    const flexHtml = renderToStaticMarkup(
      React.createElement(
        Select,
        { className: "min-w-36 flex-1", "aria-label": "Category" },
        React.createElement("option", { value: "" }, "Any category"),
      ),
    );
    expect(flexHtml).toContain('class="relative min-w-36 flex-1"');

    const colSpanHtml = renderToStaticMarkup(
      React.createElement(
        Select,
        { className: "col-span-2 h-7 rounded-lg px-2 text-xs", "aria-label": "Budget" },
        React.createElement("option", { value: "" }, "No budget"),
      ),
    );
    expect(colSpanHtml).toContain('class="relative min-w-0 w-full col-span-2"');
    expect(colSpanHtml).toContain("pe-7");
  });

  it("ensures every select control in the app uses the shared Select primitive (no raw <select> outside ui.tsx)", () => {
    const srcRoot = path.resolve(__dirname, "..");
    const tsxFiles = collectSourceFiles(srcRoot);
    const rawSelectFiles = tsxFiles.filter((filePath) => {
      if (filePath.endsWith(path.join("components", "ui.tsx"))) return false;
      const src = readFileSync(filePath, "utf8");
      return /<select[\s>]/.test(src);
    });

    expect(rawSelectFiles).toEqual([]);
  });
});
