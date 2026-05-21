const path = require("path");
const Barangay = require("../models/Barangay");
const EvacPlace = require("../models/EvacPlace");
const ReliefRequest = require("../models/ReliefRequest");
const ReliefRelease = require("../models/ReliefRelease");
const sendReliefRequestEmail = require("../utils/sendReliefRequestEmail");
const createNotification = require("../utils/createNotification");
const createAuditEvent = require("../utils/createAuditEvent");
const {
  createPdfDocument,
  drawPdfEmptyState,
  drawPdfFooter,
  drawPdfHeader,
  drawPdfImageGrid,
  drawPdfLabelValue,
  drawPdfParagraphBlock,
  drawPdfSectionTitle,
  drawPdfTable,
  ensurePdfPageSpace,
  formatPdfDateValue,
} = require("../utils/pdfTheme");
const {
  SUPPORT_TYPE_APPLIANCE,
  SUPPORT_TYPE_FOODPACKS,
  SUPPORT_TYPE_MONETARY,
  normalizeSupportTypes,
  deriveLegacyRequestType,
  getSupportTypesFromRequest,
  hasSupportType,
  getSupportTypeLabel,
} = require("../utils/reliefSupportTypes");

const ACTIVE_REQUEST_STATUSES = ["pending", "approved", "partially_released", "released"];
const VIEWABLE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "partially_released",
  "released",
  "received",
  "completed",
  "rejected",
  "cancelled",
  "canceled",
];
const FINAL_REQUEST_STATUSES = ["received", "cancelled", "canceled", "rejected", "completed"];
const RELIEF_PROOF_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "proofs");
const generateRequestNo = async () => {
  const year = new Date().getFullYear();
  const prefix = `RR-${year}`;

  const latest = await ReliefRequest.findOne({
    requestNo: { $regex: `^${prefix}-` },
  }).sort({ createdAt: -1 });

  let nextNumber = 1;

  if (latest?.requestNo) {
    const parts = latest.requestNo.split("-");
    const lastSeq = Number(parts[2]);
    if (!Number.isNaN(lastSeq)) {
      nextNumber = lastSeq + 1;
    }
  }

  return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
};

const normalizeString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const normalizeStatus = (value) => normalizeString(value).toLowerCase();

const toNumber = (value) => {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const resolveProofLocalPath = (proofFile = "") => {
  const normalized = normalizeString(proofFile).replace(/\\/g, "/");
  if (!normalized) return null;

  if (normalized.startsWith("uploads/proofs/")) {
    return path.join(__dirname, "..", normalized);
  }

  if (normalized.startsWith("proofs/")) {
    return path.join(__dirname, "..", "uploads", normalized);
  }

  if (normalized.includes("/")) {
    return path.join(__dirname, "..", normalized);
  }

  return path.join(RELIEF_PROOF_UPLOAD_DIR, normalized);
};

const isImageProofPath = (proofFile = "") =>
  /\.(png|jpe?g|webp|gif)$/i.test(normalizeString(proofFile));

const buildStoredProofPath = (file = {}) => {
  const rawName = normalizeString(file.filename || file.originalname);
  if (!rawName) return "";
  return `uploads/proofs/${rawName.replace(/\\/g, "/")}`;
};

const collectProofImagesForPdf = (proofFiles = [], options = {}) => {
  const { maxImages = 3, labelPrefix = "Proof" } = options;
  const safeFiles = (Array.isArray(proofFiles) ? proofFiles : [])
    .map((file) => normalizeString(file))
    .filter(Boolean)
    .filter(isImageProofPath);

  const images = safeFiles.slice(0, maxImages).map((file, index) => ({
    path: resolveProofLocalPath(file),
    caption: `${labelPrefix} ${index + 1}`,
  }));

  return {
    images: images.filter((image) => image.path),
    remainingCount: Math.max(0, safeFiles.length - images.length),
  };
};

const formatMonetaryAmount = (value) =>
  toNumber(value).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

const requiresFoodPackFulfillment = (request = {}) =>
  hasSupportType(getSupportTypesFromRequest(request), SUPPORT_TYPE_FOODPACKS);

const requiresMonetaryFulfillment = (request = {}) =>
  hasSupportType(getSupportTypesFromRequest(request), SUPPORT_TYPE_MONETARY);

const requiresApplianceFulfillment = (request = {}) =>
  hasSupportType(getSupportTypesFromRequest(request), SUPPORT_TYPE_APPLIANCE);

const getActiveRows = (rows = []) =>
  (Array.isArray(rows) ? rows : []).filter((row) => row && row.isActiveRow !== false);

const getRequestedFoodPacksFromRows = (rows = []) =>
  getActiveRows(rows).reduce((sum, row) => sum + toNumber(row.requestedFoodPacks), 0);

const getRequestedMonetaryAmountInput = (payload = {}) =>
  toNumber(payload.requestedMonetaryAmount ?? payload?.totals?.requestedMonetaryAmount);

const sanitizeRequestedAppliance = (item = {}) => ({
  itemName: normalizeString(item.itemName),
  category: normalizeString(item.category),
  quantityRequested: toNumber(item.quantityRequested),
  remarks: normalizeString(item.remarks),
});

const getRequestedAppliances = (request = {}) =>
  (Array.isArray(request.requestedAppliances) ? request.requestedAppliances : [])
    .map(sanitizeRequestedAppliance)
    .filter((item) => item.itemName && item.category && item.quantityRequested > 0);

const getRequestDemandProfile = (request = {}) => {
  const supportTypes = getSupportTypesFromRequest(request);
  const requestType = deriveLegacyRequestType(supportTypes);
  const totals = request.totals || {};
  const requestedFoodPacks = requiresFoodPackFulfillment({ supportTypes, requestType })
    ? toNumber(totals.requestedFoodPacks)
    : 0;
  const requestedMonetaryAmount = requiresMonetaryFulfillment({ supportTypes, requestType })
    ? toNumber(totals.requestedMonetaryAmount)
    : 0;
  const requestedAppliances = requiresApplianceFulfillment({ supportTypes, requestType })
    ? getRequestedAppliances(request)
    : [];

  return {
    requestType,
    supportTypes,
    requiresFoodPacks: requiresFoodPackFulfillment({ supportTypes, requestType }),
    requiresMonetary: requiresMonetaryFulfillment({ supportTypes, requestType }),
    requiresAppliance: requiresApplianceFulfillment({ supportTypes, requestType }),
    requestedFoodPacks,
    requestedMonetaryAmount,
    requestedAppliances,
    requestedApplianceQuantity: requestedAppliances.reduce(
      (sum, item) => sum + toNumber(item.quantityRequested),
      0
    ),
  };
};

const buildRequestDemandLabel = (request = {}) => {
  const demand = getRequestDemandProfile(request);
  const parts = [];

  if (demand.requiresFoodPacks) {
    parts.push(`${demand.requestedFoodPacks} food pack(s)`);
  }

  if (demand.requiresMonetary) {
    parts.push(`PHP ${formatMonetaryAmount(demand.requestedMonetaryAmount)}`);
  }

  if (demand.requiresAppliance) {
    parts.push(
      `${demand.requestedApplianceQuantity} appliance unit(s) across ${demand.requestedAppliances.length} item(s)`
    );
  }

  return parts.length ? `Requested ${parts.join(" and ")}` : "No quantified request totals";
};

const isMonetaryOnlySupportTypes = (supportTypes = []) =>
  hasSupportType(supportTypes, SUPPORT_TYPE_MONETARY) &&
  !hasSupportType(supportTypes, SUPPORT_TYPE_FOODPACKS) &&
  !hasSupportType(supportTypes, SUPPORT_TYPE_APPLIANCE);

const getRequestOwnerRole = (request = {}) =>
  isMonetaryOnlySupportTypes(getSupportTypesFromRequest(request)) ? "admin" : "drrmo";

const getRequestOwnerLabel = (request = {}) =>
  getRequestOwnerRole(request) === "admin" ? "Admin" : "DRRMO";

const getRequestQueueLink = (request = {}) =>
  getRequestOwnerRole(request) === "admin"
    ? "/admin/relief-lists"
    : "/drrmo/relief-lists";

const shapeReliefRequestResponse = (request) => {
  if (!request) return request;

  const requestObject =
    typeof request.toObject === "function" ? request.toObject() : { ...request };
  const supportTypes = getSupportTypesFromRequest(requestObject);

  return {
    ...requestObject,
    requestType: deriveLegacyRequestType(supportTypes),
    supportTypes,
    requestedAppliances: getRequestedAppliances(requestObject),
    totals: {
      ...(requestObject.totals || {}),
      requestedMonetaryAmount: toNumber(
        requestObject?.totals?.requestedMonetaryAmount
      ),
      requestedApplianceQuantity: toNumber(
        requestObject?.totals?.requestedApplianceQuantity
      ),
    },
    fulfillment: {
      ...(requestObject.fulfillment || {}),
      releasedApplianceQuantity: toNumber(
        requestObject?.fulfillment?.releasedApplianceQuantity
      ),
      releasedMonetaryAmount: toNumber(
        requestObject?.fulfillment?.releasedMonetaryAmount
      ),
      receivedApplianceQuantity: toNumber(
        requestObject?.fulfillment?.receivedApplianceQuantity
      ),
      receivedMonetaryAmount: toNumber(
        requestObject?.fulfillment?.receivedMonetaryAmount
      ),
    },
  };
};

const validateRequestDemand = ({
  supportTypes,
  requestType,
  rows,
  requestedMonetaryAmount,
  requestedAppliances,
  remarks,
}) => {
  const normalizedSupportTypes = normalizeSupportTypes(supportTypes, requestType);
  const requestedFoodPacks = getRequestedFoodPacksFromRows(rows);
  const applianceItems = getRequestedAppliances({ requestedAppliances });
  const requiresFoodPacks = hasSupportType(
    normalizedSupportTypes,
    SUPPORT_TYPE_FOODPACKS
  );
  const requiresMonetary = hasSupportType(
    normalizedSupportTypes,
    SUPPORT_TYPE_MONETARY
  );
  const requiresAppliance = hasSupportType(
    normalizedSupportTypes,
    SUPPORT_TYPE_APPLIANCE
  );

  if (requiresFoodPacks && requestedFoodPacks <= 0) {
    return "Requested food packs must be greater than 0 for this request type.";
  }

  if (
    requiresMonetary &&
    (requiresFoodPacks || requiresAppliance)
  ) {
    return "Monetary requests must be submitted separately from food packs or appliances.";
  }

  if (requiresMonetary && requestedMonetaryAmount <= 0) {
    return "Requested monetary amount must be greater than 0 for this request type.";
  }

  if (requiresMonetary && !normalizeString(remarks)) {
    return "Remarks are required for monetary requests.";
  }

  if (requiresAppliance && applianceItems.length === 0) {
    return "Add at least one requested appliance item.";
  }

  return null;
};

const sanitizeRow = (row = {}) => ({
  evacPlaceId: row.evacPlaceId || null,
  evacuationCenterName: normalizeString(row.evacuationCenterName),
  households: toNumber(row.households),
  families: toNumber(row.families),
  male: toNumber(row.male),
  female: toNumber(row.female),
  lgbtq: toNumber(row.lgbtq),
  pwd: toNumber(row.pwd),
  pregnant: toNumber(row.pregnant),
  senior: toNumber(row.senior),
  requestedFoodPacks: toNumber(row.requestedFoodPacks),
  isActiveRow: row.isActiveRow !== undefined ? Boolean(row.isActiveRow) : true,
  rowRemarks: normalizeString(row.rowRemarks),
});

const buildRowsFromEvacPlaces = (places = []) =>
  places.map((place) => ({
    evacPlaceId: place._id,
    evacuationCenterName: normalizeString(place.name),
    households: 0,
    families: 0,
    male: 0,
    female: 0,
    lgbtq: 0,
    pwd: 0,
    pregnant: 0,
    senior: 0,
    requestedFoodPacks: 0,
    isActiveRow: true,
    rowRemarks: "",
  }));

const sanitizeRowsForSupportTypes = (rows = [], supportTypes = []) => {
  const allowsFoodPacks = hasSupportType(supportTypes, SUPPORT_TYPE_FOODPACKS);

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    requestedFoodPacks: allowsFoodPacks ? toNumber(row.requestedFoodPacks) : 0,
  }));
};

const isNonNegativeNumber = (value) =>
  typeof value === "number" && !Number.isNaN(value) && value >= 0;

const validateRows = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return "At least one evacuation center row is required.";
  }

  const seenNames = new Set();

  for (const row of rows) {
    if (!row.evacuationCenterName) {
      return "Each row must have an evacuation center name.";
    }

    const normalizedName = row.evacuationCenterName.toLowerCase();
    if (seenNames.has(normalizedName)) {
      return `Duplicate evacuation center row found for "${row.evacuationCenterName}".`;
    }
    seenNames.add(normalizedName);

    const numberFields = [
      "households",
      "families",
      "male",
      "female",
      "lgbtq",
      "pwd",
      "pregnant",
      "senior",
      "requestedFoodPacks",
    ];

    for (const field of numberFields) {
      if (!isNonNegativeNumber(row[field])) {
        return `Invalid value for ${field} in one of the rows.`;
      }
    }
  }

  return null;
};

const computePrioritySnapshotFromRows = (rows = []) => {
  const activeRows = getActiveRows(rows);

  const totalAffected = activeRows.reduce(
    (sum, row) =>
      sum +
      toNumber(row.male) +
      toNumber(row.female) +
      toNumber(row.lgbtq) +
      toNumber(row.pwd) +
      toNumber(row.pregnant) +
      toNumber(row.senior),
    0
  );

  const vulnerableCount = activeRows.reduce(
    (sum, row) =>
      sum + toNumber(row.pwd) + toNumber(row.pregnant) + toNumber(row.senior),
    0
  );

  const requestedFoodPacks = activeRows.reduce(
    (sum, row) => sum + toNumber(row.requestedFoodPacks),
    0
  );

  const priorityScore =
    vulnerableCount * 3 + totalAffected + requestedFoodPacks * 0.2;

  return {
    totalAffected,
    vulnerableCount,
    priorityScore,
  };
};

const buildFulfillmentFromReleases = (releases = [], currentFulfillment = {}) => {
  const totalReleases = releases.length;

  const releasedFoodPacks = releases.reduce(
    (sum, release) => sum + toNumber(release.foodPacksReleased),
    0
  );

  const releasedApplianceQuantity = releases.reduce(
    (sum, release) =>
      sum +
      (Array.isArray(release.items)
        ? release.items
            .filter((item) => normalizeString(item.itemType || "goods") === "appliance")
            .reduce((itemSum, item) => itemSum + toNumber(item.quantityReleased), 0)
        : 0),
    0
  );

  const receivedFoodPacks = releases
    .filter((release) => release.releaseStatus === "received")
    .reduce((sum, release) => sum + toNumber(release.foodPacksReleased), 0);

  const receivedApplianceQuantity = releases
    .filter((release) => release.releaseStatus === "received")
    .reduce(
      (sum, release) =>
        sum +
        (Array.isArray(release.items)
          ? release.items
              .filter(
                (item) => normalizeString(item.itemType || "goods") === "appliance"
              )
              .reduce((itemSum, item) => itemSum + toNumber(item.quantityReleased), 0)
          : 0),
      0
    );

  const releasedMonetaryAmount = releases.reduce(
    (sum, release) => sum + toNumber(release.releasedMonetaryAmount),
    0
  );

  const receivedMonetaryAmount = releases
    .filter((release) => release.releaseStatus === "received")
    .reduce(
      (sum, release) =>
        sum +
        toNumber(
          release.receivedMonetaryAmount || release.releasedMonetaryAmount
        ),
      0
    );

  const receivedReleases = releases.filter(
    (release) => release.releaseStatus === "received"
  ).length;

  const pendingReleases = releases.filter(
    (release) => release.releaseStatus === "released"
  ).length;

  const lastRelease = releases
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  return {
    totalReleases,
    releasedFoodPacks,
    releasedApplianceQuantity,
    receivedFoodPacks,
    receivedApplianceQuantity,
    releasedMonetaryAmount:
      releasedMonetaryAmount > 0
        ? releasedMonetaryAmount
        : toNumber(currentFulfillment.releasedMonetaryAmount),
    receivedMonetaryAmount:
      receivedMonetaryAmount > 0
        ? receivedMonetaryAmount
        : toNumber(currentFulfillment.receivedMonetaryAmount),
    receivedReleases,
    pendingReleases,
    lastReleaseAt: lastRelease?.releasedAt || lastRelease?.createdAt || null,
  };
};

const deriveCurrentStage = (request, releases = []) => {
  if (!request) return "preparation";

  const status = normalizeStatus(request.status);
  const currentStage = normalizeStatus(request.currentStage);

  if (currentStage === "accomplished") return "accomplished";

  if (status === "pending") return "pending_review";
  if (status === "rejected") return "rejected";
  if (status === "approved") return "approved_waiting_release";
  if (status === "partially_released") return "partially_released";
  if (status === "released") return "released_waiting_receipt";
  if (status === "received" || status === "completed") return "completed";
  if (status === "cancelled" || status === "canceled") return "preparation";

  const hasReleased = releases.some(
    (release) => release.releaseStatus === "released"
  );
  const hasReceived = releases.some(
    (release) => release.releaseStatus === "received"
  );

  if (hasReleased && hasReceived) return "partially_released";
  if (hasReleased) return "released_waiting_receipt";
  if (hasReceived) return "completed";

  return "pending_review";
};

const buildEmptyJourneyResponse = () => ({
  request: null,
  releases: [],
  stage: "preparation",
  canEdit: false,
  canCancel: false,
  canReceiveAnyRelease: false,
  canRequestAgain: true,
  summary: null,
});

const getDecisionRemarks = (request) => {
  return (
    normalizeString(request?.rejectionReason) ||
    normalizeString(request?.rejectionRemarks) ||
    normalizeString(request?.decisionRemarks) ||
    normalizeString(request?.approvalRemarks) ||
    normalizeString(request?.reviewRemarks) ||
    ""
  );
};

const formatDateValue = formatPdfDateValue;

const formatStatusLabel = (status) => {
  const normalized = normalizeStatus(status);
  if (!normalized) return "-";

  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const findBlockingActiveRequest = async (barangayId) => {
  const candidates = await ReliefRequest.find({
    barangayId,
    status: {
      $in: ACTIVE_REQUEST_STATUSES,
    },
    isArchived: false,
  }).sort({ createdAt: -1 });

  for (const candidate of candidates) {
    const refreshedCandidate = await refreshRequestProgress(candidate._id);
    const normalizedStatus = normalizeStatus(
      refreshedCandidate?.status || candidate.status
    );

    if (ACTIVE_REQUEST_STATUSES.includes(normalizedStatus)) {
      return refreshedCandidate || candidate;
    }
  }

  return null;
};

const refreshRequestProgress = async (requestId) => {
  const request = await ReliefRequest.findById(requestId);
  if (!request || request.isArchived) return null;

  const currentStatus = normalizeStatus(request.status);

  if (FINAL_REQUEST_STATUSES.includes(currentStatus)) {
    if (currentStatus === "cancelled" || currentStatus === "canceled") {
      request.currentStage = "preparation";
    } else if (currentStatus === "rejected") {
      request.currentStage = "rejected";
    } else if (normalizeStatus(request.currentStage) === "accomplished") {
      request.currentStage = "accomplished";
    } else {
      request.currentStage = "completed";
    }

    await request.save();
    return request;
  }

  const releases = await ReliefRelease.find({
    reliefRequestId: request._id,
    isArchived: false,
  }).sort({ createdAt: -1 });

  request.supportTypes = getSupportTypesFromRequest(request);
  request.requestType = deriveLegacyRequestType(request.supportTypes);

  const fulfillment = buildFulfillmentFromReleases(releases, request.fulfillment);
  const demand = getRequestDemandProfile(request);
  const releasedFoodPacks = toNumber(fulfillment.releasedFoodPacks);
  const receivedFoodPacks = toNumber(fulfillment.receivedFoodPacks);
  const releasedMonetaryAmount = toNumber(fulfillment.releasedMonetaryAmount);
  const receivedMonetaryAmount = toNumber(fulfillment.receivedMonetaryAmount);
  const hasAnyFulfillment =
    releases.length > 0 || releasedMonetaryAmount > 0 || receivedMonetaryAmount > 0;
  const hasQuantifiedDemand =
    demand.requestedFoodPacks > 0 ||
    demand.requestedMonetaryAmount > 0 ||
    demand.requestedApplianceQuantity > 0;
  const isFullyReleased =
    (!demand.requiresFoodPacks || releasedFoodPacks >= demand.requestedFoodPacks) &&
    (!demand.requiresAppliance ||
      toNumber(fulfillment.releasedApplianceQuantity) >=
        demand.requestedApplianceQuantity) &&
    (!demand.requiresMonetary ||
      releasedMonetaryAmount >= demand.requestedMonetaryAmount);
  const isFullyReceived =
    (!demand.requiresFoodPacks || receivedFoodPacks >= demand.requestedFoodPacks) &&
    (!demand.requiresAppliance ||
      toNumber(fulfillment.receivedApplianceQuantity) >=
        demand.requestedApplianceQuantity) &&
    (!demand.requiresMonetary ||
      receivedMonetaryAmount >= demand.requestedMonetaryAmount);

  request.fulfillment = {
    totalReleases: fulfillment.totalReleases,
    releasedFoodPacks: fulfillment.releasedFoodPacks,
    releasedApplianceQuantity: fulfillment.releasedApplianceQuantity,
    releasedMonetaryAmount: fulfillment.releasedMonetaryAmount,
    receivedApplianceQuantity: fulfillment.receivedApplianceQuantity,
    receivedMonetaryAmount: fulfillment.receivedMonetaryAmount,
    receivedReleases: fulfillment.receivedReleases,
    pendingReleases: fulfillment.pendingReleases,
    lastReleaseAt: fulfillment.lastReleaseAt,
  };

  request.prioritySnapshot = computePrioritySnapshotFromRows(request.rows || []);

  if (!hasAnyFulfillment) {
    if (
      !["pending", "rejected", "cancelled", "canceled", "received", "completed"].includes(
        normalizeStatus(request.status)
      )
    ) {
      request.status = "approved";
      request.currentStage = "approved_waiting_release";
    }
  } else if (hasQuantifiedDemand) {
    if (isFullyReceived) {
      request.status = "received";
      request.currentStage =
        normalizeStatus(request.currentStage) === "accomplished"
          ? "accomplished"
          : "completed";
      if (!request.receivedAt) {
        request.receivedAt = new Date();
      }
    } else if (isFullyReleased) {
      request.status = "released";
      request.currentStage = "released_waiting_receipt";
      request.receivedAt = null;
    } else {
      request.status = "partially_released";
      request.currentStage = "partially_released";
      request.receivedAt = null;
    }
  } else {
    request.currentStage = deriveCurrentStage(request, releases);
  }

  await request.save();
  return request;
};

/* BARANGAY REQUEST BOOTSTRAP */
const getReliefRequestBootstrap = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const barangay = await Barangay.findById(req.session.userId);
    if (!barangay) {
      return res.status(404).json({ message: "Barangay not found" });
    }

    const activeRequest = await findBlockingActiveRequest(barangay._id);

    const buildLooseBarangayRegex = (value) => {
      const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");

      if (!normalized) return null;

      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(escaped.split("").join("[\\s_-]*"), "i");
    };

    const barangayName = normalizeString(
      barangay.barangayName || req.session?.barangayName || req.session?.username
    );

    const looseBarangayRegex = buildLooseBarangayRegex(barangayName);

    const ownershipOr = [{ barangayId: barangay._id }];

    if (barangayName) {
      ownershipOr.push({ barangayName });
    }

    if (looseBarangayRegex) {
      ownershipOr.push({ barangayName: looseBarangayRegex });
    }

    const evacPlaces = await EvacPlace.find({
      isArchived: false,
      $and: [
        { $or: ownershipOr },
        {
          $or: [
            { isRequestVisible: true },
            { isRequestVisible: { $exists: false } },
            { isRequestVisible: null },
          ],
        },
      ],
    }).sort({ name: 1 });

    const rows = buildRowsFromEvacPlaces(evacPlaces);

    return res.json({
      hasActiveRequest: Boolean(activeRequest),
      activeRequest: activeRequest ? shapeReliefRequestResponse(activeRequest) : null,
      barangay: {
        _id: barangay._id,
        barangayName: barangay.barangayName,
      },
      rows,
      meta: {
        totalEvacPlaces: evacPlaces.length,
        entryMode: "system_bootstrap",
        rowSource: "evac_place_snapshot",
      },
    });
  } catch (err) {
    console.error("Get Relief Request Bootstrap Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* BARANGAY SUBMIT RELIEF REQUEST */
const submitReliefRequest = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const barangay = await Barangay.findById(req.session.userId);
    if (!barangay) {
      return res.status(404).json({ message: "Barangay not found" });
    }

    const disaster = normalizeString(req.body.disaster);
    let supportTypes = normalizeSupportTypes(
      req.body.supportTypes,
      req.body.requestType
    );
    let requestType = deriveLegacyRequestType(supportTypes);
    const remarks = normalizeString(req.body.remarks);
    let requestedMonetaryAmount = getRequestedMonetaryAmountInput(req.body);
    let requestedAppliances = getRequestedAppliances(req.body);
    const approvalRemarks = "";
    const releaseNotes = "";
    const requestDate = req.body.requestDate
      ? new Date(req.body.requestDate)
      : new Date();

    const entryMode = ["manual", "excel_import", "system_bootstrap"].includes(
      normalizeString(req.body.entryMode)
    )
      ? normalizeString(req.body.entryMode)
      : "system_bootstrap";

    const rowSource = ["evac_place_snapshot", "manual_override"].includes(
      normalizeString(req.body.rowSource)
    )
      ? normalizeString(req.body.rowSource)
      : "evac_place_snapshot";

    let rows = Array.isArray(req.body.rows)
      ? req.body.rows.map(sanitizeRow)
      : [];

    if (!disaster) {
      return res.status(400).json({ message: "Disaster is required." });
    }

    if (Number.isNaN(requestDate.getTime())) {
      return res.status(400).json({ message: "Invalid request date." });
    }

    const rowsError = validateRows(rows);
    if (rowsError) {
      return res.status(400).json({ message: rowsError });
    }

    if (!hasSupportType(supportTypes, SUPPORT_TYPE_FOODPACKS)) {
      rows = sanitizeRowsForSupportTypes(rows, supportTypes);
    }

    if (!hasSupportType(supportTypes, SUPPORT_TYPE_MONETARY)) {
      requestedMonetaryAmount = 0;
    }

    if (!hasSupportType(supportTypes, SUPPORT_TYPE_APPLIANCE)) {
      requestedAppliances = [];
    }

    supportTypes = getSupportTypesFromRequest({
      supportTypes,
      requestType,
      rows,
      requestedAppliances,
      totals: {
        requestedMonetaryAmount,
      },
    });
    requestType = deriveLegacyRequestType(supportTypes);

    const requestDemandError = validateRequestDemand({
      supportTypes,
      requestType,
      rows,
      requestedMonetaryAmount,
      requestedAppliances,
      remarks,
    });
    if (requestDemandError) {
      return res.status(400).json({ message: requestDemandError });
    }

    const hasActiveRequest = await findBlockingActiveRequest(barangay._id);

    if (hasActiveRequest) {
      return res.status(400).json({
        message: "You still have an active relief request.",
      });
    }

    const requestNo = await generateRequestNo();
    const prioritySnapshot = computePrioritySnapshotFromRows(rows);

    const reliefRequest = await ReliefRequest.create({
      requestNo,
      barangayId: barangay._id,
      barangayName: barangay.barangayName,
      disaster,
      requestType,
      supportTypes,
      requestDate,
      rows,
      requestedAppliances,
      totals: {
        requestedMonetaryAmount,
      },
      remarks,
      approvalRemarks,
      releaseNotes,
      status: "pending",
      currentStage: "pending_review",
      entryMode,
      rowSource,
      fulfillment: {
        totalReleases: 0,
        releasedFoodPacks: 0,
        releasedApplianceQuantity: 0,
        releasedMonetaryAmount: 0,
        receivedApplianceQuantity: 0,
        receivedMonetaryAmount: 0,
        receivedReleases: 0,
        pendingReleases: 0,
        lastReleaseAt: null,
      },
      prioritySnapshot,
      emailSent: false,
      isArchived: false,
      isEditedAfterSubmit: false,
      lastEditedAt: null,
      editCount: 0,
      lastEditedBy: "",
    });

    await createAuditEvent({
      module: "relief",
      type: "relief_request_submitted",
      priority: "high",
      title: "Relief request submitted",
      message: `${barangay.barangayName} submitted relief request ${reliefRequest.requestNo} for ${reliefRequest.disaster}.`,
      actorId: barangay._id,
      actorName: barangay.barangayName || barangay.username,
      actorRole: "barangay",
      barangayId: barangay._id,
      barangayName: barangay.barangayName,
      requestNo: reliefRequest.requestNo,
      disaster: reliefRequest.disaster,
      status: "pending",
      referenceId: reliefRequest._id,
      referenceModel: "ReliefRequest",
      targetLabel: reliefRequest.requestNo,
      metadata: {
        requestType: reliefRequest.requestType,
        requestedFoodPacks: reliefRequest.totals?.requestedFoodPacks || 0,
        requestedMonetaryAmount:
          reliefRequest.totals?.requestedMonetaryAmount || 0,
        totalAffected: reliefRequest.prioritySnapshot?.totalAffected || 0,
        vulnerableCount: reliefRequest.prioritySnapshot?.vulnerableCount || 0,
      },
    });

    await createNotification({
      recipientRole: getRequestOwnerRole(reliefRequest),
      senderUser: barangay._id,
      senderRole: "barangay",
      senderName: barangay.barangayName || barangay.username,

      module: "relief",
      type: "relief_request_submitted",
      priority: "high",

      title: "New relief request submitted",
      message: `${barangay.barangayName} submitted relief request ${reliefRequest.requestNo} for ${reliefRequest.disaster}.`,
      link: getRequestQueueLink(reliefRequest),

      referenceId: reliefRequest._id,
      referenceModel: "ReliefRequest",
      audit: false,
      metadata: {
        requestNo: reliefRequest.requestNo,
        barangayName: barangay.barangayName,
        disaster: reliefRequest.disaster,
        requestType: reliefRequest.requestType,
        requestedFoodPacks: reliefRequest.totals?.requestedFoodPacks || 0,
        requestedMonetaryAmount:
          reliefRequest.totals?.requestedMonetaryAmount || 0,
        totalAffected: reliefRequest.prioritySnapshot?.totalAffected || 0,
        vulnerableCount: reliefRequest.prioritySnapshot?.vulnerableCount || 0,
      },
    });

    let emailSent = false;

    try {
      await sendReliefRequestEmail(reliefRequest);
      emailSent = true;
    } catch (emailErr) {
      console.error("Relief request email failed:", emailErr);
    }

    reliefRequest.emailSent = emailSent;
    await reliefRequest.save();

    const latestRequest = await ReliefRequest.findById(reliefRequest._id);

    res.status(201).json({
      message: emailSent
        ? "Relief request submitted successfully."
        : "Relief request submitted successfully, but email notification failed.",
      request: shapeReliefRequestResponse(latestRequest || reliefRequest),
    });
  } catch (err) {
    console.error("Submit Relief Request Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* GET LOGGED-IN BARANGAY RELIEF REQUESTS */
const getMyReliefRequests = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const requests = await ReliefRequest.find({
      barangayId: req.session.userId,
      isArchived: false,
    }).sort({ createdAt: -1 });

    res.json(requests.map(shapeReliefRequestResponse));
  } catch (err) {
    console.error("Get My Relief Requests Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* GET SINGLE BARANGAY RELIEF REQUEST */
const getMyReliefRequestById = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const request = await ReliefRequest.findOne({
      _id: req.params.id,
      barangayId: req.session.userId,
      isArchived: false,
    });

    if (!request) {
      return res.status(404).json({ message: "Relief request not found" });
    }

    res.json(shapeReliefRequestResponse(request));
  } catch (err) {
    console.error("Get My Relief Request By Id Error:", err);
    res.status(500).json({ message: err.message });
  }
};

  /* EXPORT SINGLE BARANGAY RELIEF REQUEST PDF */
const exportMyReliefRequestPdf = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const request = await ReliefRequest.findOne({
      _id: req.params.id,
      barangayId: req.session.userId,
      isArchived: false,
    }).lean();

    if (!request) {
      return res.status(404).json({ message: "Relief request not found" });
    }

    const releases = await ReliefRelease.find({
      reliefRequestId: request._id,
      isArchived: false,
    })
      .sort({ createdAt: -1 })
      .lean();

      const decisionRemarks = getDecisionRemarks(request);
      const totals = request.totals || {};
      const rows = Array.isArray(request.rows) ? request.rows : [];
      const demand = getRequestDemandProfile(request);

      const safeRequestNo = normalizeString(request.requestNo || "relief-request")
        .replace(/[^\w\-]+/g, "_");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${safeRequestNo}.pdf"`
    );

    const doc = createPdfDocument({
      size: "A4",
      layout: "portrait",
      margin: 40,
    });

    doc.pipe(res);

    drawPdfHeader(doc, {
      title: "Relief Request",
      subtitle: request.requestNo || normalizeString(request._id),
      generatedAt: new Date(),
    });

    drawPdfSectionTitle(doc, "Request Information");
    drawPdfLabelValue(doc, "Request No", request.requestNo || "-");
    drawPdfLabelValue(doc, "Barangay", request.barangayName || "-");
    drawPdfLabelValue(doc, "Disaster", request.disaster || "-");
    drawPdfLabelValue(
      doc,
      "Request Type",
      getSupportTypeLabel(getSupportTypesFromRequest(request))
    );
    drawPdfLabelValue(doc, "Request Date", formatDateValue(request.requestDate));
    drawPdfLabelValue(doc, "Status", formatStatusLabel(request.status));
    drawPdfLabelValue(doc, "Current Stage", formatStatusLabel(request.currentStage));
    drawPdfLabelValue(doc, "Submitted At", formatDateValue(request.createdAt));
    drawPdfLabelValue(doc, "Last Updated", formatDateValue(request.updatedAt));

    if (request.approvedAt) {
      drawPdfLabelValue(doc, "Approved At", formatDateValue(request.approvedAt));
    }

    if (request.rejectedAt) {
      drawPdfLabelValue(doc, "Rejected At", formatDateValue(request.rejectedAt));
    }

    if (request.receivedAt) {
      drawPdfLabelValue(doc, "Received At", formatDateValue(request.receivedAt));
    }

    drawPdfSectionTitle(doc, "Remarks");
    drawPdfParagraphBlock(doc, "Barangay Remarks", normalizeString(request.remarks) || "None");
    drawPdfParagraphBlock(doc, "Decision / Rejection Remarks", decisionRemarks || "None");

    drawPdfSectionTitle(doc, "Request Totals");
    drawPdfLabelValue(doc, "Households", String(toNumber(totals.households)));
    drawPdfLabelValue(doc, "Families", String(toNumber(totals.families)));
    drawPdfLabelValue(doc, "Male", String(toNumber(totals.male)));
    drawPdfLabelValue(doc, "Female", String(toNumber(totals.female)));
    drawPdfLabelValue(doc, "LGBTQ+", String(toNumber(totals.lgbtq)));
    drawPdfLabelValue(doc, "PWD", String(toNumber(totals.pwd)));
    drawPdfLabelValue(doc, "Pregnant", String(toNumber(totals.pregnant)));
    drawPdfLabelValue(doc, "Senior", String(toNumber(totals.senior)));
    drawPdfLabelValue(doc, "Requested Food Packs", String(toNumber(demand.requestedFoodPacks)));
    drawPdfLabelValue(
      doc,
      "Requested Monetary Amount",
      `PHP ${formatMonetaryAmount(demand.requestedMonetaryAmount)}`
    );
    drawPdfLabelValue(
      doc,
      "Requested Appliance Units",
      String(toNumber(demand.requestedApplianceQuantity))
    );

    if (demand.requestedAppliances.length) {
      drawPdfSectionTitle(doc, "Requested Appliance Details");

      drawPdfTable(
        doc,
        [
          { label: "Item", key: "itemName", width: 150 },
          { label: "Category", key: "category", width: 110 },
          { label: "Qty", key: "quantityRequested", width: 45, align: "right" },
          { label: "Remarks", key: "remarks", width: 180 },
        ],
        demand.requestedAppliances.map((item) => ({
          itemName: normalizeString(item.itemName) || "-",
          category: normalizeString(item.category) || "-",
          quantityRequested: toNumber(item.quantityRequested),
          remarks: normalizeString(item.remarks) || "-",
        })),
        {
          rowHeight: 24,
          emptyMessage: "No requested appliance items available.",
        }
      );
    }

    drawPdfSectionTitle(doc, "Evacuation Center Breakdown");

    const columns = [
      { label: "Evacuation Center", key: "evacuationCenterName", width: 120 },
      { label: "HH", key: "households", width: 28, align: "right" },
      { label: "Fam", key: "families", width: 32, align: "right" },
      { label: "M", key: "male", width: 24, align: "right" },
      { label: "F", key: "female", width: 24, align: "right" },
      { label: "LGBTQ", key: "lgbtq", width: 38, align: "right" },
      { label: "PWD", key: "pwd", width: 30, align: "right" },
      { label: "Preg", key: "pregnant", width: 34, align: "right" },
      { label: "Senior", key: "senior", width: 34, align: "right" },
      { label: "Packs", key: "requestedFoodPacks", width: 40, align: "right" },
    ];

    if (!rows.length) {
      drawPdfEmptyState(doc, "No evacuation center rows available.");
    } else {
      drawPdfTable(
        doc,
        columns,
        rows.map((row) => ({
          evacuationCenterName: normalizeString(row.evacuationCenterName) || "-",
          households: toNumber(row.households),
          families: toNumber(row.families),
          male: toNumber(row.male),
          female: toNumber(row.female),
          lgbtq: toNumber(row.lgbtq),
          pwd: toNumber(row.pwd),
          pregnant: toNumber(row.pregnant),
          senior: toNumber(row.senior),
          requestedFoodPacks: toNumber(row.requestedFoodPacks),
        })),
        {
          rowHeight: 24,
          emptyMessage: "No evacuation center rows available.",
        }
      );
    }

    const rowsWithRemarks = rows.filter((row) => normalizeString(row.rowRemarks));

    if (rowsWithRemarks.length) {
      drawPdfSectionTitle(doc, "Row Remarks");

      rowsWithRemarks.forEach((row, index) => {
        ensurePdfPageSpace(doc, 50);
        drawPdfParagraphBlock(
          doc,
          `${index + 1}. ${normalizeString(row.evacuationCenterName) || "Unnamed Evacuation Center"}`,
          normalizeString(row.rowRemarks)
        );
      });
    }

    drawPdfSectionTitle(doc, "Request Progress Snapshot");
    drawPdfLabelValue(
      doc,
      "Total Releases",
      String(toNumber(request.fulfillment?.totalReleases))
    );
    drawPdfLabelValue(
      doc,
      "Released Food Packs",
      String(toNumber(request.fulfillment?.releasedFoodPacks))
    );
    drawPdfLabelValue(
      doc,
      "Released Monetary Amount",
      `PHP ${formatMonetaryAmount(request.fulfillment?.releasedMonetaryAmount)}`
    );
    drawPdfLabelValue(
      doc,
      "Released Appliance Units",
      String(toNumber(request.fulfillment?.releasedApplianceQuantity))
    );
    drawPdfLabelValue(
      doc,
      "Received Monetary Amount",
      `PHP ${formatMonetaryAmount(request.fulfillment?.receivedMonetaryAmount)}`
    );
    drawPdfLabelValue(
      doc,
      "Received Appliance Units",
      String(toNumber(request.fulfillment?.receivedApplianceQuantity))
    );
    drawPdfLabelValue(
      doc,
      "Received Releases",
      String(toNumber(request.fulfillment?.receivedReleases))
    );
    drawPdfLabelValue(
      doc,
      "Pending Releases",
      String(toNumber(request.fulfillment?.pendingReleases))
    );
    drawPdfLabelValue(
      doc,
      "Last Release At",
      formatDateValue(request.fulfillment?.lastReleaseAt)
    );

    if (releases.length) {
      drawPdfSectionTitle(doc, "Release Activity");
      drawPdfTable(
        doc,
        [
          { label: "Release No", key: "releaseNo", width: 90 },
          { label: "Status", key: "status", width: 68 },
          { label: "Food Packs", key: "foodPacks", width: 56, align: "right" },
          { label: "Monetary", key: "monetary", width: 86, align: "right" },
          { label: "Proof", key: "proofCount", width: 42, align: "right" },
          { label: "Released At", key: "releasedAt", width: 118 },
          { label: "Remarks", key: "remarks", width: 110 },
        ],
        releases.map((release) => ({
          releaseNo: normalizeString(release.releaseNo) || "-",
          status: formatStatusLabel(release.releaseStatus),
          foodPacks: toNumber(release.foodPacksReleased),
          monetary: formatMonetaryAmount(release.releasedMonetaryAmount),
          proofCount: Array.isArray(release.proofFiles) ? release.proofFiles.length : 0,
          releasedAt: formatDateValue(release.releasedAt || release.createdAt),
          remarks: normalizeString(release.remarks) || "-",
        })),
        {
          rowHeight: 26,
          emptyMessage: "No release activity recorded.",
        }
      );

      releases.forEach((release, index) => {
        const releaseLabel =
          normalizeString(release.releaseNo) || `Release ${index + 1}`;
        const releaseProof = collectProofImagesForPdf(release.proofFiles, {
          maxImages: 3,
          labelPrefix: `${releaseLabel} Proof`,
        });

        if (!releaseProof.images.length && releaseProof.remainingCount <= 0) {
          return;
        }

        drawPdfSectionTitle(doc, `Release Proof - ${releaseLabel}`);
        drawPdfImageGrid(doc, releaseProof.images, {
          columns: 2,
          imageHeight: 125,
          emptyMessage: "No proof images attached for this release.",
        });
        if (releaseProof.remainingCount > 0) {
          drawPdfParagraphBlock(
            doc,
            "",
            `+${releaseProof.remainingCount} more proof image(s) not shown in this export.`,
            { bodyFontSize: 9, spacingAfter: 0.35 }
          );
        }
      });
    }

    drawPdfFooter(doc, { generatedAt: new Date() });

    doc.end();
  } catch (err) {
    console.error("Export My Relief Request PDF Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: err.message });
    }
  }
};

/* GET CURRENT BARANGAY REQUEST JOURNEY */
const getCurrentReliefJourney = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const latestRequest = await ReliefRequest.findOne({
      barangayId: req.session.userId,
      isArchived: false,
      status: { $in: VIEWABLE_REQUEST_STATUSES },
    }).sort({ createdAt: -1 });

    if (!latestRequest) {
      return res.json(buildEmptyJourneyResponse());
    }

    const refreshedRequest = await refreshRequestProgress(latestRequest._id);
    const requestDoc = refreshedRequest || latestRequest;
    const requestStatus = normalizeStatus(requestDoc.status);

    const releases = await ReliefRelease.find({
      reliefRequestId: requestDoc._id,
      isArchived: false,
    }).sort({ createdAt: -1 });

    const fulfillment = buildFulfillmentFromReleases(
      releases,
      requestDoc.fulfillment
    );
    const demand = getRequestDemandProfile(requestDoc);
    const stage = deriveCurrentStage(requestDoc, releases);
    const requestedFoodPacks = demand.requestedFoodPacks;
    const requestedMonetaryAmount = demand.requestedMonetaryAmount;
    const releasedFoodPacks = fulfillment.releasedFoodPacks || 0;
    const receivedFoodPacks = fulfillment.receivedFoodPacks || 0;
    const releasedMonetaryAmount = fulfillment.releasedMonetaryAmount || 0;
    const receivedMonetaryAmount = fulfillment.receivedMonetaryAmount || 0;
    const decisionRemarks = getDecisionRemarks(requestDoc);

    const canEdit = requestStatus === "pending";
    const canCancel = ["pending", "approved"].includes(requestStatus);
    const canReceiveAnyRelease =
      releases.some((release) => release.releaseStatus === "released") ||
      ["released", "partially_released"].includes(requestStatus) ||
      ["released_waiting_receipt", "partially_released"].includes(stage);
    const canRequestAgain = FINAL_REQUEST_STATUSES.includes(requestStatus);

    return res.json({
      request: shapeReliefRequestResponse(requestDoc),
      releases,
      stage,
      canEdit,
      canCancel,
      canReceiveAnyRelease,
      canRequestAgain,
      summary: {
        requestType: demand.requestType,
        requestedFoodPacks,
        requestedMonetaryAmount,
        releasedFoodPacks,
        receivedFoodPacks,
        releasedMonetaryAmount,
        receivedMonetaryAmount,
        remainingFoodPacks: Math.max(0, requestedFoodPacks - receivedFoodPacks),
        remainingMonetaryAmount: Math.max(
          0,
          requestedMonetaryAmount - receivedMonetaryAmount
        ),
        totalReleases: fulfillment.totalReleases || 0,
        receivedReleases: fulfillment.receivedReleases || 0,
        pendingReleases: fulfillment.pendingReleases || 0,
        vulnerableCount: requestDoc.prioritySnapshot?.vulnerableCount || 0,
        totalAffected: requestDoc.prioritySnapshot?.totalAffected || 0,
        requestDate: requestDoc.requestDate || null,
        receivedAt: requestDoc.receivedAt || null,
        decisionRemarks,
        rejectionRemarks: decisionRemarks,
        isRejected: requestStatus === "rejected",
      },
    });
  } catch (err) {
    console.error("Get Current Relief Journey Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* BARANGAY UPDATE OWN REQUEST */
const updateOwnReliefRequest = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const request = await ReliefRequest.findOne({
      _id: req.params.id,
      barangayId: req.session.userId,
      isArchived: false,
    });

    if (!request) {
      return res.status(404).json({ message: "Relief request not found" });
    }

    const currentStatus = normalizeStatus(request.status);
    const isRejectedResubmission =
      currentStatus === "rejected" && Boolean(req.body.resubmitRejected);

    if (!["pending", "rejected"].includes(currentStatus)) {
      return res.status(400).json({
        message: "Only pending or rejected requests can be edited.",
      });
    }

    const disaster = normalizeString(req.body.disaster);
    let supportTypes = normalizeSupportTypes(
      req.body.supportTypes,
      req.body.requestType !== undefined ? req.body.requestType : request.requestType
    );
    let requestType = deriveLegacyRequestType(supportTypes);
    const remarks = normalizeString(req.body.remarks);
    let requestedMonetaryAmount = getRequestedMonetaryAmountInput(
      req.body.requestType !== undefined ||
        req.body.requestedMonetaryAmount !== undefined ||
        req.body?.totals?.requestedMonetaryAmount !== undefined
        ? req.body
        : {
            requestType: request.requestType,
            requestedMonetaryAmount: request?.totals?.requestedMonetaryAmount,
          }
    );
    const requestDate = req.body.requestDate
      ? new Date(req.body.requestDate)
      : request.requestDate;
    let requestedAppliances = Array.isArray(req.body.requestedAppliances)
      ? getRequestedAppliances(req.body)
      : getRequestedAppliances(request);

    const entryMode = ["manual", "excel_import", "system_bootstrap"].includes(
      normalizeString(req.body.entryMode)
    )
      ? normalizeString(req.body.entryMode)
      : request.entryMode || "system_bootstrap";

    const rowSource = ["evac_place_snapshot", "manual_override"].includes(
      normalizeString(req.body.rowSource)
    )
      ? normalizeString(req.body.rowSource)
      : request.rowSource || "evac_place_snapshot";

    let rows = Array.isArray(req.body.rows)
      ? req.body.rows.map(sanitizeRow)
      : [];

    if (!disaster) {
      return res.status(400).json({ message: "Disaster is required." });
    }

    if (Number.isNaN(requestDate.getTime())) {
      return res.status(400).json({ message: "Invalid request date." });
    }

    const rowsError = validateRows(rows);
    if (rowsError) {
      return res.status(400).json({ message: rowsError });
    }

    if (!hasSupportType(supportTypes, SUPPORT_TYPE_FOODPACKS)) {
      rows = sanitizeRowsForSupportTypes(rows, supportTypes);
    }

    if (!hasSupportType(supportTypes, SUPPORT_TYPE_MONETARY)) {
      requestedMonetaryAmount = 0;
    }

    if (!hasSupportType(supportTypes, SUPPORT_TYPE_APPLIANCE)) {
      requestedAppliances = [];
    }

    supportTypes = getSupportTypesFromRequest({
      supportTypes,
      requestType,
      rows,
      requestedAppliances,
      totals: {
        requestedMonetaryAmount,
      },
    });
    requestType = deriveLegacyRequestType(supportTypes);

    const requestDemandError = validateRequestDemand({
      supportTypes,
      requestType,
      rows,
      requestedMonetaryAmount,
      requestedAppliances,
      remarks,
    });
    if (requestDemandError) {
      return res.status(400).json({ message: requestDemandError });
    }

    request.disaster = disaster;
    request.requestType = requestType;
    request.supportTypes = supportTypes;
    request.requestDate = requestDate;
    request.rows = rows;
    request.requestedAppliances = requestedAppliances;
    request.totals = {
      ...(request.totals
        ? request.totals.toObject?.() || request.totals
        : {}),
      requestedMonetaryAmount,
    };
    request.remarks = remarks;
    request.entryMode = entryMode;
    request.rowSource = rowSource;
    request.prioritySnapshot = computePrioritySnapshotFromRows(rows);
    request.isEditedAfterSubmit = true;
    request.lastEditedAt = new Date();
    request.editCount = isRejectedResubmission
      ? Number(request.editCount || 0)
      : Number(request.editCount || 0) + 1;
    request.lastEditedBy = "barangay";
    request.lastEditAction = isRejectedResubmission ? "resubmitted" : "updated";

    if (isRejectedResubmission) {
      request.status = "pending";
      request.currentStage = "pending_review";
      request.rejectionReason = "";
      request.rejectionRemarks = "";
      request.decisionRemarks = "";
      request.reviewRemarks = "";
      request.rejectedAt = null;
      request.reviewedAt = null;
      request.reviewedBy = "";
      request.approvedAt = null;
      request.approvedBy = "";
    } else {
      request.currentStage = "pending_review";
    }

    await request.save();

    await createAuditEvent({
      module: "relief",
      type: isRejectedResubmission
        ? "relief_request_resubmitted"
        : "relief_request_updated",
      priority: isRejectedResubmission ? "high" : "normal",
      title: isRejectedResubmission
        ? "Relief request resubmitted"
        : "Relief request updated",
      message: `${request.barangayName} ${
        isRejectedResubmission ? "resubmitted" : "updated"
      } relief request ${request.requestNo}.`,
      actorId: request.barangayId,
      actorName: request.barangayName,
      actorRole: "barangay",
      barangayId: request.barangayId,
      barangayName: request.barangayName,
      requestNo: request.requestNo,
      disaster: request.disaster,
      status: isRejectedResubmission ? "pending" : request.status,
      referenceId: request._id,
      referenceModel: "ReliefRequest",
      targetLabel: request.requestNo,
      metadata: {
        requestType: request.requestType,
        requestedFoodPacks: request.totals?.requestedFoodPacks || 0,
        requestedMonetaryAmount: request.totals?.requestedMonetaryAmount || 0,
        editCount: request.editCount || 0,
        action: isRejectedResubmission ? "resubmitted" : "updated",
      },
    });

    await createNotification({
      recipientRole: getRequestOwnerRole(request),
      senderUser: request.barangayId,
      senderRole: "barangay",
      senderName: request.barangayName,

      module: "relief",
      type: isRejectedResubmission
        ? "relief_request_resubmitted"
        : "relief_request_updated",
      priority: isRejectedResubmission ? "high" : "normal",

      title: isRejectedResubmission
        ? "Relief request resubmitted"
        : "Relief request updated",
      message: `${request.barangayName} ${
        isRejectedResubmission ? "resubmitted" : "updated"
      } relief request ${request.requestNo}.`,
      link: getRequestQueueLink(request),

      referenceId: request._id,
      referenceModel: "ReliefRequest",
      audit: false,
      metadata: {
        requestNo: request.requestNo,
        barangayName: request.barangayName,
        disaster: request.disaster,
        requestType: request.requestType,
        requestedFoodPacks: request.totals?.requestedFoodPacks || 0,
        requestedMonetaryAmount: request.totals?.requestedMonetaryAmount || 0,
        editCount: request.editCount || 0,
      },
    });

    res.json({
      message: isRejectedResubmission
        ? "Relief request resubmitted successfully."
        : "Relief request updated successfully.",
      request: shapeReliefRequestResponse(request),
    });
  } catch (err) {
    console.error("Update Own Relief Request Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* BARANGAY CANCEL OWN REQUEST */
const cancelOwnReliefRequest = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const request = await ReliefRequest.findOne({
      _id: req.params.id,
      barangayId: req.session.userId,
      isArchived: false,
    });

    if (!request) {
      return res.status(404).json({ message: "Relief request not found" });
    }

    if (!["pending", "approved"].includes(normalizeStatus(request.status))) {
      return res.status(400).json({
        message: "Only pending or approved requests can be cancelled.",
      });
    }

    request.status = "cancelled";
    request.currentStage = "preparation";
    request.receivedAt = null;
    request.remarks = req.body.remarks
      ? normalizeString(req.body.remarks)
      : request.remarks;

    await request.save();

    await createAuditEvent({
      module: "relief",
      type: "relief_request_cancelled",
      priority: "normal",
      title: "Relief request cancelled",
      message: `${request.barangayName} cancelled relief request ${request.requestNo}.`,
      actorId: request.barangayId,
      actorName: request.barangayName,
      actorRole: "barangay",
      barangayId: request.barangayId,
      barangayName: request.barangayName,
      requestNo: request.requestNo,
      disaster: request.disaster,
      status: "cancelled",
      referenceId: request._id,
      referenceModel: "ReliefRequest",
      targetLabel: request.requestNo,
      metadata: {
        requestType: request.requestType,
        requestedFoodPacks: request.totals?.requestedFoodPacks || 0,
        requestedMonetaryAmount: request.totals?.requestedMonetaryAmount || 0,
      },
    });

    await createNotification({
  recipientRole: getRequestOwnerRole(request),
  senderUser: request.barangayId,
  senderRole: "barangay",
  senderName: request.barangayName,

  module: "relief",
  type: "relief_request_cancelled",
  priority: "normal",

  title: "Relief request cancelled",
  message: `${request.barangayName} cancelled relief request ${request.requestNo}.`,
  link: getRequestQueueLink(request),

  referenceId: request._id,
  referenceModel: "ReliefRequest",
  audit: false,
  metadata: {
    requestNo: request.requestNo,
    barangayName: request.barangayName,
    disaster: request.disaster,
    requestType: request.requestType,
    requestedFoodPacks: request.totals?.requestedFoodPacks || 0,
    requestedMonetaryAmount: request.totals?.requestedMonetaryAmount || 0,
  },
});

    return res.json({
      message: "Relief request cancelled successfully.",
      request: shapeReliefRequestResponse(request),
      journey: buildEmptyJourneyResponse(),
    });
  } catch (err) {
    console.error("Cancel Own Relief Request Error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* BARANGAY MARK RECEIVED RELEASES FOR A REQUEST */
const markReliefRequestReceived = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const username = String(req.session?.username || req.session?.userId || "");

    const request = await ReliefRequest.findOne({
      _id: req.params.id,
      barangayId: req.session.userId,
      isArchived: false,
    });

    if (!request) {
      return res.status(404).json({ message: "Relief request not found" });
    }

    if (!["released", "partially_released"].includes(normalizeStatus(request.status))) {
      return res.status(400).json({
        message: "Only released requests can be marked as received.",
      });
    }

    const uploadedReceiptProofFiles = (Array.isArray(req.files) ? req.files : [])
      .map(buildStoredProofPath)
      .filter(Boolean);

    if (!uploadedReceiptProofFiles.length) {
      return res.status(400).json({
        message: "Attach at least one receipt proof image before confirming receipt.",
      });
    }

    const releasesToReceive = await ReliefRelease.find({
      reliefRequestId: request._id,
      isArchived: false,
      releaseStatus: { $nin: ["received", "cancelled"] },
    });

    if (!releasesToReceive.length) {
      const alreadyReceivedReleases = await ReliefRelease.find({
        reliefRequestId: request._id,
        isArchived: false,
        releaseStatus: "received",
      });

      const updatedRequest = await refreshRequestProgress(request._id);

      if (
        alreadyReceivedReleases.length > 0 ||
        updatedRequest?.receivedAt ||
        ["received", "completed"].includes(normalizeStatus(updatedRequest?.status))
      ) {
        return res.json({
          message: "Relief deliveries were already marked as received.",
          request: shapeReliefRequestResponse(updatedRequest || request),
        });
      }

      return res.status(400).json({
        message: "No released deliveries found for this request.",
      });
    }

    const now = new Date();

      for (const release of releasesToReceive) {
        release.releaseStatus = "received";
        release.receivedAt = now;
        release.receivedBy = username;
        release.receiptProofFiles = uploadedReceiptProofFiles;
        release.receivedMonetaryAmount = toNumber(
          release.receivedMonetaryAmount || release.releasedMonetaryAmount
        );
        release.items = Array.isArray(release.items)
          ? release.items.map((item) => ({
              ...(item.toObject?.() ? item.toObject() : item),
              quantityReceived: toNumber(
                item?.quantityReceived || item?.quantityReleased
              ),
            }))
          : [];
        await release.save();
      }

    const updatedRequest = await refreshRequestProgress(request._id);

    await createAuditEvent({
      module: "relief",
      type: "relief_request_received",
      priority: "normal",
      title: "Relief request marked received",
      message: `${request.barangayName} marked relief request ${request.requestNo} as received.`,
      actorId: request.barangayId,
      actorName: request.barangayName,
      actorRole: "barangay",
      barangayId: request.barangayId,
      barangayName: request.barangayName,
      requestNo: request.requestNo,
      disaster: request.disaster,
      status: updatedRequest?.status || "partially_released",
      referenceId: request._id,
      referenceModel: "ReliefRequest",
      targetLabel: request.requestNo,
      metadata: {
        requestType: updatedRequest?.requestType || request.requestType,
        releasedFoodPacks: updatedRequest?.fulfillment?.releasedFoodPacks || 0,
        releasedMonetaryAmount:
          updatedRequest?.fulfillment?.releasedMonetaryAmount || 0,
        receiptProofCount: uploadedReceiptProofFiles.length,
      },
    });

    await createNotification({
  recipientRole: getRequestOwnerRole(request),
  senderUser: request.barangayId,
  senderRole: "barangay",
  senderName: request.barangayName,

  module: "relief",
  type: "relief_request_received",
  priority: "normal",

  title: "Relief delivery received",
  message: `${request.barangayName} marked relief request ${request.requestNo} as received.`,
  link: getRequestQueueLink(request),

  referenceId: request._id,
  referenceModel: "ReliefRequest",
  audit: false,
  metadata: {
    requestNo: request.requestNo,
    barangayName: request.barangayName,
    disaster: request.disaster,
    requestType: updatedRequest?.requestType || request.requestType,
    status: updatedRequest?.status || request.status,
    releasedFoodPacks: updatedRequest?.fulfillment?.releasedFoodPacks || 0,
    releasedMonetaryAmount:
      updatedRequest?.fulfillment?.releasedMonetaryAmount || 0,
    receiptProofCount: uploadedReceiptProofFiles.length,
  },
});

    const refreshedReleases = await ReliefRelease.find({
      reliefRequestId: request._id,
      isArchived: false,
    });
    const refreshedFulfillment = buildFulfillmentFromReleases(
      refreshedReleases,
      updatedRequest?.fulfillment
    );
    const demand = getRequestDemandProfile(updatedRequest || request);
    const remainingFoodPacks = Math.max(
      0,
      demand.requestedFoodPacks - toNumber(refreshedFulfillment.receivedFoodPacks)
    );
    const remainingMonetaryAmount = Math.max(
      0,
      demand.requestedMonetaryAmount -
        toNumber(refreshedFulfillment.receivedMonetaryAmount)
    );
    const remainingParts = [];

    if (remainingFoodPacks > 0) {
      remainingParts.push(`${remainingFoodPacks} food pack(s)`);
    }

    if (remainingMonetaryAmount > 0) {
      remainingParts.push(`PHP ${formatMonetaryAmount(remainingMonetaryAmount)}`);
    }

    res.json({
      message:
        remainingParts.length > 0
          ? `Relief received. ${remainingParts.join(
              " and "
            )} still remaining to fulfill this request.`
          : "Relief request marked as received successfully.",
      request: shapeReliefRequestResponse(updatedRequest),
      receiptProofFiles: uploadedReceiptProofFiles,
    });
  } catch (err) {
    console.error("Mark Relief Request Received Error:", err);
    res.status(500).json({ message: err.message });
  }
};

const reportReliefRequestNotReceived = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const request = await ReliefRequest.findOne({
      _id: req.params.id,
      barangayId: req.session.userId,
      isArchived: false,
    });

    if (!request) {
      return res.status(404).json({ message: "Relief request not found" });
    }

    const updatedRequest = await refreshRequestProgress(request._id);

    await createAuditEvent({
      module: "relief",
      type: "relief_request_not_received",
      priority: "high",
      title: "Relief delivery not received",
      message: `${request.barangayName} reported that relief request ${request.requestNo} was not received.`,
      actorId: request.barangayId,
      actorName: request.barangayName,
      actorRole: "barangay",
      barangayId: request.barangayId,
      barangayName: request.barangayName,
      requestNo: request.requestNo,
      disaster: request.disaster,
      status: updatedRequest?.status || request.status,
      referenceId: request._id,
      referenceModel: "ReliefRequest",
      targetLabel: request.requestNo,
      metadata: {
        requestType: request.requestType,
      },
    });

    await createNotification({
      recipientRole: getRequestOwnerRole(request),
      senderUser: request.barangayId,
      senderRole: "barangay",
      senderName: request.barangayName,
      module: "relief",
      type: "relief_request_not_received",
      priority: "high",
      title: "Relief delivery not received",
      message: `${request.barangayName} reported that relief request ${request.requestNo} was not received.`,
      link: getRequestQueueLink(request),
      referenceId: request._id,
      referenceModel: "ReliefRequest",
      audit: false,
      metadata: {
        requestNo: request.requestNo,
        barangayName: request.barangayName,
        disaster: request.disaster,
        status: updatedRequest?.status || request.status,
      },
    });

    return res.json({
      message: `${getRequestOwnerLabel(request)} has been notified that this release was not received.`,
      request: shapeReliefRequestResponse(updatedRequest || request),
    });
  } catch (err) {
    console.error("Report Relief Request Not Received Error:", err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getReliefRequestBootstrap,
  submitReliefRequest,
  getMyReliefRequests,
  getMyReliefRequestById,
  exportMyReliefRequestPdf,
  getCurrentReliefJourney,
  updateOwnReliefRequest,
  cancelOwnReliefRequest,
  markReliefRequestReceived,
  reportReliefRequestNotReceived,
  refreshRequestProgress,
};
