import type { Metadata } from "next";
import { Suspense } from "react";
import { BudgetsClient } from "./budgets-client";

export const metadata: Metadata = { title: "Budgets" };

export default function BudgetsPage() {
  return (
    <Suspense>
      <BudgetsClient />
    </Suspense>
  );
}
