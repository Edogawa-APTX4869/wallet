"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";
import {
  Activity,
  AlarmClock,
  AlertTriangle,
  Anchor,
  Apple,
  ArrowLeftRight,
  Award,
  Baby,
  Bandage,
  Banknote,
  BarChart3,
  Barcode,
  Bed,
  Beef,
  Beer,
  Bell,
  Bike,
  Book,
  Bookmark,
  BookOpen,
  Briefcase,
  Building,
  Building2,
  Bus,
  Cake,
  Calculator,
  Calendar,
  Camera,
  Car,
  Cat,
  CheckCircle2,
  ChefHat,
  Clapperboard,
  Clock,
  Cloud,
  Coffee,
  Coins,
  Compass,
  Cookie,
  Cpu,
  CreditCard,
  Crown,
  CupSoda,
  Dice5,
  Dog,
  DollarSign,
  Droplet,
  Dumbbell,
  FileSpreadsheet,
  Film,
  Fish,
  Flag,
  Flame,
  Flower2,
  Folder,
  FolderTree,
  Fuel,
  Gamepad2,
  Gem,
  Gift,
  Glasses,
  Globe,
  GraduationCap,
  Hammer,
  Headphones,
  Heart,
  HeartPulse,
  HelpCircle,
  Home,
  Hotel,
  IceCreamCone,
  Joystick,
  Key,
  Lamp,
  Landmark,
  Laptop,
  Leaf,
  Lock,
  Luggage,
  MapPin,
  Medal,
  Mic,
  Monitor,
  Mountain,
  Music,
  Navigation,
  Newspaper,
  Package,
  Paintbrush,
  Palmtree,
  PawPrint,
  PenTool,
  Percent,
  Phone,
  PieChart,
  PiggyBank,
  Pill,
  Pizza,
  Plane,
  Printer,
  Radio,
  Receipt,
  Repeat,
  Router,
  Salad,
  Scale,
  Scissors,
  Search,
  Shield,
  ShieldCheck,
  Ship,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Smile,
  Sofa,
  Soup,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Sun,
  Syringe,
  Tag,
  Tags,
  Tent,
  Thermometer,
  Ticket,
  Train,
  TramFront,
  Trash2,
  Trees,
  TrendingDown,
  TrendingUp,
  Trophy,
  Tv,
  Umbrella,
  User,
  Users,
  Utensils,
  Video,
  Wallet,
  WashingMachine,
  Watch,
  Wifi,
  Wine,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Account } from "@/lib/firefly/types";
import { cn } from "@/lib/utils";

export const ICON_CATALOG: Record<string, LucideIcon> = {
  // Finance, Banking & Investing
  Wallet,
  Landmark,
  CreditCard,
  Banknote,
  Coins,
  PiggyBank,
  TrendingUp,
  TrendingDown,
  BarChart3,
  PieChart,
  DollarSign,
  Percent,
  Gem,
  Award,
  Crown,
  Scale,
  Calculator,
  Receipt,
  FileSpreadsheet,
  ArrowLeftRight,
  Repeat,
  // Shopping & Retail
  Building2,
  Building,
  Store,
  ShoppingCart,
  ShoppingBag,
  Tag,
  Tags,
  Barcode,
  Package,
  Gift,
  Shirt,
  Watch,
  Glasses,
  Scissors,
  Sparkles,
  // Food & Dining
  Utensils,
  Coffee,
  Pizza,
  CupSoda,
  Wine,
  Beer,
  Cake,
  Cookie,
  Apple,
  Beef,
  Fish,
  IceCreamCone,
  ChefHat,
  Soup,
  Salad,
  // Home & Utilities
  Home,
  Bed,
  Sofa,
  Lamp,
  Key,
  Lock,
  Shield,
  ShieldCheck,
  Zap,
  Flame,
  Droplet,
  Thermometer,
  Wifi,
  Router,
  Phone,
  Smartphone,
  Wrench,
  Hammer,
  Paintbrush,
  Trash2,
  WashingMachine,
  // Transport & Travel
  Car,
  Fuel,
  Bus,
  Train,
  TramFront,
  Bike,
  Plane,
  Ship,
  Anchor,
  Navigation,
  MapPin,
  Compass,
  Luggage,
  Hotel,
  Tent,
  Palmtree,
  Sun,
  Umbrella,
  Mountain,
  Ticket,
  // Health & Fitness
  Heart,
  HeartPulse,
  Stethoscope,
  Pill,
  Syringe,
  Bandage,
  Activity,
  Dumbbell,
  Trophy,
  Medal,
  Smile,
  // Entertainment, Media & Tech
  Gamepad2,
  Joystick,
  Dice5,
  Film,
  Clapperboard,
  Tv,
  Radio,
  Music,
  Headphones,
  Mic,
  Camera,
  Video,
  BookOpen,
  Newspaper,
  Laptop,
  Monitor,
  Cpu,
  Printer,
  Cloud,
  Globe,
  // Work, Education, Family & Nature
  Briefcase,
  GraduationCap,
  Book,
  PenTool,
  Calendar,
  Clock,
  AlarmClock,
  Users,
  User,
  Baby,
  PawPrint,
  Dog,
  Cat,
  Flower2,
  Trees,
  Leaf,
  // Organization
  Folder,
  FolderTree,
  Star,
  Bookmark,
  Bell,
  Flag,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
};

export const COLOR_PALETTE = [
  "#6366f1", // Indigo
  "#3b82f6", // Blue
  "#0ea5e9", // Sky
  "#06b6d4", // Cyan
  "#10b981", // Emerald
  "#22c55e", // Green
  "#84cc16", // Lime
  "#eab308", // Yellow
  "#f59e0b", // Amber
  "#f97316", // Orange
  "#ef4444", // Red
  "#f43f5e", // Rose
  "#ec4899", // Pink
  "#a855f7", // Purple
  "#14b8a6", // Teal
  "#64748b", // Slate
];

/**
 * Infers a smart default icon & color based on an account's category/role/name
 * when the user hasn't explicitly saved a custom icon in the database yet.
 */
export function inferAccountDefaultStyle(
  acc: Pick<Account, "name" | "type" | "account_role" | "liability_type">,
  fallbackIndex = 0,
): { icon: string; color: string } {
  const hay = `${acc.name || ""} ${acc.type || ""} ${acc.account_role || ""} ${acc.liability_type || ""}`.toLowerCase();

  if (/cash|wallet|pocket/.test(hay) || acc.account_role === "cashWalletAsset") {
    return { icon: "Wallet", color: "#a855f7" };
  }
  if (/credit|card|visa|mastercard|amex/.test(hay) || acc.account_role === "ccAsset") {
    return { icon: "CreditCard", color: "#f97316" };
  }
  if (/saving|deposit|fixed|goal|emergency|scholarship|piggy/.test(hay) || acc.account_role === "savingAsset") {
    return { icon: "PiggyBank", color: "#ec4899" };
  }
  if (/stock|eft|etf|invest|gold|crypto|portfolio|trading/.test(hay)) {
    return { icon: "TrendingUp", color: "#14b8a6" };
  }
  if (/salary|payroll|income|revenue/.test(hay)) {
    return { icon: "Briefcase", color: "#ef4444" };
  }
  if (/loan|debt|mortgage|liabilit/.test(hay)) {
    return { icon: "Receipt", color: "#eab308" };
  }
  if (acc.type === "expense") {
    return { icon: "Store", color: "#f97316" };
  }
  if (acc.type === "revenue") {
    return { icon: "Building2", color: "#10b981" };
  }
  return {
    icon: "Landmark",
    color: COLOR_PALETTE[fallbackIndex % COLOR_PALETTE.length],
  };
}

/**
 * Infers a smart default icon & color based on an expense/income category name
 * when the user hasn't customized it yet.
 */
export function inferCategoryDefaultStyle(categoryName: string, fallbackIndex = 0): { icon: string; color: string } {
  const lower = (categoryName || "").toLowerCase();
  if (/grocer|supermarket|market|lulu|carrefour/.test(lower)) return { icon: "ShoppingCart", color: "#10b981" };
  if (/restaurant|fast-food|dining|food|lunch|dinner|eat/.test(lower)) return { icon: "Utensils", color: "#f97316" };
  if (/coffee|cafe|tea|starbucks|bakery/.test(lower)) return { icon: "Coffee", color: "#eab308" };
  if (/pizza|delivery|takeout/.test(lower)) return { icon: "Pizza", color: "#ef4444" };
  if (/home|rent|housing|mortgage|apartment|property/.test(lower)) return { icon: "Home", color: "#6366f1" };
  if (/electric|water|utility|utilities|power|gas bill/.test(lower)) return { icon: "Zap", color: "#eab308" };
  if (/internet|wifi|broadband|telecom/.test(lower)) return { icon: "Wifi", color: "#0ea5e9" };
  if (/phone|mobile|sim/.test(lower)) return { icon: "Smartphone", color: "#3b82f6" };
  if (/fuel|petrol|gas|station/.test(lower)) return { icon: "Fuel", color: "#ef4444" };
  if (/car|auto|vehicle|parking|taxi|uber|maintenance/.test(lower)) return { icon: "Car", color: "#64748b" };
  if (/bus|train|metro|transit|transport/.test(lower)) return { icon: "Bus", color: "#0ea5e9" };
  if (/flight|travel|hotel|vacation|trip|airline/.test(lower)) return { icon: "Plane", color: "#14b8a6" };
  if (/health|medical|doctor|hospital|pharmacy|dental/.test(lower)) return { icon: "HeartPulse", color: "#ec4899" };
  if (/gym|fitness|sport|workout/.test(lower)) return { icon: "Dumbbell", color: "#22c55e" };
  if (/education|school|university|tuition|book|course/.test(lower)) return { icon: "GraduationCap", color: "#6366f1" };
  if (/work|business|office|salary/.test(lower)) return { icon: "Briefcase", color: "#3b82f6" };
  if (/tech|software|electronics|subscription|cloud/.test(lower)) return { icon: "Laptop", color: "#0ea5e9" };
  if (/game|gaming|entertainment|fun/.test(lower)) return { icon: "Gamepad2", color: "#a855f7" };
  if (/movie|cinema|netflix|streaming|tv/.test(lower)) return { icon: "Film", color: "#ec4899" };
  if (/cloth|fashion|apparel|shoes|laundry|حلاق|كواي/.test(lower)) return { icon: "Shirt", color: "#a855f7" };
  if (/shop|mall|amazon|store/.test(lower)) return { icon: "ShoppingBag", color: "#f97316" };
  if (/gift|charity|sadaqah|donation|zakat/.test(lower)) return { icon: "Gift", color: "#22c55e" };
  if (/baby|kid|child|family/.test(lower)) return { icon: "Baby", color: "#ec4899" };
  if (/pet|cat|dog|vet/.test(lower)) return { icon: "PawPrint", color: "#eab308" };
  if (/repair|service|tool|hardware/.test(lower)) return { icon: "Wrench", color: "#64748b" };
  return {
    icon: "FolderTree",
    color: COLOR_PALETTE[fallbackIndex % COLOR_PALETTE.length],
  };
}

export interface CompanionMetaItem {
  entity_type: string;
  entity_id: string;
  icon: string;
  color: string;
  hidden: boolean;
  is_todo: boolean;
  extra: Record<string, unknown>;
}

export function useResourceMeta() {
  const query = useQuery({
    queryKey: ["companion-meta"],
    queryFn: async () => {
      const res = await fetch("/api/companion/meta");
      if (!res.ok) return [] as CompanionMetaItem[];
      const json = (await res.json()) as { data?: CompanionMetaItem[] };
      return json.data ?? [];
    },
    staleTime: 60_000,
  });

  const map = new Map<string, CompanionMetaItem>();
  for (const item of query.data ?? []) {
    map.set(`${item.entity_type}:${item.entity_id}`, item);
  }

  return {
    ...query,
    get(entityType: string, entityId: string): CompanionMetaItem | undefined {
      return map.get(`${entityType}:${entityId}`);
    },
  };
}

export function useUpdateResourceMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      entity_type: string;
      entity_id: string;
      icon?: string;
      color?: string;
      hidden?: boolean;
      is_todo?: boolean;
      extra?: Record<string, unknown>;
    }) => {
      const res = await fetch("/api/companion/meta", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save custom icon/meta");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companion-meta"] });
    },
  });
}

/**
 * Renders the custom icon & color badge for a Firefly III resource (Account, Category, Budget, Tag, etc.),
 * and opens an interactive Pico-style Icon & Color picker popover when clicked!
 */
export function ResourceIconBadge({
  entityType,
  entityId,
  defaultIcon = "Wallet",
  defaultColor,
  size = "md",
  editable = true,
}: {
  entityType: "account" | "category" | "budget" | "tag" | "piggy" | "template" | "bill";
  entityId: string;
  defaultIcon?: string;
  defaultColor?: string;
  size?: "xs" | "sm" | "md" | "lg";
  editable?: boolean;
}) {
  const meta = useResourceMeta();
  const updateMut = useUpdateResourceMeta();
  const [open, setOpen] = useState(false);
  const [rendered, setRendered] = useState(open);
  const [iconQuery, setIconQuery] = useState("");

  if (open && !rendered) {
    setRendered(true);
  }

  useEffect(() => {
    if (!open && rendered) {
      const timer = window.setTimeout(() => setRendered(false), 200);
      return () => window.clearTimeout(timer);
    }
    if (open) {
      setIconQuery("");
    }
  }, [open, rendered]);

  const filteredIcons = useMemo(() => {
    const q = iconQuery.trim().toLowerCase();
    const entries = Object.entries(ICON_CATALOG);
    if (!q) return entries;
    return entries.filter(([name]) => name.toLowerCase().includes(q));
  }, [iconQuery]);

  const isClosing = !open && rendered;
  const showPicker = open || isClosing;

  useEscapeDismiss(open, () => setOpen(false), "resource-icon-picker", { hidesChrome: true });

  const item = meta.get(entityType, entityId);
  const iconName = item?.icon || defaultIcon;
  const color = item?.color || defaultColor || "";
  const IconComp = ICON_CATALOG[iconName] ?? Wallet;

  return (
    <div className="relative inline-flex shrink-0">
      <button
        type="button"
        disabled={!editable}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (editable) setOpen((o) => !o);
        }}
        title={editable ? "Click to customize icon & color (saved to database)" : undefined}
        style={color ? { backgroundColor: `${color}22`, color } : undefined}
        className={cn(
          "flex items-center justify-center transition-transform",
          size === "xs"
            ? "size-5 rounded-md"
            : size === "sm"
              ? "size-6 rounded-lg"
              : size === "lg"
                ? "size-11 rounded-2xl"
                : "size-8 sm:size-9 rounded-xl",
          !color && "bg-primary-soft text-primary",
          editable && "hover:scale-105 cursor-pointer",
        )}
      >
        <IconComp
          className={
            size === "xs"
              ? "size-3"
              : size === "sm"
                ? "size-3.5"
                : size === "lg"
                  ? "size-5"
                  : "size-4"
          }
          aria-hidden
        />
      </button>

      {showPicker && typeof document !== "undefined" && createPortal(
        <div
          className={cn(
            "fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs overscroll-none touch-none",
            isClosing ? "drawer-backdrop-out pointer-events-none" : "drawer-backdrop-in",
          )}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
            }
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
          aria-hidden="true"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose Icon & Color"
            onClick={(e) => {
              e.stopPropagation();
            }}
            className={cn(
              "w-full max-w-xs rounded-2xl border border-border bg-surface p-4 shadow-2xl touch-auto sm:max-w-sm relative z-10",
              isClosing ? "animate-pop-out pointer-events-none" : "animate-pop-in",
            )}
          >
            <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
              <span className="text-sm font-semibold text-fg">Choose Icon &amp; Color</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
                className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg active:scale-95"
              >
                Done
              </button>
            </div>

            {/* Color swatches */}
            <div className="mb-3 flex flex-wrap gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateMut.mutate({ entity_type: entityType, entity_id: entityId, color: c });
                  }}
                  style={{ backgroundColor: c }}
                  className={cn(
                    "size-6 cursor-pointer rounded-full border-2 transition-transform active:scale-90",
                    color === c ? "border-fg scale-110 shadow-xs ring-2 ring-primary/40" : "border-transparent hover:scale-105",
                  )}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>

            {/* Icon search */}
            <div className="relative mb-2.5">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                value={iconQuery}
                onChange={(e) => setIconQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder={`Search ${Object.keys(ICON_CATALOG).length} icons…`}
                aria-label="Search icons"
                className="h-9 w-full rounded-xl border border-border bg-surface-2/60 pl-8 pr-3 text-xs text-fg outline-none transition-colors placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
            </div>

            {/* Icon grid */}
            <div className="grid max-h-60 grid-cols-7 gap-1.5 overflow-y-auto overscroll-contain touch-pan-y p-1.5 rounded-xl bg-surface-2/40 border border-border/50">
              {filteredIcons.length === 0 ? (
                <p className="col-span-7 py-6 text-center text-xs text-muted">
                  No icons match &ldquo;{iconQuery}&rdquo;
                </p>
              ) : (
                filteredIcons.map(([name, Comp]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateMut.mutate({ entity_type: entityType, entity_id: entityId, icon: name });
                      setOpen(false);
                    }}
                    title={name}
                    className={cn(
                      "flex size-9 cursor-pointer items-center justify-center rounded-xl transition-all hover:bg-surface hover:shadow-xs active:scale-90",
                      iconName === name && "bg-primary text-primary-fg ring-2 ring-primary/40 shadow-xs font-bold",
                    )}
                  >
                    <Comp className="size-4" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
