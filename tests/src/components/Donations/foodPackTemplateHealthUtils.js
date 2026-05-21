import { getInventoryExpiryStatus } from "./inventoryExpiryUtils";

const LOW_STOCK_THRESHOLD = 20;

const normalizeId = (value) => String(value || "").trim();

export const getTemplateExpiryStatus = getInventoryExpiryStatus;

export function isLowStockQuantity(quantity) {
  return Number(quantity || 0) < LOW_STOCK_THRESHOLD;
}

export function buildInventoryItemLookup(items = []) {
  return items.reduce((lookup, item) => {
    const key = normalizeId(item?._id);
    if (key) {
      lookup[key] = item;
    }
    return lookup;
  }, {});
}

export function getTemplateItemHealth(templateItem, inventoryLookup = {}) {
  const inventoryItem =
    inventoryLookup[normalizeId(templateItem?.inventoryItemId)] || null;
  const availableQuantity = Number(inventoryItem?.quantity || 0);
  const expiryStatus = getTemplateExpiryStatus(inventoryItem?.expirationDate);
  const isLow = !inventoryItem || isLowStockQuantity(availableQuantity);

  return {
    inventoryItem,
    availableQuantity,
    expiryStatus,
    isLow,
    isExpiring: expiryStatus === "soon",
    isExpired: expiryStatus === "expired",
  };
}

export function summarizeTemplateHealth(template, inventoryLookup = {}) {
  const items = Array.isArray(template?.items) ? template.items : [];

  const itemHealth = items.map((item) => ({
    item,
    ...getTemplateItemHealth(item, inventoryLookup),
  }));

  return {
    itemHealth,
    lowCount: itemHealth.filter((entry) => entry.isLow).length,
    expiringCount: itemHealth.filter((entry) => entry.isExpiring).length,
    expiredCount: itemHealth.filter((entry) => entry.isExpired).length,
  };
}

