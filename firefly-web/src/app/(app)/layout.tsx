import { AppAuthGate } from "@/components/auth-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppAuthGate>{children}</AppAuthGate>;
}
