import type { Catalog } from "./catalog.ts";
import type { Inventory } from "./inventory.ts";
import { discountsFor, type Discount, type Line, type Rule } from "./discounts.ts";
import { sum, type Cents } from "./money.ts";
import { taxFor } from "./tax.ts";

export interface Totals {
  subtotal: Cents;
  discounts: Discount[];
  tax: Cents;
  total: Cents;
}

export class Cart {
  #catalog: Catalog;
  #inventory: Inventory;
  #qty = new Map<string, number>();

  constructor(catalog: Catalog, inventory: Inventory) {
    this.#catalog = catalog;
    this.#inventory = inventory;
  }

  addItem(sku: string, qty = 1): void {
    this.#catalog.get(sku); // throws on an unknown sku
    this.#qty.set(sku, (this.#qty.get(sku) ?? 0) + qty);
  }

  /** Sets a line's quantity; 0 removes the line. */
  setQuantity(sku: string, qty: number): void {
    if (qty === 0) {
      this.#qty.delete(sku);
      return;
    }
    this.#catalog.get(sku);
    this.#qty.set(sku, qty);
  }

  removeItem(sku: string): void {
    this.#qty.delete(sku);
  }

  lines(): Line[] {
    return [...this.#qty.keys()].sort().map((sku) => ({ product: this.#catalog.get(sku), qty: this.#qty.get(sku)! }));
  }

  totals(region: string, rules: Rule[] = []): Totals {
    const lines = this.lines();
    const subtotal = sum(lines.map((l) => l.product.priceCents * l.qty));
    const discounts = discountsFor(lines, rules);
    const taxable = sum(lines.filter((l) => l.product.taxable).map((l) => l.product.priceCents * l.qty));
    const tax = taxFor(taxable, region);
    return { subtotal, discounts, tax, total: subtotal - sum(discounts.map((d) => d.cents)) + tax };
  }

  /** Reserves stock for every line, or for none: a failed line releases the ones before it. */
  checkout(): void {
    const done: Line[] = [];
    try {
      for (const line of this.lines()) {
        this.#inventory.reserve(line.product.sku, line.qty);
        done.push(line);
      }
    } catch (err) {
      for (const line of done) this.#inventory.release(line.product.sku, line.qty);
      throw err;
    }
    this.#qty.clear();
  }
}
