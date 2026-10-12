/** Items with 5 units or fewer available count as low stock. */
export const LOW_STOCK_THRESHOLD = 5;

export class InsufficientStock extends Error {
  readonly sku: string;
  readonly wanted: number;
  readonly available: number;

  constructor(sku: string, wanted: number, available: number) {
    super(`${sku}: wanted ${wanted}, ${available} available`);
    this.name = "InsufficientStock";
    this.sku = sku;
    this.wanted = wanted;
    this.available = available;
  }
}

export class Inventory {
  #onHand = new Map<string, number>();
  #reserved = new Map<string, number>();

  receive(sku: string, qty: number): void {
    this.#onHand.set(sku, this.onHand(sku) + qty);
  }

  onHand(sku: string): number {
    return this.#onHand.get(sku) ?? 0;
  }

  reserved(sku: string): number {
    return this.#reserved.get(sku) ?? 0;
  }

  /** Units that can still be promised to a new order. */
  available(sku: string): number {
    return this.onHand(sku) - this.reserved(sku);
  }

  reserve(sku: string, qty: number): void {
    this.#reserved.set(sku, this.reserved(sku) + qty);
  }

  release(sku: string, qty: number): void {
    this.#reserved.set(sku, Math.max(0, this.reserved(sku) - qty));
  }

  /** Ships reserved units: they leave both the reservation and the shelf. */
  commit(sku: string, qty: number): void {
    if (qty > this.reserved(sku)) throw new InsufficientStock(sku, qty, this.reserved(sku));
    this.#reserved.set(sku, this.reserved(sku) - qty);
    this.#onHand.set(sku, this.onHand(sku) - qty);
  }

  lowStock(): string[] {
    return [...this.#onHand.keys()].filter((sku) => this.available(sku) <= LOW_STOCK_THRESHOLD).sort();
  }
}
