"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { triggerNativeHaptic } from "@/components/capacitor-bridge";
import { ImpactStyle } from "@capacitor/haptics";

export interface SwipePhysicsResult {
  effectiveDeltaX: number;
  dynamicBlurPx: number;
  opacity: number;
  scale: number;
  incomingScale: number;
  incomingOpacity: number;
  incomingBlurPx: number;
  shadow: string;
}

/**
 * Pure physics calculation for swipe displacement, rubber-band resistance (~0.35),
 * dynamic motion blur (0px -> 12px), and incoming view pre-reveal (scale 0.96 -> 1.0,
 * opacity 0.5 -> 1.0, blur 8px -> 0px).
 */
export function computeSwipePhysics(
  rawDeltaX: number,
  containerWidth: number,
  canSwipePrev: boolean,
  canSwipeNext: boolean,
  maxBlurPx = 12,
): SwipePhysicsResult {
  const safeWidth = Math.max(containerWidth, 200);
  let effectiveDeltaX = rawDeltaX;

  // Apply rubber-band resistance (decay factor ~ 0.35) when swiping past first or last view
  if ((rawDeltaX > 0 && !canSwipePrev) || (rawDeltaX < 0 && !canSwipeNext)) {
    const sign = Math.sign(rawDeltaX);
    const abs = Math.abs(rawDeltaX);
    // Progressive logarithmic + 0.35 linear resistance
    effectiveDeltaX = sign * Math.min(abs * 0.35, 90 * Math.log10(1 + abs / 40));
  }

  const absEffective = Math.abs(effectiveDeltaX);
  const progress = Math.min(1, absEffective / (safeWidth * 0.65));

  // Dynamic blur scaled proportionally from 0px up to maxBlurPx (12px desktop, 8px mobile clamp)
  const dynamicBlurPx = Number(Math.min(maxBlurPx, (absEffective / 200) * maxBlurPx).toFixed(2));

  // Active card softens slightly (opacity 1 -> 0.85, scale 1 -> 0.97)
  const opacity = Number((1 - progress * 0.15).toFixed(3));
  const scale = Number((1 - progress * 0.03).toFixed(3));

  // Incoming card pre-reveal: starts at scale(0.96), opacity(0.5), blur(8px) -> 1.0, 1.0, 0px
  const incomingScale = Number((0.96 + progress * 0.04).toFixed(3));
  const incomingOpacity = Number((0.5 + progress * 0.5).toFixed(3));
  const incomingBlurPx = Number((8 * (1 - progress)).toFixed(2));

  // Elevated trailing edge directional shadow
  const dir = effectiveDeltaX <= 0 ? -1 : 1;
  const shadow = `${dir * 12}px 0 24px -6px rgba(0, 0, 0, 0.45)`;

  return {
    effectiveDeltaX,
    dynamicBlurPx,
    opacity,
    scale,
    incomingScale,
    incomingOpacity,
    incomingBlurPx,
    shadow,
  };
}

/**
 * Determines whether a swipe release meets the velocity-aware snapping threshold:
 * >= 25% distance OR flick velocity > 0.5 px/ms.
 */
export function evaluateSwipeSnap(
  deltaX: number,
  velocityPxPerMs: number,
  containerWidth: number,
  canSwipePrev: boolean,
  canSwipeNext: boolean,
): "next" | "prev" | "bounce" {
  const safeWidth = Math.max(containerWidth, 200);
  const distanceRatio = Math.abs(deltaX) / safeWidth;
  const absVelocity = Math.abs(velocityPxPerMs);

  const meetsThreshold = distanceRatio >= 0.25 || absVelocity > 0.5;

  if (!meetsThreshold) return "bounce";

  if (deltaX < 0 && canSwipeNext) {
    return "next";
  }
  if (deltaX > 0 && canSwipePrev) {
    return "prev";
  }
  return "bounce";
}

export interface SwipePaginationDotsProps {
  total: number;
  activeIndex: number;
  labels?: string[];
  onSelect?: (index: number) => void;
  visible?: boolean;
  className?: string;
}

/**
 * Ultra-compact native widget pagination dots (inspired by iOS/OneUI Smart Stack widgets).
 * Appears subtly on touch/swipe/hover and fades out when idle.
 */
export function SwipePaginationDots({
  total,
  activeIndex,
  labels,
  onSelect,
  visible = true,
  className,
}: SwipePaginationDotsProps) {
  if (total <= 1) return null;
  return (
    <div
      role="tablist"
      aria-label="View pagination"
      className={cn(
        "flex items-center justify-center gap-1 py-0.5 select-none transition-all duration-300 ease-out",
        visible ? "opacity-90 translate-y-0" : "opacity-0 translate-y-0.5 pointer-events-none",
        className,
      )}
    >
      {Array.from({ length: total }).map((_, idx) => {
        const isActive = idx === activeIndex;
        const label = labels?.[idx] ?? `View ${idx + 1}`;
        return (
          <button
            key={idx}
            type="button"
            role="tab"
            data-pagination-dot="true"
            aria-selected={isActive}
            aria-label={label}
            title={label}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(idx);
            }}
            style={{
              minWidth: 0,
              minHeight: 0,
              width: "auto",
              height: "auto",
              padding: "2px",
              background: "transparent",
            }}
            className="group/dot flex items-center justify-center p-0.5 !min-h-0 !min-w-0 focus:outline-none"
          >
            <span
              style={{
                width: isActive ? "14px" : "5px",
                height: "5px",
                minWidth: 0,
                minHeight: 0,
              }}
              className={cn(
                "block h-1.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                isActive
                  ? "w-3.5 bg-primary/90 shadow-[0_0_6px_rgba(99,102,241,0.45)]"
                  : "w-1.5 bg-muted/35 group-hover/dot:bg-muted/65",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

export interface SwipeableWidgetProps {
  children: React.ReactNode;
  activeIndex: number;
  totalViews: number;
  viewLabels?: string[];
  onIndexChange: (nextIndex: number) => void;
  incomingPreview?: React.ReactNode;
  showDots?: boolean;
  className?: string;
  disabled?: boolean;
}

/**
 * Interactive velocity-tracked swipeable container with 1:1 pointer tracking,
 * logarithmic rubber-banding, dynamic motion blur, and tactile pagination dots.
 */
export function SwipeableWidget({
  children,
  activeIndex,
  totalViews,
  viewLabels,
  onIndexChange,
  incomingPreview,
  showDots = true,
  className,
  disabled = false,
}: SwipeableWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    isRubberBanding: boolean;
    physics: SwipePhysicsResult | null;
  }>({
    isDragging: false,
    isRubberBanding: false,
    physics: null,
  });

  const [dotsVisible, setDotsVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revealDotsBriefly = useCallback(() => {
    setDotsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setDotsVisible(false);
    }, 1800);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const gestureRef = useRef<{
    active: boolean;
    lockedAxis: "x" | "y" | null;
    startX: number;
    startY: number;
    lastX: number;
    lastTimestamp: number;
    velocityX: number;
    width: number;
  }>({
    active: false,
    lockedAxis: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTimestamp: 0,
    velocityX: 0,
    width: 320,
  });

  const canSwipePrev = activeIndex > 0;
  const canSwipeNext = activeIndex < totalViews - 1;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || totalViews <= 1) return;
      revealDotsBriefly();
      // Ignore interactive child elements like buttons, inputs, selects, links
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          'button, a, input, select, textarea, [role="button"], [role="tab"], [data-no-swipe]',
        )
      ) {
        return;
      }

      const rect = containerRef.current?.getBoundingClientRect();
      gestureRef.current = {
        active: true,
        lockedAxis: null,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastTimestamp: performance.now(),
        velocityX: 0,
        width: rect?.width || 320,
      };
    },
    [disabled, totalViews, revealDotsBriefly],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current;
      if (!g.active) return;

      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;

      if (!g.lockedAxis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.lockedAxis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        if (g.lockedAxis === "y") {
          g.active = false;
          return;
        }
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }

      if (g.lockedAxis !== "x") return;

      revealDotsBriefly();
      const now = performance.now();
      const dt = Math.max(1, now - g.lastTimestamp);
      const instantVel = (e.clientX - g.lastX) / dt;
      g.velocityX = g.velocityX * 0.4 + instantVel * 0.6;
      g.lastX = e.clientX;
      g.lastTimestamp = now;

      const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
      const maxBlur = isMobile ? 8 : 12;
      const physics = computeSwipePhysics(dx, g.width, canSwipePrev, canSwipeNext, maxBlur);

      setDragState({
        isDragging: true,
        isRubberBanding: false,
        physics,
      });
    },
    [canSwipePrev, canSwipeNext, revealDotsBriefly],
  );

  const finishGesture = useCallback(
    (clientX: number) => {
      const g = gestureRef.current;
      if (!g.active) return;
      g.active = false;
      revealDotsBriefly();

      if (g.lockedAxis !== "x") {
        setDragState({ isDragging: false, isRubberBanding: false, physics: null });
        return;
      }

      const dx = clientX - g.startX;
      const decision = evaluateSwipeSnap(
        dx,
        g.velocityX,
        g.width,
        canSwipePrev,
        canSwipeNext,
      );

      if (decision === "next") {
        triggerNativeHaptic(ImpactStyle.Light).catch(() => {});
        onIndexChange(activeIndex + 1);
        setDragState({ isDragging: false, isRubberBanding: false, physics: null });
      } else if (decision === "prev") {
        triggerNativeHaptic(ImpactStyle.Light).catch(() => {});
        onIndexChange(activeIndex - 1);
        setDragState({ isDragging: false, isRubberBanding: false, physics: null });
      } else {
        setDragState({ isDragging: false, isRubberBanding: true, physics: null });
      }
    },
    [activeIndex, canSwipeNext, canSwipePrev, onIndexChange, revealDotsBriefly],
  );

  const p = dragState.physics;
  const cssVars = p
    ? ({
        "--swipe-x": `${p.effectiveDeltaX.toFixed(1)}px`,
        "--swipe-scale": String(p.scale),
        "--swipe-blur": `${p.dynamicBlurPx}px`,
        "--swipe-content-blur": `${(p.dynamicBlurPx * 0.35).toFixed(1)}px`,
        "--swipe-opacity": String(p.opacity),
        "--swipe-shadow": p.shadow,
        "--incoming-scale": String(p.incomingScale),
        "--incoming-opacity": String(p.incomingOpacity),
        "--incoming-blur": `${p.incomingBlurPx}px`,
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={cn("group/swipe flex flex-col gap-0.5", className)}
      onPointerEnter={revealDotsBriefly}
    >
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishGesture(e.clientX)}
        onPointerCancel={(e) => finishGesture(e.clientX)}
        style={cssVars}
        className={cn(
          "swipeable-card relative select-none",
          totalViews > 1 && !disabled && "cursor-grab active:cursor-grabbing",
          dragState.isDragging && "is-dragging",
          dragState.isRubberBanding && "is-rubber-banding",
        )}
      >
        {incomingPreview && dragState.isDragging && (
          <div
            aria-hidden="true"
            className="swipeable-incoming-view is-dragging pointer-events-none absolute inset-0 -z-10"
          >
            {incomingPreview}
          </div>
        )}
        {children}
      </div>

      {showDots && totalViews > 1 && (
        <SwipePaginationDots
          total={totalViews}
          activeIndex={activeIndex}
          labels={viewLabels}
          visible={dotsVisible || dragState.isDragging}
          onSelect={(idx) => {
            revealDotsBriefly();
            onIndexChange(idx);
          }}
        />
      )}
    </div>
  );
}
