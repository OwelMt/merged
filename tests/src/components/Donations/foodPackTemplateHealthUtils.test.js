import {
  buildInventoryItemLookup,
  getTemplateExpiryStatus,
  isLowStockQuantity,
  summarizeTemplateHealth,
} from "./foodPackTemplateHealthUtils";

describe("foodPackTemplateHealthUtils", () => {
  test("flags low, expiring, and expired template items separately", () => {
    const today = new Date();
    const soonDate = new Date(today);
    soonDate.setDate(soonDate.getDate() + 10);
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + 60);
    const pastDate = new Date(today);
    pastDate.setDate(pastDate.getDate() - 2);

    const inventoryLookup = buildInventoryItemLookup([
      { _id: "rice", quantity: 12, expirationDate: soonDate.toISOString() },
      { _id: "water", quantity: 120, expirationDate: futureDate.toISOString() },
      { _id: "sardines", quantity: 55, expirationDate: pastDate.toISOString() },
    ]);

    const summary = summarizeTemplateHealth(
      {
        items: [
          { inventoryItemId: "rice", itemName: "Rice" },
          { inventoryItemId: "water", itemName: "Water" },
          { inventoryItemId: "sardines", itemName: "Sardines" },
        ],
      },
      inventoryLookup
    );

    expect(summary.lowCount).toBe(1);
    expect(summary.expiringCount).toBe(1);
    expect(summary.expiredCount).toBe(1);
  });

  test("treats missing inventory items as low stock only", () => {
    const summary = summarizeTemplateHealth({
      items: [{ inventoryItemId: "missing", itemName: "Missing Item" }],
    });

    expect(summary.lowCount).toBe(1);
    expect(summary.expiringCount).toBe(0);
    expect(summary.expiredCount).toBe(0);
  });

  test("uses the same low-stock threshold as inventory", () => {
    expect(isLowStockQuantity(0)).toBe(true);
    expect(isLowStockQuantity(19)).toBe(true);
    expect(isLowStockQuantity(20)).toBe(false);
  });

  test("separates expiring from expired dates", () => {
    const today = new Date();
    const soonDate = new Date(today);
    soonDate.setDate(soonDate.getDate() + 5);
    const pastDate = new Date(today);
    pastDate.setDate(pastDate.getDate() - 1);

    expect(getTemplateExpiryStatus(soonDate.toISOString())).toBe("soon");
    expect(getTemplateExpiryStatus(pastDate.toISOString())).toBe("expired");
  });
});

