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
 * >= 18% distance (or >= 56px) OR flick velocity > 0.35 px/ms.
 */
export function evaluateSwipeSnap(
  deltaX: number,
  velocityPxPerMs: number,
  containerWidth: number,
  canSwipePrev: boolean,
  canSwipeNext: boolean,
): "next" | "prev" | "bounce" {
  const safeWidth = Math.max(containerWidth, 200);
  const absDelta = Math.abs(deltaX);
  const distanceRatio = absDelta / safeWidth;
  const absVelocity = Math.abs(velocityPxPerMs);

  const meetsThreshold =
    distanceRatio >= 0.18 || absDelta >= 56 || (absDelta >= 16 && absVelocity > 0.35);

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

  // Track directional transition ("next" slides in from right, "prev" slides in from left)
  const prevIndexRef = useRef<number>(activeIndex);
  const [transitionState, setTransitionState] = useState<{
    dir: "next" | "prev" | null;
    gen: number;
  }>({ dir: null, gen: 0 });

  useEffect(() => {
    if (prevIndexRef.current !== activeIndex) {
      const dir = activeIndex > prevIndexRef.current ? "next" : "prev";
      prevIndexRef.current = activeIndex;
      setTransitionState((prev) => ({ dir, gen: prev.gen + 1 }));
    }
  }, [activeIndex]);

  const [dotsVisible, setDotsVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (suppressClickTimerRef.current) clearTimeout(suppressClickTimerRef.current);
    };
  }, []);

  const gestureRef = useRef<{
    active: boolean;
    source: "touch" | "pointer" | null;
    lockedAxis: "x" | "y" | null;
    startX: number;
    startY: number;
    lastX: number;
    lastTimestamp: number;
    velocityX: number;
    width: number;
  }>({
    active: false,
    source: null,
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

  const isIgnoredTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== "function") return false;
    return Boolean(
      el.closest('input, select, textarea, [data-no-swipe], [data-pagination-dot], [aria-label="View pagination"]'),
    );
  };

  const beginGesture = useCallback(
    (clientX: number, clientY: number, source: "touch" | "pointer", target: EventTarget | null) => {
      if (disabled || totalViews <= 1) return;
      revealDotsBriefly();
      if (isIgnoredTarget(target)) return;

      const rect = containerRef.current?.getBoundingClientRect();
      gestureRef.current = {
        active: true,
        source,
        lockedAxis: null,
        startX: clientX,
        startY: clientY,
        lastX: clientX,
        lastTimestamp: performance.now(),
        velocityX: 0,
        width: rect?.width || 320,
      };
    },
    [disabled, totalViews, revealDotsBriefly],
  );

  const moveGesture = useCallback(
    (clientX: number, clientY: number, onLockHorizontal?: () => void) => {
      const g = gestureRef.current;
      if (!g.active) return;

      const dx = clientX - g.startX;
      const dy = clientY - g.startY;

      if (!g.lockedAxis) {
        if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
        g.lockedAxis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        if (g.lockedAxis === "y") {
          g.active = false;
          return;
        }
        onLockHorizontal?.();
      }

      if (g.lockedAxis !== "x") return;

      onLockHorizontal?.();
      revealDotsBriefly();
      const now = performance.now();
      const dt = Math.max(1, now - g.lastTimestamp);
      const instantVel = (clientX - g.lastX) / dt;
      g.velocityX = g.velocityX * 0.4 + instantVel * 0.6;
      g.lastX = clientX;
      g.lastTimestamp = now;

      const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
      const maxBlur = isMobile ? 6 : 10;
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
      if (Math.abs(dx) >= 8) {
        suppressClickRef.current = true;
        if (suppressClickTimerRef.current) clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = setTimeout(() => {
          suppressClickRef.current = false;
        }, 160);
      }

      const decision = evaluateSwipeSnap(
        dx,
        g.velocityX,
        g.width,
        canSwipePrev,
        canSwipeNext,
      );

      if (decision === "next") {
        triggerNativeHaptic(ImpactStyle.Light).catch(() => {});
        prevIndexRef.current = activeIndex + 1;
        setTransitionState((prev) => ({ dir: "next", gen: prev.gen + 1 }));
        onIndexChange(activeIndex + 1);
        setDragState({ isDragging: false, isRubberBanding: false, physics: null });
      } else if (decision === "prev") {
        triggerNativeHaptic(ImpactStyle.Light).catch(() => {});
        prevIndexRef.current = activeIndex - 1;
        setTransitionState((prev) => ({ dir: "prev", gen: prev.gen + 1 }));
        onIndexChange(activeIndex - 1);
        setDragState({ isDragging: false, isRubberBanding: false, physics: null });
      } else {
        setDragState({ isDragging: false, isRubberBanding: true, physics: null });
      }
    },
    [activeIndex, canSwipeNext, canSwipePrev, onIndexChange, revealDotsBriefly],
  );

  // Attach native non-passive touch listeners so Android WebView / mobile Safari never
  // fire pointercancel mid-swipe when the user drags horizontally.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled || totalViews <= 1) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      beginGesture(t.clientX, t.clientY, "touch", e.target);
    };

    const onTouchMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g.active || g.source !== "touch" || e.touches.length !== 1) return;
      const t = e.touches[0];
      moveGesture(t.clientX, t.clientY, () => {
        if (e.cancelable) e.preventDefault();
      });
    };

    const onTouchEnd = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g.active || g.source !== "touch") return;
      const t = e.changedTouches[0];
      finishGesture(t ? t.clientX : g.lastX);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [beginGesture, moveGesture, finishGesture, disabled, totalViews]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "touch") return;
      beginGesture(e.clientX, e.clientY, "pointer", e.target);
    },
    [beginGesture],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "touch") return;
      const g = gestureRef.current;
      if (!g.active || g.source !== "pointer") return;
      moveGesture(e.clientX, e.clientY, () => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      });
    },
    [moveGesture],
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "touch") return;
      const g = gestureRef.current;
      if (!g.active || g.source !== "pointer") return;
      finishGesture(e.clientX);
    },
    [finishGesture],
  );

  const handleClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const p = dragState.physics;
  const cssVars: React.CSSProperties = {
    ...(totalViews > 1 && !disabled ? { touchAction: "pan-y" } : {}),
    ...(p
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
      : {}),
  };

  return (
    <div
      className={cn("group/swipe flex flex-col gap-0.5", className)}
      onPointerEnter={revealDotsBriefly}
    >
      <div
        ref={containerRef}
        data-swipe-v2="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onClickCapture={handleClickCapture}
        style={cssVars}
        className={cn(
          "swipeable-card relative select-none touch-pan-y overflow-hidden",
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
        <div
          key={`swipe-stage-${activeIndex}-${transitionState.gen}`}
          className={cn(
            "flex-1 flex flex-col min-h-0",
            transitionState.dir === "next" && "animate-swipe-next",
            transitionState.dir === "prev" && "animate-swipe-prev",
          )}
        >
          {children}
        </div>
      </div>

      {showDots && totalViews > 1 && (
        <SwipePaginationDots
          total={totalViews}
          activeIndex={activeIndex}
          labels={viewLabels}
          visible={dotsVisible || dragState.isDragging}
          onSelect={(idx) => {
            revealDotsBriefly();
            if (idx !== activeIndex) {
              prevIndexRef.current = idx;
              setTransitionState((prev) => ({
                dir: idx > activeIndex ? "next" : "prev",
                gen: prev.gen + 1,
              }));
              onIndexChange(idx);
            }
          }}
        />
      )}
    </div>
  );
}
