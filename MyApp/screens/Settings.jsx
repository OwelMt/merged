import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ThemeContext } from "./contexts/ThemeContext";
import { UserContext } from "./UserContext";
import { updateShareSafetyLocation } from "../lib/api";
import {
  getNotificationSoundSettings,
  updateNotificationSoundSettings,
} from "../utils/notificationSounds";

const THEME_OPTIONS = [
  { label: "Light", value: "light", icon: "sunny-outline" },
  { label: "Dark", value: "dark", icon: "moon-outline" },
  { label: "System", value: "system", icon: "phone-portrait-outline" },
];

export default function Settings({ navigation }) {
  const { theme, mode, resolvedMode, setMode } = useContext(ThemeContext);
  const { user, setUser } = useContext(UserContext);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [loading, setLoading] = useState(true);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyConfirmVisible, setPrivacyConfirmVisible] = useState(false);
  const [privacyConsentSeen, setPrivacyConsentSeen] = useState(false);
  const [soundSettings, setSoundSettings] = useState({
    normalNotificationSound: true,
    dangerNotificationSound: true,
    smsNotificationSound: true,
  });

  const shareSafetyLocation = user?.shareSafetyLocation === true;
  const privacyConsentKey = user?._id
    ? `shareSafetyLocationConsent:${user._id}`
    : null;

  useEffect(() => {
    let active = true;

    const loadSoundSettings = async () => {
      try {
        const settings = await getNotificationSoundSettings();
        if (active) setSoundSettings(settings);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadSoundSettings();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadPrivacyConsent = async () => {
      if (!privacyConsentKey) {
        setPrivacyConsentSeen(false);
        return;
      }

      const stored = await AsyncStorage.getItem(privacyConsentKey);
      if (active) setPrivacyConsentSeen(stored === "true");
    };

    loadPrivacyConsent();

    return () => {
      active = false;
    };
  }, [privacyConsentKey]);

  const setSoundSetting = async (key, value) => {
    const nextSettings = {
      ...soundSettings,
      [key]: value,
    };

    setSoundSettings(nextSettings);

    try {
      const savedSettings = await updateNotificationSoundSettings({
        [key]: value,
      });
      setSoundSettings(savedSettings);
    } catch (err) {
      console.log("[settings] sound setting save failed:", err?.message);
      setSoundSettings(soundSettings);
    }
  };

  const saveShareSafetyLocation = async (value) => {
    if (!user?._id || privacySaving) return;

    setPrivacySaving(true);

    try {
      const res = await updateShareSafetyLocation(user._id, value);
      await setUser(res?.data?.user || { ...user, shareSafetyLocation: value });

      if (value && privacyConsentKey) {
        await AsyncStorage.setItem(privacyConsentKey, "true");
        setPrivacyConsentSeen(true);
      }
    } catch (err) {
      Alert.alert(
        "Privacy Setting",
        err?.response?.data?.message ||
          "Failed to update Safety Marking location sharing."
      );
    } finally {
      setPrivacySaving(false);
    }
  };

  const handleShareSafetyLocationChange = (value) => {
    if (value && !privacyConsentSeen) {
      setPrivacyConfirmVisible(true);
      return;
    }

    saveShareSafetyLocation(value);
  };

  const handleAllowSharing = () => {
    setPrivacyConfirmVisible(false);
    saveShareSafetyLocation(true);
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={theme.primary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Notifications and appearance</Text>
        </View>
      </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="shield-checkmark-outline" size={19} color={theme.primary} />
            <Text style={styles.sectionTitle}>Safety Marking Privacy</Text>
          </View>

          <SettingSwitchRow
            theme={theme}
            styles={styles}
            icon="location-outline"
            title="Share my Safety Marking location"
            helper="When enabled, your profile marker may appear on the Safety Marking map so responders and nearby users can see your safety status. Turn this off if you do not want to share your location."
            value={shareSafetyLocation}
            disabled={privacySaving || !user?._id}
            onValueChange={handleShareSafetyLocationChange}
            isLast
          />
        </View>

        <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="volume-high-outline" size={19} color={theme.primary} />
          <Text style={styles.sectionTitle}>Notification sounds</Text>
        </View>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : (
          <>
            <SettingSwitchRow
              theme={theme}
              styles={styles}
              icon="notifications-outline"
              title="Normal Notification Sound"
              helper="Guidelines, announcements, safety marking updates"
              value={soundSettings.normalNotificationSound}
              onValueChange={(value) =>
                setSoundSetting("normalNotificationSound", value)
              }
            />

            <SettingSwitchRow
              theme={theme}
              styles={styles}
              icon="chatbubble-ellipses-outline"
              title="SMS Alert Sound"
              helper="Alerts that are also delivered by text message"
              value={soundSettings.smsNotificationSound}
              onValueChange={(value) =>
                setSoundSetting("smsNotificationSound", value)
              }
            />

            <SettingSwitchRow
              theme={theme}
              styles={styles}
              icon="warning-outline"
              title="Danger Alert Sound"
              helper="Nearby incidents, road hazards, emergency alerts"
              value={soundSettings.dangerNotificationSound}
              onValueChange={(value) =>
                setSoundSetting("dangerNotificationSound", value)
              }
              isLast
            />
          </>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="contrast-outline" size={19} color={theme.primary} />
          <Text style={styles.sectionTitle}>Appearance</Text>
        </View>

        <View style={styles.themeOptions}>
          {THEME_OPTIONS.map((option) => {
            const active = mode === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.themeOption, active && styles.themeOptionActive]}
                onPress={() => setMode(option.value)}
                activeOpacity={0.86}
              >
                <Ionicons
                  name={option.icon}
                  size={18}
                  color={active ? theme.buttonText : theme.primary}
                />
                <Text style={[styles.themeOptionText, active && styles.themeOptionTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.helperText}>
          Current display: {resolvedMode === "dark" ? "Dark" : "Light"}
        </Text>
        </View>
      </ScrollView>

      <Modal
        visible={privacyConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPrivacyConfirmVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <Ionicons name="location-outline" size={24} color={theme.primary} />
            </View>
            <Text style={styles.modalTitle}>Share Safety Location?</Text>
            <Text style={styles.modalMessage}>
              Your profile marker and safety status may be visible to other users inside the Safety Marking map. You can turn this off anytime in Settings.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={() => setPrivacyConfirmVisible(false)}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={handleAllowSharing}
              >
                <Text style={styles.modalButtonPrimaryText}>Allow Sharing</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function SettingSwitchRow({
  theme,
  styles,
  icon,
  title,
  helper,
  value,
  onValueChange,
  disabled = false,
  isLast = false,
}) {
  return (
    <View style={[styles.settingRow, isLast && styles.settingRowLast]}>
      <View style={styles.settingIcon}>
        <Ionicons name={icon} size={18} color={theme.primary} />
      </View>
      <View style={styles.settingCopy}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingHelper}>{helper}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: theme.border, true: theme.primarySoft }}
        thumbColor={value ? theme.primary : theme.muted}
      />
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      padding: 18,
      paddingBottom: 36,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 18,
    },
    iconButton: {
      width: 42,
      height: 42,
      borderRadius: 14,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    headerCopy: {
      flex: 1,
    },
    title: {
      color: theme.text,
      fontSize: 28,
      fontWeight: "900",
    },
    subtitle: {
      marginTop: 3,
      color: theme.muted,
      fontSize: 13,
      fontWeight: "700",
    },
    section: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 18,
      padding: 14,
      marginBottom: 16,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 12,
    },
    sectionTitle: {
      color: theme.text,
      fontSize: 16,
      fontWeight: "900",
    },
    loadingRow: {
      minHeight: 82,
      alignItems: "center",
      justifyContent: "center",
    },
    settingRow: {
      minHeight: 72,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      paddingVertical: 10,
    },
    settingRowLast: {
      borderBottomWidth: 0,
    },
    settingIcon: {
      width: 38,
      height: 38,
      borderRadius: 14,
      backgroundColor: theme.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    settingCopy: {
      flex: 1,
      minWidth: 0,
      paddingRight: 10,
    },
    settingTitle: {
      color: theme.text,
      fontSize: 14,
      fontWeight: "900",
    },
    settingHelper: {
      marginTop: 4,
      color: theme.muted,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
    },
    themeOptions: {
      flexDirection: "row",
      gap: 8,
    },
    themeOption: {
      flex: 1,
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 6,
      paddingHorizontal: 8,
    },
    themeOptionActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    themeOptionText: {
      color: theme.primary,
      fontSize: 12,
      fontWeight: "900",
    },
    themeOptionTextActive: {
      color: theme.buttonText,
    },
    helperText: {
      marginTop: 12,
      color: theme.muted,
      fontSize: 12,
      fontWeight: "700",
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(15,23,42,0.52)",
      alignItems: "center",
      justifyContent: "center",
      padding: 22,
    },
    modalCard: {
      width: "100%",
      maxWidth: 420,
      borderRadius: 18,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 18,
    },
    modalIcon: {
      width: 46,
      height: 46,
      borderRadius: 16,
      backgroundColor: theme.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    modalTitle: {
      color: theme.text,
      fontSize: 18,
      fontWeight: "900",
      marginBottom: 8,
    },
    modalMessage: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "600",
    },
    modalActions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 18,
    },
    modalButton: {
      flex: 1,
      minHeight: 46,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    modalButtonSecondary: {
      backgroundColor: theme.surfaceAlt,
      borderWidth: 1,
      borderColor: theme.border,
    },
    modalButtonPrimary: {
      backgroundColor: theme.primary,
    },
    modalButtonSecondaryText: {
      color: theme.text,
      fontSize: 13,
      fontWeight: "900",
    },
    modalButtonPrimaryText: {
      color: theme.buttonText,
      fontSize: 13,
      fontWeight: "900",
    },
  });
}
