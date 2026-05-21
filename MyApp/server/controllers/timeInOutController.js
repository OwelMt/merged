const TimeLog = require('../models/TimeLog');

const getAllTimeLogs = async (req, res) => {
  try {

    if (req.session.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { role, date, page = 1, limit = 10 } = req.query;

    let filter = {};

    // 🔎 Filter by role
    if (role) {
      filter.role = role;
    }

    // 🔎 Filter by date
    if (date) {
      const start = new Date(date);
      start.setHours(0,0,0,0);

      const end = new Date(date);
      end.setHours(23,59,59,999);

      filter.timeIn = { $gte: start, $lte: end };
    }

    const skip = (page - 1) * limit;

    const logs = await TimeLog.find(filter)
      .sort({ timeIn: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await TimeLog.countDocuments(filter);

    res.json({
      logs,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page)
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getAllTimeLogs };