import { StyleSheet, Platform } from "react-native";

export const COLORS = {
  CARD: "rgba(255,255,255,0.93)",
  CARD_PRESSED: "rgba(240,247,243,0.98)",
  CARD_ACTIVE: "#14532d",
  BORDER: "rgba(255,255,255,0.72)",
  BORDER_ACTIVE: "#14532d",
  TEXT: "#10251b",
  MUTED: "#5f6f66",
  TEXT_ACTIVE: "#ffffff",
};

export const METRICS = {
  CARD_WIDTH: 146,
  CARD_WIDTH_ACTIVE: 172,
  CARD_HEIGHT: 78,
  CARD_HEIGHT_ACTIVE: 92,
  CARD_GAP: 10,
};

export default StyleSheet.create({
  safe: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
    elevation: 99999,
    backgroundColor: "transparent",
  },

  root: {
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: "transparent",
  },

  stackContent: {
    paddingLeft: 14,
    paddingRight: 44,
    alignItems: "center",
  },

  cardWrap: {
    marginRight: METRICS.CARD_GAP,
    paddingTop: 10,
  },

  lastCardWrap: {
    marginRight: 0,
    paddingTop: 10,
  },

  moduleCard: {
    width: METRICS.CARD_WIDTH,
    minHeight: METRICS.CARD_HEIGHT,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.CARD,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",

    ...Platform.select({
      ios: {
        shadowColor: "#06291a",
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: {
        elevation: 10,
      },
    }),
  },

  moduleCardPressed: {
    backgroundColor: COLORS.CARD_PRESSED,
    borderColor: "rgba(20,83,45,0.22)",
  },

  moduleCardActive: {
    width: METRICS.CARD_WIDTH_ACTIVE,
    minHeight: METRICS.CARD_HEIGHT_ACTIVE,
    backgroundColor: COLORS.CARD_ACTIVE,
    borderColor: COLORS.BORDER_ACTIVE,
  },

  lastModuleCard: {
    marginRight: 0,
  },

  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: "#e7f5ed",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#d7eadf",
  },

  iconBoxActive: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderColor: "rgba(255,255,255,0.28)",
  },

  labelBox: {
    flex: 1,
    minWidth: 0,
  },

  moduleLabel: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.TEXT,
  },

  moduleLabelActive: {
    fontSize: 14,
    color: COLORS.TEXT_ACTIVE,
  },

  moduleHelper: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.MUTED,
  },

  moduleHelperActive: {
    color: "rgba(255,255,255,0.82)",
  },
});
