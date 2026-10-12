import { test } from "node:test";
import assert from "node:assert/strict";
import { Cart } from "../src/cart.ts";
import { Catalog } from "../src/catalog.ts";
import { Inventory } from "../src/inventory.ts";
import { receipt } from "../src/receipt.ts";

test("receipt lists lines, discounts, tax and total in one column", () => {
  const catalog = new Catalog();
  catalog.add({ sku: "bk-1", name: "Atlas", priceCents: 2500, category: "books", taxable: false });
  catalog.add({ sku: "lp-1", name: "Lamp", priceCents: 10000, category: "home", taxable: true });
  const cart = new Cart(catalog, new Inventory());
  cart.addItem("bk-1", 2);
  cart.addItem("lp-1");
  const text = receipt(cart.lines(), cart.totals("US-CA", [{ kind: "category-percent", category: "books", percent: 10 }]));
  assert.equal(
    text,
    [
      "2 x Atlas                     $50.00",
      "1 x Lamp                     $100.00",
      "Subtotal                     $150.00",
      "10% off books                 -$5.00",
      "Tax                            $7.25",
      "Total                        $152.25",
      "",
    ].join("\n"),
  );
});
