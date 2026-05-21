export function getTodayInputDate(baseDate = new Date()) {
  const date = new Date(baseDate);
  date.setHours(0, 0, 0, 0);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getInventoryExpiryStatus(expirationDate, baseDate = new Date()) {
  if (!expirationDate) return "none";

  const today = new Date(baseDate);
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expirationDate);
  if (Number.isNaN(expiry.getTime())) return "none";

  expiry.setHours(0, 0, 0, 0);

  const diffDays = Math.ceil(
    (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays < 0) return "expired";
  if (diffDays <= 30) return "soon";
  return "ok";
}

export function validateFutureOrTodayInventoryDate(value, baseDate = new Date()) {
  if (!value) return "";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Expiration date is invalid.";
  }

  const today = new Date(baseDate);
  today.setHours(0, 0, 0, 0);

  parsed.setHours(0, 0, 0, 0);

  if (parsed < today) {
    return "Expiration date cannot be in the past.";
  }

  return "";
}
