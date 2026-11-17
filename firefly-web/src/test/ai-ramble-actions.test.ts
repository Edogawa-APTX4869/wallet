import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateSmartReply,
  parseWithSmartHeuristics,
  type SmartParseContext,
} from "@/lib/ai-ramble-parser";

const baseCtx: SmartParseContext = {
  text: "",
  today: "2026-11-17",
  defaultCurrency: "BHD",
  defaultAccount: "ila White",
  accounts: ["ila White", "Khaleeji Bank", "Salary Account"],
  categories: ["Food & Drinks", "Food & Drinks: Coffee", "Vehicle: Fuel", "Bills & Subscriptions"],
  budgets: ["Groceries", "Dining Out", "Petrol"],
  tags: ["urgent", "food", "work"],
  accountDetails: [
    { name: "ila White", currency: "BHD", balance: "120.500", type: "asset" },
    { name: "Khaleeji Bank", currency: "BHD", balance: "50.436", type: "asset" },
  ],
  budgetDetails: [
    { name: "Groceries", limit: "150", spent: "80", left: "70", currency: "BHD" },
    { name: "Dining Out", limit: "50", spent: "65", left: "-15", currency: "BHD" },
  ],
  piggyDetails: [
    { name: "Emergency Fund", current: "500", target: "2000", account: "Salary Account", currency: "BHD" },
  ],
  billDetails: [
    { name: "Netflix", amount: "4.500", freq: "monthly", currency: "BHD" },
  ],
};

describe("AI Ramble full-system action parser & live Q&A", () => {
  it("parses expenses, incomes, and account-to-account transfers with source, destination, budget, and bill", () => {
    const exp = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Coffee 2.400 BHD from ila White #food",
    });
    expect(exp[0]).toMatchObject({
      action_type: "transaction",
      type: "withdrawal",
      amount: "2.400",
      currency_code: "BHD",
      source_name: "ila White",
      category_name: "Food & Drinks: Coffee",
      tags: ["food"],
    });

    const billExp = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Paid 4.500 BHD for Netflix",
    });
    expect(billExp[0]?.bill_name).toBe("Netflix");

    const xfer = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Transfer 50 BHD from ila White to Khaleeji Bank",
    });
    expect(xfer[0]).toMatchObject({
      action_type: "transaction",
      type: "transfer",
      amount: "50",
      currency_code: "BHD",
      source_name: "ila White",
      destination_name: "Khaleeji Bank",
    });
  });

  it("parses budget transfers between budgets", () => {
    const res = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Transfer 25 BHD from Dining Out budget to Groceries budget",
    });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      action_type: "budget_transfer",
      amount: "25",
      currency_code: "BHD",
      source_name: "Dining Out",
      destination_name: "Groceries",
    });
  });

  it("parses budget adjustments (add, subtract, set, create)", () => {
    const addRes = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Add 20 BHD to Petrol budget",
    });
    expect(addRes[0]).toMatchObject({
      action_type: "budget_adjust",
      adjust_mode: "add",
      amount: "20",
      budget_name: "Petrol",
    });

    const setRes = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Set Groceries budget to 180 BHD",
    });
    expect(setRes[0]).toMatchObject({
      action_type: "budget_adjust",
      adjust_mode: "set",
      amount: "180",
      budget_name: "Groceries",
    });
  });

  it("parses piggy bank deposits and creation", () => {
    const res = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Add 50 BHD to Emergency Fund piggy",
    });
    expect(res[0]).toMatchObject({
      action_type: "piggy_bank",
      adjust_mode: "add",
      amount: "50",
      destination_name: "Emergency Fund",
    });
  });

  it("parses bills, recurring transactions, categories, and accounts", () => {
    const billRes = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Create monthly bill Gym Membership 15 BHD",
    });
    expect(billRes[0]).toMatchObject({
      action_type: "bill",
      amount: "15",
      repeat_freq: "monthly",
    });

    const recRes = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Recurring monthly Rent 250 BHD",
    });
    expect(recRes[0]).toMatchObject({
      action_type: "recurrence",
      amount: "250",
      repeat_freq: "monthly",
    });

    const catRes = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Create category Vehicle: Car Wash",
    });
    expect(catRes[0]).toMatchObject({
      action_type: "category",
      category_name: "Vehicle: Car Wash",
    });

    const accRes = parseWithSmartHeuristics({
      ...baseCtx,
      text: "Create account Travel Cash 100 USD",
    });
    expect(accRes[0]).toMatchObject({
      action_type: "account",
      account_type: "asset",
      amount: "100",
      currency_code: "USD",
      source_name: "Travel Cash",
    });
  });

  it("generates concise financial answers from live account, budget, piggy, and bill data", () => {
    const balReply = generateSmartReply({ ...baseCtx, text: "What are my balances?" }, []);
    expect(balReply).toContain("ila White: BHD 120.500");
    expect(balReply).toContain("Khaleeji Bank: BHD 50.436");

    const budReply = generateSmartReply({ ...baseCtx, text: "Which budgets are overspent?" }, []);
    expect(budReply).toContain("Dining Out");
    expect(budReply).toContain("15.000");

    const piggyReply = generateSmartReply({ ...baseCtx, text: "Check piggy bank goals" }, []);
    expect(piggyReply).toContain("Emergency Fund: BHD 500/2000");

    const billReply = generateSmartReply({ ...baseCtx, text: "List my bills" }, []);
    expect(billReply).toContain("Netflix");
  });

  it("wires full-system actions and compact UI across MagicChatPanel, Settings, and /new", () => {
    const magicSrc = readFileSync(
      path.resolve(__dirname, "../components/magic-chatbar.tsx"),
      "utf8",
    );
    const settingsSrc = readFileSync(
      path.resolve(__dirname, "../app/(app)/settings/settings-client.tsx"),
      "utf8",
    );
    const newTxSrc = readFileSync(
      path.resolve(__dirname, "../app/(app)/new/new-transaction.tsx"),
      "utf8",
    );

    expect(magicSrc).toContain("budget_transfer");
    expect(magicSrc).toContain("budget_adjust");
    expect(magicSrc).toContain("piggy_bank");
    expect(magicSrc).toContain("api.createBill");
    expect(magicSrc).toContain("api.createRecurrence");
    expect(magicSrc).toContain("api.createCategory");
    expect(magicSrc).toContain("api.createAccount");
    expect(settingsSrc).not.toContain("Google restricts third-party self-hosted Docker apps");
    expect(magicSrc).toContain("alwaysShow");
    expect(newTxSrc).not.toContain("AI MAGIC");
  });
});
