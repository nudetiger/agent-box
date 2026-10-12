export interface Product {
  sku: string;
  name: string;
  priceCents: number;
  category: string;
  taxable: boolean;
}

export class Catalog {
  #products = new Map<string, Product>();

  add(product: Product): void {
    if (this.#products.has(product.sku)) throw new Error(`duplicate sku: ${product.sku}`);
    if (!Number.isInteger(product.priceCents) || product.priceCents < 0) {
      throw new RangeError(`bad price for ${product.sku}: ${product.priceCents}`);
    }
    this.#products.set(product.sku, { ...product });
  }

  has(sku: string): boolean {
    return this.#products.has(sku);
  }

  get(sku: string): Product {
    const product = this.#products.get(sku);
    if (!product) throw new Error(`unknown sku: ${sku}`);
    return product;
  }

  list(): Product[] {
    return [...this.#products.values()].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  }
}
