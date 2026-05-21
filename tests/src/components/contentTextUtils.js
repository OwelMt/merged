export const MAX_CONTENT_TITLE_LENGTH = 120;
export const MAX_CONTENT_DESCRIPTION_LENGTH = 800;

const collapseWhitespace = (value) =>
  String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");

const stripUnsupportedCharacters = (value, { allowLineBreaks = false } = {}) => {
  const normalized = String(value || "").normalize("NFKC");

  return normalized.replace(
    new RegExp(`[^A-Za-z0-9 .,!?():;@%&/+'"#\\-_${allowLineBreaks ? "\\n" : ""}]`, "g"),
    ""
  );
};

const trimNoise = (value) =>
  String(value || "")
    .replace(/(^|[\s\n])[#@%&/+=_*^~`|\\]+(?=$|[\s\n])/g, " ")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9.!?)]$/, "")
    .trim();

const trimContentLines = (value) =>
  String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

const hasReadableLetters = (value, minimumLetters = 3) => {
  const matches = String(value || "").match(/[A-Za-z]/g);
  return (matches?.length || 0) >= minimumLetters;
};

export const sanitizeContentTitle = (value) =>
  trimContentLines(
    trimNoise(stripUnsupportedCharacters(collapseWhitespace(value))).replace(/[ ]{2,}/g, " ")
  ).slice(0, MAX_CONTENT_TITLE_LENGTH);

export const sanitizeContentDescription = (value) =>
  trimContentLines(
    trimNoise(
      stripUnsupportedCharacters(collapseWhitespace(value), { allowLineBreaks: true })
    )
      .replace(/[ ]*\n[ ]*/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .replace(/[ ]{2,}/g, " ")
  ).slice(0, MAX_CONTENT_DESCRIPTION_LENGTH);

export const validateContentFields = (title, description) => {
  const cleanTitle = sanitizeContentTitle(title);
  const cleanDescription = sanitizeContentDescription(description);

  if (!cleanTitle || !cleanDescription) {
    return "Title and description are required.";
  }

  if (!hasReadableLetters(cleanTitle, 3)) {
    return "Title must contain readable letters.";
  }

  if (!hasReadableLetters(cleanDescription, 6)) {
    return "Description must contain readable details.";
  }

  return "";
};
