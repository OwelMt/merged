import React, { useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  Dimensions,
} from "react-native";

const SCREEN_HEIGHT = Dimensions.get("window").height;

// Limits
const MIN_Y = SCREEN_HEIGHT * 0.25; // expanded
const MAX_Y = SCREEN_HEIGHT * 0.7;  // collapsed

function getAvailabilityMeta(status) {
  switch (status) {
    case "available":
      return { text: "Available", color: "#16a34a" };
    case "limited":
      return { text: "Limited", color: "#facc15" };
    case "full":
      return { text: "Full", color: "#dc2626" };
    default:
      return { text: "Unknown", color: "#9ca3af" };
  }
}

export default function BottomSheetPanel({
  state,
  evac,
  routes = [],
  onViewRoutes,
  onGoNow,
  onLeaveLater,
}) {
  if (!evac || state === "HIDDEN") return null;

  const translateY = useRef(new Animated.Value(MAX_Y)).current;
  const lastY = useRef(MAX_Y);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,

      onPanResponderGrant: () => {
        translateY.setOffset(lastY.current);
        translateY.setValue(0);
      },

      onPanResponderMove: (_, g) => {
        let nextY = lastY.current + g.dy;
        nextY = Math.max(MIN_Y, Math.min(MAX_Y, nextY));
        translateY.setValue(nextY - lastY.current);
      },

      onPanResponderRelease: (_, g) => {
        translateY.flattenOffset();

        let finalY = lastY.current + g.dy;
        finalY = Math.max(MIN_Y, Math.min(MAX_Y, finalY));

        lastY.current = finalY;
        translateY.setValue(finalY);
      },
    })
  ).current;

  const availability = getAvailabilityMeta(evac.availability);

  return (
    <Animated.View
      style={[
        styles.panel,
        { transform: [{ translateY }] },
      ]}
    >
      {/* ✅ ONLY THIS HANDLE IS DRAGGABLE */}
      <View
        {...panResponder.panHandlers}
        style={styles.handle}
      />

      {state === "PLACE_INFO" && (
        <>
          <Text style={styles.title}>
            {evac.label || "Selected location"}
          </Text>

          <View
            style={[
              styles.badge,
              { backgroundColor: availability.color },
            ]}
          >
            <Text style={styles.badgeText}>
              {availability.text}
            </Text>
          </View>

          <PrimaryButton
            text="View routes"
            onPress={onViewRoutes}
          />
        </>
      )}

      {state === "ROUTE_SELECTION" && (
        <>
          <Text style={styles.title}>Available Routes</Text>

          {routes.map((r, i) => (
            <Text key={i} style={styles.routeText}>
              ⏱ {Math.round(r.duration / 60)} min · 📏{" "}
              {Math.round(r.distance)} m
            </Text>
          ))}

          <View style={styles.actions}>
            <SecondaryButton
              text="Later"
              onPress={onLeaveLater}
            />
            <PrimaryButton
              text="Go now"
              onPress={onGoNow}
            />
          </View>
        </>
      )}
    </Animated.View>
  );
}

/* ================= BUTTONS ================= */

const PrimaryButton = ({ text, onPress }) => (
  <TouchableOpacity style={styles.primaryBtn} onPress={onPress}>
    <Text style={styles.primaryText}>{text}</Text>
  </TouchableOpacity>
);

const SecondaryButton = ({ text, onPress }) => (
  <TouchableOpacity style={styles.secondaryBtn} onPress={onPress}>
    <Text>{text}</Text>
  </TouchableOpacity>
);

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
    elevation: 20,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 5,
    backgroundColor: "#e5e7eb",
    borderRadius: 3,
    marginVertical: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
  },
  badge: {
    padding: 6,
    borderRadius: 6,
    marginBottom: 12,
    alignSelf: "flex-start",
  },
  badgeText: {
    color: "#fff",
    fontWeight: "600",
  },
  routeText: {
    marginVertical: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  primaryBtn: {
    backgroundColor: "#14532d",
    padding: 12,
    borderRadius: 8,
    flex: 1,
  },
  primaryText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "600",
  },
  secondaryBtn: {
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
    flex: 1,
  },
});