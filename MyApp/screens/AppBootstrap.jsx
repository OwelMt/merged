import { useContext, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { UserContext } from "./UserContext";

const SPLASH_MIN_MS = 2200;

export default function AppBootstrap({ navigation }) {
  const { user } = useContext(UserContext) || {};
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 7,
        tension: 70,
        useNativeDriver: true,
      }),
    ]).start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 950,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 950,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [fade, pulse, scale]);

  useEffect(() => {
    let active = true;

    const boot = async () => {
      const startedAt = Date.now();

      if (user?._id || user?.id) {
        return;
      }

      const getStartedSeen =
        (await AsyncStorage.getItem("hasSeenGetStarted")) ||
        (await AsyncStorage.getItem("getStartedSeen"));
      const privacyAccepted =
        (await AsyncStorage.getItem("hasAcceptedPrivacy")) ||
        (await AsyncStorage.getItem("hasAcceptedDataPrivacy")) ||
        (await AsyncStorage.getItem("privacyAccepted"));
      const termsAccepted =
        (await AsyncStorage.getItem("hasAcceptedTerms")) ||
        (await AsyncStorage.getItem("termsAccepted"));
      const hasCreatedAccount =
        (await AsyncStorage.getItem("hasAccount")) ||
        (await AsyncStorage.getItem("hasCreatedAccount"));
      const onboardingComplete = await AsyncStorage.getItem("onboardingComplete");

      let nextRoute = "LogIn";

      if (hasCreatedAccount === "true" || onboardingComplete === "true") {
        nextRoute = "LogIn";
      } else if (getStartedSeen !== "true") {
        nextRoute = "GetStarted";
      } else if (privacyAccepted !== "true" || termsAccepted !== "true") {
        nextRoute = "PrivacyGate";
      }

      const remaining = Math.max(0, SPLASH_MIN_MS - (Date.now() - startedAt));

      setTimeout(() => {
        if (active) navigation.replace(nextRoute);
      }, remaining);
    };

    boot();

    return () => {
      active = false;
    };
  }, [navigation, user?._id, user?.id]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0.08],
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.blobTop} />
      <View style={styles.blobBottom} />

      <Animated.View style={[styles.content, { opacity: fade, transform: [{ scale }] }]}>
        <View style={styles.logoWrap}>
          <Animated.View
            style={[
              styles.logoPulse,
              { opacity: pulseOpacity, transform: [{ scale: pulseScale }] },
            ]}
          />
          <View style={styles.logoCircle}>
            <Ionicons name="shield-checkmark-outline" size={46} color="#1F5F3B" />
          </View>
        </View>

        <Text style={styles.brand}>SagipBayan</Text>
        <Text style={styles.tagline}>
          Community Disaster Response and Safety Platform
        </Text>
        <Text style={styles.subtitle}>
          Stay informed, report incidents, and receive official safety alerts.
        </Text>

        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.loadingText}>Preparing safety access...</Text>
        </View>
      </Animated.View>

      <Text style={styles.footer}>Powered for community safety</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#1F5F3B",
    overflow: "hidden",
  },
  blobTop: {
    position: "absolute",
    top: -110,
    right: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(221,238,227,0.18)",
  },
  blobBottom: {
    position: "absolute",
    bottom: -140,
    left: -90,
    width: 330,
    height: 330,
    borderRadius: 165,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  logoWrap: {
    width: 124,
    height: 124,
    alignItems: "center",
    justifyContent: "center",
  },
  logoPulse: {
    position: "absolute",
    width: 118,
    height: 118,
    borderRadius: 59,
    backgroundColor: "#FFFFFF",
  },
  logoCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#123524",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  brand: {
    marginTop: 22,
    color: "#FFFFFF",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "900",
    textAlign: "center",
  },
  tagline: {
    marginTop: 8,
    color: "#DDEEE3",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    marginTop: 10,
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "center",
  },
  loadingRow: {
    marginTop: 32,
    minHeight: 46,
    borderRadius: 23,
    paddingHorizontal: 18,
    backgroundColor: "rgba(18,53,36,0.45)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  footer: {
    position: "absolute",
    bottom: 28,
    alignSelf: "center",
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "800",
  },
});
