"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/firefly/api";
import type { Account } from "@/lib/firefly/types";
import { useCurrencies, usePrimaryCurrency } from "@/lib/hooks";
import { cn, isoDate } from "@/lib/utils";
import { Button, Field, Input, ModalSheet, Select } from "@/components/ui";
import { useToast } from "@/components/providers";

export type CreatableAccountType = "asset" | "liability" | "expense" | "revenue";

export function normalizeType(type?: string): CreatableAccountType {
  if (!type) return "asset";
  const lower = type.toLowerCase();
  if (lower === "liabilities" || lower === "liability" || lower === "loan" || lower === "debt" || lower === "mortgage") {
    return "liability";
  }
  if (lower === "expense" || lower === "expenses") return "expense";
  if (lower === "revenue" || lower === "revenues" || lower === "income") return "revenue";
  return "asset";
}

export function CreateAccountModal({
  open,
  onClose,
  initialType = "asset",
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialType?: string;
  onCreated?: (account: Account) => void;
}) {
  const [rendered, setRendered] = useState(open);

  if (open && !rendered) {
    setRendered(true);
  }

  useEffect(() => {
    if (!open && rendered) {
      const timer = window.setTimeout(() => setRendered(false), 240);
      return () => window.clearTimeout(timer);
    }
  }, [open, rendered]);

  if (!open && !rendered) return null;

  return (
    <CreateAccountModalContent
      open={open}
      onClose={onClose}
      initialType={initialType}
      onCreated={onCreated}
    />
  );
}

function CreateAccountModalContent({
  open,
  onClose,
  initialType = "asset",
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialType?: string;
  onCreated?: (account: Account) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const primaryQ = usePrimaryCurrency();
  const currenciesQ = useCurrencies();
  const currencies = currenciesQ.data ?? [];

  const [accountType, setAccountType] = useState<CreatableAccountType>(() => normalizeType(initialType));
  const [name, setName] = useState("");
  const primaryCode = primaryQ.data?.code;
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const currencyCode = selectedCurrency ?? primaryCode ?? currencies?.[0]?.attributes.code ?? "USD";
  const [accountRole, setAccountRole] = useState("defaultAsset");
  const [liabilityType, setLiabilityType] = useState("loan");
  const [liabilityDirection, setLiabilityDirection] = useState("debit");
  const [openingBalance, setOpeningBalance] = useState("");
  const [openingBalanceDate, setOpeningBalanceDate] = useState(() => isoDate());
  const [iban, setIban] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setAccountType(normalizeType(initialType));
      setName("");
      setOpeningBalance("");
      setOpeningBalanceDate(isoDate());
      setIban("");
      setAccountNumber("");
      setNotes("");
      setLiabilityType("loan");
      setLiabilityDirection("debit");
      setAccountRole("defaultAsset");
    }
  }, [open, initialType]);

  const createMut = useMutation({
    mutationFn: async () => {
      const payload: Parameters<typeof api.createAccount>[0] = {
        name: name.trim(),
        type: accountType,
        currency_code: currencyCode.trim() || undefined,
        notes: notes.trim() || undefined,
      };

      if (accountType === "asset") {
        payload.account_role = accountRole;
        if (openingBalance.trim()) {
          payload.opening_balance = openingBalance.trim();
          payload.opening_balance_date = openingBalanceDate || isoDate();
        }
        if (iban.trim()) payload.iban = iban.trim();
        if (accountNumber.trim()) payload.account_number = accountNumber.trim();
      } else if (accountType === "liability") {
        payload.liability_type = liabilityType;
        payload.liability_direction = liabilityDirection;
        if (openingBalance.trim()) {
          payload.opening_balance = openingBalance.trim();
          payload.opening_balance_date = openingBalanceDate || isoDate();
        }
        if (iban.trim()) payload.iban = iban.trim();
        if (accountNumber.trim()) payload.account_number = accountNumber.trim();
      } else {
        // expense or revenue
        if (iban.trim()) payload.iban = iban.trim();
        if (accountNumber.trim()) payload.account_number = accountNumber.trim();
      }

      return api.createAccount(payload);
    },
    onSuccess: (res) => {
      toast("Account created successfully", "success");
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
      if (onCreated && res.data?.attributes) {
        onCreated(res.data.attributes);
      }
    },
    onError: (err) => {
      toast((err as Error).message, "error");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast("Please enter an account name", "error");
      return;
    }
    createMut.mutate();
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title="Create New Account"
      subtitle="Add an asset, liability, expense, or revenue account"
      maxWidth="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Account Type Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Account type</label>
          <div
            role="radiogroup"
            aria-label="Account Type"
            className="grid grid-cols-4 gap-1.5 rounded-xl border border-border bg-surface-2/60 p-1"
          >
            {(
              [
                { type: "asset", label: "Asset" },
                { type: "liability", label: "Liability" },
                { type: "expense", label: "Expense" },
                { type: "revenue", label: "Revenue" },
              ] as const
            ).map((item) => (
              <button
                key={item.type}
                type="button"
                role="radio"
                aria-checked={accountType === item.type}
                onClick={() => setAccountType(item.type)}
                className={cn(
                  "cursor-pointer rounded-lg py-1.5 text-xs font-semibold transition-all",
                  accountType === item.type
                    ? "bg-surface text-fg shadow-xs ring-1 ring-border"
                    : "text-muted hover:text-fg",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Account Name */}
        <Field label="Account name">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                accountType === "asset"
                  ? "e.g. Checking Account, Savings, Cash"
                  : accountType === "liability"
                    ? "e.g. Student Loan, Mortgage, Credit Card"
                    : accountType === "expense"
                      ? "e.g. Supermarket, Landlord, Coffee Shop"
                      : "e.g. Employer, Dividends, Freelance Client"
              }
              required
              autoFocus
            />
          )}
        </Field>

        {/* Currency & Type-specific selector */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Currency">
            {(id) => (
              <Select
                id={id}
                value={currencyCode}
                onChange={(e) => setSelectedCurrency(e.target.value)}
              >
                {currencies.length > 0 ? (
                  currencies.map((c) => (
                    <option key={c.id} value={c.attributes.code}>
                      {c.attributes.code} ({c.attributes.symbol}) — {c.attributes.name}
                    </option>
                  ))
                ) : (
                  <option value={currencyCode}>{currencyCode}</option>
                )}
              </Select>
            )}
          </Field>

          {accountType === "asset" && (
            <Field label="Account role">
              {(id) => (
                <Select id={id} value={accountRole} onChange={(e) => setAccountRole(e.target.value)}>
                  <option value="defaultAsset">Default asset account</option>
                  <option value="savingAsset">Savings account</option>
                  <option value="sharedAsset">Shared asset account</option>
                  <option value="ccAsset">Credit card account</option>
                  <option value="cashWalletAsset">Cash wallet</option>
                </Select>
              )}
            </Field>
          )}

          {accountType === "liability" && (
            <Field label="Liability type">
              {(id) => (
                <Select id={id} value={liabilityType} onChange={(e) => setLiabilityType(e.target.value)}>
                  <option value="loan">Loan</option>
                  <option value="debt">Debt</option>
                  <option value="mortgage">Mortgage</option>
                </Select>
              )}
            </Field>
          )}
        </div>

        {accountType === "liability" && (
          <Field label="Liability direction">
            {(id) => (
              <Select
                id={id}
                value={liabilityDirection}
                onChange={(e) => setLiabilityDirection(e.target.value)}
              >
                <option value="debit">I owe this debt (debit)</option>
                <option value="credit">I am owed this debt (credit)</option>
              </Select>
            )}
          </Field>
        )}

        {/* Opening Balance (Asset & Liability only) */}
        {(accountType === "asset" || accountType === "liability") && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={accountType === "liability" ? "Starting debt amount" : "Opening balance"}
              hint="Leave blank if starting at zero"
            >
              {(id) => (
                <Input
                  id={id}
                  type="text"
                  inputMode="decimal"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  placeholder="0.00"
                />
              )}
            </Field>

            <Field label="Opening balance date">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={openingBalanceDate}
                  onChange={(e) => setOpeningBalanceDate(e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        {/* IBAN & Account Number */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="IBAN (optional)">
            {(id) => (
              <Input
                id={id}
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                placeholder="e.g. GB29NWBK60161331926819"
              />
            )}
          </Field>

          <Field label="Account number (optional)">
            {(id) => (
              <Input
                id={id}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="e.g. 100200300"
              />
            )}
          </Field>
        </div>

        {/* Notes */}
        <Field label="Notes (optional)">
          {(id) => (
            <textarea
              id={id}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes about this account…"
              className="w-full rounded-xl border border-border bg-surface p-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          )}
        </Field>

        {/* Action Buttons */}
        <div className="mt-2 flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={createMut.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={createMut.isPending}>
            Create account
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
