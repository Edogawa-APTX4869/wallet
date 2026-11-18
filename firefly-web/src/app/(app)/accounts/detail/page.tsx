"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AccountDetailClient } from "../[id]/account-detail-client";

function AccountDetailQueryInner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  if (!id) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
        Missing account identifier.
      </div>
    );
  }
  return <AccountDetailClient id={id} />;
}

export default function AccountDetailQueryPage() {
  return (
    <Suspense>
      <AccountDetailQueryInner />
    </Suspense>
  );
}
