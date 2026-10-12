import type { Product } from "./catalog.ts";
import { percentOf, type Cents } from "./money.ts";

export interface Line {
  product: Product;
  qty: number;
}

export type Rule =
  | { kind: "category-percent"; category: string; percent: number }
  | { kind: "buy-x-get-y"; sku: string; buy: number; free: number };

export interface Discount {
  label: string;
  cents: Cents;
}

export function discountsFor(lines: Line[], rules: Rule[]): Discount[] {
  const out: Discount[] = [];
  for (const rule of rules) {
    if (rule.kind === "category-percent") {
      const base = lines
        .filter((l) => l.product.category === rule.category)
        .reduce((n, l) => n + l.product.priceCents * l.qty, 0);
      if (base > 0) out.push({ label: `${rule.percent}% off ${rule.category}`, cents: percentOf(base, rule.percent) });
    } else {
      const line = lines.find((l) => l.product.sku === rule.sku);
      if (!line) continue;
      const free = Math.floor(line.qty / (rule.buy + rule.free)) * rule.free;
      if (free > 0) {
        out.push({ label: `buy ${rule.buy} get ${rule.free}: ${line.product.name}`, cents: free * line.product.priceCents });
      }
    }
  }
  return out;
}
