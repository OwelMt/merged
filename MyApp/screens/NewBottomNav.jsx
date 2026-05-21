import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  Text,
  View,
  Easing,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { FlatList } from "react-native-gesture-handler";

import styles from "../Designs/NewBottomNav";
import { MapContext } from "./contexts/MapContext";
import { useTheme } from "./contexts/ThemeContext";

const MODULES = [
  {
    key: "incident",
    label: "Incident",
    helper: "Report",
    icon: "warning-outline",
  },
  {
    key: "flood",
    label: "Flood Map",
    helper: "Hazard",
    icon: "water-outline",
  },
  {
    key: "earthquake",
    label: "Earthquake",
    helper: "Risk",
    icon: "pulse-outline",
  },
  {
    key: "barangay",
    label: "Barangay",
    helper: "Boundary",
    icon: "map-outline",
  },
  {
    key: "evac",
    label: "Evac Place",
    helper: "Routes",
    icon: "navigate-outline",
  },
];

const NAV_REVEAL_PANEL_Y = 280;
const ITEM_WIDTH = 156;

function DockCard({ item, index, total, isActive, onPress, theme }) {
  const isDark = theme.mode === "dark";
  const activeAnim = useRef(new Animated.Value(isActive ? 1 : 0)).current;
  const pressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(activeAnim, {
      toValue: isActive ? 1 : 0,
      stiffness: 180,
      damping: 18,
      mass: 0.8,
      useNativeDriver: false,
    }).start();
  }, [isActive, activeAnim]);

  const handlePressIn = () => {
    Animated.timing(pressAnim, {
      toValue: 1,
      duration: 140,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(pressAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  };

  const width = activeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [146, 172],
  });

  const minHeight = activeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [78, 92],
  });

  const translateY = Animated.add(
    activeAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -8],
    }),
    pressAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -2],
    })
  );

  const scale = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.02],
  });

  const backgroundColor = activeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? "rgba(18,28,24,0.96)" : theme.card, theme.buttonPrimary],
  });

  const borderColor = activeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? "rgba(134,239,172,0.46)" : theme.border, theme.buttonPrimary],
  });

  const iconBg = activeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? "rgba(134,239,172,0.16)" : theme.primarySoft, theme.panel],
  });

  const iconBorder = activeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? "rgba(134,239,172,0.36)" : theme.border, theme.border],
  });

  const labelColor = activeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? "#F8FFF9" : theme.text, theme.buttonText],
  });

  const helperColor = activeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? "#D7E8DC" : theme.subtext, theme.buttonText],
  });

  const iconColor = isActive ? theme.primary : isDark ? "#F8FFF9" : theme.primary;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={index === total - 1 ? styles.lastCardWrap : styles.cardWrap}
    >
      <Animated.View
        style={[
          styles.moduleCard,
          {
            width,
            minHeight,
            backgroundColor,
            borderColor,
            transform: [{ translateY }, { scale }],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.iconBox,
            {
              backgroundColor: iconBg,
              borderColor: iconBorder,
            },
          ]}
        >
          <Ionicons name={item.icon} size={isActive ? 22 : 20} color={iconColor} />
        </Animated.View>

        <View style={styles.labelBox}>
          <Animated.Text
            numberOfLines={1}
            style={[
              styles.moduleLabel,
              {
                color: labelColor,
                fontSize: isActive ? 14 : 13,
              },
            ]}
          >
            {item.label}
          </Animated.Text>

          <Animated.Text
            numberOfLines={1}
            style={[
              styles.moduleHelper,
              {
                color: helperColor,
              },
            ]}
          >
            {item.helper}
          </Animated.Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default function NewBottomNav() {
  const { theme } = useTheme();
  const {
    activeMapModule,
    setActiveMapModule,
    setPanelState,
    panelY,
    setPanelY,
    setIsBottomNavInteracting,
    setEvac,
    setRouteRequested,
    setRoutes,
    setActiveRoute,
  } = useContext(MapContext);

  const [activeDockItem, setActiveDockItem] = useState("incident");
  const [focusedIndex, setFocusedIndex] = useState(0);

  const moduleData = useMemo(() => MODULES, []);
  const navAnim = useRef(new Animated.Value(1)).current;
  const listRef = useRef(null);

  const shouldRevealBottomNav =
    !activeMapModule || (typeof panelY === "number" && panelY >= NAV_REVEAL_PANEL_Y);

  useEffect(() => {
    Animated.timing(navAnim, {
      toValue: shouldRevealBottomNav ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [navAnim, shouldRevealBottomNav]);

  useEffect(() => {
    const index = moduleData.findIndex((item) => item.key === activeMapModule);

    if (index >= 0) {
      setFocusedIndex(index);
      setActiveDockItem(moduleData[index].key);

      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
      });
    }
  }, [activeMapModule, moduleData]);

  const lockBottomNavGesture = () => {
    if (typeof setIsBottomNavInteracting === "function") {
      setIsBottomNavInteracting(true);
    }
  };

  const releaseBottomNavGesture = () => {
    if (typeof setIsBottomNavInteracting === "function") {
      setIsBottomNavInteracting(false);
    }
  };

  const openModule = (moduleKey, index) => {
    releaseBottomNavGesture();

    setFocusedIndex(index);
    setActiveDockItem(moduleKey);
    setEvac(null);
    setRouteRequested(false);
    setRoutes([]);
    setActiveRoute(null);
    setActiveMapModule(moduleKey);
    setPanelState("HIDDEN");
    setPanelY(null);

    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });
    });
  };

  const moveByOne = (direction) => {
    lockBottomNavGesture();

    const nextIndex = Math.max(
      0,
      Math.min(moduleData.length - 1, focusedIndex + direction)
    );

    const focused = moduleData[nextIndex];

    if (!focused) {
      releaseBottomNavGesture();
      return;
    }

    setFocusedIndex(nextIndex);
    setActiveDockItem(focused.key);

    listRef.current?.scrollToIndex({
      index: nextIndex,
      animated: true,
      viewPosition: 0.5,
    });

    setTimeout(() => {
      releaseBottomNavGesture();
    }, 260);
  };

  const handleMomentumEnd = (event) => {
    const offsetX = event?.nativeEvent?.contentOffset?.x || 0;
    const index = Math.round(offsetX / ITEM_WIDTH);
    const safeIndex = Math.max(0, Math.min(index, moduleData.length - 1));
    const focused = moduleData[safeIndex];

    setFocusedIndex(safeIndex);

    if (focused) {
      setActiveDockItem(focused.key);
    }

    releaseBottomNavGesture();
  };

  const handleScrollToIndexFailed = (info) => {
    const safeIndex = Math.max(0, Math.min(info.index || 0, moduleData.length - 1));

    setTimeout(() => {
      listRef.current?.scrollToOffset({
        offset: safeIndex * ITEM_WIDTH,
        animated: true,
      });
    }, 80);
  };

  const renderItem = ({ item, index }) => (
    <DockCard
      item={item}
      index={index}
      total={moduleData.length}
      isActive={activeDockItem === item.key}
      onPress={() => openModule(item.key, index)}
      theme={theme}
    />
  );

  return (
    <Animated.View
      pointerEvents={shouldRevealBottomNav ? "auto" : "none"}
      style={[
        localStyles.overlay,
        {
          opacity: navAnim,
          transform: [
            {
              translateY: navAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [120, 0],
              }),
            },
          ],
        },
      ]}
    >
      <SafeAreaView edges={["bottom"]} style={styles.safe} pointerEvents="box-none">
        <View
          style={styles.root}
          pointerEvents="auto"
          onTouchStart={lockBottomNavGesture}
          onTouchEnd={releaseBottomNavGesture}
          onTouchCancel={releaseBottomNavGesture}
        >
          <View style={localStyles.navFrame}>
            <Pressable
              onPress={() => moveByOne(-1)}
              disabled={focusedIndex <= 0}
              style={({ pressed }) => [
                localStyles.arrowButton,
                {
                  backgroundColor: theme.mode === "dark" ? "rgba(18,28,24,0.96)" : theme.card,
                  borderColor: theme.mode === "dark" ? "rgba(134,239,172,0.42)" : theme.border,
                },
                focusedIndex <= 0 && localStyles.arrowButtonDisabled,
                pressed && focusedIndex > 0 && localStyles.arrowButtonPressed,
              ]}
            >
              <Ionicons
                name="chevron-back"
                size={21}
                color={
                  focusedIndex <= 0
                    ? theme.subtext
                    : theme.mode === "dark"
                      ? "#F8FFF9"
                      : theme.primary
                }
              />
            </Pressable>

            <FlatList
              ref={listRef}
              data={moduleData}
              keyExtractor={(item) => item.key}
              renderItem={renderItem}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.stackContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
              decelerationRate="fast"
              snapToInterval={ITEM_WIDTH}
              snapToAlignment="start"
              onTouchStart={lockBottomNavGesture}
              onTouchEnd={releaseBottomNavGesture}
              onTouchCancel={releaseBottomNavGesture}
              onScrollBeginDrag={lockBottomNavGesture}
              onScrollEndDrag={() => {}}
              onMomentumScrollEnd={handleMomentumEnd}
              onScrollToIndexFailed={handleScrollToIndexFailed}
              getItemLayout={(_, index) => ({
                length: ITEM_WIDTH,
                offset: ITEM_WIDTH * index,
                index,
              })}
              style={localStyles.list}
            />

            <Pressable
              onPress={() => moveByOne(1)}
              disabled={focusedIndex >= moduleData.length - 1}
              style={({ pressed }) => [
                localStyles.arrowButton,
                {
                  backgroundColor: theme.mode === "dark" ? "rgba(18,28,24,0.96)" : theme.card,
                  borderColor: theme.mode === "dark" ? "rgba(134,239,172,0.42)" : theme.border,
                },
                focusedIndex >= moduleData.length - 1 && localStyles.arrowButtonDisabled,
                pressed &&
                  focusedIndex < moduleData.length - 1 &&
                  localStyles.arrowButtonPressed,
              ]}
            >
              <Ionicons
                name="chevron-forward"
                size={21}
                color={
                  focusedIndex >= moduleData.length - 1
                    ? theme.subtext
                    : theme.mode === "dark"
                      ? "#F8FFF9"
                      : theme.primary
                }
              />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const localStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    elevation: 999,
  },

  navFrame: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },

  list: {
    flex: 1,
  },

  arrowButton: {
    width: 42,
    height: 54,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: "rgba(20,83,45,0.16)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f2a19",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },

  arrowButtonPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: "#dcfce7",
  },

  arrowButtonDisabled: {
    opacity: 0.48,
  },
});
