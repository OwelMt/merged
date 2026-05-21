const express = require('express');
const { getAuditLogs } = require('../controllers/auditController.js');
const { requireLogin, requireAdmin } = require('../middleware/adminMiddleware');

const router = express.Router();

router.get('/', requireLogin, requireAdmin, getAuditLogs);

module.exports = router;
