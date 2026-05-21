import {
  MAX_CONTENT_DESCRIPTION_LENGTH,
  MAX_CONTENT_TITLE_LENGTH,
  sanitizeContentDescription,
  sanitizeContentTitle,
  validateContentFields,
} from "./contentTextUtils";

describe("contentTextUtils", () => {
  test("sanitizes titles by trimming, collapsing spaces, and removing noisy symbols", () => {
    expect(sanitizeContentTitle("  !! Flood   advisory ###  ")).toBe(
      "Flood advisory"
    );
  });

  test("sanitizes descriptions while keeping readable punctuation and line breaks", () => {
    expect(
      sanitizeContentDescription(
        "  Stay indoors!!!\n\nBring water, food, and IDs. ###  "
      )
    ).toBe("Stay indoors!!!\nBring water, food, and IDs.");
  });

  test("caps title and description length", () => {
    expect(sanitizeContentTitle("a".repeat(MAX_CONTENT_TITLE_LENGTH + 20))).toHaveLength(
      MAX_CONTENT_TITLE_LENGTH
    );
    expect(
      sanitizeContentDescription("b".repeat(MAX_CONTENT_DESCRIPTION_LENGTH + 30))
    ).toHaveLength(MAX_CONTENT_DESCRIPTION_LENGTH);
  });

  test("rejects values without enough readable letters", () => {
    expect(validateContentFields("1234567", "Weather notice")).toBe(
      "Title must contain readable letters."
    );
    expect(validateContentFields("Flood update", "1234567890")).toBe(
      "Description must contain readable details."
    );
  });

  test("accepts normal announcement-style content", () => {
    expect(
      validateContentFields(
        "Flood advisory for Barangay San Jose",
        "Residents near the river should monitor updates and prepare go-bags."
      )
    ).toBe("");
  });
});
