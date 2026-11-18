import type { Metadata } from "next";
import { AccountDetailClient } from "./account-detail-client";

export const metadata: Metadata = { title: "Account" };

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountDetailClient id={id} />;
}
