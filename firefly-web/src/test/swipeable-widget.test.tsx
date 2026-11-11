import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  computeSwipePhysics,
  evaluateSwipeSnap,
  SwipePaginationDots,
  SwipeableWidget,
} from "@/components/swipeable-widget";
import { computeEdgeResizePhysics } from "@/app/(app)/dashboard-client";

describe("Swipe Physics & Dynamic Depth Effects", () => {
  it("tracks 1:1 displacement when swiping towards an available view", () => {
    const res = computeSwipePhysics(-100, 400, true, true, 12);
    expect(res.effectiveDeltaX).toBe(-100);
    expect(res.dynamicBlurPx).toBe(6);
    expect(res.opacity).toBeLessThan(1);
    expect(res.scale).toBeLessThan(1);
    expect(res.incomingScale).toBeGreaterThan(0.96);
    expect(res.incomingOpacity).toBeGreaterThan(0.5);
    expect(res.incomingBlurPx).toBeLessThan(8);
  });

  it("applies progressive rubber-band resistance (~0.35) when swiping past boundary", () => {
    const res = computeSwipePhysics(120, 400, false, true, 12);
    expect(res.effectiveDeltaX).toBeGreaterThan(0);
    expect(res.effectiveDeltaX).toBeLessThanOrEqual(42.1);
  });

  it("clamps dynamic blur to maxBlurPx (12px desktop / 8px mobile)", () => {
    const desktop = computeSwipePhysics(-300, 400, true, true, 12);
    expect(desktop.dynamicBlurPx).toBe(12);

    const mobile = computeSwipePhysics(-300, 400, true, true, 8);
    expect(mobile.dynamicBlurPx).toBe(8);
  });

  it("evaluates velocity-aware snapping (>= 25% distance OR > 0.5 px/ms velocity)", () => {
    // >= 25% distance (110 / 400 = 27.5%)
    expect(evaluateSwipeSnap(-110, 0.1, 400, true, true)).toBe("next");
    expect(evaluateSwipeSnap(110, 0.1, 400, true, true)).toBe("prev");

    // High flick velocity (> 0.5 px/ms) with short distance
    expect(evaluateSwipeSnap(-30, -0.75, 400, true, true)).toBe("next");
    expect(evaluateSwipeSnap(30, 0.75, 400, true, true)).toBe("prev");

    // Below both thresholds -> bounce back
    expect(evaluateSwipeSnap(-40, -0.2, 400, true, true)).toBe("bounce");

    // Boundary blocked -> bounce back
    expect(evaluateSwipeSnap(-150, -0.9, 400, true, false)).toBe("bounce");
    expect(evaluateSwipeSnap(150, 0.9, 400, false, true)).toBe("bounce");
  });

  it("renders SwipePaginationDots with ultra-compact active capsule (w-3.5 vs w-1.5) and data-pagination-dot", () => {
    const html = renderToStaticMarkup(
      <SwipePaginationDots
        total={3}
        activeIndex={1}
        labels={["Last 7 days", "Last 30 days", "Last 90 days"]}
      />,
    );
    expect(html).toContain("w-3.5");
    expect(html).toContain("w-1.5");
    expect(html).toContain('data-pagination-dot="true"');
    expect(html).toContain('aria-label="Last 30 days"');
  });

  it("renders SwipeableWidget with cursor-grab, touch-pan-y, data-swipe-v2, and swipeable-card classes", () => {
    const html = renderToStaticMarkup(
      <SwipeableWidget
        activeIndex={0}
        totalViews={2}
        viewLabels={["Accounts", "Budgets"]}
        onIndexChange={() => {}}
      >
        <div>Panel Content</div>
      </SwipeableWidget>,
    );
    expect(html).toContain("swipeable-card");
    expect(html).toContain("touch-pan-y");
    expect(html).toContain('data-swipe-v2="true"');
    expect(html).toContain("cursor-grab");
    expect(html).toContain("Panel Content");
  });

  it("computes edge-resize swipe physics with elastic stretching, rubber-banding, and dynamic blur", () => {
    // Expanding a 1-col card (dx > 0)
    const expand = computeEdgeResizePhysics(100, 400, 1);
    expect(expand.effectiveDx).toBeGreaterThan(0);
    expect(expand.scaleX).toBeGreaterThan(1);
    expect(expand.blurPx).toBeGreaterThan(0);
    expect(expand.opacity).toBeLessThan(1);

    // Rubber-banding when trying to shrink a 1-col card further (dx < 0)
    const rubber = computeEdgeResizePhysics(-100, 400, 1);
    expect(Math.abs(rubber.effectiveDx)).toBeLessThanOrEqual(35);
    expect(rubber.scaleX).toBeLessThan(1);

    // Shrinking a 2-col card (dx < 0)
    const shrink = computeEdgeResizePhysics(-120, 800, 2);
    expect(shrink.effectiveDx).toBeLessThan(0);
    expect(shrink.scaleX).toBeLessThan(1);
    expect(shrink.blurPx).toBeGreaterThan(0);
  });
});
