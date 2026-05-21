const express = require("express");

const {
  createWaterLevel,
  getWaterLevels,
  getLatestWaterLevel,
  getWaterLevelHistoryByCamera,
} = require("../controllers/waterLevelController");

const router = express.Router();

router.post("/", createWaterLevel);
router.get("/", getWaterLevels);
router.get("/latest/:camera_id", getLatestWaterLevel);
router.get("/history/:camera_id", getWaterLevelHistoryByCamera);

module.exports = router;

