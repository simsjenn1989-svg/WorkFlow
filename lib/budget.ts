import { db } from './supabase';

/** Monthly ceiling in US dollars. Set MONTHLY_BUDGET_USD to change it. */
export function monthlyBudgetCents(): number {
  const raw = Number(process.env.MONTHLY_BUDGET_USD ?? 20);
  return Math.round((Number.isFinite(raw) && raw > 0 ? raw : 20) * 100);
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function spentThisMonthCents(): Promise<number> {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await db()
    .from('cost_ledger')
    .select('amount_cents')
    .gte('created_at', since.toISOString());
  if (error) return 0;

  return (data ?? []).reduce((total, row) => total + (row.amount_cents as number), 0);
}

export type BudgetState = {
  spentCents: number;
  budgetCents: number;
  remainingCents: number;
  /** True past 80%, so the UI can warn before it refuses. */
  warning: boolean;
};

export async function budgetState(): Promise<BudgetState> {
  const budgetCents = monthlyBudgetCents();
  const spentCents = await spentThisMonthCents();
  return {
    spentCents,
    budgetCents,
    remainingCents: Math.max(0, budgetCents - spentCents),
    warning: spentCents >= budgetCents * 0.8,
  };
}

/** Refuses rather than overspending. The ceiling is a stop, not a suggestion. */
export async function assertWithinBudget(costCents: number): Promise<void> {
  const { spentCents, budgetCents } = await budgetState();
  if (spentCents + costCents > budgetCents) {
    throw new Error(
      `This would take the month to ${formatUsd(spentCents + costCents)}, past the ` +
        `${formatUsd(budgetCents)} ceiling. Raise MONTHLY_BUDGET_USD to continue.`,
    );
  }
}
