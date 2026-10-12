import { percentOf, type Cents } from "./money.ts";

/** Percent rates by shipping region. */
export const TAX_RATES: Record<string, number> = {
  "US-CA": 7.25,
  "US-NY": 8.875,
  "US-OR": 0,
  DE: 19,
};

export class UnknownRegion extends Error {
  constructor(region: string) {
    super(`no tax rate for region ${region}`);
    this.name = "UnknownRegion";
  }
}

export function taxRate(region: string): number {
  if (!Object.hasOwn(TAX_RATES, region)) throw new UnknownRegion(region);
  return TAX_RATES[region];
}

export function taxFor(taxableCents: Cents, region: string): Cents {
  return percentOf(taxableCents, taxRate(region));
}
