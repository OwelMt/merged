import { StyleSheet, Platform, StatusBar } from "react-native";

export default StyleSheet.create({
  container: {
    paddingTop: (StatusBar.currentHeight || 0) + 24,
    paddingHorizontal: 20,
    backgroundColor: "#fff",
  },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    marginTop: -30, // ✅ moved slightly lower for better reach
  },

  backText: {
    fontSize: 26,
    color: "#166534",
  },

  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#166534",
  },

  progressRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginVertical: 12,
  },

  circle: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#d1d5db",
    marginHorizontal: 6,
  },

  activeCircle: {
    backgroundColor: "#166534",
  },

  stepTitle: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
});