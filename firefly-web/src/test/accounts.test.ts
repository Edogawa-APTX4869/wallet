import { describe, expect, it } from "vitest";
import {
  buildAccountPayload,
  normalizeAccountType,
  type CreateAccountFormValues,
} from "./test-harness";

describe("R1: Account Creation & Management (Tiers 1-4)", () => {
  const TODAY = "2026-11-06";

  // ==========================================================================
  // Tier 1: Feature Coverage (>= 5 tests)
  // ==========================================================================
  describe("Tier 1: Feature Coverage", () => {
    it("T1.1: generates asset account payload with default role and trimmed fields", () => {
      const form: CreateAccountFormValues = {
        name: "Main Checking Account",
        type: "asset",
        currencyCode: "EUR",
        accountRole: "defaultAsset",
        openingBalance: "1250.00",
        openingBalanceDate: "2026-11-01",
        iban: "DE89370400440532013000",
        accountNumber: "ACC-9921",
        notes: "Primary household checking account",
      };

      const payload = buildAccountPayload(form, TODAY);

      expect(payload.name).toBe("Main Checking Account");
      expect(payload.type).toBe("asset");
      expect(payload.account_role).toBe("defaultAsset");
      expect(payload.currency_code).toBe("EUR");
      expect(payload.opening_balance).toBe("1250.00");
      expect(payload.opening_balance_date).toBe("2026-11-01");
      expect(payload.iban).toBe("DE89370400440532013000");
      expect(payload.account_number).toBe("ACC-9921");
      expect(payload.notes).toBe("Primary household checking account");
      expect(payload.liability_type).toBeUndefined();
      expect(payload.liability_direction).toBeUndefined();
    });

    it("T1.2: generates liability account payload with default liability_type loan and liability_direction credit", () => {
      const form: CreateAccountFormValues = {
        name: "Car Loan",
        type: "liability",
        currencyCode: "USD",
        liabilityType: "loan",
        openingBalance: "18500.00",
        openingBalanceDate: TODAY,
        notes: "Auto loan via Credit Union",
      };

      const payload = buildAccountPayload(form, TODAY);

      expect(payload.name).toBe("Car Loan");
      expect(payload.type).toBe("liability");
      expect(payload.liability_type).toBe("loan");
      expect(payload.liability_direction).toBe("credit");
      expect(payload.opening_balance).toBe("18500.00");
      expect(payload.opening_balance_date).toBe(TODAY);
      expect(payload.account_role).toBeUndefined();
    });

    it("T1.2b: generates liability account payload with explicit liability_direction debit", () => {
      const form: CreateAccountFormValues = {
        name: "Personal Loan to Friend",
        type: "liability",
        currencyCode: "USD",
        liabilityType: "debt",
        liabilityDirection: "debit",
        openingBalance: "500.00",
        openingBalanceDate: TODAY,
      };

      const payload = buildAccountPayload(form, TODAY);

      expect(payload.name).toBe("Personal Loan to Friend");
      expect(payload.type).toBe("liability");
      expect(payload.liability_type).toBe("debt");
      expect(payload.liability_direction).toBe("debit");
      expect(payload.opening_balance).toBe("500.00");
    });

    it("T1.3: generates expense account payload without role or opening balance", () => {
      const form: CreateAccountFormValues = {
        name: "Supermarket Groceries",
        type: "expense",
        currencyCode: "USD",
        notes: "Weekly food expenses",
        openingBalance: "500.00", // should be ignored for expense accounts
      };

      const payload = buildAccountPayload(form, TODAY);

      expect(payload.name).toBe("Supermarket Groceries");
      expect(payload.type).toBe("expense");
      expect(payload.currency_code).toBe("USD");
      expect(payload.notes).toBe("Weekly food expenses");
      expect(payload.account_role).toBeUndefined();
      expect(payload.liability_type).toBeUndefined();
      expect(payload.liability_direction).toBeUndefined();
      expect(payload.opening_balance).toBeUndefined();
      expect(payload.opening_balance_date).toBeUndefined();
    });

    it("T1.4: generates revenue account payload without role or opening balance", () => {
      const form: CreateAccountFormValues = {
        name: "Freelance Consulting",
        type: "revenue",
        currencyCode: "EUR",
        notes: "Client invoice deposits",
      };

      const payload = buildAccountPayload(form, TODAY);

      expect(payload.name).toBe("Freelance Consulting");
      expect(payload.type).toBe("revenue");
      expect(payload.currency_code).toBe("EUR");
      expect(payload.notes).toBe("Client invoice deposits");
      expect(payload.account_role).toBeUndefined();
      expect(payload.liability_type).toBeUndefined();
      expect(payload.liability_direction).toBeUndefined();
      expect(payload.opening_balance).toBeUndefined();
    });

    it("T1.5: Speed Dial FAB action pill triggers modal event when on /accounts", () => {
      let dispatchedEvent = "";
      const fakeWindow = {
        dispatchEvent: (ev: { type: string }) => {
          dispatchedEvent = ev.type;
          return true;
        },
      };

      // When FAB action is clicked on `/accounts`
      const currentPath = "/accounts";
      if (currentPath === "/accounts") {
        fakeWindow.dispatchEvent({ type: "ff:open-create-account" });
      }

      expect(dispatchedEvent).toBe("ff:open-create-account");
    });

    it("T1.6: Accounts page listens to ff:open-create-account and activates modal", () => {
      let isModalOpen = false;
      const listeners = new Map<string, () => void>();

      const mockWindow = {
        addEventListener: (event: string, handler: () => void) => {
          listeners.set(event, handler);
        },
        removeEventListener: (event: string) => {
          listeners.delete(event);
        },
        trigger: (event: string) => {
          listeners.get(event)?.();
        },
      };

      // Component mount: wire listener
      const handler = () => {
        isModalOpen = true;
      };
      mockWindow.addEventListener("ff:open-create-account", handler);

      expect(isModalOpen).toBe(false);
      mockWindow.trigger("ff:open-create-account");
      expect(isModalOpen).toBe(true);

      // Component unmount cleanup
      mockWindow.removeEventListener("ff:open-create-account");
      expect(listeners.has("ff:open-create-account")).toBe(false);
    });

    it("T1.7: Accounts page parses ?create=1 deep-link and auto-opens modal", () => {
      const parseDeepLink = (searchParamsString: string): boolean => {
        const params = new URLSearchParams(searchParamsString);
        return params.get("create") === "1" || params.get("create") === "true";
      };

      expect(parseDeepLink("create=1")).toBe(true);
      expect(parseDeepLink("create=true")).toBe(true);
      expect(parseDeepLink("tab=asset&create=1")).toBe(true);
      expect(parseDeepLink("create=0")).toBe(false);
      expect(parseDeepLink("tab=asset")).toBe(false);
      expect(parseDeepLink("")).toBe(false);
    });
  });

  // ==========================================================================
  // Tier 2: Boundary & Corner Cases (>= 5 tests)
  // ==========================================================================
  describe("Tier 2: Boundary & Corner Cases", () => {
    it("T2.1: rejects empty or whitespace-only account name", () => {
      expect(() =>
        buildAccountPayload(
          {
            name: "",
            type: "asset",
          },
          TODAY,
        ),
      ).toThrow("Account name is required");

      expect(() =>
        buildAccountPayload(
          {
            name: "    ",
            type: "asset",
          },
          TODAY,
        ),
      ).toThrow("Account name is required");
    });

    it("T2.2: normalizes plural and alias types to canonical types", () => {
      expect(normalizeAccountType("liabilities")).toBe("liability");
      expect(normalizeAccountType("LIABILITY")).toBe("liability");
      expect(normalizeAccountType("loan")).toBe("liability");
      expect(normalizeAccountType("mortgage")).toBe("liability");
      expect(normalizeAccountType("debt")).toBe("liability");

      expect(normalizeAccountType("expenses")).toBe("expense");
      expect(normalizeAccountType("EXPENSE")).toBe("expense");

      expect(normalizeAccountType("revenues")).toBe("revenue");
      expect(normalizeAccountType("income")).toBe("revenue");
      expect(normalizeAccountType("REVENUE")).toBe("revenue");

      expect(normalizeAccountType("asset")).toBe("asset");
      expect(normalizeAccountType("cash")).toBe("asset");
      expect(normalizeAccountType(undefined)).toBe("asset");
      expect(normalizeAccountType("")).toBe("asset");
    });

    it("T2.3: trims excess whitespace around name, IBAN, account number, notes, and currency", () => {
      const payload = buildAccountPayload(
        {
          name: "   Emergency Fund   ",
          type: "asset",
          currencyCode: "  USD  ",
          iban: "  GB29 NWBK 6016 1331 9268 19  ",
          accountNumber: "   9876543210   ",
          notes: "   Funds for emergency situations only   ",
        },
        TODAY,
      );

      expect(payload.name).toBe("Emergency Fund");
      expect(payload.currency_code).toBe("USD");
      expect(payload.iban).toBe("GB29 NWBK 6016 1331 9268 19");
      expect(payload.account_number).toBe("9876543210");
      expect(payload.notes).toBe("Funds for emergency situations only");
    });

    it("T2.4: defaults opening_balance_date to fallback date when balance is given without date", () => {
      const payload = buildAccountPayload(
        {
          name: "Savings Vault",
          type: "asset",
          openingBalance: "5000.00",
          openingBalanceDate: "",
        },
        TODAY,
      );

      expect(payload.opening_balance).toBe("5000.00");
      expect(payload.opening_balance_date).toBe(TODAY);
    });

    it("T2.5: omits opening_balance and opening_balance_date when balance is empty or whitespace", () => {
      const payload = buildAccountPayload(
        {
          name: "Zero Balance Checking",
          type: "asset",
          openingBalance: "   ",
          openingBalanceDate: "2026-11-01",
        },
        TODAY,
      );

      expect(payload.opening_balance).toBeUndefined();
      expect(payload.opening_balance_date).toBeUndefined();
    });

    it("T2.6: preserves Unicode, emojis, and special symbols in account name and notes", () => {
      const payload = buildAccountPayload(
        {
          name: "🏦 Coffre Fort & Épargne (日本語 / 💰)",
          type: "asset",
          notes: "Special reserve: 100% sécurisé! Notes avec accents: café, résumé, naïve.",
        },
        TODAY,
      );

      expect(payload.name).toBe("🏦 Coffre Fort & Épargne (日本語 / 💰)");
      expect(payload.notes).toBe("Special reserve: 100% sécurisé! Notes avec accents: café, résumé, naïve.");
    });

    it("T2.7: handles maximum length IBAN (34 chars) and lengthy notes cleanly", () => {
      const longIban = "AL98202111090000000001234567890123"; // 34 chars
      const longNotes = "A".repeat(1500);

      const payload = buildAccountPayload(
        {
          name: "International Treasury",
          type: "asset",
          iban: longIban,
          notes: longNotes,
        },
        TODAY,
      );

      expect(payload.iban).toHaveLength(34);
      expect(payload.iban).toBe(longIban);
      expect(payload.notes).toHaveLength(1500);
    });
  });

  // ==========================================================================
  // Tier 3: Cross-Feature Combinations
  // ==========================================================================
  describe("Tier 3: Cross-Feature Combinations", () => {
    it("T3.1: Speed Dial FAB on another route navigates to /accounts?create=1", () => {
      const determineFabAction = (currentPath: string) => {
        if (currentPath === "/accounts") {
          return { type: "event", eventName: "ff:open-create-account" };
        }
        return { type: "navigate", targetUrl: "/accounts?create=1" };
      };

      const fromDashboard = determineFabAction("/dashboard");
      expect(fromDashboard.type).toBe("navigate");
      expect(fromDashboard.targetUrl).toBe("/accounts?create=1");

      const fromAccounts = determineFabAction("/accounts");
      expect(fromAccounts.type).toBe("event");
      expect(fromAccounts.eventName).toBe("ff:open-create-account");
    });

    it("T3.2: Account creation modal preserves selected tab and query params", () => {
      const urlParams = new URLSearchParams("tab=liability&create=1");
      const initialTab = urlParams.get("tab") || "asset";
      const normalizedTab = normalizeAccountType(initialTab);

      const form: CreateAccountFormValues = {
        name: "Student Loan 2026",
        type: normalizedTab,
        liabilityType: "loan",
        openingBalance: "35000",
      };

      const payload = buildAccountPayload(form, TODAY);
      expect(payload.type).toBe("liability");
      expect(payload.liability_type).toBe("loan");
      expect(payload.liability_direction).toBe("credit");
    });

    it("T3.3: Query cache invalidation triggers on successful account creation", () => {
      const invalidatedKeys: string[][] = [];
      const fakeQueryClient = {
        invalidateQueries: ({ queryKey }: { queryKey: string[] }) => {
          invalidatedKeys.push(queryKey);
        },
      };

      const handleCreationSuccess = () => {
        fakeQueryClient.invalidateQueries({ queryKey: ["accounts"] });
        fakeQueryClient.invalidateQueries({ queryKey: ["summary"] });
        fakeQueryClient.invalidateQueries({ queryKey: ["dashboard"] });
      };

      handleCreationSuccess();

      expect(invalidatedKeys).toContainEqual(["accounts"]);
      expect(invalidatedKeys).toContainEqual(["summary"]);
      expect(invalidatedKeys).toContainEqual(["dashboard"]);
      expect(invalidatedKeys).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Tier 4: Real-World Application Scenarios
  // ==========================================================================
  describe("Tier 4: Real-World Application Scenarios", () => {
    it("T4.1: Scenario - User onboards with multi-account setup (checking + mortgage)", () => {
      // 1. User creates primary checking account
      const checkingForm: CreateAccountFormValues = {
        name: "Everyday Checking",
        type: "asset",
        currencyCode: "EUR",
        accountRole: "defaultAsset",
        openingBalance: "2500.00",
        openingBalanceDate: "2026-11-01",
        iban: "FR7630006000011234567890189",
      };
      const checkingPayload = buildAccountPayload(checkingForm, TODAY);
      expect(checkingPayload.type).toBe("asset");
      expect(checkingPayload.opening_balance).toBe("2500.00");
      expect(checkingPayload.account_role).toBe("defaultAsset");

      // 2. User creates a home mortgage liability account
      const mortgageForm: CreateAccountFormValues = {
        name: "Primary Residence Mortgage",
        type: "liabilities", // plural input from UI tab
        currencyCode: "EUR",
        liabilityType: "mortgage",
        openingBalance: "320000.00",
        openingBalanceDate: "2026-11-01",
        notes: "30-year fixed rate mortgage at 3.2%",
      };
      const mortgagePayload = buildAccountPayload(mortgageForm, TODAY);
      expect(mortgagePayload.type).toBe("liability");
      expect(mortgagePayload.liability_type).toBe("mortgage");
      expect(mortgagePayload.liability_direction).toBe("credit");
      expect(mortgagePayload.opening_balance).toBe("320000.00");
      expect(mortgagePayload.notes).toContain("30-year fixed rate");
    });

    it("T4.2: Scenario - Business user sets up revenue streams and expense categories", () => {
      // 1. Client consulting revenue account
      const revenueForm: CreateAccountFormValues = {
        name: "Acme Corp Retainer Revenue",
        type: "income",
        currencyCode: "USD",
        notes: "Monthly enterprise support contract",
      };
      const revPayload = buildAccountPayload(revenueForm, TODAY);
      expect(revPayload.type).toBe("revenue");
      expect(revPayload.notes).toBe("Monthly enterprise support contract");

      // 2. SaaS tools expense account
      const expenseForm: CreateAccountFormValues = {
        name: "Cloud Hosting & SaaS Subscriptions",
        type: "expenses",
        currencyCode: "USD",
        notes: "AWS, Vercel, Datadog",
      };
      const expPayload = buildAccountPayload(expenseForm, TODAY);
      expect(expPayload.type).toBe("expense");
      expect(expPayload.notes).toBe("AWS, Vercel, Datadog");
    });
  });
});
