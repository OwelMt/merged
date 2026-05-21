const parseResponseBody = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text ? { message: text } : {};
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read workbook file."));

    reader.readAsDataURL(file);
  });

const triggerBlobDownload = (blob, fileName) => {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(objectUrl);
};

const parseFileName = (response, fallbackName) => {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallbackName;
};

const downloadDistributionTemplate = async ({ baseUrl }) => {
  const response = await fetch(`${baseUrl}/api/relief-distributions/template/download`, {
    credentials: "include",
  });

  if (!response.ok) {
    const body = await parseResponseBody(response);
    throw new Error(body?.message || "Failed to download the DAFAC template.");
  }

  const blob = await response.blob();
  triggerBlobDownload(blob, parseFileName(response, "relief-distribution-template.xlsx"));
};

const importDistributionWorkbook = async ({ baseUrl, reliefRequestId, file }) => {
  const workbookBase64 = await readFileAsDataUrl(file);

  const response = await fetch(
    `${baseUrl}/api/relief-distributions/${reliefRequestId}/import-workbook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ workbookBase64 }),
    }
  );

  const body = await parseResponseBody(response);

  if (!response.ok) {
    const error = new Error(body?.message || "Failed to import the DAFAC workbook.");
    error.issues = Array.isArray(body?.issues) ? body.issues : [];
    throw error;
  }

  return body;
};

const downloadAccomplishedReportPdf = async ({ baseUrl, reliefRequestId }) => {
  const response = await fetch(
    `${baseUrl}/api/relief-distributions/${reliefRequestId}/export-accomplished-report-pdf`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    const body = await parseResponseBody(response);
    throw new Error(body?.message || "Failed to export the accomplished report.");
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  window.open(objectUrl, "_blank", "noopener,noreferrer");
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
};

module.exports = {
  downloadAccomplishedReportPdf,
  downloadDistributionTemplate,
  importDistributionWorkbook,
  readFileAsDataUrl,
};
