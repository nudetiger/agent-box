import type { Line } from "./discounts.ts";
import type { Totals } from "./cart.ts";
import { formatCents } from "./money.ts";

const WIDTH = 36;

function row(label: string, amount: string): string {
  return label + " ".repeat(Math.max(1, WIDTH - label.length - amount.length)) + amount;
}

export function receipt(lines: Line[], totals: Totals): string {
  const out = lines.map((l) => row(`${l.qty} x ${l.product.name}`, formatCents(l.product.priceCents * l.qty)));
  out.push(row("Subtotal", formatCents(totals.subtotal)));
  for (const d of totals.discounts) out.push(row(d.label, formatCents(-d.cents)));
  out.push(row("Tax", formatCents(totals.tax)));
  out.push(row("Total", formatCents(totals.total)));
  return out.join("\n") + "\n";
}
