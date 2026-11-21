"use client";

import { useEffect, useRef, useState } from "react";
import { cn, formatMoney } from "@/lib/utils";

interface UseAnimatedNumberOptions {
  duration?: number;
  decimals?: number;
}

/**
 * High-performance count-up/count-down number interpolation using requestAnimationFrame
 * with cubic-bezier ease-out curve. Automatically respects prefers-reduced-motion.
 */
export function useAnimatedNumber(
  targetValue: number,
  options: UseAnimatedNumberOptions = {},
): number {
  const { duration = 350, decimals } = options;
  const [displayValue, setDisplayValue] = useState(targetValue);
  const prevTargetRef = useRef(targetValue);
  const currentValRef = useRef(targetValue);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // If target has not changed, keep current
    if (prevTargetRef.current === targetValue) return;

    const isCoarsePointer =
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(pointer: coarse)")?.matches);
    const prefersReduced =
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

    // On touch/mobile devices or reduced motion, snap in a single frame to avoid
    // running dozens of parallel 60fps React state loops on mobile CPUs.
    if (isCoarsePointer || prefersReduced) {
      prevTargetRef.current = targetValue;
      currentValRef.current = targetValue;
      animFrameRef.current = requestAnimationFrame(() => {
        setDisplayValue(targetValue);
      });
      return () => {
        if (animFrameRef.current !== null) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
      };
    }

    const startVal = currentValRef.current;
    const endVal = targetValue;
    prevTargetRef.current = targetValue;
    const startTime = performance.now();
    let lastEmitTime = 0;
    let lastEmittedVal = startVal;

    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
    }

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      // Ease-out cubic: 1 - (1 - t)^3
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const nextVal = startVal + (endVal - startVal) * easeOut;

      currentValRef.current = nextVal;
      const rounded = typeof decimals === "number" ? Number(nextVal.toFixed(decimals)) : nextVal;

      if (progress < 1) {
        if (now - lastEmitTime >= 40 && rounded !== lastEmittedVal) {
          lastEmitTime = now;
          lastEmittedVal = rounded;
          setDisplayValue(rounded);
        }
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        currentValRef.current = endVal;
        setDisplayValue(endVal);
        animFrameRef.current = null;
      }
    }

    animFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [targetValue, duration, decimals]);

  return displayValue;
}

export function AnimatedMoney({
  amount,
  code,
  decimals,
  symbol,
  signed,
  colored,
  skipCurrency,
  className,
  duration = 350,
}: {
  amount: string | number | null | undefined;
  code?: string | null;
  decimals?: number | null;
  symbol?: string | null;
  signed?: boolean;
  colored?: boolean;
  skipCurrency?: boolean;
  className?: string;
  duration?: number;
}) {
  const numericTarget = Number(amount ?? 0);
  const safeDecimals = typeof decimals === "number" ? decimals : 2;
  const animatedValue = useAnimatedNumber(Number.isFinite(numericTarget) ? numericTarget : 0, {
    duration,
    decimals: safeDecimals,
  });

  return (
    <span
      className={cn(
        "tabular whitespace-nowrap transition-colors duration-200",
        colored && animatedValue > 0 && "text-success",
        colored && animatedValue < 0 && "text-danger",
        className,
      )}
    >
      {formatMoney(animatedValue.toFixed(safeDecimals), code, decimals, symbol, { signed, skipCurrency })}
    </span>
  );
}

export function AnimatedNumber({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
  duration = 350,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  duration?: number;
}) {
  const animatedValue = useAnimatedNumber(value, { duration, decimals });
  const formatted = decimals > 0 ? animatedValue.toFixed(decimals) : Math.round(animatedValue).toString();
  return (
    <span className={cn("tabular whitespace-nowrap", className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
