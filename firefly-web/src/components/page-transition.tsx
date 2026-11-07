"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Universal Route Change / Screen Transition Component:
 * Animates route navigations with GPU-composited fade and gentle slide-up.
 * Compatible with View Transitions API and respects prefers-reduced-motion.
 */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <div
      key={pathname}
      className={cn("page-enter min-w-0 flex-1", className)}
      style={{
        viewTransitionName: "page-content",
      }}
    >
      {children}
    </div>
  );
}
