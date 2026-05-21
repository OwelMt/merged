const Audit = require("../models/Audit");
const {
  buildAuditSearchText,
  formatModuleLabel,
  formatRoleLabel,
  mapAuditDocToEvent,
  normalizeActorRoleValue,
  normalizeModuleValue,
  normalizeString,
} = require("../utils/auditEventUtils");

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeLower = (value) => normalizeString(value).toLowerCase();

const buildSummary = (events = []) => {
  const modules = new Set();
  const actors = new Set();
  let todayCount = 0;
  let highPriorityCount = 0;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  events.forEach((event) => {
    if (event.module) modules.add(event.module);
    if (event.actorName) actors.add(`${event.actorRole}:${event.actorName}`);
    if (["high", "critical"].includes(event.priority)) highPriorityCount += 1;

    const eventDate = event.createdAt ? new Date(event.createdAt) : null;
    if (eventDate && !Number.isNaN(eventDate.getTime()) && eventDate >= todayStart) {
      todayCount += 1;
    }
  });

  return {
    total: events.length,
    today: todayCount,
    modules: modules.size,
    actors: actors.size,
    highPriority: highPriorityCount,
  };
};

const getAuditLogs = async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (normalizeLower(req.session.role) !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const moduleFilter = normalizeLower(req.query.module);
    const actorRoleFilter = normalizeLower(req.query.actorRole);
    const searchQuery = normalizeLower(req.query.search);
    const days = Math.max(0, toNumber(req.query.days));
    const limit = Math.min(500, Math.max(25, toNumber(req.query.limit) || 250));

    const auditQuery = {};

    if (moduleFilter && moduleFilter !== "all") {
      auditQuery.module = normalizeModuleValue(moduleFilter);
    }

    if (actorRoleFilter && actorRoleFilter !== "all") {
      auditQuery.actorRole = normalizeActorRoleValue(actorRoleFilter);
    }

    if (days > 0) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      auditQuery.$or = [{ createdAt: { $gte: since } }, { actionAt: { $gte: since } }];
    }

    const audits = await Audit.find(auditQuery)
      .sort({ actionAt: -1, createdAt: -1 })
      .limit(limit);

    const normalizedEvents = audits
      .map(mapAuditDocToEvent)
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });

    const filterBaseEvents = searchQuery
      ? normalizedEvents.filter((event) => buildAuditSearchText(event).includes(searchQuery))
      : normalizedEvents;

    const availableModules = Array.from(
      new Set(filterBaseEvents.map((event) => event.module).filter(Boolean))
    ).sort();

    const availableActorRoles = Array.from(
      new Set(filterBaseEvents.map((event) => event.actorRole).filter(Boolean))
    ).sort();

    res.json({
      events: filterBaseEvents,
      filters: {
        modules: availableModules.map((moduleName) => ({
          value: moduleName,
          label: formatModuleLabel(moduleName),
        })),
        actorRoles: availableActorRoles.map((roleName) => ({
          value: roleName,
          label: formatRoleLabel(roleName),
        })),
      },
      summary: buildSummary(filterBaseEvents),
    });
  } catch (err) {
    console.error("Audit log fetch error:", err);
    res.status(500).json({ message: "Failed to load audit logs" });
  }
};

module.exports = { getAuditLogs };
