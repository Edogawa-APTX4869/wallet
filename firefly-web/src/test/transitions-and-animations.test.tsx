import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpeedDialFab } from "@/components/speed-dial-fab";
import { ModalSheet } from "@/components/ui";
import { PageTransition } from "@/components/page-transition";
import fs from "fs";
import path from "path";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithProviders(node: React.ReactElement): string {
  const qc = createTestQueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  );
}

describe("SpeedDialFab Staggered & Fluid Animations", () => {
  it("renders with staggered fab-pill-in classes and calculated animation delays when open", () => {
    const html = renderWithProviders(<SpeedDialFab isOpen={true} onToggle={() => {}} />);
    expect(html).toContain("fab-pill-in");
    expect(html).toContain("drawer-backdrop-in");
    expect(html).toContain("data-testid=\"fab-backdrop\"");
    expect(html).toContain("rotate-45");
    // Verify staggered delays for action pills
    expect(html).toContain("animation-delay:0ms");
    expect(html).toContain("animation-delay:35ms");
    expect(html).toContain("animation-delay:70ms");
    expect(html).toContain("animation-delay:105ms");
  });

  it("does not render backdrop or open pills when closed", () => {
    const html = renderWithProviders(<SpeedDialFab isOpen={false} onToggle={() => {}} />);
    expect(html).not.toContain("data-testid=\"fab-backdrop\"");
    expect(html).not.toContain("fab-pill-in");
    expect(html).not.toContain("rotate-45");
    expect(html).toContain("size-14");
    expect(html).toContain("rounded-full");
  });
});

describe("ModalSheet Smooth Transitions", () => {
  it("renders with sheet-up and drawer-backdrop-in when opened", () => {
    const html = renderToStaticMarkup(
      <ModalSheet open={true} onClose={() => {}} title="Test Modal">
        <p>Modal content</p>
      </ModalSheet>,
    );
    expect(html).toContain("sheet-up");
    expect(html).toContain("drawer-backdrop-in");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).toContain("Test Modal");
  });

  it("renders nothing when closed initially", () => {
    const html = renderToStaticMarkup(
      <ModalSheet open={false} onClose={() => {}} title="Closed Modal">
        <p>Nothing here</p>
      </ModalSheet>,
    );
    expect(html).toBe("");
  });
});

describe("PageTransition Architecture", () => {
  it("wraps child route screens with page-enter animation and view-transition-name", () => {
    const html = renderToStaticMarkup(
      <PageTransition>
        <div data-testid="dashboard-screen">Dashboard Screen</div>
      </PageTransition>,
    );
    expect(html).toContain("page-enter");
    expect(html).toContain("view-transition-name:page-content");
    expect(html).toContain("Dashboard Screen");
  });
});

describe("CSS Motion & Reduced-Motion Contracts", () => {
  it("defines all GPU-accelerated keyframes and transition classes in globals.css", () => {
    const cssPath = path.resolve(process.cwd(), "src/app/globals.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // Check keyframe definitions
    expect(cssContent).toContain("@keyframes page-enter");
    expect(cssContent).toContain("@keyframes fab-pill-in");
    expect(cssContent).toContain("@keyframes fab-pill-out");
    expect(cssContent).toContain("@keyframes sheet-down");
    expect(cssContent).toContain("@keyframes popover-in");
    expect(cssContent).toContain("@keyframes pop-out");

    // Check View Transitions API rules for root and page-content
    expect(cssContent).toContain("@view-transition");
    expect(cssContent).toContain("navigation: auto");
    expect(cssContent).toContain("::view-transition-old(page-content)");
    expect(cssContent).toContain("::view-transition-new(page-content)");

    // Check reduced motion overrides
    expect(cssContent).toContain(".page-enter");
    expect(cssContent).toContain(".fab-pill-in");
    expect(cssContent).toContain(".fab-pill-out");
    expect(cssContent).toContain(".popover-in");
    expect(cssContent).toContain(".sheet-down");
    expect(cssContent).toContain(".animate-pop-out");
    expect(cssContent).toContain("::view-transition-group(*)");
    expect(cssContent).toContain("opacity: 0 !important");
  });
});
