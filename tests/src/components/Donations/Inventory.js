import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import DashboardShell from "../layout/DashboardShell";
import "../css/Inventory.css";
import {
  canEditInventoryType,
  getInventoryViewTypes,
  getReliefReviewerLabel,
  normalizeRole,
} from "../auth/roleAccessUtils";
import {
  buildReleasePreviewSummary,
  buildReleaseRequestPayload,
} from "./releasePlannerUtils";
import {
  buildReleaseJourneySteps,
  getInitialJourneyStep,
  getJourneyStepMeta,
  isJourneyStepComplete,
} from "./releasePlannerJourneyUtils";
import {
  SUPPORT_TYPE_APPLIANCE,
  SUPPORT_TYPE_FOODPACKS,
  SUPPORT_TYPE_MONETARY,
  getSupportTypesFromRequest,
  getSupportTypeLabel as getReliefSupportTypeLabel,
  hasSupportType,
} from "../relief/supportTypes";
import { resolveInventoryType } from "./inventoryTypeUtils";
import {
  getTodayInputDate,
  getInventoryExpiryStatus,
  validateFutureOrTodayInventoryDate,
} from "./inventoryExpiryUtils";
import {
  buildInventoryItemLookup,
  summarizeTemplateHealth,
} from "./foodPackTemplateHealthUtils";
import {
  FaArchive,
  FaBell,
  FaBoxes,
  FaBoxOpen,
  FaCheck,
  FaClipboardCheck,
  FaClipboardList,
  FaEdit,
  FaExclamationTriangle,
  FaFilePdf,
  FaFileInvoiceDollar,
  FaFilter,
  FaLayerGroup,
  FaMoneyBillWave,
  FaPlus,
  FaTimes,
  FaTrash,
  FaUndo,
  FaUtensils,
} from "react-icons/fa";
import { API_BASE_URL } from "../../config/api";

const BASE_URL = API_BASE_URL;

const TABLE_PAGE_SIZE = 8;
const ARCHIVE_PAGE_SIZE = 10;
const TEMPLATE_PAGE_SIZE = 6;
const TOAST_LIMIT = 3;
const TOAST_DURATION = 10000;
const DEFAULT_NON_EXPIRING_GOODS_CATEGORIES = new Set([
  "clothes",
  "clothing",
  "shoes",
  "shoe",
  "shoes/footwear",
  "footwear",
  "blankets",
  "blanket",
  "mats",
  "mat",
  "towels",
  "towel",
  "bedding",
  "mosquito nets",
  "mosquito net"
]);
const CUSTOM_CATEGORY_VALUE = "__custom__";
const CUSTOM_UNIT_VALUE = "__custom_unit__";
const MAX_QUANTITY = 1000000;
const MAX_AMOUNT = 1000000000;
const MAX_NAME_LENGTH = 80;
const MAX_SOURCE_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_UNIT_LENGTH = 24;
const MAX_CUSTOM_CATEGORY_LENGTH = 40;
const DEFAULT_APPLIANCE_CATEGORIES = [
  "kitchen appliances",
  "cleaning appliances",
  "cooling appliances",
  "lighting equipment",
  "communication devices",
  "power equipment",
  "emergency equipment",
];
const CATEGORY_UNIT_HINTS = [
  { keywords: ["rice", "grain", "corn"], units: ["kg", "sack", "bag"] },
  { keywords: ["water", "drink", "juice", "milk"], units: ["bottle", "liter", "gallon", "box"] },
  { keywords: ["canned", "sardines", "tuna"], units: ["can", "box", "pack"] },
  { keywords: ["noodle", "biscuit", "snack", "food"], units: ["pack", "box", "piece"] },
  { keywords: ["clothes", "blanket", "towel", "bedding", "mat"], units: ["piece", "set", "bundle"] },
  { keywords: ["hygiene", "kit", "soap", "toothpaste"], units: ["piece", "pack", "box"] },
];

const sanitizeCompactText = (value, maxLength) =>
  String(value || "")
    .replace(/[^\w\s.,()/#&-]/g, "")
    .replace(/\s+/g, " ")
    .trimStart()
    .slice(0, maxLength);

const sanitizeNoteText = (value, maxLength) =>
  String(value || "")
    .replace(/[^\w\s.,()/#&:;!?'"%-]/g, "")
    .replace(/\r/g, "")
    .slice(0, maxLength);

export default function Inventory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const role = normalizeRole(user?.role || localStorage.getItem("role"));
  const isAdmin = role === "admin";
  const isDrrmo = role === "drrmo";
  const isAccountant = role === "accountant";
  const releaseActorLabel = getReliefReviewerLabel(role);
  const canSeeCentralInventory = isAdmin || isDrrmo || isAccountant;
  const canRelease = isAdmin || isDrrmo || isAccountant;
  const canManageTemplates = isDrrmo;
  const allowedViewTypes = useMemo(
    () => getInventoryViewTypes(role),
    [role]
  );
  const defaultViewType = allowedViewTypes[0] || "goods";

  const [activeItems, setActiveItems] = useState([]);
  const [archivedItems, setArchivedItems] = useState([]);
  const [approvedRequests, setApprovedRequests] = useState([]);
  const [foodPackTemplates, setFoodPackTemplates] = useState([]);

  const [loadingActive, setLoadingActive] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [loadingReleaseQueue, setLoadingReleaseQueue] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [releaseSubmitting, setReleaseSubmitting] = useState(false);
  const [templateSubmitting, setTemplateSubmitting] = useState(false);

  const [error, setError] = useState("");

  const [mode, setMode] = useState("active");
  const [viewType, setViewType] = useState(defaultViewType);
  const canUseReleasePlanner = canRelease && mode === "active";

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [expiryStatusFilter, setExpiryStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc");

  const [selectedItem, setSelectedItem] = useState(null);
  const [editingItemId, setEditingItemId] = useState("");
  const [itemEditModalOpen, setItemEditModalOpen] = useState(false);
  const [itemEditSubmitting, setItemEditSubmitting] = useState(false);

  const [itemForm, setItemForm] = useState({
    type: "goods",
    name: "",
    category: "",
    customCategory: "",
    requiresExpiration: true,
    quantity: "",
    unit: "",
    amount: "",
    referenceNumber: "",
    expirationDate: "",
    condition: "brand_new",
    usageDuration: "",
    description: "",
    sourceType: "external",
    sourceName: ""
  });
  const [itemFormErrors, setItemFormErrors] = useState({});

  const [tablePage, setTablePage] = useState(1);
  const [archivePage, setArchivePage] = useState(1);

  const [operationsOpen, setOperationsOpen] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);

  const [selectedReleaseRequestId, setSelectedReleaseRequestId] = useState("");
  const [releaseRemarks, setReleaseRemarks] = useState("");
  const [releaseBarangayFilter, setReleaseBarangayFilter] = useState("");

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [foodPacksToRelease, setFoodPacksToRelease] = useState("");
  const [releaseMonetaryAmount, setReleaseMonetaryAmount] = useState("");
  const [releaseProofFiles, setReleaseProofFiles] = useState([]);
  const [activeJourneyStep, setActiveJourneyStep] = useState("review");
  const [confirmedJourneySteps, setConfirmedJourneySteps] = useState([]);

  const [applianceSearch, setApplianceSearch] = useState("");
  const [applianceSelections, setApplianceSelections] = useState([]);

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateBuilderSearch, setTemplateBuilderSearch] = useState("");
  const [templateItems, setTemplateItems] = useState([]);
  const [selectedTemplateCardId, setSelectedTemplateCardId] = useState("");
  const [templatePage, setTemplatePage] = useState(1);

  const [goodsDisplayMode, setGoodsDisplayMode] = useState("all");
  const [expandedCategories, setExpandedCategories] = useState({});

  const [notifications, setNotifications] = useState([]);
  const notificationTimersRef = useRef({});
  const [confirmationDialog, setConfirmationDialog] = useState(null);
  const templateModalRef = useRef(null);
  const releaseProofInputRef = useRef(null);
  const expiredNoticeCountRef = useRef(0);
  const minExpirationDate = useMemo(() => getTodayInputDate(), []);

  const normalize = useCallback((val) => (val || "").toString().trim().toLowerCase(), []);

  const isExpiryRequiredCategory = (value) => {
    const v = normalize(value);
    if (!v) return false;
    return !DEFAULT_NON_EXPIRING_GOODS_CATEGORIES.has(v);
  };

  const getExpiryStatus = (item) => {
    return getInventoryExpiryStatus(item?.expirationDate);
  };

  const getExpiryBadgeLabel = (item) => {
    const status = getExpiryStatus(item);
    if (status === "expired") return "Expired";
    if (status === "soon") return "Expiring Soon";
    return "";
  };

  const getExpiryBadgeClass = (item) => {
    const status = getExpiryStatus(item);
    if (status === "expired") return "badge-expiry-expired";
    if (status === "soon") return "badge-expiry-soon";
    if (status === "ok") return "badge-expiry-ok";
    return "badge-expiry-none";
  };

  const buildGoodsMergeKey = useCallback((item = {}) =>
    [normalize(item.name), normalize(item.category), normalize(item.unit)].join(
      "||"
    ), [normalize]);

  const getCategoryLabel = (value) => {
    const v = String(value || "").trim();
    if (!v) return "Uncategorized";
    return v
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const getSourceLabel = (value) => {
    const v = String(value || "").trim();
    if (!v) return "-";
    return v.charAt(0).toUpperCase() + v.slice(1);
  };

  const formatDate = (date) => {
    if (!date) return "-";
    return new Date(date).toLocaleString();
  };

  const formatExpiryDate = (date) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString();
  };

  const formatMoney = (amount) =>
    `PHP ${Number(amount || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })}`;

  const extractReferenceFromDescription = useCallback((description) => {
    const text = String(description || "");
    const match = text.match(/Reference Number:\s*(.+)$/im);
    return match ? String(match[1] || "").trim() : "";
  }, []);

  const stripReferenceFromDescription = useCallback((description) => {
    return String(description || "")
      .replace(/\n?\s*Reference Number:\s*.+$/im, "")
      .trim();
  }, []);

  const getReferenceNumber = useCallback(
    (item) => String(item?.referenceNumber || "").trim() || extractReferenceFromDescription(item?.description),
    [extractReferenceFromDescription]
  );

  const getRequestedPackCount = useCallback(
    (request) => Number(request?.totals?.requestedFoodPacks || 0),
    []
  );

  const getReleasedPackCount = useCallback(
    (request) => Number(request?.fulfillment?.releasedFoodPacks || 0),
    []
  );

  const getRemainingPackCount = useCallback(
    (request) =>
      Math.max(0, getRequestedPackCount(request) - getReleasedPackCount(request)),
    [getRequestedPackCount, getReleasedPackCount]
  );

  const getRequestedMonetaryAmount = useCallback(
    (request) => Number(request?.totals?.requestedMonetaryAmount || 0),
    []
  );

  const getRequestedApplianceQuantity = useCallback((request) => {
    if (request?.totals?.requestedApplianceQuantity !== undefined) {
      return Number(request?.totals?.requestedApplianceQuantity || 0);
    }

    return Array.isArray(request?.requestedAppliances)
      ? request.requestedAppliances.reduce(
          (sum, item) => sum + Number(item?.quantityRequested || 0),
          0
        )
      : 0;
  }, []);

  const getRequestSupportTypes = useCallback(
    (request) => getSupportTypesFromRequest(request),
    []
  );

  const getReleasedMonetaryAmount = useCallback(
    (request) => Number(request?.fulfillment?.releasedMonetaryAmount || 0),
    []
  );

  const getReleasedApplianceQuantity = useCallback(
    (request) => Number(request?.fulfillment?.releasedApplianceQuantity || 0),
    []
  );

  const getRemainingMonetaryAmount = useCallback(
    (request) =>
      Math.max(
        0,
        getRequestedMonetaryAmount(request) - getReleasedMonetaryAmount(request)
      ),
    [getRequestedMonetaryAmount, getReleasedMonetaryAmount]
  );

  const getRemainingApplianceQuantity = useCallback(
    (request) =>
      Math.max(
        0,
        getRequestedApplianceQuantity(request) - getReleasedApplianceQuantity(request)
      ),
    [getRequestedApplianceQuantity, getReleasedApplianceQuantity]
  );

  const getRequestTypeLabel = (request) =>
    getReliefSupportTypeLabel(getRequestSupportTypes(request));

  const getStockBadgeClass = (quantity) => {
    const qty = Number(quantity || 0);
    if (qty <= 0) return "empty";
    if (qty < 20) return "low";
    return "available";
  };

  const pushNotification = useCallback((message, type = "success") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    setNotifications((prev) =>
      [{ id, message, type }, ...prev].slice(0, TOAST_LIMIT)
    );

    if (notificationTimersRef.current[id]) {
      clearTimeout(notificationTimersRef.current[id]);
    }

    notificationTimersRef.current[id] = setTimeout(() => {
      setNotifications((prev) =>
        prev.filter((notification) => notification.id !== id)
      );
      delete notificationTimersRef.current[id];
    }, TOAST_DURATION);
  }, []);

  const removeNotification = (id) => {
    if (notificationTimersRef.current[id]) {
      clearTimeout(notificationTimersRef.current[id]);
      delete notificationTimersRef.current[id];
    }

    setNotifications((prev) =>
      prev.filter((notification) => notification.id !== id)
    );
  };

  const exportInventoryPdf = useCallback(() => {
    try {
      let reportType = "masterlist";

      if (mode === "archived") {
        reportType = "archived";
      } else if (viewType === "monetary") {
        reportType = "monetary_donations";
      } else if (viewType === "appliance") {
        reportType = "appliance_donations";
      }

      const pdfUrl = `${BASE_URL}/api/inventory/export-pdf?reportType=${reportType}`;
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      pushNotification("Opening inventory PDF...", "info");
    } catch (error) {
      console.error("Export inventory PDF error:", error);
      pushNotification("Failed to open inventory PDF.", "error");
    }
  }, [mode, viewType, pushNotification]);

  const getToastIcon = (type) => {
    if (type === "success") return <FaCheck />;
    if (type === "error") return <FaTimes />;
    if (type === "warning") return <FaExclamationTriangle />;
    return <FaBell />;
  };

  const openConfirmationDialog = (config) => {
    setConfirmationDialog({
      title: "Confirm Action",
      message: "Please confirm before continuing.",
      confirmLabel: "Confirm",
      cancelLabel: "Cancel",
      tone: "primary",
      ...config,
    });
  };

  const closeConfirmationDialog = () => {
    if (actionLoading) return;
    setConfirmationDialog(null);
  };

  const confirmDialogAction = async () => {
    if (!confirmationDialog?.onConfirm) return;
    await confirmationDialog.onConfirm();
    setConfirmationDialog(null);
  };

  useEffect(() => {
    const timers = notificationTimersRef.current;
    return () => {
      Object.values(timers).forEach((timer) =>
        clearTimeout(timer)
      );
    };
  }, []);

  const fetchActiveInventory = useCallback(async () => {
    try {
      setLoadingActive(true);
      const res = await axios.get(`${BASE_URL}/api/inventory`, {
        withCredentials: true
      });
      setActiveItems(Array.isArray(res.data) ? res.data : []);
      setError("");
    } catch (err) {
      console.error("Fetch active inventory error:", err);
      setActiveItems([]);
      setError("Failed to fetch active inventory.");
      pushNotification("Failed to fetch active inventory.", "error");
    } finally {
      setLoadingActive(false);
    }
  }, [pushNotification]);

  const fetchArchivedInventory = useCallback(async () => {
    try {
      setLoadingArchived(true);
      const res = await axios.get(`${BASE_URL}/api/inventory/archived`, {
        withCredentials: true
      });
      setArchivedItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Fetch archived inventory error:", err);
      setArchivedItems([]);
      pushNotification("Failed to fetch archived inventory.", "error");
    } finally {
      setLoadingArchived(false);
    }
  }, [pushNotification]);

  const fetchApprovedRequests = useCallback(async () => {
    if (!canRelease) {
      setApprovedRequests([]);
      return;
    }

    try {
      setLoadingReleaseQueue(true);
      const res = await axios.get(
        `${BASE_URL}/api/relief-releases/approved-requests`,
        {
          withCredentials: true
        }
      );
      setApprovedRequests(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Fetch approved requests error:", err);
      setApprovedRequests([]);
      pushNotification("Failed to fetch release queue.", "error");
    } finally {
      setLoadingReleaseQueue(false);
    }
  }, [canRelease, pushNotification]);

  const fetchFoodPackTemplates = useCallback(async () => {
    if (!canManageTemplates) {
      setFoodPackTemplates([]);
      return;
    }

    try {
      setLoadingTemplates(true);
      const res = await axios.get(`${BASE_URL}/api/food-pack-templates`, {
        withCredentials: true
      });

      const incoming = Array.isArray(res.data) ? res.data : [];
      const activeOnly = incoming.filter(
        (template) => !template.isArchived && template.isActive !== false
      );

      setFoodPackTemplates(activeOnly);
    } catch (err) {
      console.error("Fetch food pack templates error:", err);
      setFoodPackTemplates([]);
      pushNotification("Failed to fetch food pack templates.", "error");
    } finally {
      setLoadingTemplates(false);
    }
  }, [canManageTemplates, pushNotification]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchActiveInventory(),
      fetchArchivedInventory(),
      fetchApprovedRequests(),
      fetchFoodPackTemplates()
    ]);
  }, [
    fetchActiveInventory,
    fetchArchivedInventory,
    fetchApprovedRequests,
    fetchFoodPackTemplates
  ]);

  useEffect(() => {
    if (!canSeeCentralInventory) {
      setActiveItems([]);
      setArchivedItems([]);
      setApprovedRequests([]);
      setFoodPackTemplates([]);
      setError("");
      return;
    }

    refreshAll();
  }, [canSeeCentralInventory, refreshAll]);

  useEffect(() => {
    setTablePage(1);
    setArchivePage(1);
  }, [
    mode,
    viewType,
    search,
    categoryFilter,
    expiryStatusFilter,
    sortBy,
    sortOrder,
    goodsDisplayMode
  ]);

  useEffect(() => {
    if (!allowedViewTypes.includes(viewType)) {
      setViewType(defaultViewType);
    }
  }, [allowedViewTypes, defaultViewType, viewType]);

  useEffect(() => {
    if (viewType === "goods" && (sortBy === "name" || sortBy === "category")) {
      setSortBy("createdAt");
    }
  }, [viewType, sortBy]);

  useEffect(() => {
    setTemplatePage(1);
  }, [foodPackTemplates.length]);

  useEffect(() => {
    if (!canRelease) return;

    const incoming = location.state || {};
    const incomingOpen = Boolean(incoming.openReleasePlanner);
    const incomingRequestId =
      incoming.selectedReliefRequestId ||
      incoming.selectedReliefRequest?._id ||
      "";

    if (incomingOpen) {
      setOperationsOpen(true);
      setPlannerOpen(true);
      setMode("active");
      setViewType(defaultViewType);
    }

    if (incomingRequestId) {
      setSelectedReleaseRequestId(incomingRequestId);
    }

    if (incomingOpen || incomingRequestId) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, canRelease, navigate, location.pathname, defaultViewType]);

  const activeGoods = useMemo(() => {
    return activeItems.filter((item) => resolveInventoryType(item) === "goods");
  }, [activeItems]);

  const activeAppliances = useMemo(() => {
    return activeItems.filter((item) => resolveInventoryType(item) === "appliance");
  }, [activeItems]);

  const activeMonetary = useMemo(() => {
    return activeItems.filter((item) => resolveInventoryType(item) === "monetary");
  }, [activeItems]);

  const mergedActiveGoods = useMemo(() => {
    const grouped = new Map();

    activeGoods.forEach((item) => {
      const key = buildGoodsMergeKey(item);
      const quantity = Number(item.quantity || 0);

      if (!grouped.has(key)) {
        grouped.set(key, {
          ...item,
          _mergeKey: key,
          _mergedIds: [item._id],
          _sourceTypes: [normalize(item.sourceType)].filter(Boolean),
          _sourceNames: [normalize(item.sourceName)].filter(Boolean),
          quantity
        });
        return;
      }

      const existing = grouped.get(key);

      existing.quantity = Number(existing.quantity || 0) + quantity;
      existing._mergedIds = [...existing._mergedIds, item._id];

      const nextSourceType = normalize(item.sourceType);
      const nextSourceName = normalize(item.sourceName);

      if (nextSourceType && !existing._sourceTypes.includes(nextSourceType)) {
        existing._sourceTypes.push(nextSourceType);
      }

      if (nextSourceName && !existing._sourceNames.includes(nextSourceName)) {
        existing._sourceNames.push(nextSourceName);
      }

      const existingCreatedAt = existing.createdAt
        ? new Date(existing.createdAt).getTime()
        : 0;
      const incomingCreatedAt = item.createdAt
        ? new Date(item.createdAt).getTime()
        : 0;

      if (incomingCreatedAt > existingCreatedAt) {
        existing.createdAt = item.createdAt;
        existing.updatedAt = item.updatedAt;
      }

      if (item.expirationDate) {
        const incomingExpiry = new Date(item.expirationDate);
        const existingExpiry = existing.expirationDate
          ? new Date(existing.expirationDate)
          : null;

        if (
          !existingExpiry ||
          Number.isNaN(existingExpiry.getTime()) ||
          (!Number.isNaN(incomingExpiry.getTime()) && incomingExpiry < existingExpiry)
        ) {
          existing.expirationDate = item.expirationDate;
        }
      }
    });

    return Array.from(grouped.values());
  }, [activeGoods, buildGoodsMergeKey, normalize]);

  const activeFoodGoods = useMemo(() => {
    return mergedActiveGoods;
  }, [mergedActiveGoods]);

  const activeFoodInventoryLookup = useMemo(() => {
    return buildInventoryItemLookup(activeGoods);
  }, [activeGoods]);

  const activeApplianceGoods = useMemo(() => {
    return activeAppliances;
  }, [activeAppliances]);

  const archivedGoods = useMemo(() => {
    return archivedItems.filter((item) => resolveInventoryType(item) === "goods");
  }, [archivedItems]);

  const archivedMonetary = useMemo(() => {
    return archivedItems.filter((item) => resolveInventoryType(item) === "monetary");
  }, [archivedItems]);

  const archivedAppliances = useMemo(() => {
    return archivedItems.filter((item) => resolveInventoryType(item) === "appliance");
  }, [archivedItems]);

  const activeSummary = useMemo(() => {
    const totalGoodsQuantity = mergedActiveGoods.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );

    const totalMonetaryAmount = activeMonetary.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    const totalApplianceQuantity = activeAppliances.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );

    const lowStockCount = mergedActiveGoods.filter((item) => {
      const qty = Number(item.quantity || 0);
      return qty > 0 && qty < 20;
    }).length;

    const outOfStockCount = mergedActiveGoods.filter(
      (item) => Number(item.quantity || 0) <= 0
    ).length;

    const expiredCount = mergedActiveGoods.filter(
      (item) => getExpiryStatus(item) === "expired"
    ).length;

    const expiringSoonCount = mergedActiveGoods.filter(
      (item) => getExpiryStatus(item) === "soon"
    ).length;

    return {
      totalRecords: activeItems.length,
      goodsCount: mergedActiveGoods.length,
      monetaryCount: activeMonetary.length,
      applianceCount: activeAppliances.length,
      totalGoodsQuantity,
      totalApplianceQuantity,
      totalMonetaryAmount,
      lowStockCount,
      outOfStockCount,
      foodEligibleCount: activeFoodGoods.length,
      expiredCount,
      expiringSoonCount
    };
  }, [activeItems, mergedActiveGoods, activeMonetary, activeAppliances, activeFoodGoods]);

  const archivedSummary = useMemo(() => {
    return {
      totalRecords: archivedItems.length,
      goodsCount: archivedGoods.length,
      monetaryCount: archivedMonetary.length,
      applianceCount: archivedAppliances.length
    };
  }, [archivedItems, archivedGoods, archivedMonetary, archivedAppliances]);

  useEffect(() => {
    if (loadingActive || !canSeeCentralInventory) return;

    if (activeSummary.expiredCount > 0) {
      if (expiredNoticeCountRef.current !== activeSummary.expiredCount) {
        expiredNoticeCountRef.current = activeSummary.expiredCount;
        pushNotification(
          `${activeSummary.expiredCount} expired goods item(s) need review.`,
          "warning"
        );
      }
      return;
    }

    expiredNoticeCountRef.current = 0;
  }, [activeSummary.expiredCount, loadingActive, canSeeCentralInventory, pushNotification]);

  const activeCategoryOptions = useMemo(() => {
    return [
      ...new Set(
        (viewType === "appliance" ? activeAppliances : mergedActiveGoods)
          .map((item) => normalize(item.category))
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));
  }, [mergedActiveGoods, activeAppliances, normalize, viewType]);

  const archivedCategoryOptions = useMemo(() => {
    return [
      ...new Set(
        (viewType === "appliance" ? archivedAppliances : archivedGoods)
          .map((item) => normalize(item.category))
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));
  }, [archivedGoods, archivedAppliances, normalize, viewType]);

  const editCategoryOptions = useMemo(() => {
    const sourceItems =
      itemForm.type === "appliance"
        ? [...activeAppliances, ...archivedAppliances]
        : [...activeGoods, ...archivedGoods];
    const defaults =
      itemForm.type === "appliance"
        ? DEFAULT_APPLIANCE_CATEGORIES
        : Array.from(DEFAULT_NON_EXPIRING_GOODS_CATEGORIES);
    const merged = [
      ...new Set(
        [...defaults, ...sourceItems.map((item) => String(item.category || "").trim().toLowerCase())].filter(Boolean)
      ),
    ];
    return merged.sort((a, b) => a.localeCompare(b));
  }, [itemForm.type, activeAppliances, archivedAppliances, activeGoods, archivedGoods]);

  const getFinalEditCategory = useCallback(() => {
    if (itemForm.category === CUSTOM_CATEGORY_VALUE) {
      return normalize(itemForm.customCategory);
    }
    return normalize(itemForm.category);
  }, [itemForm.category, itemForm.customCategory, normalize]);

  const editUnitOptions = useMemo(() => {
    if (itemForm.type !== "goods") return [];

    const finalCategory = getFinalEditCategory();
    const sourceItems = [...activeGoods, ...archivedGoods];
    const categoryUnits = sourceItems
      .filter((item) => normalize(item.category) === finalCategory)
      .map((item) => String(item.unit || "").trim().toLowerCase())
      .filter(Boolean);
    const hintedUnits = CATEGORY_UNIT_HINTS.flatMap((entry) =>
      entry.keywords.some((keyword) => finalCategory.includes(keyword)) ? entry.units : []
    );

    return [...new Set([...hintedUnits, ...categoryUnits, "piece", "pack", "box"])].sort(
      (a, b) => a.localeCompare(b)
    );
  }, [itemForm.type, getFinalEditCategory, activeGoods, archivedGoods, normalize]);

  const selectedEditUnitValue = useMemo(() => {
    if (itemForm.type !== "goods") return "";
    if (itemForm.category === CUSTOM_CATEGORY_VALUE) return CUSTOM_UNIT_VALUE;
    const currentUnit = String(itemForm.unit || "").trim().toLowerCase();
    return editUnitOptions.includes(currentUnit) ? currentUnit : CUSTOM_UNIT_VALUE;
  }, [itemForm.type, itemForm.category, itemForm.unit, editUnitOptions]);

  const filteredActiveGoods = useMemo(() => {
    let items = [...mergedActiveGoods];

    if (search.trim()) {
      const q = normalize(search);
      items = items.filter((item) => {
        return (
          normalize(item.name).includes(q) ||
          normalize(item.description).includes(q) ||
          normalize(item.category).includes(q) ||
          normalize(item.sourceType).includes(q) ||
          normalize(item.sourceName).includes(q) ||
          normalize(item.addedBy).includes(q) ||
          normalize(item.unit).includes(q) ||
          normalize(item.expirationDate).includes(q) ||
          (Array.isArray(item._sourceTypes) &&
            item._sourceTypes.some((value) => value.includes(q))) ||
          (Array.isArray(item._sourceNames) &&
            item._sourceNames.some((value) => value.includes(q)))
        );
      });
    }

    if (categoryFilter) {
      items = items.filter(
        (item) => normalize(item.category) === normalize(categoryFilter)
      );
    }

    if (expiryStatusFilter) {
      items = items.filter((item) => getExpiryStatus(item) === expiryStatusFilter);
    }

    items.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (sortBy === "quantity") {
        valA = Number(valA || 0);
        valB = Number(valB || 0);
      } else if (sortBy === "createdAt" || sortBy === "expirationDate") {
        valA = a[sortBy] ? new Date(a[sortBy]).getTime() : 0;
        valB = b[sortBy] ? new Date(b[sortBy]).getTime() : 0;
      } else {
        valA = (valA || "").toString().toLowerCase();
        valB = (valB || "").toString().toLowerCase();
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return items;
  }, [
    mergedActiveGoods,
    search,
    categoryFilter,
    expiryStatusFilter,
    sortBy,
    sortOrder,
    normalize
  ]);

  const activeMonetaryRows = useMemo(() => {
    let items = [...activeMonetary];

    if (search.trim()) {
      const q = normalize(search);
      items = items.filter((item) => {
        return (
          normalize(item.name).includes(q) ||
          normalize(item.description).includes(q) ||
          normalize(getReferenceNumber(item)).includes(q) ||
          normalize(item.sourceType).includes(q) ||
          normalize(item.sourceName).includes(q) ||
          normalize(item.addedBy).includes(q)
        );
      });
    }

    items.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (sortBy === "amount") {
        valA = Number(valA || 0);
        valB = Number(valB || 0);
      } else if (sortBy === "createdAt") {
        valA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        valB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      } else {
        valA = (valA || "").toString().toLowerCase();
        valB = (valB || "").toString().toLowerCase();
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return items;
  }, [activeMonetary, search, sortBy, sortOrder, normalize, getReferenceNumber]);

  const activeApplianceRows = useMemo(() => {
    let items = [...activeAppliances];

    if (search.trim()) {
      const q = normalize(search);
      items = items.filter((item) => {
        return (
          normalize(item.name).includes(q) ||
          normalize(item.description).includes(q) ||
          normalize(item.category).includes(q) ||
          normalize(item.sourceType).includes(q) ||
          normalize(item.sourceName).includes(q) ||
          normalize(item.addedBy).includes(q) ||
          normalize(item.condition).includes(q) ||
          normalize(item.usageDuration).includes(q)
        );
      });
    }

    if (categoryFilter) {
      items = items.filter(
        (item) => normalize(item.category) === normalize(categoryFilter)
      );
    }

    items.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (sortBy === "quantity") {
        valA = Number(valA || 0);
        valB = Number(valB || 0);
      } else if (sortBy === "createdAt") {
        valA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        valB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      } else {
        valA = (valA || "").toString().toLowerCase();
        valB = (valB || "").toString().toLowerCase();
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return items;
  }, [activeAppliances, search, categoryFilter, sortBy, sortOrder, normalize]);

  const archivedRows = useMemo(() => {
    const sourceData =
      viewType === "goods"
        ? archivedGoods
        : viewType === "appliance"
        ? archivedAppliances
        : archivedMonetary;
    let items = [...sourceData];

    if (search.trim()) {
      const q = normalize(search);
      items = items.filter((item) => {
        return (
          normalize(item.name).includes(q) ||
          normalize(item.description).includes(q) ||
          normalize(getReferenceNumber(item)).includes(q) ||
          normalize(item.category).includes(q) ||
          normalize(item.sourceType).includes(q) ||
          normalize(item.sourceName).includes(q) ||
          normalize(item.addedBy).includes(q) ||
          normalize(item.unit).includes(q) ||
          normalize(item.expirationDate).includes(q)
        );
      });
    }

    if ((viewType === "goods" || viewType === "appliance") && categoryFilter) {
      items = items.filter(
        (item) => normalize(item.category) === normalize(categoryFilter)
      );
    }

    if (viewType === "goods" && expiryStatusFilter) {
      items = items.filter((item) => getExpiryStatus(item) === expiryStatusFilter);
    }

    items.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (sortBy === "quantity" || sortBy === "amount") {
        valA = Number(valA || 0);
        valB = Number(valB || 0);
      } else if (sortBy === "createdAt" || sortBy === "expirationDate") {
        valA = a[sortBy] ? new Date(a[sortBy]).getTime() : 0;
        valB = b[sortBy] ? new Date(b[sortBy]).getTime() : 0;
      } else {
        valA = (valA || "").toString().toLowerCase();
        valB = (valB || "").toString().toLowerCase();
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return items;
  }, [
    archivedGoods,
    archivedMonetary,
    archivedAppliances,
    viewType,
    search,
    categoryFilter,
    expiryStatusFilter,
    sortBy,
    sortOrder,
    normalize,
    getReferenceNumber
  ]);

  const tableRows =
    mode === "active"
      ? viewType === "goods"
        ? filteredActiveGoods
        : viewType === "appliance"
        ? activeApplianceRows
        : activeMonetaryRows
      : archivedRows;

  const tablePageCount =
    mode === "active"
      ? Math.max(1, Math.ceil(tableRows.length / TABLE_PAGE_SIZE))
      : Math.max(1, Math.ceil(tableRows.length / ARCHIVE_PAGE_SIZE));

  const paginatedTableRows = useMemo(() => {
    if (mode === "active") {
      const start = (tablePage - 1) * TABLE_PAGE_SIZE;
      return tableRows.slice(start, start + TABLE_PAGE_SIZE);
    }

    const start = (archivePage - 1) * ARCHIVE_PAGE_SIZE;
    return tableRows.slice(start, start + ARCHIVE_PAGE_SIZE);
  }, [tableRows, mode, tablePage, archivePage]);

  useEffect(() => {
    if (tablePage > tablePageCount) setTablePage(1);
    if (archivePage > tablePageCount) setArchivePage(1);
  }, [tablePageCount, tablePage, archivePage]);

  const groupedGoodsRows = useMemo(() => {
    const groups = filteredActiveGoods.reduce((acc, item) => {
      const key = normalize(item.category) || "uncategorized";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredActiveGoods, normalize]);

  useEffect(() => {
    if (goodsDisplayMode !== "grouped") return;

    setExpandedCategories((prev) => {
      const next = { ...prev };
      groupedGoodsRows.forEach(([categoryKey]) => {
        if (typeof next[categoryKey] === "undefined") {
          next[categoryKey] = true;
        }
      });
      return next;
    });
  }, [groupedGoodsRows, goodsDisplayMode]);

  const barangayOptions = useMemo(() => {
    return [
      ...new Set(
        approvedRequests
          .map((request) => String(request.barangayName || "").trim())
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));
  }, [approvedRequests]);

  const roleRelevantApprovedRequests = useMemo(() => {
    return approvedRequests.filter((request) => {
      const supportTypes = getRequestSupportTypes(request);
      if (isAdmin) {
        return (
          hasSupportType(supportTypes, SUPPORT_TYPE_MONETARY) &&
          getRemainingMonetaryAmount(request) > 0
        );
      }

      if (isDrrmo) {
        const hasPendingFood =
          hasSupportType(supportTypes, SUPPORT_TYPE_FOODPACKS) &&
          getRemainingPackCount(request) > 0;
        const hasPendingAppliance =
          hasSupportType(supportTypes, SUPPORT_TYPE_APPLIANCE) &&
          getRemainingApplianceQuantity(request) > 0;
        return hasPendingFood || hasPendingAppliance;
      }

      return false;
    });
  }, [
    approvedRequests,
    isAdmin,
    isDrrmo,
    getRequestSupportTypes,
    getRemainingApplianceQuantity,
    getRemainingMonetaryAmount,
    getRemainingPackCount,
  ]);

  const filteredApprovedRequests = useMemo(() => {
    if (!releaseBarangayFilter) return roleRelevantApprovedRequests;
    return roleRelevantApprovedRequests.filter(
      (request) =>
        String(request.barangayName || "").trim() === releaseBarangayFilter
    );
  }, [roleRelevantApprovedRequests, releaseBarangayFilter]);

  const selectedReleaseRequest = useMemo(() => {
    return (
      filteredApprovedRequests.find(
        (request) => String(request._id) === String(selectedReleaseRequestId)
      ) || null
    );
  }, [filteredApprovedRequests, selectedReleaseRequestId]);

  const selectedReleaseSupportTypes = useMemo(
    () => getRequestSupportTypes(selectedReleaseRequest),
    [selectedReleaseRequest, getRequestSupportTypes]
  );
  const selectedRequestNeedsFood = hasSupportType(
    selectedReleaseSupportTypes,
    SUPPORT_TYPE_FOODPACKS
  );
  const selectedRequestNeedsMonetary = hasSupportType(
    selectedReleaseSupportTypes,
    SUPPORT_TYPE_MONETARY
  );
  const selectedRequestNeedsAppliance = hasSupportType(
    selectedReleaseSupportTypes,
    SUPPORT_TYPE_APPLIANCE
  );
  const selectedRemainingFoodPacks = getRemainingPackCount(selectedReleaseRequest);
  const selectedRemainingMonetaryAmount =
    getRemainingMonetaryAmount(selectedReleaseRequest);
  const selectedRemainingApplianceQuantity =
    getRemainingApplianceQuantity(selectedReleaseRequest);
  const selectedRequestPendingFood =
    isDrrmo && selectedRequestNeedsFood && selectedRemainingFoodPacks > 0;
  const selectedRequestPendingMonetary =
    isAdmin && selectedRequestNeedsMonetary && selectedRemainingMonetaryAmount > 0;
  const selectedRequestPendingAppliance =
    isDrrmo &&
    selectedRequestNeedsAppliance &&
    selectedRemainingApplianceQuantity > 0;
  const releaseJourneySteps = useMemo(
    () =>
      buildReleaseJourneySteps({
        pendingFood: selectedRequestPendingFood,
        pendingMonetary: selectedRequestPendingMonetary,
        pendingAppliance: selectedRequestPendingAppliance,
      }),
    [
      selectedRequestPendingFood,
      selectedRequestPendingMonetary,
      selectedRequestPendingAppliance,
    ]
  );

  useEffect(() => {
    if (!canRelease) return;

    if (!filteredApprovedRequests.length) {
      setSelectedReleaseRequestId("");
      return;
    }

    const exists = filteredApprovedRequests.some(
      (request) => String(request._id) === String(selectedReleaseRequestId)
    );

    if (!selectedReleaseRequestId || !exists) {
      setSelectedReleaseRequestId(filteredApprovedRequests[0]._id);
    }
  }, [filteredApprovedRequests, selectedReleaseRequestId, canRelease]);

  useEffect(() => {
    if (!selectedReleaseRequest?._id) {
      setReleaseMonetaryAmount("");
      return;
    }

    const remainingMonetaryAmount = Math.max(
      0,
      Number(selectedReleaseRequest?.totals?.requestedMonetaryAmount || 0) -
        Number(selectedReleaseRequest?.fulfillment?.releasedMonetaryAmount || 0)
    );

    if (selectedRequestPendingMonetary) {
      setReleaseMonetaryAmount(String(remainingMonetaryAmount || ""));
      return;
    }

    setReleaseMonetaryAmount("");
  }, [selectedReleaseRequest, selectedRequestPendingMonetary]);

  useEffect(() => {
    setActiveJourneyStep(getInitialJourneyStep(releaseJourneySteps));
    setConfirmedJourneySteps([]);
    setReleaseProofFiles([]);
    if (releaseProofInputRef.current) {
      releaseProofInputRef.current.value = "";
    }
  }, [selectedReleaseRequestId, releaseJourneySteps]);

  const selectedTemplate = useMemo(() => {
    return (
      foodPackTemplates.find(
        (template) => String(template._id) === String(selectedTemplateId)
      ) || null
    );
  }, [foodPackTemplates, selectedTemplateId]);

  const selectedTemplateCard = useMemo(() => {
    return (
      foodPackTemplates.find(
        (template) => String(template._id) === String(selectedTemplateCardId)
      ) || null
    );
  }, [foodPackTemplates, selectedTemplateCardId]);

  const templateHealthById = useMemo(() => {
    const next = {};

    foodPackTemplates.forEach((template) => {
      next[String(template._id)] = summarizeTemplateHealth(
        template,
        activeFoodInventoryLookup
      );
    });

    return next;
  }, [foodPackTemplates, activeFoodInventoryLookup]);

  const selectedTemplateCardHealth = useMemo(() => {
    if (!selectedTemplateCard) {
      return {
        itemHealth: [],
        lowCount: 0,
        expiringCount: 0,
        expiredCount: 0,
      };
    }

    return (
      templateHealthById[String(selectedTemplateCard._id)] || {
        itemHealth: [],
        lowCount: 0,
        expiringCount: 0,
        expiredCount: 0,
      }
    );
  }, [selectedTemplateCard, templateHealthById]);

  const computedTemplateItems = useMemo(() => {
    if (!selectedTemplate) return [];

    const packCount = Number(foodPacksToRelease || 0);
    if (packCount <= 0) return [];

    return (selectedTemplate.items || []).map((item) => ({
      inventoryItemId: item.inventoryItemId,
      itemName: item.itemName,
      category: item.category,
      unit: item.unit,
      quantityReleased: Number(item.quantityPerPack || 0) * packCount,
      quantityPerPack: Number(item.quantityPerPack || 0)
    }));
  }, [selectedTemplate, foodPacksToRelease]);
  const journeyCompletionState = useMemo(
    () => ({
      food: isJourneyStepComplete({
        step: "food",
        state: {
          selectedTemplateId,
          foodPacksToRelease,
          requiredFoodPacks: selectedRemainingFoodPacks,
          computedTemplateItems,
        },
      }),
      monetary: isJourneyStepComplete({
        step: "monetary",
        state: {
          releaseMonetaryAmount,
          requiredMonetaryAmount: selectedRemainingMonetaryAmount,
        },
      }),
      appliance: isJourneyStepComplete({
        step: "appliance",
        state: {
          requestedApplianceQuantity: selectedRemainingApplianceQuantity,
          applianceSelections,
        },
      }),
    }),
    [
      selectedTemplateId,
      foodPacksToRelease,
      selectedRemainingFoodPacks,
      computedTemplateItems,
      releaseMonetaryAmount,
      selectedRemainingMonetaryAmount,
      selectedRemainingApplianceQuantity,
      applianceSelections,
    ]
  );
  const completedJourneySteps = useMemo(
    () =>
      releaseJourneySteps.filter(
        (step) =>
          step !== "review" &&
          confirmedJourneySteps.includes(step) &&
          Boolean(journeyCompletionState[step])
      ),
    [releaseJourneySteps, confirmedJourneySteps, journeyCompletionState]
  );
  const activeJourneyMeta = useMemo(
    () => getJourneyStepMeta(activeJourneyStep),
    [activeJourneyStep]
  );
  const currentStepIndex = releaseJourneySteps.indexOf(activeJourneyStep);
  const nextJourneyStep = useMemo(() => {
    if (currentStepIndex === -1) return null;
    return releaseJourneySteps[currentStepIndex + 1] || null;
  }, [releaseJourneySteps, currentStepIndex]);
  const reviewStepIndex = releaseJourneySteps.indexOf("review");
  const canOpenReviewStep =
    reviewStepIndex === -1 ||
    releaseJourneySteps
      .slice(0, reviewStepIndex)
      .every((step) => completedJourneySteps.includes(step));
  const canSubmitReleasePlan =
    releaseJourneySteps
      .filter((step) => step !== "review")
      .every((step) => completedJourneySteps.includes(step));
  const releaseProofPreviews = useMemo(
    () =>
      releaseProofFiles.map((file) => ({
        key: `${file.name}-${file.lastModified}-${file.size}`,
        file,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
      })),
    [releaseProofFiles]
  );

  useEffect(() => {
    return () => {
      releaseProofPreviews.forEach((preview) => {
        URL.revokeObjectURL(preview.previewUrl);
      });
    };
  }, [releaseProofPreviews]);

  useEffect(() => {
    if (!releaseJourneySteps.includes(activeJourneyStep)) {
      setActiveJourneyStep(getInitialJourneyStep(releaseJourneySteps));
    }
  }, [activeJourneyStep, releaseJourneySteps]);

  useEffect(() => {
    if (mode === "archived" && operationsOpen) {
      setOperationsOpen(false);
    }
  }, [mode, operationsOpen]);

  const templateCatalog = useMemo(() => {
    let items = activeFoodGoods.filter((item) => Number(item.quantity || 0) > 0);

    if (templateBuilderSearch.trim()) {
      const q = normalize(templateBuilderSearch);
      items = items.filter((item) => {
        return (
          normalize(item.name).includes(q) ||
          normalize(item.category).includes(q) ||
          normalize(item.sourceName).includes(q) ||
          normalize(item.sourceType).includes(q) ||
          normalize(item.unit).includes(q)
        );
      });
    }

    items.sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
    return items;
  }, [activeFoodGoods, templateBuilderSearch, normalize]);

  const applianceCatalog = useMemo(() => {
    let items = activeApplianceGoods.filter((item) => Number(item.quantity || 0) > 0);

    if (applianceSearch.trim()) {
      const q = normalize(applianceSearch);
      items = items.filter((item) => {
        return (
          normalize(item.name).includes(q) ||
          normalize(item.category).includes(q) ||
          normalize(item.sourceName).includes(q) ||
          normalize(item.sourceType).includes(q) ||
          normalize(item.unit).includes(q)
        );
      });
    }

    items.sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));
    return items;
  }, [activeApplianceGoods, applianceSearch, normalize]);

  const releasePreviewSummary = useMemo(() => {
    return buildReleasePreviewSummary({
      needsFood:
        selectedRequestPendingFood &&
        (confirmedJourneySteps.includes("food") || activeJourneyStep === "food"),
      needsMonetary:
        selectedRequestPendingMonetary &&
        (confirmedJourneySteps.includes("monetary") || activeJourneyStep === "monetary"),
      computedTemplateItems:
        confirmedJourneySteps.includes("food") || activeJourneyStep === "food"
          ? computedTemplateItems
          : [],
      foodPacksToRelease:
        confirmedJourneySteps.includes("food") || activeJourneyStep === "food"
          ? foodPacksToRelease
          : "",
      releaseMonetaryAmount:
        confirmedJourneySteps.includes("monetary") || activeJourneyStep === "monetary"
        ? releaseMonetaryAmount
        : "",
      applianceSelections:
        confirmedJourneySteps.includes("appliance") || activeJourneyStep === "appliance"
        ? applianceSelections
        : [],
    });
  }, [
    activeJourneyStep,
    confirmedJourneySteps,
    selectedRequestPendingFood,
    selectedRequestPendingMonetary,
    computedTemplateItems,
    foodPacksToRelease,
    releaseMonetaryAmount,
    applianceSelections,
  ]);

  const templatePageCount = Math.max(
    1,
    Math.ceil(foodPackTemplates.length / TEMPLATE_PAGE_SIZE)
  );

  const paginatedTemplates = useMemo(() => {
    const start = (templatePage - 1) * TEMPLATE_PAGE_SIZE;
    return foodPackTemplates.slice(start, start + TEMPLATE_PAGE_SIZE);
  }, [foodPackTemplates, templatePage]);

  useEffect(() => {
    if (templatePage > templatePageCount) {
      setTemplatePage(1);
    }
  }, [templatePage, templatePageCount]);

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("");
    setExpiryStatusFilter("");
    setSortBy("createdAt");
    setSortOrder("desc");
    setTablePage(1);
    setArchivePage(1);
  };

  const toggleCategoryExpanded = (categoryKey) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [categoryKey]: !prev[categoryKey]
    }));
  };

  const clearReleasePlanner = () => {
    setSelectedTemplateId("");
    setFoodPacksToRelease("");
    setReleaseMonetaryAmount(
      selectedReleaseRequest ? String(getRemainingMonetaryAmount(selectedReleaseRequest) || "") : ""
    );
    setReleaseProofFiles([]);
    setApplianceSelections([]);
    setApplianceSearch("");
    setReleaseRemarks("");
    setActiveJourneyStep(getInitialJourneyStep(releaseJourneySteps));
    setConfirmedJourneySteps([]);
    if (releaseProofInputRef.current) {
      releaseProofInputRef.current.value = "";
    }
  };

  const handleReleaseProofFileSelect = (event) => {
    const incomingFiles = Array.from(event.target.files || []);
    if (!incomingFiles.length) return;

    const imageFiles = incomingFiles.filter((file) =>
      String(file.type || "").startsWith("image/")
    );

    if (imageFiles.length !== incomingFiles.length) {
      pushNotification("Only image proof files are allowed for release proof.", "error");
    }

    setReleaseProofFiles((prev) => {
      const next = [...prev];

      imageFiles.forEach((file) => {
        const duplicate = next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified
        );

        if (!duplicate) {
          next.push(file);
        }
      });

      if (next.length > 5) {
        pushNotification("You can upload up to 5 release proof images.", "warning");
      }

      return next.slice(0, 5);
    });

    event.target.value = "";
  };

  const removeReleaseProofFile = (targetKey) => {
    setReleaseProofFiles((prev) =>
      prev.filter(
        (file) => `${file.name}-${file.lastModified}-${file.size}` !== targetKey
      )
    );
  };

  const jumpToJourneyStep = (step) => {
    const stepIndex = releaseJourneySteps.indexOf(step);
    if (stepIndex === -1) return;

    const priorSteps = releaseJourneySteps.slice(0, stepIndex);
    const priorStepsComplete = priorSteps.every(
      (priorStep) =>
        priorStep === "review" || completedJourneySteps.includes(priorStep)
    );

    if (!priorStepsComplete) return;
    if (step === "review" && !canOpenReviewStep) return;

    setActiveJourneyStep(step);
  };

  const goToNextJourneyStep = () => {
    if (
      !nextJourneyStep ||
      !activeJourneyStep ||
      !journeyCompletionState[activeJourneyStep]
    ) {
      return;
    }
    setConfirmedJourneySteps((prev) =>
      prev.includes(activeJourneyStep) ? prev : [...prev, activeJourneyStep]
    );
    setActiveJourneyStep(nextJourneyStep);
  };

  const goToPreviousJourneyStep = () => {
    const currentIndex = releaseJourneySteps.indexOf(activeJourneyStep);
    if (currentIndex <= 0) return;
    setActiveJourneyStep(releaseJourneySteps[currentIndex - 1]);
  };

  const handleTemplateSelectionChange = (value) => {
    setSelectedTemplateId(value);
    if (value) {
      setFoodPacksToRelease(
        selectedReleaseRequest && selectedRequestPendingFood
          ? String(selectedRemainingFoodPacks || 1)
          : "1"
      );
    } else {
      setFoodPacksToRelease("");
    }
  };

  const openCreateTemplateModal = () => {
    setEditingTemplateId("");
    setTemplateName("");
    setTemplateDescription("");
    setTemplateBuilderSearch("");
    setTemplateItems([]);
    setTemplateModalOpen(true);
  };

  const openEditTemplateModal = (template) => {
    setEditingTemplateId(template?._id || "");
    setTemplateName(template?.name || "");
    setTemplateDescription(template?.description || "");
    setTemplateBuilderSearch("");
    setTemplateItems(
      Array.isArray(template?.items)
        ? template.items.map((item) => ({
            inventoryItemId: item.inventoryItemId,
            itemName: item.itemName,
            category: item.category,
            quantityPerPack: String(Number(item.quantityPerPack || 0)),
            unit: item.unit || ""
          }))
        : []
    );
    setTemplateModalOpen(true);
  };

  const closeTemplateModal = () => {
    if (templateSubmitting) return;
    setTemplateModalOpen(false);
    setEditingTemplateId("");
    setTemplateName("");
    setTemplateDescription("");
    setTemplateBuilderSearch("");
    setTemplateItems([]);
  };

  const addTemplateItem = (inventoryItem) => {
    setTemplateItems((prev) => {
      const exists = prev.some(
        (item) => String(item.inventoryItemId) === String(inventoryItem._id)
      );
      if (exists) return prev;

      return [
        ...prev,
        {
          inventoryItemId: inventoryItem._id,
          itemName: inventoryItem.name,
          category: inventoryItem.category || "",
          quantityPerPack: "1",
          unit: inventoryItem.unit || ""
        }
      ];
    });
  };

  const updateTemplateItem = (inventoryItemId, field, value) => {
    setTemplateItems((prev) =>
      prev.map((item) =>
        String(item.inventoryItemId) === String(inventoryItemId)
          ? { ...item, [field]: value }
          : item
      )
    );
  };

useEffect(() => {
  if (!templateModalOpen) {
    document.body.style.overflow = "";
    return;
  }

  document.body.style.overflow = "hidden";

  requestAnimationFrame(() => {
    if (templateModalRef.current) {
      templateModalRef.current.scrollTop = 0;
    }
  });

  return () => {
    document.body.style.overflow = "";
  };
}, [templateModalOpen]);

  const removeTemplateItem = (inventoryItemId) => {
    setTemplateItems((prev) =>
      prev.filter(
        (item) => String(item.inventoryItemId) !== String(inventoryItemId)
      )
    );
  };

  const addApplianceReleaseItem = (inventoryItem) => {
    const selectionId =
      inventoryItem._id ||
      inventoryItem._mergeKey ||
      buildGoodsMergeKey(inventoryItem);

    setApplianceSelections((prev) => {
      const exists = prev.some(
        (item) => String(item.inventoryItemId) === String(selectionId)
      );
      if (exists) return prev;

      return [
        ...prev,
        {
          inventoryItemId: selectionId,
          sourceInventoryIds: Array.isArray(inventoryItem._mergedIds)
            ? inventoryItem._mergedIds
            : [inventoryItem._id].filter(Boolean),
          itemName: inventoryItem.name,
          category: inventoryItem.category,
          availableQuantity: Number(inventoryItem.quantity || 0),
          quantityReleased: "",
          unit: inventoryItem.unit || "",
          remarks: ""
        }
      ];
    });
  };

  const updateApplianceSelection = (inventoryItemId, field, value) => {
    setApplianceSelections((prev) =>
      prev.map((item) =>
        String(item.inventoryItemId) === String(inventoryItemId)
          ? { ...item, [field]: value }
          : item
      )
    );
  };

  const removeApplianceSelection = (inventoryItemId) => {
    setApplianceSelections((prev) =>
      prev.filter(
        (item) => String(item.inventoryItemId) !== String(inventoryItemId)
      )
    );
  };

  const openItemEditModal = (item) => {
    const normalizedType = resolveInventoryType(item);
    const itemType =
      normalizedType === "monetary"
        ? "monetary"
        : normalizedType === "appliance"
        ? "appliance"
        : "goods";

    setEditingItemId(item?._id || "");
    setItemFormErrors({});
    setItemForm({
      type: itemType,
      name: item?.name || "",
      category:
        itemType === "goods" || itemType === "appliance"
          ? editCategoryOptions.includes(normalize(item?.category))
            ? normalize(item?.category)
            : item?.category
              ? CUSTOM_CATEGORY_VALUE
              : ""
          : "",
      customCategory:
        itemType === "goods" || itemType === "appliance"
          ? editCategoryOptions.includes(normalize(item?.category))
            ? ""
            : item?.category || ""
          : "",
      requiresExpiration: itemType === "goods" ? item?.requiresExpiration !== false : true,
      quantity:
        (itemType === "goods" || itemType === "appliance") && item?.quantity !== undefined
          ? String(item.quantity)
          : "",
      unit: itemType === "goods" ? item?.unit || "" : "",
      amount:
        itemType === "monetary" && item?.amount !== undefined
          ? String(item.amount)
          : "",
      referenceNumber:
        itemType === "monetary"
          ? item?.referenceNumber || extractReferenceFromDescription(item?.description)
          : "",
      expirationDate:
        itemType === "goods" && item?.expirationDate
          ? new Date(item.expirationDate).toISOString().slice(0, 10)
          : "",
      condition: itemType === "appliance" ? item?.condition || "brand_new" : "brand_new",
      usageDuration: itemType === "appliance" ? item?.usageDuration || "" : "",
      description:
        itemType === "monetary"
          ? stripReferenceFromDescription(item?.description)
          : item?.description || "",
      sourceType: item?.sourceType || "external",
      sourceName: item?.sourceName || ""
    });
    setItemEditModalOpen(true);
  };

  const closeItemEditModal = () => {
    if (itemEditSubmitting) return;
    setItemEditModalOpen(false);
    setEditingItemId("");
    setItemFormErrors({});
    setItemForm({
      type: "goods",
      name: "",
      category: "",
      customCategory: "",
      requiresExpiration: true,
      quantity: "",
      unit: "",
      amount: "",
      referenceNumber: "",
      expirationDate: "",
      condition: "brand_new",
      usageDuration: "",
      description: "",
      sourceType: "external",
      sourceName: ""
    });
  };

  const validateItemForm = () => {
    const errors = {};

    if (!itemForm.name.trim()) {
      errors.name = "Name is required.";
    } else if (itemForm.name.trim().length > MAX_NAME_LENGTH) {
      errors.name = `Name must be ${MAX_NAME_LENGTH} characters or less.`;
    }

    if (itemForm.type === "goods") {
      const finalCategory = getFinalEditCategory();

      if (!finalCategory) {
        errors.category = "Category is required.";
      }

      if (
        itemForm.category === CUSTOM_CATEGORY_VALUE &&
        !normalize(itemForm.customCategory)
      ) {
        errors.customCategory = "Please enter a custom category.";
      }

      if (itemForm.quantity === "" || Number(itemForm.quantity) <= 0) {
        errors.quantity = "Quantity must be greater than 0.";
      } else if (Number(itemForm.quantity) > MAX_QUANTITY) {
        errors.quantity = `Quantity must not exceed ${MAX_QUANTITY.toLocaleString()}.`;
      }

      if (!itemForm.unit.trim()) {
        errors.unit = "Unit is required.";
      } else if (itemForm.unit.trim().length > MAX_UNIT_LENGTH) {
        errors.unit = `Unit must be ${MAX_UNIT_LENGTH} characters or less.`;
      }

      if (itemForm.expirationDate) {
        const expirationDateError = validateFutureOrTodayInventoryDate(
          itemForm.expirationDate
        );
        if (expirationDateError) {
          errors.expirationDate = expirationDateError;
        }
      }

      if (
        isExpiryRequiredCategory(finalCategory) &&
        !itemForm.expirationDate
      ) {
        errors.expirationDate =
          "Expiration date is required for non-appliance goods.";
      }
    }

    if (itemForm.type === "appliance") {
      const finalCategory = getFinalEditCategory();

      if (!finalCategory) {
        errors.category = "Category is required.";
      }

      if (
        itemForm.category === CUSTOM_CATEGORY_VALUE &&
        !normalize(itemForm.customCategory)
      ) {
        errors.customCategory = "Please enter a custom category.";
      }

      if (itemForm.quantity === "" || Number(itemForm.quantity) <= 0) {
        errors.quantity = "Quantity must be greater than 0.";
      } else if (Number(itemForm.quantity) > MAX_QUANTITY) {
        errors.quantity = `Quantity must not exceed ${MAX_QUANTITY.toLocaleString()}.`;
      }

      if (!itemForm.condition) {
        errors.condition = "Condition is required.";
      }

      if (
        itemForm.condition === "used_item" &&
        !String(itemForm.usageDuration || "").trim()
      ) {
        errors.usageDuration = "Usage duration is required.";
      }
    }

    if (itemForm.type === "monetary") {
      if (itemForm.amount === "" || Number(itemForm.amount) <= 0) {
        errors.amount = "Amount must be greater than 0.";
      } else if (Number(itemForm.amount) > MAX_AMOUNT) {
        errors.amount = "Amount is too large.";
      }

      if (!String(itemForm.referenceNumber || "").trim()) {
        errors.referenceNumber = "Reference number is required.";
      }
    }

    if (
      (itemForm.type === "goods" || itemForm.type === "appliance") &&
      String(itemForm.sourceName || "").trim().length > MAX_SOURCE_NAME_LENGTH
    ) {
      errors.sourceName = `Source name must be ${MAX_SOURCE_NAME_LENGTH} characters or less.`;
    }

    if (String(itemForm.description || "").trim().length > MAX_DESCRIPTION_LENGTH) {
      errors.description = `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less.`;
    }

    setItemFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleItemFormChange = (e) => {
    const { name, value } = e.target;

    if (name === "quantity" || name === "amount") {
      if (value === "") {
        setItemForm((prev) => ({ ...prev, [name]: "" }));
      } else {
        const parsedValue = Number(value);
        const maxValue = name === "quantity" ? MAX_QUANTITY : MAX_AMOUNT;
        if (!Number.isNaN(parsedValue) && parsedValue >= 0 && parsedValue <= maxValue) {
          setItemForm((prev) => ({ ...prev, [name]: value }));
        }
      }
    } else if (name === "name") {
      setItemForm((prev) => ({
        ...prev,
        name: sanitizeCompactText(value, MAX_NAME_LENGTH),
      }));
    } else if (name === "sourceName") {
      setItemForm((prev) => ({
        ...prev,
        sourceName: sanitizeCompactText(value, MAX_SOURCE_NAME_LENGTH),
      }));
    } else if (name === "description") {
      setItemForm((prev) => ({
        ...prev,
        description: sanitizeNoteText(value, MAX_DESCRIPTION_LENGTH),
      }));
    } else if (name === "customCategory") {
      setItemForm((prev) => ({
        ...prev,
        customCategory: sanitizeCompactText(value, MAX_CUSTOM_CATEGORY_LENGTH).toLowerCase(),
      }));
    } else if (name === "unit") {
      setItemForm((prev) => ({
        ...prev,
        unit: sanitizeCompactText(value, MAX_UNIT_LENGTH).toLowerCase(),
      }));
    } else if (name === "unitSelect") {
      setItemForm((prev) => ({
        ...prev,
        unit: value === CUSTOM_UNIT_VALUE ? "" : value,
      }));
    } else if (name === "category") {
      setItemForm((prev) => ({
        ...prev,
        category: value,
        customCategory: value === CUSTOM_CATEGORY_VALUE ? prev.customCategory : "",
        unit: prev.type === "goods" ? "" : prev.unit,
      }));
    } else {
      setItemForm((prev) => ({
        ...prev,
        [name]: value,
        usageDuration:
          name === "condition" && value === "brand_new" ? "" : prev.usageDuration
      }));
    }

    setItemFormErrors((prev) => ({
      ...prev,
      [name]: "",
      customCategory: "",
      unitSelect: "",
      category: "",
      usageDuration: name === "condition" ? "" : prev.usageDuration,
      condition: name === "condition" ? "" : prev.condition,
      sourceName: "",
      description: "",
    }));
  };

  const saveItemEdit = async () => {
    if (!editingItemId) return;
    if (!validateItemForm()) return;

    try {
      setItemEditSubmitting(true);

      const formData = new FormData();

      formData.append("type", itemForm.type);
      formData.append("name", itemForm.name.trim());
      formData.append("description", itemForm.description.trim());
      formData.append("sourceType", itemForm.sourceType);
      formData.append("sourceName", itemForm.sourceName.trim());

      if (itemForm.type === "goods") {
        formData.append("category", getFinalEditCategory());
        formData.append("quantity", itemForm.quantity);
        formData.append("unit", itemForm.unit.trim());
        formData.append("expirationDate", itemForm.expirationDate || "");
        formData.append(
          "requiresExpiration",
          itemForm.requiresExpiration ? "true" : "false"
        );
      } else if (itemForm.type === "appliance") {
        formData.append("category", getFinalEditCategory());
        formData.append("quantity", itemForm.quantity);
        formData.append("condition", itemForm.condition);
        formData.append(
          "usageDuration",
          itemForm.condition === "used_item"
            ? String(itemForm.usageDuration || "").trim()
            : ""
        );
      } else {
        formData.append("amount", itemForm.amount);
        formData.append("referenceNumber", String(itemForm.referenceNumber || "").trim());
      }

      await axios.put(`${BASE_URL}/api/inventory/${editingItemId}`, formData, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" }
      });

      await refreshAll();
      closeItemEditModal();
      pushNotification("Inventory item updated successfully.", "success");
    } catch (err) {
      console.error("Update inventory item error:", err);
      pushNotification(
        err.response?.data?.message || "Failed to update inventory item.",
        "error"
      );
    } finally {
      setItemEditSubmitting(false);
    }
  };

  const saveTemplate = async () => {
    const cleanName = String(templateName || "").trim();
    const cleanDescription = String(templateDescription || "").trim();

    if (!cleanName) {
      pushNotification("Template name is required.", "error");
      return;
    }

    const preparedItems = templateItems
      .map((item) => ({
        inventoryItemId: item.inventoryItemId,
        itemName: String(item.itemName || "").trim(),
        category: String(item.category || "").trim(),
        quantityPerPack: Number(item.quantityPerPack || 0),
        unit: String(item.unit || "").trim()
      }))
      .filter((item) => item.inventoryItemId);

    if (!preparedItems.length) {
      pushNotification("Add at least one food item to the template.", "error");
      return;
    }

    const invalidItem = preparedItems.find(
      (item) =>
        !item.itemName ||
        !item.category ||
        !item.unit ||
        Number(item.quantityPerPack || 0) <= 0
    );

    if (invalidItem) {
      pushNotification(
        `Complete all required fields for "${invalidItem.itemName || "item"}".`,
        "error"
      );
      return;
    }

    try {
      setTemplateSubmitting(true);

      const payload = {
        name: cleanName,
        description: cleanDescription,
        items: preparedItems
      };

      if (editingTemplateId) {
        await axios.put(
          `${BASE_URL}/api/food-pack-templates/${editingTemplateId}`,
          payload,
          { withCredentials: true }
        );
        pushNotification("Food pack template updated successfully.", "success");
      } else {
        await axios.post(`${BASE_URL}/api/food-pack-templates`, payload, {
          withCredentials: true
        });
        pushNotification("Food pack template created successfully.", "success");
      }

      await fetchFoodPackTemplates();
      closeTemplateModal();
    } catch (err) {
      console.error("Save template error:", err);
      pushNotification(
        err.response?.data?.message || "Failed to save food pack template.",
        "error"
      );
    } finally {
      setTemplateSubmitting(false);
    }
  };

  const archiveTemplate = async (templateId) => {
    openConfirmationDialog({
      title: "Archive food pack template?",
      message:
        "This template will be removed from active release preparation, but existing records remain unchanged.",
      confirmLabel: "Archive Template",
      tone: "danger",
      icon: <FaArchive />,
      onConfirm: async () => {
        try {
          setActionLoading(true);
          await axios.delete(`${BASE_URL}/api/food-pack-templates/${templateId}`, {
            withCredentials: true
          });

          if (selectedTemplateId === templateId) {
            setSelectedTemplateId("");
          }
          if (selectedTemplateCardId === templateId) {
            setSelectedTemplateCardId("");
          }

          await fetchFoodPackTemplates();
          pushNotification("Food pack template archived.", "success");
        } catch (err) {
          console.error("Archive template error:", err);
          pushNotification(
            err.response?.data?.message || "Failed to archive food pack template.",
            "error"
          );
        } finally {
          setActionLoading(false);
        }
      }
    });
  };

  const handleArchive = async (id) => {
    openConfirmationDialog({
      title: "Archive inventory record?",
      message:
        "This record will move to archived inventory and will no longer appear in active stock.",
      confirmLabel: "Archive Record",
      tone: "danger",
      icon: <FaArchive />,
      onConfirm: async () => {
        try {
          setActionLoading(true);
          await axios.delete(`${BASE_URL}/api/inventory/${id}`, {
            withCredentials: true
          });
          await refreshAll();
          if (selectedItem?._id === id) setSelectedItem(null);
          pushNotification("Inventory record archived.", "success");
        } catch (err) {
          console.error("Archive error:", err);
          pushNotification(
            err.response?.data?.message || "Failed to archive record.",
            "error"
          );
        } finally {
          setActionLoading(false);
        }
      }
    });
  };

  const handleRestore = async (id) => {
    openConfirmationDialog({
      title: "Restore inventory record?",
      message:
        "This archived record will return to active inventory and become available for operations again.",
      confirmLabel: "Restore Record",
      tone: "primary",
      icon: <FaUndo />,
      onConfirm: async () => {
        try {
          setActionLoading(true);
          await axios.put(
            `${BASE_URL}/api/inventory/archived/${id}/restore`,
            {},
            { withCredentials: true }
          );
          await refreshAll();
          if (selectedItem?._id === id) setSelectedItem(null);
          pushNotification("Inventory record restored.", "success");
        } catch (err) {
          console.error("Restore error:", err);
          pushNotification(
            err.response?.data?.message || "Failed to restore record.",
            "error"
          );
        } finally {
          setActionLoading(false);
        }
      }
    });
  };

  const handlePermanentDelete = async (id) => {
    openConfirmationDialog({
      title: "Permanently delete record?",
      message:
        "This archived inventory record will be permanently deleted. This action cannot be undone.",
      confirmLabel: "Delete Permanently",
      tone: "danger",
      icon: <FaTrash />,
      onConfirm: async () => {
        try {
          setActionLoading(true);
          await axios.delete(`${BASE_URL}/api/inventory/archived/${id}/permanent`, {
            withCredentials: true
          });
          await refreshAll();
          if (selectedItem?._id === id) setSelectedItem(null);
          pushNotification("Archived inventory record deleted.", "success");
        } catch (err) {
          console.error("Permanent delete error:", err);
          pushNotification(
            err.response?.data?.message || "Failed to delete record.",
            "error"
          );
        } finally {
          setActionLoading(false);
        }
      }
    });
  };

  const renderProofFiles = (proofFiles) => {
    if (!Array.isArray(proofFiles) || proofFiles.length === 0) {
      return <span className="muted-text">No files</span>;
    }

    return (
      <div className="proof-list">
        {proofFiles.map((file, index) => {
          const rawValue = typeof file === "string" ? file : "";
          const fileName = typeof file === "string" ? file : file?.filename;
          const path =
            typeof file === "string" && rawValue.includes("/")
              ? rawValue
              : typeof file === "string"
              ? ""
              : file?.path;

          const href = path
            ? path.startsWith("http")
              ? path
              : `${BASE_URL}/${path.replace(/^\/+/, "")}`
            : fileName
            ? `${BASE_URL}/uploads/${fileName}`
            : "#";

          return (
            <a
              key={`${fileName || "file"}-${index}`}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="file-link"
            >
              View File {index + 1}
            </a>
          );
        })}
      </div>
    );
  };

  const renderRowActions = (item) => {
    const canManageItem = canEditInventoryType(role, item?.type);

    if (mode === "active") {
      return (
        <div className="row-actions row-actions-tight">
          {canManageItem ? (
            <>
              <button
                type="button"
                className="btn btn-edit btn-sm"
                disabled={actionLoading}
                onClick={() => openItemEditModal(item)}
              >
                <FaEdit className="btn-icon" />
                Edit
              </button>
              <button
                type="button"
                className="btn btn-archive btn-sm"
                disabled={actionLoading}
                onClick={() => handleArchive(item._id)}
              >
                <FaArchive className="btn-icon" />
                Archive
              </button>
            </>
          ) : (
            <span className="inventory-muted-note">View only</span>
          )}
        </div>
      );
    }

    return (
      <div className="row-actions">
        {canManageItem ? (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={actionLoading}
              onClick={() => handleRestore(item._id)}
            >
              <FaUndo className="btn-icon" />
              Restore
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={actionLoading}
              onClick={() => handlePermanentDelete(item._id)}
            >
              <FaTrash className="btn-icon" />
              Delete
            </button>
          </>
        ) : (
          <span className="inventory-muted-note">View only</span>
        )}
      </div>
    );
  };

  const submitRelease = async () => {
    if (!selectedReleaseRequest?._id) {
      pushNotification("Select a request first.", "error");
      return;
    }

    try {
      setReleaseSubmitting(true);

      if (selectedRequestPendingFood) {
        if (!selectedTemplateId) {
          throw new Error("Select a food pack template.");
        }

        const packCount = Number(foodPacksToRelease || 0);
        const requiredPackCount = selectedRemainingFoodPacks;

        if (packCount <= 0) {
          throw new Error("Food packs to release must be greater than 0.");
        }

        if (packCount !== requiredPackCount) {
          throw new Error(
            `${releaseActorLabel} must fully satisfy the approved request. Release exactly ${requiredPackCount} food pack(s).`
          );
        }
      }

      if (selectedRequestPendingMonetary) {
        const requiredMonetaryAmount = selectedRemainingMonetaryAmount;
        const enteredMonetaryAmount = Number(releaseMonetaryAmount || 0);

        if (enteredMonetaryAmount <= 0) {
          throw new Error("Enter the monetary amount to release.");
        }

        if (enteredMonetaryAmount !== requiredMonetaryAmount) {
          throw new Error(
            `${releaseActorLabel} must release the full approved monetary amount in one go. Release exactly ${formatMoney(
              requiredMonetaryAmount
            )}.`
          );
        }
      }

      const validApplianceSelections = applianceSelections.filter(
        (item) => Number(item.quantityReleased || 0) > 0
      );

      if (selectedRequestPendingAppliance && validApplianceSelections.length > 0) {
        const totalApplianceQuantity = validApplianceSelections.reduce(
          (sum, item) => sum + Number(item.quantityReleased || 0),
          0
        );

        if (totalApplianceQuantity > selectedRemainingApplianceQuantity) {
          throw new Error(
            `Appliance release cannot exceed the remaining ${selectedRemainingApplianceQuantity} unit(s).`
          );
        }

        const invalidAppliance = validApplianceSelections.find(
          (item) =>
            Number(item.quantityReleased || 0) > Number(item.availableQuantity || 0)
        );

        if (invalidAppliance) {
          throw new Error(
            `${invalidAppliance.itemName} exceeds available appliance stock.`
          );
        }
      }

      if (!releaseProofFiles.length) {
        throw new Error("Attach at least one release proof image before submitting.");
      }

      const payload = buildReleaseRequestPayload({
        reliefRequestId: selectedReleaseRequest._id,
        remarks: releaseRemarks,
        needsFood: selectedRequestPendingFood,
        needsMonetary: selectedRequestPendingMonetary,
        needsAppliance: selectedRequestPendingAppliance,
        selectedTemplateId,
        foodPacksToRelease,
        releaseMonetaryAmount,
        applianceSelections,
      });

      const hasApplianceItems = Array.isArray(payload.items) && payload.items.length > 0;
      if (
        !selectedRequestPendingFood &&
        !selectedRequestPendingMonetary &&
        !selectedRequestPendingAppliance
      ) {
        throw new Error("This request has no remaining support to release.");
      }

      if (
        !selectedRequestPendingFood &&
        !selectedRequestPendingMonetary &&
        selectedRequestPendingAppliance &&
        !hasApplianceItems
      ) {
        throw new Error("Add at least one appliance item to release.");
      }

      const releaseFormData = new FormData();
      releaseFormData.append("payload", JSON.stringify(payload));
      releaseProofFiles.forEach((file) => {
        releaseFormData.append("proofFiles", file);
      });

      const res = await axios.post(`${BASE_URL}/api/relief-releases`, releaseFormData, {
        withCredentials: true
      });

      pushNotification(
        res.data?.message || "Release submitted successfully.",
        "success"
      );

      clearReleasePlanner();
      await refreshAll();
    } catch (err) {
      console.error("Release submit error:", err);
      pushNotification(
        err.response?.data?.message || err.message || "Failed to submit release.",
        "error"
      );
    } finally {
      setReleaseSubmitting(false);
    }
  };

  const loadingCurrent =
    (mode === "active" && loadingActive) ||
    (mode === "archived" && loadingArchived);
  
    return (
    <DashboardShell>
      <div className="inventory-page">
        <div className="inventory-shell">
          {typeof document !== "undefined"
  ? createPortal(
      <div className="notification-stack">
        {notifications.map((notification) => (
          <button
            key={notification.id}
            type="button"
            className={`notification-toast ${notification.type}`}
            onClick={() => removeNotification(notification.id)}
          >
            <span className="notification-icon">{getToastIcon(notification.type)}</span>
            <span className="notification-text">{notification.message}</span>
          </button>
        ))}
      </div>,
      document.body
    )
  : null}

          {confirmationDialog && typeof document !== "undefined"
            ? createPortal(
                <div
                  className="inventory-confirm-backdrop"
                  role="presentation"
                  onClick={closeConfirmationDialog}
                >
                  <div
                    className={`inventory-confirm-card ${confirmationDialog.tone || "primary"}`}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="inventory-confirm-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inventory-confirm-head">
                      <span className="inventory-confirm-icon">
                        {confirmationDialog.icon || <FaExclamationTriangle />}
                      </span>
                      <div>
                        <h3 id="inventory-confirm-title">{confirmationDialog.title}</h3>
                        <p>{confirmationDialog.message}</p>
                      </div>
                    </div>

                    <div className="inventory-confirm-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={closeConfirmationDialog}
                        disabled={actionLoading}
                      >
                        {confirmationDialog.cancelLabel || "Cancel"}
                      </button>
                      <button
                        type="button"
                        className={`btn ${
                          confirmationDialog.tone === "danger"
                            ? "btn-danger"
                            : "btn-primary"
                        }`}
                        onClick={confirmDialogAction}
                        disabled={actionLoading}
                      >
                        {actionLoading
                          ? "Working..."
                          : confirmationDialog.confirmLabel || "Confirm"}
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )
            : null}

          <div className="inventory-hero">
            <div className="inventory-hero-head">
              <div className="inventory-title-group">
                <h1 className="inventory-title">
                  {canUseReleasePlanner ? "Inventory & Release Preparation" : "Inventory"}
                </h1>

                <div className="inventory-title-meta">
                  {canUseReleasePlanner && (
                    <span className="inventory-top-pill subtle">
                      {filteredApprovedRequests.length} approved request(s)
                    </span>
                  )}

                  {canManageTemplates && (
                    <span className="inventory-top-pill subtle">
                      {foodPackTemplates.length} active template(s)
                    </span>
                  )}
                </div>
              </div>

              <div className="inventory-hero-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={exportInventoryPdf}
                >
                  <FaFilePdf className="btn-icon" />
                  Export PDF
                </button>

                {canUseReleasePlanner && (
                  <button
                    type="button"
                    className={`btn ${operationsOpen ? "btn-secondary" : "btn-primary"}`}
                    onClick={() => setOperationsOpen((prev) => !prev)}
                  >
                    <FaClipboardCheck className="btn-icon" />
                    {operationsOpen ? "Hide Operations" : "Release Preparation"}
                  </button>
                )}
              </div>
            </div>

            {mode === "active" && (
              <div className="inventory-summary inventory-summary-6">
                <>
                  <div className="summary-card info">
                    <div className="summary-card-top">
                      <span className="summary-label">Monetary Total</span>
                      <span className="summary-icon"><FaMoneyBillWave /></span>
                    </div>
                    <h3 className="summary-value">
                      {formatMoney(activeSummary.totalMonetaryAmount)}
                    </h3>
                    <span className="summary-note">
                      {activeSummary.monetaryCount} monetary record(s)
                    </span>
                  </div>

                  <div className="summary-card summary-card-emphasis success">
                    <div className="summary-card-top">
                      <span className="summary-label">Goods Stock</span>
                      <span className="summary-icon"><FaBoxes /></span>
                    </div>
                    <h3 className="summary-value">
                      {activeSummary.totalGoodsQuantity.toLocaleString()}
                    </h3>
                    <span className="summary-note">
                      {activeSummary.goodsCount} goods record(s)
                    </span>
                  </div>

                  <div className="summary-card accent">
                    <div className="summary-card-top">
                      <span className="summary-label">Food Template Items</span>
                      <span className="summary-icon"><FaUtensils /></span>
                    </div>
                    <h3 className="summary-value">
                      {activeSummary.foodEligibleCount.toLocaleString()}
                    </h3>
                    <span className="summary-note">Eligible for food packs</span>
                  </div>

                  <div className="summary-card muted">
                    <div className="summary-card-top">
                      <span className="summary-label">Appliance Items</span>
                      <span className="summary-icon"><FaBoxOpen /></span>
                    </div>
                    <h3 className="summary-value">
                      {activeSummary.applianceCount.toLocaleString()}
                    </h3>
                    <span className="summary-note">
                      Total quantity: {activeSummary.totalApplianceQuantity.toLocaleString()}
                    </span>
                  </div>

                  <div className="summary-card danger">
                    <div className="summary-card-top">
                      <span className="summary-label">Expired Goods</span>
                      <span className="summary-icon"><FaTimes /></span>
                    </div>
                    <h3 className="summary-value">
                      {activeSummary.expiredCount.toLocaleString()}
                    </h3>
                    <span className="summary-note">Needs review or removal</span>
                  </div>

                  <div className="summary-card warning">
                    <div className="summary-card-top">
                      <span className="summary-label">Expiring Soon</span>
                      <span className="summary-icon"><FaExclamationTriangle /></span>
                    </div>
                    <h3 className="summary-value">
                      {activeSummary.expiringSoonCount.toLocaleString()}
                    </h3>
                    <span className="summary-note">30 days or less</span>
                  </div>
                </>
              </div>
            )}

            {mode === "archived" && (
              <div className="inventory-summary inventory-summary-archived">
                <div className="summary-card muted">
                  <div className="summary-card-top">
                    <span className="summary-label">Archived Records</span>
                    <span className="summary-icon"><FaArchive /></span>
                  </div>
                  <h3 className="summary-value">
                    {archivedSummary.totalRecords.toLocaleString()}
                  </h3>
                  <span className="summary-note">Historical inventory entries</span>
                </div>

                {isDrrmo ? (
                  <>
                    <div className="summary-card success">
                      <div className="summary-card-top">
                        <span className="summary-label">Goods</span>
                        <span className="summary-icon"><FaBoxes /></span>
                      </div>
                      <h3 className="summary-value">
                        {archivedSummary.goodsCount.toLocaleString()}
                      </h3>
                      <span className="summary-note">Archived goods records</span>
                    </div>
                    <div className="summary-card warning">
                      <div className="summary-card-top">
                        <span className="summary-label">Appliances</span>
                        <span className="summary-icon"><FaBoxOpen /></span>
                      </div>
                      <h3 className="summary-value">
                        {archivedSummary.applianceCount.toLocaleString()}
                      </h3>
                      <span className="summary-note">Archived appliance records</span>
                    </div>
                  </>
                ) : null}

                {isAdmin ? (
                  <div className="summary-card info">
                    <div className="summary-card-top">
                      <span className="summary-label">Monetary</span>
                      <span className="summary-icon"><FaFileInvoiceDollar /></span>
                    </div>
                    <h3 className="summary-value">
                      {archivedSummary.monetaryCount.toLocaleString()}
                    </h3>
                    <span className="summary-note">Archived monetary records</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {!canSeeCentralInventory ? (
            <div className="inventory-card inventory-empty-surface">
              <div className="table-empty">
                <h4>Inventory access is not available for this account.</h4>
                <p>This page is for central inventory monitoring only.</p>
              </div>
            </div>
          ) : (
            <>
              {itemEditModalOpen && typeof document !== "undefined"
                ? createPortal(
                    <div
                      className="inventory-modal-backdrop"
                      onClick={closeItemEditModal}
                    >
                      <div
                        className="inventory-modal"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inventory-modal-head">
                          <div>
                            <h3>Edit Inventory Item</h3>
                            <p>Update the selected inventory record.</p>
                          </div>

                          <button
                            type="button"
                            className="inventory-modal-close"
                            onClick={closeItemEditModal}
                            aria-label="Close edit modal"
                          >
                            <FaTimes />
                          </button>
                        </div>

                        <div className="inventory-modal-grid">
                      <div className="release-selection-field">
                        <label>Name</label>
                        <input
                          type="text"
                          name="name"
                          className="input"
                          maxLength={MAX_NAME_LENGTH}
                          value={itemForm.name}
                          onChange={handleItemFormChange}
                        />
                        {itemFormErrors.name ? (
                          <span className="error-text">{itemFormErrors.name}</span>
                        ) : null}
                      </div>

                      <div className="release-selection-field">
                        <label>Type</label>
                        <select
                          name="type"
                          className="input"
                          value={itemForm.type}
                          onChange={handleItemFormChange}
                        >
                          {allowedViewTypes.includes("goods") ? (
                            <option value="goods">Goods</option>
                          ) : null}
                          {allowedViewTypes.includes("appliance") ? (
                            <option value="appliance">Appliance</option>
                          ) : null}
                          {allowedViewTypes.includes("monetary") ? (
                            <option value="monetary">Monetary</option>
                          ) : null}
                        </select>
                      </div>

                      {itemForm.type === "goods" ? (
                        <>
                          <div className="release-selection-field">
                            <label>Category</label>
                            <select
                              name="category"
                              className="input"
                              value={itemForm.category}
                              onChange={handleItemFormChange}
                            >
                              <option value="">Select category</option>
                              {editCategoryOptions.map((category) => (
                                <option key={category} value={category}>
                                  {getCategoryLabel(category)}
                                </option>
                              ))}
                              <option value={CUSTOM_CATEGORY_VALUE}>Other / Custom Category</option>
                            </select>
                            {itemFormErrors.category ? (
                              <span className="error-text">
                                {itemFormErrors.category}
                              </span>
                            ) : null}
                            {itemForm.category === CUSTOM_CATEGORY_VALUE ? (
                              <>
                                <input
                                  type="text"
                                  name="customCategory"
                                  className="input inventory-inline-input"
                                  maxLength={MAX_CUSTOM_CATEGORY_LENGTH}
                                  value={itemForm.customCategory}
                                  onChange={handleItemFormChange}
                                  placeholder="e.g. medicine, water, shelter kits"
                                />
                                {itemFormErrors.customCategory ? (
                                  <span className="error-text">
                                    {itemFormErrors.customCategory}
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                          </div>

                          <div className="release-selection-field">
                            <label>Quantity</label>
                            <input
                              type="number"
                              min="0"
                              max={MAX_QUANTITY}
                              name="quantity"
                              className="input"
                              value={itemForm.quantity}
                              onChange={handleItemFormChange}
                            />
                            {itemFormErrors.quantity ? (
                              <span className="error-text">
                                {itemFormErrors.quantity}
                              </span>
                            ) : null}
                          </div>

                          <div className="release-selection-field">
                            <label>Unit</label>
                            <select
                              name="unitSelect"
                              className="input"
                              value={selectedEditUnitValue}
                              onChange={handleItemFormChange}
                            >
                              <option value="">Select unit</option>
                              {editUnitOptions.map((unit) => (
                                <option key={unit} value={unit}>
                                  {getCategoryLabel(unit)}
                                </option>
                              ))}
                              <option value={CUSTOM_UNIT_VALUE}>Other / Custom Unit</option>
                            </select>
                            {selectedEditUnitValue === CUSTOM_UNIT_VALUE ? (
                              <input
                                type="text"
                                name="unit"
                                className="input inventory-inline-input"
                                maxLength={MAX_UNIT_LENGTH}
                                value={itemForm.unit}
                                onChange={handleItemFormChange}
                                placeholder="e.g. tray, bundle, pair"
                              />
                            ) : null}
                            {itemFormErrors.unit ? (
                              <span className="error-text">{itemFormErrors.unit}</span>
                            ) : null}
                          </div>

                          <div className="release-selection-field">
                            <label>
                              Expiration Date{" "}
                              {isExpiryRequiredCategory(itemForm.category) ? "*" : ""}
                            </label>
                            <input
                              type="date"
                              name="expirationDate"
                              className="input"
                              value={itemForm.expirationDate}
                              min={minExpirationDate}
                              onChange={handleItemFormChange}
                            />
                            {itemFormErrors.expirationDate ? (
                              <span className="error-text">
                                {itemFormErrors.expirationDate}
                              </span>
                            ) : null}
                          </div>
                        </>
                      ) : itemForm.type === "appliance" ? (
                        <>
                          <div className="release-selection-field">
                            <label>Category</label>
                            <select
                              name="category"
                              className="input"
                              value={itemForm.category}
                              onChange={handleItemFormChange}
                            >
                              <option value="">Select category</option>
                              {editCategoryOptions.map((category) => (
                                <option key={category} value={category}>
                                  {getCategoryLabel(category)}
                                </option>
                              ))}
                              <option value={CUSTOM_CATEGORY_VALUE}>Other / Custom Category</option>
                            </select>
                            {itemFormErrors.category ? (
                              <span className="error-text">
                                {itemFormErrors.category}
                              </span>
                            ) : null}
                            {itemForm.category === CUSTOM_CATEGORY_VALUE ? (
                              <>
                                <input
                                  type="text"
                                  name="customCategory"
                                  className="input inventory-inline-input"
                                  maxLength={MAX_CUSTOM_CATEGORY_LENGTH}
                                  value={itemForm.customCategory}
                                  onChange={handleItemFormChange}
                                  placeholder="e.g. radio equipment"
                                />
                                {itemFormErrors.customCategory ? (
                                  <span className="error-text">
                                    {itemFormErrors.customCategory}
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                          </div>

                          <div className="release-selection-field">
                            <label>Quantity</label>
                            <input
                              type="number"
                              min="0"
                              max={MAX_QUANTITY}
                              name="quantity"
                              className="input"
                              value={itemForm.quantity}
                              onChange={handleItemFormChange}
                            />
                            {itemFormErrors.quantity ? (
                              <span className="error-text">
                                {itemFormErrors.quantity}
                              </span>
                            ) : null}
                          </div>

                          <div className="release-selection-field">
                            <label>Condition</label>
                            <select
                              name="condition"
                              className="input"
                              value={itemForm.condition}
                              onChange={handleItemFormChange}
                            >
                              <option value="brand_new">Brand New</option>
                              <option value="used_item">Used Item</option>
                            </select>
                            {itemFormErrors.condition ? (
                              <span className="error-text">{itemFormErrors.condition}</span>
                            ) : null}
                          </div>

                          <div className="release-selection-field">
                            <label>Usage Duration</label>
                            <input
                              type="text"
                              name="usageDuration"
                              className="input"
                              value={itemForm.usageDuration}
                              onChange={handleItemFormChange}
                              disabled={itemForm.condition !== "used_item"}
                            />
                            {itemFormErrors.usageDuration ? (
                              <span className="error-text">
                                {itemFormErrors.usageDuration}
                              </span>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="release-selection-field">
                            <label>Amount</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              max={MAX_AMOUNT}
                              name="amount"
                              className="input"
                              value={itemForm.amount}
                              onChange={handleItemFormChange}
                            />
                            {itemFormErrors.amount ? (
                              <span className="error-text">{itemFormErrors.amount}</span>
                            ) : null}
                          </div>

                          <div className="release-selection-field">
                            <label>Reference Number</label>
                            <input
                              type="text"
                              name="referenceNumber"
                              className="input"
                              value={itemForm.referenceNumber}
                              onChange={handleItemFormChange}
                            />
                            {itemFormErrors.referenceNumber ? (
                              <span className="error-text">{itemFormErrors.referenceNumber}</span>
                            ) : null}
                          </div>
                        </>
                      )}

                      <div className="release-selection-field">
                        <label>Source Type</label>
                        <select
                          name="sourceType"
                          className="input"
                          value={itemForm.sourceType}
                          onChange={handleItemFormChange}
                        >
                          <option value="external">External</option>
                          <option value="government">Government</option>
                          <option value="internal">Internal</option>
                        </select>
                      </div>

                      <div className="release-selection-field">
                        <label>Source Name</label>
                        <input
                          type="text"
                          name="sourceName"
                          className="input"
                          maxLength={MAX_SOURCE_NAME_LENGTH}
                          value={itemForm.sourceName}
                          onChange={handleItemFormChange}
                        />
                        {itemFormErrors.sourceName ? (
                          <span className="error-text">{itemFormErrors.sourceName}</span>
                        ) : null}
                      </div>

                      <div className="release-selection-field release-selection-field-wide">
                        <label>Description</label>
                        <textarea
                          name="description"
                          className="release-textarea"
                          maxLength={MAX_DESCRIPTION_LENGTH}
                          value={itemForm.description}
                          onChange={handleItemFormChange}
                        />
                        <div className="inventory-textarea-meta">
                          <span>{String(itemForm.description || "").length}/{MAX_DESCRIPTION_LENGTH}</span>
                        </div>
                        {itemFormErrors.description ? (
                          <span className="error-text">{itemFormErrors.description}</span>
                        ) : null}
                      </div>
                        </div>

                        <div className="inventory-modal-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={closeItemEditModal}
                            disabled={itemEditSubmitting}
                          >
                            <FaTimes className="btn-icon" />
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={saveItemEdit}
                            disabled={itemEditSubmitting}
                          >
                            <FaCheck className="btn-icon" />
                            {itemEditSubmitting ? "Saving..." : "Save Changes"}
                          </button>
                        </div>
                      </div>
                    </div>,
                    document.body
                  )
                : null}

              {canUseReleasePlanner && operationsOpen && (
                <div className="inventory-operations-stack">
                  {canManageTemplates && viewType === "goods" && mode === "active" && (
                    <div className="inventory-card release-shell">
                      <div className="release-shell-head">
                        <div>
                          <h2>Food Pack Templates</h2>
                          <p>
                            Build reusable food pack templates using food goods only.
                          </p>
                        </div>

                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={openCreateTemplateModal}
                      >
                        <FaPlus className="btn-icon" />
                        Create Template
                      </button>
                      </div>

                      {loadingTemplates ? (
                        <div className="release-empty">Loading templates...</div>
                      ) : foodPackTemplates.length === 0 ? (
                        <div className="release-empty">
                          No food pack templates yet. Create your first template.
                        </div>
                      ) : (
                        <>
                          <div className="template-card-grid">
                            {paginatedTemplates.map((template) => {
                              const templateHealth =
                                templateHealthById[String(template._id)] || {
                                  lowCount: 0,
                                  expiringCount: 0,
                                  expiredCount: 0,
                                };

                              return (
                                <button
                                  type="button"
                                  key={template._id}
                                  className={`template-summary-card ${
                                    selectedTemplateCardId === template._id ? "active" : ""
                                  }`}
                                  onClick={() =>
                                    setSelectedTemplateCardId((prev) =>
                                      prev === template._id ? "" : template._id
                                    )
                                  }
                                >
                                  <div className="template-summary-top">
                                    <div>
                                      <strong>{template.name}</strong>
                                      <span>{template.description || "No description."}</span>
                                    </div>

                                    <div className="template-summary-pill-stack">
                                      <span className="badge available">
                                        {(template.items || []).length} Item(s)
                                      </span>
                                      {templateHealth.lowCount > 0 ? (
                                        <span className="badge low">
                                          {templateHealth.lowCount} Low
                                        </span>
                                      ) : null}
                                      {templateHealth.expiringCount > 0 ? (
                                        <span className="badge badge-expiry-soon">
                                          {templateHealth.expiringCount} Expiring
                                        </span>
                                      ) : null}
                                      {templateHealth.expiredCount > 0 ? (
                                        <span className="badge badge-expiry-expired">
                                          {templateHealth.expiredCount} Expired
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className="template-summary-meta">
                                    <div>
                                      <label>Created By</label>
                                      <b>{template.createdBy || "-"}</b>
                                    </div>
                                    <div>
                                      <label>Updated By</label>
                                      <b>{template.updatedBy || "-"}</b>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          {templatePageCount > 1 && (
                            <div className="pager">
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={templatePage === 1}
                                onClick={() => setTemplatePage((prev) => prev - 1)}
                              >
                                Prev
                              </button>
                              <span>
                                Page {templatePage} of {templatePageCount}
                              </span>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={templatePage === templatePageCount}
                                onClick={() => setTemplatePage((prev) => prev + 1)}
                              >
                                Next
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {selectedTemplateCard ? (
                        <div className="template-detail-panel">
                          <div className="template-detail-head">
                            <div>
                              <h3>{selectedTemplateCard.name}</h3>
                              <p>
                                {selectedTemplateCard.description || "No description."}
                              </p>
                              <div className="template-detail-summary">
                                <span className="badge available">
                                  {(selectedTemplateCard.items || []).length} Item(s)
                                </span>
                                {selectedTemplateCardHealth.lowCount > 0 ? (
                                  <span className="badge low">
                                    {selectedTemplateCardHealth.lowCount} Low
                                  </span>
                                ) : null}
                                {selectedTemplateCardHealth.expiringCount > 0 ? (
                                  <span className="badge badge-expiry-soon">
                                    {selectedTemplateCardHealth.expiringCount} Expiring
                                  </span>
                                ) : null}
                                {selectedTemplateCardHealth.expiredCount > 0 ? (
                                  <span className="badge badge-expiry-expired">
                                    {selectedTemplateCardHealth.expiredCount} Expired
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="row-actions">
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => openEditTemplateModal(selectedTemplateCard)}
                          >
                                <FaEdit className="btn-icon" />
                                Edit Template
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger"
                                disabled={actionLoading}
                                onClick={() => archiveTemplate(selectedTemplateCard._id)}
                              >
                                <FaArchive className="btn-icon" />
                                Archive Template
                              </button>
                            </div>
                          </div>

                          <div className="table-wrapper">
                            <table className="inventory-table">
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  <th>Category</th>
                                  <th>Per Pack</th>
                                  <th>Available</th>
                                  <th>Unit</th>
                                  <th>Expiration</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(selectedTemplateCard.items || []).length === 0 ? (
                                  <tr>
                                    <td colSpan="7">No template items found.</td>
                                  </tr>
                                ) : (
                                  selectedTemplateCardHealth.itemHealth.map((entry, index) => (
                                    <tr key={`${entry.item?.inventoryItemId}-${index}`}>
                                      <td>{entry.item?.itemName || "-"}</td>
                                      <td>{getCategoryLabel(entry.item?.category)}</td>
                                      <td>{Number(entry.item?.quantityPerPack || 0)}</td>
                                      <td>
                                        <span
                                          className={`badge ${getStockBadgeClass(
                                            entry.availableQuantity
                                          )}`}
                                        >
                                          {Number(entry.availableQuantity || 0)}
                                        </span>
                                      </td>
                                      <td>{entry.inventoryItem?.unit || entry.item?.unit || "-"}</td>
                                      <td>
                                        <div className="expiry-cell-stack">
                                          <span>
                                            {formatExpiryDate(
                                              entry.inventoryItem?.expirationDate
                                            )}
                                          </span>
                                          {entry.expiryStatus === "soon" ||
                                          entry.expiryStatus === "expired" ? (
                                            <span
                                              className={`badge ${getExpiryBadgeClass(
                                                entry.inventoryItem
                                              )}`}
                                            >
                                              {getExpiryBadgeLabel(entry.inventoryItem)}
                                            </span>
                                          ) : null}
                                        </div>
                                      </td>
                                      <td>
                                        <div className="template-row-status">
                                          {entry.isLow ? (
                                            <span
                                              className={`badge ${getStockBadgeClass(
                                                entry.availableQuantity
                                              )}`}
                                            >
                                              Low
                                            </span>
                                          ) : (
                                            <span className="muted-text">Ready</span>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className="inventory-card release-shell">
                    <div className="release-shell-head">
                      <div>
                        <h2>Release Preparation</h2>
                      </div>

                      <button
                        type="button"
                        className={`btn ${plannerOpen ? "btn-secondary" : "btn-outline"}`}
                        onClick={() => setPlannerOpen((prev) => !prev)}
                      >
                        <FaClipboardList className="btn-icon" />
                        {plannerOpen ? "Collapse" : "Open Planner"}
                      </button>
                    </div>

                    {plannerOpen ? (
                      <div className="release-layout">
                        <aside className="release-queue">
                          <div className="release-queue-head">
                            <h3>Approved Requests</h3>
                            <span>{filteredApprovedRequests.length}</span>
                          </div>

                          <div className="release-queue-filter">
                            <label className="release-selection-field">
                              <span>Barangay</span>
                              <select
                                className="input"
                                value={releaseBarangayFilter}
                                onChange={(e) => setReleaseBarangayFilter(e.target.value)}
                              >
                                <option value="">All Barangays</option>
                                {barangayOptions.map((barangay) => (
                                  <option key={barangay} value={barangay}>
                                    {barangay}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          {loadingReleaseQueue ? (
                            <div className="release-empty">Loading requests...</div>
                          ) : filteredApprovedRequests.length === 0 ? (
                            <div className="release-empty">
                              No approved requests found.
                            </div>
                          ) : (
                            <div className="release-request-list">
                              {filteredApprovedRequests.map((request) => {
                                const isActive =
                                  String(request._id) === String(selectedReleaseRequestId);
                                const requestSupportTypes = getRequestSupportTypes(request);
                                const requestNeedsFood = hasSupportType(
                                  requestSupportTypes,
                                  SUPPORT_TYPE_FOODPACKS
                                );
                                const requestNeedsMonetary = hasSupportType(
                                  requestSupportTypes,
                                  SUPPORT_TYPE_MONETARY
                                );
                                const requestNeedsAppliance = hasSupportType(
                                  requestSupportTypes,
                                  SUPPORT_TYPE_APPLIANCE
                                );

                                return (
                                  <button
                                    type="button"
                                    key={request._id}
                                    className={`release-request-card ${
                                      isActive ? "active" : ""
                                    }`}
                                    onClick={() => setSelectedReleaseRequestId(request._id)}
                                  >
                                    <strong>{request.barangayName || "-"}</strong>
                                    <span>{request.disaster || "-"}</span>
                                    <small>{request.requestNo || "-"}</small>

                                    <div className="release-request-support">
                                      {getRequestTypeLabel(request)}
                                    </div>

                                    <div className="release-request-meta release-request-meta-compact">
                                      {requestNeedsFood ? (
                                        <b>{getRequestedPackCount(request)} packs</b>
                                      ) : null}
                                      {requestNeedsMonetary ? (
                                        <b>{formatMoney(getRemainingMonetaryAmount(request))}</b>
                                      ) : null}
                                      {requestNeedsAppliance ? (
                                        <b>
                                          {getRequestedApplianceQuantity(request)} appliance
                                          {getRequestedApplianceQuantity(request) === 1 ? "" : "s"}
                                        </b>
                                      ) : null}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </aside>

                        <section className="release-main">
                          {!selectedReleaseRequest ? (
                            <div className="release-empty release-empty-main">
                              Select a request to prepare a release.
                            </div>
                          ) : (
                            <>
                              <div className="release-summary-bar release-summary-bar-journey">
                                <div className="release-summary-card release-summary-card-feature">
                                  <span>Request</span>
                                  <strong>{selectedReleaseRequest.requestNo}</strong>
                                  <small>
                                    {selectedReleaseRequest.barangayName} •{" "}
                                    {getRequestTypeLabel(selectedReleaseRequest)}
                                  </small>
                                </div>
                                <div className="release-summary-card">
                                  <span>Journey</span>
                                  <strong>
                                    Step {Math.max(currentStepIndex + 1, 1)} of{" "}
                                    {releaseJourneySteps.length}
                                  </strong>
                                  <small>{activeJourneyMeta.shortLabel}</small>
                                </div>
                                <div className="release-summary-card">
                                  <span>Required Packs</span>
                                  <strong>
                                    {selectedRequestNeedsFood
                                      ? selectedRemainingFoodPacks
                                      : "-"}
                                  </strong>
                                </div>
                                <div className="release-summary-card">
                                  <span>Required Monetary</span>
                                  <strong>
                                    {selectedRequestNeedsMonetary
                                      ? formatMoney(selectedRemainingMonetaryAmount)
                                      : "-"}
                                  </strong>
                                </div>
                                <div className="release-summary-card">
                                  <span>Required Appliances</span>
                                  <strong>
                                    {selectedRequestNeedsAppliance
                                      ? selectedRemainingApplianceQuantity
                                      : "-"}
                                  </strong>
                                </div>
                              </div>

                              <div className="release-journey-card">
                                <div className="release-journey-head">
                                  <div>
                                    <h3>Release Journey</h3>
                                    <p>
                                      Complete each required support step before moving to the
                                      next release stage.
                                    </p>
                                  </div>
                                </div>

                                <div className="release-journey-steps">
                                  {releaseJourneySteps.map((step, index) => {
                                    const meta = getJourneyStepMeta(step);
                                    const isActive = activeJourneyStep === step;
                                    const isCompleted = completedJourneySteps.includes(step);
                                    const priorSteps = releaseJourneySteps.slice(0, index);
                                    const isUnlocked = priorSteps.every(
                                      (priorStep) =>
                                        priorStep === "review" ||
                                        completedJourneySteps.includes(priorStep)
                                    );

                                    return (
                                      <button
                                        key={step}
                                        type="button"
                                        className={[
                                          "release-journey-step",
                                          isActive ? "active" : "",
                                          isCompleted ? "complete" : "",
                                          !isUnlocked ? "locked" : "",
                                        ]
                                          .filter(Boolean)
                                          .join(" ")}
                                        onClick={() => jumpToJourneyStep(step)}
                                        disabled={
                                          !isUnlocked || (step === "review" && !canOpenReviewStep)
                                        }
                                      >
                                        <span className="release-journey-step-index">
                                          {isCompleted && step !== "review" ? (
                                            <FaCheck />
                                          ) : (
                                            index + 1
                                          )}
                                        </span>
                                        <span className="release-journey-step-copy">
                                          <strong>{meta.shortLabel}</strong>
                                          <small>{meta.title}</small>
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {activeJourneyStep === "food" ? (
                                <div className="release-panel release-journey-panel">
                                  <div className="release-panel-head release-panel-head-simple">
                                    <div>
                                      <h3>{activeJourneyMeta.title}</h3>
                                      <p className="release-panel-copy">
                                        {activeJourneyMeta.description}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="template-config-grid">
                                    <div className="release-selection-field">
                                      <label>Template</label>
                                      <select
                                        className="input"
                                        value={selectedTemplateId}
                                        onChange={(e) =>
                                          handleTemplateSelectionChange(e.target.value)
                                        }
                                      >
                                        <option value="">Select template</option>
                                        {foodPackTemplates.map((template) => (
                                          <option key={template._id} value={template._id}>
                                            {template.name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    <div className="release-selection-field">
                                      <label>Food Packs to Release</label>
                                      <input
                                        type="number"
                                        min="1"
                                        className="input"
                                        value={foodPacksToRelease}
                                        onChange={(e) => setFoodPacksToRelease(e.target.value)}
                                      />
                                    </div>

                                    <div className="release-selection-field">
                                      <label>Required Food Packs</label>
                                      <div className="release-static-value">
                                        {selectedRemainingFoodPacks}
                                      </div>
                                    </div>
                                  </div>

                                  {selectedTemplate ? (
                                    <div className="template-preview-wrap">
                                      <div className="template-preview-head">
                                        <strong>{selectedTemplate.name}</strong>
                                        <span>
                                          {selectedTemplate.description || "No description."}
                                        </span>
                                      </div>

                                      {computedTemplateItems.length === 0 ? (
                                        <div className="release-empty">
                                          Enter the exact required food pack count to preview
                                          the generated release items.
                                        </div>
                                      ) : (
                                        <div className="table-wrapper">
                                          <table className="inventory-table release-table">
                                            <thead>
                                              <tr>
                                                <th>Item</th>
                                                <th>Category</th>
                                                <th>Per Pack</th>
                                                <th>Total Release</th>
                                                <th>Unit</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {computedTemplateItems.map((item, index) => (
                                                <tr key={`${item.itemName}-${index}`}>
                                                  <td>{item.itemName}</td>
                                                  <td>{getCategoryLabel(item.category)}</td>
                                                  <td>{item.quantityPerPack}</td>
                                                  <td>{item.quantityReleased}</td>
                                                  <td>{item.unit || "-"}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="release-empty">
                                      Select a food pack template to continue.
                                    </div>
                                  )}

                                  <div className="release-step-actions">
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      onClick={clearReleasePlanner}
                                      disabled={releaseSubmitting}
                                    >
                                      <FaTimes className="btn-icon" />
                                      Clear
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-primary"
                                      onClick={goToNextJourneyStep}
                                      disabled={!journeyCompletionState.food}
                                    >
                                      Continue to {getJourneyStepMeta(nextJourneyStep).shortLabel}
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              {activeJourneyStep === "monetary" ? (
                                <div className="release-panel release-journey-panel">
                                  <div className="release-panel-head release-panel-head-simple">
                                    <div>
                                      <h3>{activeJourneyMeta.title}</h3>
                                      <p className="release-panel-copy">
                                        {activeJourneyMeta.description}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="template-config-grid">
                                    <div className="release-selection-field">
                                      <label>Requested Monetary Amount</label>
                                      <div className="release-static-value">
                                        {formatMoney(
                                          getRequestedMonetaryAmount(selectedReleaseRequest)
                                        )}
                                      </div>
                                    </div>

                                    <div className="release-selection-field">
                                      <label>Remaining Monetary</label>
                                      <div className="release-static-value">
                                        {formatMoney(selectedRemainingMonetaryAmount)}
                                      </div>
                                    </div>

                                    <div className="release-selection-field">
                                      <label>Release Monetary Amount</label>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="input"
                                        value={releaseMonetaryAmount}
                                        onChange={(e) => setReleaseMonetaryAmount(e.target.value)}
                                      />
                                    </div>
                                  </div>

                                  <div className="release-empty release-empty-inline">
                                    The full approved monetary amount must be planned before
                                    proceeding to the next step.
                                  </div>

                                  <div className="release-step-actions">
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      onClick={goToPreviousJourneyStep}
                                    >
                                      Back
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-primary"
                                      onClick={goToNextJourneyStep}
                                      disabled={!journeyCompletionState.monetary}
                                    >
                                      Continue to {getJourneyStepMeta(nextJourneyStep).shortLabel}
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              {activeJourneyStep === "appliance" ? (
                                <div className="release-panel release-journey-panel">
                                  <div className="release-panel-head release-panel-head-simple">
                                    <div>
                                      <h3>{activeJourneyMeta.title}</h3>
                                      <p className="release-panel-copy">
                                        {activeJourneyMeta.description}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="release-mode-layout release-mode-layout-journey">
                                    <div className="release-panel release-panel-nested">
                                      <div className="release-panel-head release-panel-head-simple compact">
                                        <div>
                                          <h3>Requested Appliances</h3>
                                          <span>
                                            {selectedRemainingApplianceQuantity} unit(s) still
                                            needed
                                          </span>
                                        </div>
                                      </div>

                                      {Array.isArray(selectedReleaseRequest?.requestedAppliances) &&
                                      selectedReleaseRequest.requestedAppliances.length > 0 ? (
                                        <div className="release-appliance-request-list release-appliance-request-scroll">
                                          {selectedReleaseRequest.requestedAppliances.map(
                                            (item, index) => (
                                              <div
                                                className="release-appliance-request-card"
                                                key={`${item.itemName}-${index}`}
                                              >
                                                <div className="release-appliance-request-main">
                                                  <strong>{item.itemName || "-"}</strong>
                                                  <span>{getCategoryLabel(item.category)}</span>
                                                  <small>{item.remarks || "No remarks"}</small>
                                                </div>
                                                <div className="release-appliance-request-meta">
                                                  <b className="release-appliance-qty-badge">
                                                    {Number(item.quantityRequested || 0)} unit(s)
                                                  </b>
                                                </div>
                                              </div>
                                            )
                                          )}
                                        </div>
                                      ) : (
                                        <div className="release-empty release-empty-compact">
                                          No requested appliance details available.
                                        </div>
                                      )}

                                      <div className="release-panel-head release-panel-head-simple compact">
                                        <div>
                                          <h3>Available Appliances</h3>
                                        </div>
                                        <input
                                          type="text"
                                          className="input"
                                          placeholder="Search appliance, category, source..."
                                          value={applianceSearch}
                                          onChange={(e) => setApplianceSearch(e.target.value)}
                                        />
                                      </div>

                                      {applianceCatalog.length === 0 ? (
                                        <div className="release-empty">
                                          No appliance items found.
                                        </div>
                                      ) : (
                                        <div className="template-builder-list-wrap appliance-builder-list-wrap">
                                          <div className="template-builder-list">
                                            {applianceCatalog.map((item) => {
                                              const selectionId =
                                                item._id ||
                                                item._mergeKey ||
                                                buildGoodsMergeKey(item);

                                              const alreadyAdded = applianceSelections.some(
                                                (selection) =>
                                                  String(selection.inventoryItemId) ===
                                                  String(selectionId)
                                              );

                                              return (
                                                <div
                                                  className="template-source-row appliance-source-row"
                                                  key={selectionId}
                                                >
                                                  <div className="template-source-main appliance-source-main">
                                                    <strong>{item.name || "-"}</strong>
                                                    <span>
                                                      {getCategoryLabel(item.category)}
                                                    </span>
                                                  </div>

                                                  <div className="template-source-meta appliance-source-meta">
                                                    <span className="appliance-source-qty-badge">
                                                      {Number(item.quantity || 0)} {item.unit || "unit(s)"}
                                                    </span>
                                                  </div>

                                                  <button
                                                    type="button"
                                                    className="btn btn-outline btn-sm template-add-btn"
                                                    onClick={() => addApplianceReleaseItem(item)}
                                                    disabled={alreadyAdded}
                                                  >
                                                    <FaPlus className="btn-icon" />
                                                    {alreadyAdded ? "Added" : "Add"}
                                                  </button>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    <div className="release-panel release-panel-nested">
                                      <div className="release-panel-head release-panel-head-simple compact">
                                        <div>
                                          <h3>Appliance Release List</h3>
                                          <span>
                                            {applianceSelections.length} item(s) selected
                                          </span>
                                        </div>
                                      </div>

                                      {applianceSelections.length === 0 ? (
                                        <div className="release-empty release-empty-compact">
                                          Add appliance items that will be included in this
                                          release.
                                        </div>
                                      ) : (
                                        <div className="release-selection-list template-builder-selection-list appliance-release-selection-list">
                                          {applianceSelections.map((item) => (
                                            <div
                                              className="release-selection-card compact-template-card"
                                              key={item.inventoryItemId}
                                            >
                                              <div className="release-selection-head compact-template-head">
                                                <div>
                                                  <strong>{item.itemName}</strong>
                                                  <span>
                                                    {getCategoryLabel(item.category)} • {item.unit}
                                                  </span>
                                                </div>

                                                <button
                                                  type="button"
                                                  className="btn btn-danger btn-sm"
                                                  onClick={() =>
                                                    removeApplianceSelection(item.inventoryItemId)
                                                  }
                                                >
                                                  <FaTimes className="btn-icon" />
                                                  Remove
                                                </button>
                                              </div>

                                              <div className="release-selection-grid appliance-selection-grid">
                                                <div className="release-selection-field compact-template-field">
                                                  <label>Available</label>
                                                  <div className="release-static-value">
                                                    {item.availableQuantity}
                                                  </div>
                                                </div>

                                                <div className="release-selection-field compact-template-field">
                                                  <label>Release Qty</label>
                                                  <input
                                                    type="number"
                                                    min="0"
                                                    className="input"
                                                    value={item.quantityReleased}
                                                    onChange={(e) =>
                                                      updateApplianceSelection(
                                                        item.inventoryItemId,
                                                        "quantityReleased",
                                                        e.target.value
                                                      )
                                                    }
                                                  />
                                                </div>

                                                <div className="release-selection-field appliance-remarks-field">
                                                  <label>Remarks</label>
                                                  <input
                                                    type="text"
                                                    className="input"
                                                    value={item.remarks}
                                                    onChange={(e) =>
                                                      updateApplianceSelection(
                                                        item.inventoryItemId,
                                                        "remarks",
                                                        e.target.value
                                                      )
                                                    }
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      <div className="release-appliance-step-total">
                                        <span>Planned appliance quantity</span>
                                        <strong>{releasePreviewSummary.applianceUnits}</strong>
                                        <small>
                                          Required: {selectedRemainingApplianceQuantity} unit(s)
                                        </small>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="release-step-actions">
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      onClick={goToPreviousJourneyStep}
                                    >
                                      Back
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-primary"
                                      onClick={goToNextJourneyStep}
                                      disabled={!journeyCompletionState.appliance}
                                    >
                                      Continue to {getJourneyStepMeta(nextJourneyStep).shortLabel}
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              {activeJourneyStep === "review" ? (
                                <div className="release-panel release-journey-panel">
                                  <div className="release-panel-head release-panel-head-simple">
                                    <div>
                                      <h3>{activeJourneyMeta.title}</h3>
                                      <p className="release-panel-copy">
                                        {activeJourneyMeta.description}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="release-review-grid">
                                    {releaseJourneySteps
                                      .filter((step) => step !== "review")
                                      .map((step) => {
                                        const meta = getJourneyStepMeta(step);
                                        return (
                                          <div
                                            key={step}
                                            className={`release-review-card ${
                                              journeyCompletionState[step]
                                                ? "complete"
                                                : "pending"
                                            }`}
                                          >
                                            <span>{meta.shortLabel}</span>
                                            <strong>
                                              {journeyCompletionState[step]
                                                ? "Ready"
                                                : "Needs attention"}
                                            </strong>
                                            <small>{meta.description}</small>
                                          </div>
                                        );
                                      })}
                                  </div>

                                  <div className="release-remarks-wrap">
                                    <label>Release Remarks</label>
                                    <textarea
                                      className="release-textarea"
                                      value={releaseRemarks}
                                      onChange={(e) => setReleaseRemarks(e.target.value)}
                                      placeholder="Add notes for this release..."
                                    />
                                  </div>

                                  <div className="release-proof-review-card">
                                    <div className="release-proof-review-head">
                                      <div>
                                        <label>Release Proof</label>
                                        <p>
                                          Attach at least one image showing the prepared release
                                          before submitting.
                                        </p>
                                      </div>

                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => releaseProofInputRef.current?.click()}
                                        disabled={releaseSubmitting}
                                      >
                                        <FaPlus className="btn-icon" />
                                        Add Image
                                      </button>
                                    </div>

                                    <input
                                      ref={releaseProofInputRef}
                                      type="file"
                                      accept="image/*"
                                      multiple
                                      className="release-proof-input"
                                      onChange={handleReleaseProofFileSelect}
                                    />

                                    {releaseProofPreviews.length ? (
                                      <div className="release-proof-preview-grid">
                                        {releaseProofPreviews.map((proof) => (
                                          <div
                                            key={proof.key}
                                            className="release-proof-preview-card"
                                          >
                                            <img
                                              src={proof.previewUrl}
                                              alt={proof.name}
                                              className="release-proof-preview-image"
                                            />
                                            <div className="release-proof-preview-meta">
                                              <strong>{proof.name}</strong>
                                              <span>
                                                {(proof.file.size / (1024 * 1024)).toFixed(2)} MB
                                              </span>
                                            </div>
                                            <button
                                              type="button"
                                              className="release-proof-remove"
                                              onClick={() => removeReleaseProofFile(proof.key)}
                                              aria-label={`Remove ${proof.name}`}
                                            >
                                              <FaTimes />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="release-proof-empty">
                                        No release proof images added yet.
                                      </div>
                                    )}
                                  </div>

                                  <div className="release-submit-row">
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      onClick={clearReleasePlanner}
                                      disabled={releaseSubmitting}
                                    >
                                      <FaTimes className="btn-icon" />
                                      Clear
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      onClick={goToPreviousJourneyStep}
                                      disabled={releaseSubmitting}
                                    >
                                      Back
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      onClick={() => setPlannerOpen(false)}
                                      disabled={releaseSubmitting}
                                    >
                                      <FaTimes className="btn-icon" />
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-primary release-submit-btn"
                                      onClick={submitRelease}
                                      disabled={
                                        releaseSubmitting ||
                                        !canSubmitReleasePlan ||
                                        releaseProofFiles.length === 0
                                      }
                                    >
                                      <FaClipboardCheck className="btn-icon" />
                                      {releaseSubmitting
                                        ? "Submitting..."
                                        : "Submit Release"}
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              <div className="release-footer-card release-footer-sticky">
                                <div className="release-footer-head">
                                  <div>
                                    <h3>Release Summary</h3>
                                    <p>
                                      This summary stays visible while you complete each release
                                      step.
                                    </p>
                                  </div>
                                </div>

                                <div className="release-footer-grid">
                                  <div className="release-footer-box">
                                    <span>Line Items</span>
                                    <strong>{releasePreviewSummary.lineItems}</strong>
                                  </div>
                                  <div className="release-footer-box">
                                    <span>Total Quantity</span>
                                    <strong>{releasePreviewSummary.totalQuantity}</strong>
                                  </div>
                                  <div className="release-footer-box">
                                    <span>Food Packs</span>
                                    <strong>
                                      {selectedRequestPendingFood
                                        ? releasePreviewSummary.packCount
                                        : "-"}
                                    </strong>
                                  </div>
                                  <div className="release-footer-box">
                                    <span>Monetary</span>
                                    <strong>
                                      {selectedRequestPendingMonetary
                                        ? formatMoney(releasePreviewSummary.totalMonetary)
                                        : "-"}
                                    </strong>
                                  </div>
                                  <div className="release-footer-box">
                                    <span>Appliances</span>
                                    <strong>
                              {selectedRequestPendingAppliance
                                        ? releasePreviewSummary.applianceUnits
                                        : "-"}
                                    </strong>
                                  </div>
                                </div>

                                {!canSubmitReleasePlan || releaseProofFiles.length === 0 ? (
                                  <div className="release-empty release-empty-inline">
                                    {!canSubmitReleasePlan
                                      ? "Complete each required step before reviewing and submitting the final release."
                                      : "Attach at least one release proof image before submitting the final release."}
                                  </div>
                                ) : null}
                              </div>
                            </>
                          )}
                        </section>
                      </div>
                    ) : null}

                  </div>
                </div>
              )}

              <div className="mode-switch inventory-mode-switch-compact">
                <button
                  type="button"
                  className={mode === "active" ? "active" : ""}
                  onClick={() => setMode("active")}
                >
                  <FaBoxes className="btn-icon" />
                  Active
                </button>
                <button
                  type="button"
                  className={mode === "archived" ? "active" : ""}
                  onClick={() => setMode("archived")}
                >
                  <FaArchive className="btn-icon" />
                  Archived
                </button>
              </div>

              <div className="inventory-card inventory-workspace">
                <div className="inventory-toolbar">
                  <div className="inventory-toolbar-top inventory-toolbar-top-split inventory-toolbar-top-clean">
                    <div className="inventory-toolbar-left-cluster inventory-toolbar-left-cluster-clean">
                      <div className="type-switch inventory-type-switch-compact">
                        {allowedViewTypes.includes("goods") ? (
                          <button
                            type="button"
                            className={viewType === "goods" ? "active" : ""}
                            onClick={() => setViewType("goods")}
                          >
                            <FaBoxes className="btn-icon" />
                            Goods
                          </button>
                        ) : null}
                        {allowedViewTypes.includes("monetary") ? (
                          <button
                            type="button"
                            className={viewType === "monetary" ? "active" : ""}
                            onClick={() => setViewType("monetary")}
                          >
                            <FaMoneyBillWave className="btn-icon" />
                            Monetary
                          </button>
                        ) : null}
                        {allowedViewTypes.includes("appliance") ? (
                          <button
                            type="button"
                            className={viewType === "appliance" ? "active" : ""}
                            onClick={() => setViewType("appliance")}
                          >
                            <FaBoxOpen className="btn-icon" />
                            Appliances
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="inventory-meta-row">
                      {mode === "active" && viewType === "goods" ? (
                        <div className="type-switch inventory-display-switch inventory-display-switch-right">
                          <button
                            type="button"
                            className={goodsDisplayMode === "all" ? "active" : ""}
                            onClick={() => setGoodsDisplayMode("all")}
                          >
                            <FaLayerGroup className="btn-icon" />
                            See All Items
                          </button>
                          <button
                            type="button"
                            className={goodsDisplayMode === "grouped" ? "active" : ""}
                            onClick={() => setGoodsDisplayMode("grouped")}
                          >
                            <FaFilter className="btn-icon" />
                            Group by Category
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="inventory-controls inventory-controls-clean inventory-controls-expanded">
                    <input
                      type="text"
                      className="input inventory-control-input inventory-control-search"
                      placeholder={
                        viewType === "goods"
                          ? "Search item, category, source, notes..."
                          : viewType === "appliance"
                          ? "Search appliance, category, source, notes..."
                          : "Search donation, source, description..."
                      }
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />

                    {viewType === "goods" || viewType === "appliance" ? (
                      <select
                        className="input inventory-control-select"
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                      >
                        <option value="">All Categories</option>
                        {(mode === "active"
                          ? activeCategoryOptions
                          : archivedCategoryOptions
                        ).map((category) => (
                          <option key={category} value={category}>
                            {getCategoryLabel(category)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="inventory-control-placeholder" />
                    )}

                    {viewType === "goods" ? (
                      <select
                        className="input inventory-control-select"
                        value={expiryStatusFilter}
                        onChange={(e) => setExpiryStatusFilter(e.target.value)}
                      >
                        <option value="">All Expiry</option>
                        <option value="expired">Expired</option>
                        <option value="soon">Expiring Soon</option>
                        <option value="ok">Not expiring</option>
                        <option value="none">No Expiry</option>
                      </select>
                    ) : (
                      <div className="inventory-control-placeholder" />
                    )}

                    <select
                      className="input inventory-control-select"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                    >
                      {viewType === "goods" ? (
                        <>
                          <option value="createdAt">Date</option>
                          <option value="quantity">Quantity</option>
                          <option value="expirationDate">Expiration</option>
                          <option value="name">Name</option>
                        </>
                      ) : viewType === "appliance" ? (
                        <>
                          <option value="createdAt">Date</option>
                          <option value="name">Name</option>
                          <option value="quantity">Quantity</option>
                        </>
                      ) : (
                        <>
                          <option value="createdAt">Date</option>
                          <option value="name">Name</option>
                          <option value="amount">Amount</option>
                        </>
                      )}
                    </select>

                    <select
                      className="input inventory-control-select"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value)}
                    >
                      <option value="desc">Desc</option>
                      <option value="asc">Asc</option>
                    </select>

                    <button
                      type="button"
                      className="btn btn-secondary inventory-clear-btn"
                      onClick={clearFilters}
                    >
                      <FaTimes className="btn-icon" />
                      Clear
                    </button>
                  </div>
                </div>

                {loadingCurrent ? (
                  <div className="release-empty">Loading inventory...</div>
                ) : error ? (
                  <div className="release-feedback error">{error}</div>
                ) : tableRows.length === 0 ? (
                  <div className="inventory-empty-surface table-empty">
                    <h4>No records found.</h4>
                    <p>Try adjusting your filters or search keyword.</p>
                  </div>
                ) : mode === "active" &&
                  viewType === "goods" &&
                  goodsDisplayMode === "grouped" ? (
                  <div className="inventory-category-groups">
                    {groupedGoodsRows.map(([categoryKey, items]) => {
                      const isExpanded = expandedCategories[categoryKey] !== false;

                      return (
                        <div className="inventory-category-card" key={categoryKey}>
                          <button
                            type="button"
                            className="inventory-category-head"
                            onClick={() => toggleCategoryExpanded(categoryKey)}
                          >
                            <div className="inventory-category-head-main">
                              <strong>{getCategoryLabel(categoryKey)}</strong>
                              <span>
                                {items.length} item(s) •{" "}
                                {items.reduce(
                                  (sum, item) => sum + Number(item.quantity || 0),
                                  0
                                )}{" "}
                                total stock
                              </span>
                            </div>
                            <span className="inventory-category-toggle">
                              {isExpanded ? "-" : "+"}
                            </span>
                          </button>

                          {isExpanded ? (
                            <div className="table-wrapper">
                              <table className="inventory-table">
                                <thead>
                                  <tr>
                                    <th>Item</th>
                                    <th>Quantity</th>
                                    <th>Unit</th>
                                    <th>Expiration</th>
                                    <th>Source</th>
                                    <th>Description</th>
                                    <th>Proof</th>
                                    <th>Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map((item) => (
                                    <tr key={item._mergeKey || item._id}>
                                      <td>
                                        <button
                                          type="button"
                                          className="cell-link"
                                          onClick={() => setSelectedItem(item)}
                                        >
                                          <div className="table-main-cell">
                                            <strong>{item.name || "-"}</strong>
                                            <span>{formatDate(item.createdAt)}</span>
                                          </div>
                                        </button>
                                      </td>
                                      <td>
                                        <span
                                          className={`badge ${getStockBadgeClass(
                                            item.quantity
                                          )}`}
                                        >
                                          {Number(item.quantity || 0)}
                                        </span>
                                      </td>
                                      <td>{item.unit || "-"}</td>
                                      <td>
                                        <div className="expiry-cell-stack">
                                          <span>{formatExpiryDate(item.expirationDate)}</span>
                                          {getExpiryBadgeLabel(item) ? (
                                            <span className={`badge ${getExpiryBadgeClass(item)}`}>
                                              {getExpiryBadgeLabel(item)}
                                            </span>
                                          ) : null}
                                        </div>
                                      </td>
                                      <td>
                                        <div className="table-mini-stack">
                                          <strong>
                                            {Array.isArray(item._sourceTypes) &&
                                            item._sourceTypes.length > 0
                                              ? item._sourceTypes
                                                  .map((value) => getSourceLabel(value))
                                                  .join(", ")
                                              : getSourceLabel(item.sourceType)}
                                          </strong>
                                          <span>
                                            {Array.isArray(item._sourceNames) &&
                                            item._sourceNames.length > 0
                                              ? item._sourceNames.join(", ")
                                              : item.sourceName || "-"}
                                          </span>
                                        </div>
                                      </td>
                                      <td>{item.description || "-"}</td>
                                      <td>{renderProofFiles(item.proofFiles)}</td>
                                      <td>{renderRowActions(item)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <div className="table-wrapper">
                      <table className="inventory-table">
                        <thead>
                          <tr>
                            <th>{viewType === "monetary" ? "Donation / Entry" : "Item"}</th>
                            {(viewType === "goods" || viewType === "appliance") && (
                              <th>Category</th>
                            )}
                            <th>{viewType === "monetary" ? "Amount" : "Quantity"}</th>
                            {viewType === "goods" && <th>Unit</th>}
                            {viewType === "goods" && <th>Expiration</th>}
                            {viewType === "appliance" && <th>Condition</th>}
                            <th>Source</th>
                            <th>Description</th>
                            <th>Proof</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedTableRows.map((item) => (
                            <tr key={item._mergeKey || item._id}>
                              <td>
                                <button
                                  type="button"
                                  className="cell-link"
                                  onClick={() => setSelectedItem(item)}
                                >
                                  <div className="table-main-cell">
                                    <strong>{item.name || "-"}</strong>
                                    <span>{formatDate(item.createdAt)}</span>
                                  </div>
                                </button>
                              </td>

                              {(viewType === "goods" || viewType === "appliance") && (
                                <td>{getCategoryLabel(item.category)}</td>
                              )}

                              <td>
                                {viewType === "monetary" ? (
                                  <strong className="money-cell">
                                    {formatMoney(item.amount)}
                                  </strong>
                                ) : (
                                  <span
                                    className={`badge ${getStockBadgeClass(item.quantity)}`}
                                  >
                                    {Number(item.quantity || 0)}
                                  </span>
                                )}
                              </td>

                              {viewType === "goods" && <td>{item.unit || "-"}</td>}

                              {viewType === "goods" && (
                                <td>
                                  <div className="expiry-cell-stack">
                                    <span>{formatExpiryDate(item.expirationDate)}</span>
                                    {getExpiryBadgeLabel(item) ? (
                                      <span className={`badge ${getExpiryBadgeClass(item)}`}>
                                        {getExpiryBadgeLabel(item)}
                                      </span>
                                    ) : null}
                                  </div>
                                </td>
                              )}

                              {viewType === "appliance" && (
                                <td>
                                  <div className="table-mini-stack">
                                    <strong>
                                      {getCategoryLabel(
                                        String(item.condition || "").replace(/_/g, " ")
                                      )}
                                    </strong>
                                    <span>{item.usageDuration || "-"}</span>
                                  </div>
                                </td>
                              )}

                              <td>
                                <div className="table-mini-stack">
                                  <strong>
                                    {Array.isArray(item._sourceTypes) &&
                                    item._sourceTypes.length > 0
                                      ? item._sourceTypes
                                          .map((value) => getSourceLabel(value))
                                          .join(", ")
                                      : getSourceLabel(item.sourceType)}
                                  </strong>
                                  <span>
                                    {Array.isArray(item._sourceNames) &&
                                    item._sourceNames.length > 0
                                      ? item._sourceNames.join(", ")
                                      : item.sourceName || "-"}
                                  </span>
                                </div>
                              </td>

                              <td>
                                {viewType === "monetary"
                                  ? stripReferenceFromDescription(item.description) || "-"
                                  : item.description || "-"}
                              </td>
                              <td>{renderProofFiles(item.proofFiles)}</td>
                              <td>{renderRowActions(item)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {tablePageCount > 1 ? (
                      <div className="pager">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={
                            mode === "active" ? tablePage === 1 : archivePage === 1
                          }
                          onClick={() => {
                            if (mode === "active") {
                              setTablePage((prev) => prev - 1);
                            } else {
                              setArchivePage((prev) => prev - 1);
                            }
                          }}
                        >
                          Prev
                        </button>
                        <span>
                          Page {mode === "active" ? tablePage : archivePage} of{" "}
                          {tablePageCount}
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={
                            mode === "active"
                              ? tablePage === tablePageCount
                              : archivePage === tablePageCount
                          }
                          onClick={() => {
                            if (mode === "active") {
                              setTablePage((prev) => prev + 1);
                            } else {
                              setArchivePage((prev) => prev + 1);
                            }
                          }}
                        >
                          Next
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {selectedItem && typeof document !== "undefined"
                ? createPortal(
                    <div
                      className="inventory-modal-backdrop"
                      onClick={() => setSelectedItem(null)}
                    >
                      <div
                        className="inventory-modal"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inventory-modal-head">
                          <div>
                            <h3>{selectedItem.name || "Inventory Detail"}</h3>
                            <p>Review the selected inventory record.</p>
                          </div>

                          <button
                            type="button"
                            className="inventory-modal-close"
                            onClick={() => setSelectedItem(null)}
                            aria-label="Close details modal"
                          >
                            <FaTimes />
                          </button>
                        </div>

                        <div className="inventory-modal-grid">
                      <div className="modal-stat">
                        <span>Type</span>
                        <strong>{selectedItem.type || "-"}</strong>
                      </div>

                      {normalize(selectedItem.type) === "goods" ? (
                        <>
                          <div className="modal-stat">
                            <span>Category</span>
                            <strong>{getCategoryLabel(selectedItem.category)}</strong>
                          </div>
                          <div className="modal-stat">
                            <span>Quantity</span>
                            <strong>{Number(selectedItem.quantity || 0)}</strong>
                          </div>
                          <div className="modal-stat">
                            <span>Unit</span>
                            <strong>{selectedItem.unit || "-"}</strong>
                          </div>
                          <div className="modal-stat">
                            <span>Expiration</span>
                            <strong>{formatExpiryDate(selectedItem.expirationDate)}</strong>
                          </div>
                          {getExpiryBadgeLabel(selectedItem) ? (
                            <div className="modal-stat">
                              <span>Expiry Status</span>
                              <strong>{getExpiryBadgeLabel(selectedItem)}</strong>
                            </div>
                          ) : null}
                        </>
                      ) : normalize(selectedItem.type) === "appliance" ? (
                        <>
                          <div className="modal-stat">
                            <span>Category</span>
                            <strong>{getCategoryLabel(selectedItem.category)}</strong>
                          </div>
                          <div className="modal-stat">
                            <span>Quantity</span>
                            <strong>{Number(selectedItem.quantity || 0)}</strong>
                          </div>
                          <div className="modal-stat">
                            <span>Condition</span>
                            <strong>
                              {getCategoryLabel(
                                String(selectedItem.condition || "").replace(/_/g, " ")
                              )}
                            </strong>
                          </div>
                          <div className="modal-stat">
                            <span>Usage Duration</span>
                            <strong>{selectedItem.usageDuration || "-"}</strong>
                          </div>
                          <div className="modal-stat">
                            <span>Source Type</span>
                            <strong>{getSourceLabel(selectedItem.sourceType)}</strong>
                          </div>
                          <div className="modal-stat">
                            <span>Source Name</span>
                            <strong>{selectedItem.sourceName || "-"}</strong>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="modal-stat">
                            <span>Amount</span>
                            <strong>{formatMoney(selectedItem.amount)}</strong>
                          </div>
                          <div className="modal-stat">
                            <span>Reference Number</span>
                            <strong>{getReferenceNumber(selectedItem) || "-"}</strong>
                          </div>
                          <div className="modal-stat">
                            <span>Source Type</span>
                            <strong>{getSourceLabel(selectedItem.sourceType)}</strong>
                          </div>
                          <div className="modal-stat">
                            <span>Source Name</span>
                            <strong>{selectedItem.sourceName || "-"}</strong>
                          </div>
                        </>
                      )}

                      <div className="modal-stat">
                        <span>Added By</span>
                        <strong>{selectedItem.addedBy || "-"}</strong>
                      </div>

                      <div className="modal-stat">
                        <span>Created</span>
                        <strong>{formatDate(selectedItem.createdAt)}</strong>
                      </div>

                      <div className="modal-stat">
                        <span>Updated</span>
                        <strong>{formatDate(selectedItem.updatedAt)}</strong>
                      </div>
                        </div>

                        <div className="inventory-modal-section">
                          <h4>Description</h4>
                          <p>
                            {normalize(selectedItem.type) === "monetary"
                              ? stripReferenceFromDescription(selectedItem.description) ||
                                "No description provided."
                              : selectedItem.description || "No description provided."}
                          </p>
                        </div>

                        <div className="inventory-modal-section">
                          <h4>Proof Files</h4>
                          {renderProofFiles(selectedItem.proofFiles)}
                        </div>

                        <div className="inventory-modal-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setSelectedItem(null)}
                          >
                            <FaTimes className="btn-icon" />
                            Close
                          </button>

                          {mode === "active" ? (
                            <>
                              {canEditInventoryType(role, selectedItem?.type) ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-edit"
                                    onClick={() => {
                                      setSelectedItem(null);
                                      openItemEditModal(selectedItem);
                                    }}
                                  >
                                    <FaEdit className="btn-icon" />
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-archive"
                                    disabled={actionLoading}
                                    onClick={() => {
                                      handleArchive(selectedItem._id);
                                      setSelectedItem(null);
                                    }}
                                  >
                                    <FaArchive className="btn-icon" />
                                    Archive
                                  </button>
                                </>
                              ) : (
                                <span className="inventory-muted-note">View only</span>
                              )}
                            </>
                          ) : (
                            <>
                          {canEditInventoryType(role, selectedItem?.type) ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={actionLoading}
                              onClick={() => {
                                handleRestore(selectedItem._id);
                                setSelectedItem(null);
                              }}
                            >
                              <FaUndo className="btn-icon" />
                              Restore
                            </button>
                          ) : (
                            <span className="inventory-muted-note">View only</span>
                          )}
                          {canEditInventoryType(role, selectedItem?.type) ? (
                            <button
                              type="button"
                              className="btn btn-danger"
                              disabled={actionLoading}
                              onClick={() => {
                                handlePermanentDelete(selectedItem._id);
                                setSelectedItem(null);
                              }}
                            >
                              <FaTrash className="btn-icon" />
                              Delete
                            </button>
                          ) : null}
                            </>
                          )}
                        </div>
                      </div>
                    </div>,
                    document.body
                  )
                : null}

              {typeof document !== "undefined" && templateModalOpen
  ? createPortal(
      <div
        className="inventory-modal-backdrop inventory-modal-backdrop-centered"
        onClick={closeTemplateModal}
        role="dialog"
        aria-modal="true"
        aria-label={
          editingTemplateId
            ? "Edit Food Pack Template"
            : "Create Food Pack Template"
        }
      >
        <div
          ref={templateModalRef}
          className="inventory-modal template-builder-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="inventory-modal-head">
            <div>
              <h3>
                {editingTemplateId
                  ? "Edit Food Pack Template"
                  : "Create Food Pack Template"}
              </h3>
              <p>
                Configure reusable food combinations for faster release
                preparation.
              </p>
            </div>

            <button
              type="button"
              className="inventory-modal-close"
              onClick={closeTemplateModal}
              aria-label="Close template modal"
            >
              <FaTimes />
            </button>
          </div>

                    <div className="template-builder-form">
                      <div className="inventory-modal-grid">
                        <div className="release-selection-field">
                          <label>Template Name</label>
                          <input
                            type="text"
                            className="input"
                            placeholder="Enter template name"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                          />
                        </div>

                        <div className="release-selection-field">
                          <label>Description</label>
                          <input
                            type="text"
                            className="input"
                            placeholder="Optional description"
                            value={templateDescription}
                            onChange={(e) => setTemplateDescription(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="template-builder-layout compact-template-layout">
                        <div className="release-panel template-builder-panel">
                          <div className="release-panel-head template-builder-head">
                            <h3>Available Food Goods</h3>
                            <input
                              type="text"
                              className="input"
                              placeholder="Search goods..."
                              value={templateBuilderSearch}
                              onChange={(e) =>
                                setTemplateBuilderSearch(e.target.value)
                              }
                            />
                          </div>

                          {templateCatalog.length === 0 ? (
                            <div className="release-empty">
                              No eligible food goods found.
                            </div>
                          ) : (
                            <div className="template-builder-list-wrap">
                              <div className="template-builder-list">
                                {templateCatalog.map((item) => {
                                  const alreadyAdded = templateItems.some(
                                    (templateItem) =>
                                      String(templateItem.inventoryItemId) ===
                                      String(item._id)
                                  );

                                  return (
                                    <div
                                      className="template-source-row"
                                      key={item._mergeKey || item._id}
                                    >
                                      <div className="template-source-main">
                                        <strong>{item.name || "-"}</strong>
                                        <span>{getCategoryLabel(item.category)}</span>
                                      </div>

                                      <div className="template-source-meta">
                                        <span>{Number(item.quantity || 0)}</span>
                                        <small>{item.unit || "-"}</small>
                                      </div>

                                      <button
                                        type="button"
                                        className="btn btn-outline btn-sm template-add-btn"
                                        onClick={() => addTemplateItem(item)}
                                        disabled={alreadyAdded}
                                      >
                                        {alreadyAdded ? "Added" : "Add"}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="release-panel template-builder-panel">
                          <div className="release-panel-head release-panel-head-simple compact">
                            <div>
                              <h3>Template Items</h3>
                              <span>{templateItems.length} item(s)</span>
                            </div>
                          </div>

                          {templateItems.length === 0 ? (
                            <div className="release-empty release-empty-compact">
                              Add food goods from the inventory list.
                            </div>
                          ) : (
                            <div className="release-selection-list template-builder-selection-list">
                              {templateItems.map((item) => (
                                <div
                                  className="release-selection-card compact-template-card"
                                  key={item.inventoryItemId}
                                >
                                  <div className="release-selection-head compact-template-head">
                                    <div>
                                      <strong>{item.itemName}</strong>
                                      <span>
                                        {getCategoryLabel(item.category)} • {item.unit}
                                      </span>
                                    </div>

                                    <button
                                      type="button"
                                      className="btn btn-danger btn-sm"
                                      onClick={() =>
                                        removeTemplateItem(item.inventoryItemId)
                                      }
                                    >
                                      Remove
                                    </button>
                                  </div>

                                  <div className="release-selection-grid compact-template-grid">
                                    <div className="release-selection-field compact-template-field">
                                      <label>Quantity Per Pack</label>
                                      <input
                                        type="number"
                                        min="1"
                                        className="input"
                                        value={item.quantityPerPack}
                                        onChange={(e) =>
                                          updateTemplateItem(
                                            item.inventoryItemId,
                                            "quantityPerPack",
                                            e.target.value
                                          )
                                        }
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="inventory-modal-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={closeTemplateModal}
                          disabled={templateSubmitting}
                        >
                          <FaTimes className="btn-icon" />
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={saveTemplate}
                          disabled={templateSubmitting}
                        >
                          <FaCheck className="btn-icon" />
                          {templateSubmitting ? "Saving..." : "Save Template"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>,
                document.body
              )
               : null}
            </>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}


