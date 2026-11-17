import type { Metadata } from "next";
import { Suspense } from "react";
import { PiggyBanksClient } from "./piggy-banks-client";

export const metadata: Metadata = { title: "Piggy Banks" };

export default function PiggyBanksPage() {
  return (
    <Suspense>
      <PiggyBanksClient />
    </Suspense>
  );
}
