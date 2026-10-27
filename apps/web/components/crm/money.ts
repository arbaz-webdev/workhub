import type { MoneyDto } from '@workhub/shared';

/** Adds up values per currency; amounts in different currencies are never added together. */
export function sumMoney(items: { value: number | null; currency: string }[]): MoneyDto[] {
  const totals = new Map<string, number>();
  for (const i of items) if (i.value !== null) totals.set(i.currency, (totals.get(i.currency) ?? 0) + i.value);
  return [...totals].map(([currency, value]) => ({ currency, value })).sort((a, b) => b.value - a.value);
}
