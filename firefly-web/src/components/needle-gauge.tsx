"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface NeedleGaugeProps {
  /** Percentage from 0 (far left / red) to 100 (far right / green) */
  pct: number;
  /** Label displayed below the gauge (e.g. "BALANCE", "CASH-FLOW", "OUTLOOK") */
  label: string;
  /** Primary formatted value displayed below the label */
  value?: React.ReactNode;
  /** Size variant: "lg" for top 2 primary gauges, "sm" for 4 bottom mini gauges */
  size?: "lg" | "sm";
  className?: string;
}

/**
 * BudgetBakers Wallet-inspired semicircular tri-color speedometer gauge
 * with an animated SVG pivot needle.
 */
export function NeedleGauge({
  pct,
  label,
  value,
  size = "lg",
  className,
}: NeedleGaugeProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 50));
  // Map 0..100 -> -85deg..+85deg
  const angleDeg = -85 + (clamped / 100) * 170;

  const isLg = size === "lg";

  return (
    <div className={cn("flex flex-col items-center justify-start text-center min-w-0 select-none", className)}>
      <div
        className={cn(
          "relative flex items-center justify-center",
          isLg ? "w-32 h-18 sm:w-36 sm:h-20" : "w-18 h-11 sm:w-20 sm:h-12",
        )}
      >
        <svg
          viewBox="0 0 100 58"
          className="w-full h-full overflow-visible"
          aria-hidden="true"
        >
          {/* Outer subtle track shadow */}
          <path
            d="M 10 48 A 40 40 0 0 1 90 48"
            fill="none"
            stroke="var(--border)"
            strokeWidth={isLg ? "11" : "10"}
            strokeLinecap="butt"
            opacity={0.35}
          />

          {/* Segment 1: Red (Left third: 180deg -> 120deg, i.e. (10,48) -> (30, 13.36)) */}
          <path
            d="M 10 48 A 40 40 0 0 1 28.5 14.3"
            fill="none"
            stroke="#ef4444"
            strokeWidth={isLg ? "10" : "9"}
            strokeLinecap="butt"
          />

          {/* Segment 2: Amber/Yellow (Middle third: (31, 13) -> (69, 13)) */}
          <path
            d="M 31 13.1 A 40 40 0 0 1 69 13.1"
            fill="none"
            stroke="#f59e0b"
            strokeWidth={isLg ? "10" : "9"}
            strokeLinecap="butt"
          />

          {/* Segment 3: Emerald Green (Right third: (71.5, 14.3) -> (90, 48)) */}
          <path
            d="M 71.5 14.3 A 40 40 0 0 1 90 48"
            fill="none"
            stroke="#10b981"
            strokeWidth={isLg ? "10" : "9"}
            strokeLinecap="butt"
          />

          {/* Inner subtle arc rim */}
          <path
            d="M 18 48 A 32 32 0 0 1 82 48"
            fill="none"
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity={0.6}
          />

          {/* Animated Tapered Speedometer Needle */}
          <g
            style={{
              transform: `rotate(${angleDeg.toFixed(1)}deg)`,
              transformOrigin: "50px 48px",
              transition: "transform 650ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {/* Needle blade pointing straight up at 0deg from (50,48) to (50,13) */}
            <polygon
              points={isLg ? "47.8,48 50,12 52.2,48" : "48,48 50,14 52,48"}
              fill="var(--fg)"
            />
            {/* Needle tail */}
            <rect
              x="48.8"
              y="48"
              width="2.4"
              height="4"
              rx="1"
              fill="var(--fg)"
            />
          </g>

          {/* Center Pivot Hub */}
          <circle
            cx="50"
            cy="48"
            r={isLg ? "5.2" : "4.5"}
            fill="var(--fg)"
          />
          <circle
            cx="50"
            cy="48"
            r={isLg ? "2.2" : "1.8"}
            fill="var(--surface)"
          />
        </svg>
      </div>

      {/* Label & Value */}
      <span
        className={cn(
          "mt-1 font-bold uppercase tracking-wider text-muted whitespace-nowrap max-w-full",
          isLg ? "text-[11px] sm:text-xs" : "text-[10px]",
        )}
      >
        {label}
      </span>
      {value !== undefined && (
        <span
          className={cn(
            "tabular font-mono font-bold tracking-tight text-fg whitespace-nowrap max-w-full",
            isLg ? "mt-0.5 text-sm sm:text-base" : "text-[11px] sm:text-xs",
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}
