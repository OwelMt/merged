const mongoose = require("mongoose");

const waterLevelSchema = new mongoose.Schema(
  {
    camera_id: {
      type: String,
      default: "cam_1",
      index: true,
    },

    water_level: {
      type: Number,
      required: true,
    },

    warning_level: {
      type: Number,
      required: true,
      default: 8,
    },

    danger_level: {
      type: Number,
      default: 10,
    },

    status: {
      type: String,
      enum: ["SAFE", "WARNING", "DANGER"],
      required: true,
      index: true,
    },

    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    versionKey: false,
    timestamps: true,
  }
);

waterLevelSchema.index({ camera_id: 1, timestamp: -1 });
waterLevelSchema.index({ camera_id: 1, createdAt: -1 });
module.exports = mongoose.model("WaterLevel", waterLevelSchema);

