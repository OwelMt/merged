// screens/Profile.jsx
import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";

import { UserContext } from "./UserContext";
import { useTheme } from "./contexts/ThemeContext";
import api, { getApiBaseUrl } from "../lib/api";
import { safeDisplayText } from "./utils/validation";

const DEFAULT_AVATAR =
  "https://ui-avatars.com/api/?background=E5E7EB&color=6B7280&rounded=true&name=User";

export default function Profile({ navigation }) {
  const { user, setUser } = useContext(UserContext);
  const { theme } = useTheme();
  const themed = useMemo(() => createProfileThemeStyles(theme), [theme]);
  const [avatarUri, setAvatarUri] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (user?.avatar) {
      setAvatarUri(user.avatar || null);
    }
  }, [user?.avatar]);

  const changeAvatar = async () => {
    if (!user?._id || uploading) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== "granted") {
      Alert.alert("Permission required", "Please allow photo access.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: true,
    });

    if (result.canceled || !Array.isArray(result.assets) || !result.assets[0]?.uri) {
      return;
    }

    const picked = result.assets[0];
    const mimeType = picked.mimeType || "image/jpeg";

    if (!mimeType.startsWith("image/")) {
      Alert.alert("Invalid File", "Please choose an image file.");
      return;
    }

    setAvatarUri(picked.uri);

    try {
      setUploading(true);

      const API_BASE_URL = await getApiBaseUrl();

      const uploadResult = await FileSystem.uploadAsync(
        `${API_BASE_URL}/user/avatar/${user._id}`,
        picked.uri,
        {
          httpMethod: "PUT",
          uploadType: 1,
          fieldName: "avatar",
          mimeType,
          parameters: {},
        }
      );

      let responseData = {};

      try {
        responseData = uploadResult.body ? JSON.parse(uploadResult.body) : {};
      } catch (_) {
        responseData = { message: uploadResult.body };
      }

      console.log("Avatar upload response:", {
        status: uploadResult.status,
        body: responseData,
      });

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(responseData?.message || "Avatar upload failed.");
      }

      const updatedUser = responseData?.user || {
        ...user,
        avatar: responseData?.avatar || picked.uri,
      };

      setUser(updatedUser);
      setAvatarUri(updatedUser.avatar || picked.uri);

      Alert.alert("Profile updated", "Your profile picture has been updated.");
    } catch (err) {
      console.log("Avatar upload failed:", {
        message: err?.message,
        data: err?.response?.data,
        status: err?.response?.status,
      });

      Alert.alert("Upload failed", err?.message || "Please try again.");
      setAvatarUri(user.avatar || null);
    } finally {
      setUploading(false);
    }
  };

  if (!user) return null;

  const isSafe = user.safetyStatus === "SAFE";
  const statusLabel = isSafe ? "SAFE" : "NEEDS CHECK-IN";

  return (
    <ScrollView
      style={[styles.container, themed.screen]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <TouchableOpacity style={[styles.headerIcon, themed.card]} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={theme.primary} />
        </TouchableOpacity>

        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, themed.text]}>Account</Text>
          <Text style={[styles.headerSubtitle, themed.subtext]}>Profile and safety identity</Text>
        </View>

        <View style={[styles.headerIconGhost, themed.softIcon]}>
          <Ionicons name="shield-checkmark-outline" size={21} color={theme.primary} />
        </View>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroTop}>
          <TouchableOpacity
            onPress={changeAvatar}
            disabled={uploading}
            style={[
              styles.avatarRing,
              { borderColor: isSafe ? "#22C55E" : "#EF4444" },
            ]}
          >
            <Image source={{ uri: avatarUri || DEFAULT_AVATAR }} style={styles.avatar} />

            {uploading && (
              <View style={styles.overlay}>
                <ActivityIndicator color="#fff" />
              </View>
            )}

            <View style={styles.cameraBadge}>
              <Ionicons name="camera-outline" size={15} color="#ffffff" />
            </View>
          </TouchableOpacity>

          <View style={styles.identityBlock}>
            <Text style={styles.name}>
              {safeDisplayText(user.fname, "User")} {safeDisplayText(user.lname, "")}
            </Text>

            <Text style={styles.username}>
              @{safeDisplayText(user.username, "resident")}
            </Text>

            <View
              style={[
                styles.statusPill,
                { backgroundColor: isSafe ? "#DCFCE7" : "#FEE2E2" },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isSafe ? "#22C55E" : "#EF4444" },
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: isSafe ? "#166534" : "#991B1B" },
                ]}
              >
                {statusLabel}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoTile}>
            <Text style={styles.infoLabel}>Phone</Text>
            <Text style={styles.infoValue} numberOfLines={1}>
              {safeDisplayText(user.phone, "Not set")}
            </Text>
          </View>

          <View style={styles.infoTile}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue} numberOfLines={1}>
              {safeDisplayText(user.email, "Not set")}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.summaryStrip}>
        <View style={styles.summaryPill}>
          <Ionicons name="checkmark-circle-outline" size={16} color="#166534" />
          <Text style={styles.summaryPillText}>Account active</Text>
        </View>

        <View style={styles.summaryPillSoft}>
          <Ionicons name="shield-half-outline" size={16} color="#6B7C3F" />
          <Text style={styles.summaryPillSoftText}>Safety-ready profile</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, themed.text]}>Manage account</Text>

        <ActionRow
          theme={theme}
          icon="person-outline"
          title="Personal Details"
          subtitle="Name, username, phone and email"
          onPress={() => navigation.navigate("PersonalDetails")}
        />

        <ActionRow
          theme={theme}
          icon="lock-closed-outline"
          title="Password & Security"
          subtitle="Password rules and two-factor settings"
          onPress={() => navigation.navigate("PasswordSecurity")}
        />
      </View>

      <View style={styles.dangerCard}>
        <View style={styles.dangerCopy}>
          <Text style={styles.dangerTitle}>Delete account</Text>
          <Text style={styles.dangerSub}>Permanently remove your profile data.</Text>
        </View>

        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() =>
            Alert.alert("Delete Account", "Are you sure you want to delete your account?", [
              { text: "Cancel" },
              { text: "Delete", style: "destructive" },
            ])
          }
        >
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function ActionRow({ icon, title, subtitle, onPress, theme }) {
  return (
    <TouchableOpacity
      style={[
        styles.actionRow,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
      onPress={onPress}
      activeOpacity={0.84}
    >
      <View style={[styles.actionIcon, { backgroundColor: theme.primarySoft }]}>
        <Ionicons name={icon} size={20} color={theme.primary} />
      </View>

      <View style={styles.actionCopy}>
        <Text style={[styles.actionTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.actionSubtitle, { color: theme.subtext }]}>{subtitle}</Text>
      </View>

      <Ionicons name="chevron-forward" size={19} color={theme.subtext} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F7F3",
  },
  content: {
    paddingTop: 38,
    paddingHorizontal: 18,
    paddingBottom: 42,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E1EAE4",
  },
  headerIconGhost: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#E7F4EA",
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#10251B",
  },
  headerSubtitle: {
    marginTop: 2,
    color: "#647067",
    fontSize: 12,
    fontWeight: "600",
  },
  heroCard: {
    backgroundColor: "#355A2C",
    borderRadius: 24,
    padding: 18,
    shadowColor: "#16311E",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 4,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarRing: {
    width: 102,
    height: 102,
    borderRadius: 30,
    borderWidth: 3,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
  avatar: {
    width: 92,
    height: 92,
    borderRadius: 26,
    backgroundColor: "#E5E7EB",
  },
  overlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 26,
  },
  cameraBadge: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: "#14532D",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  identityBlock: {
    flex: 1,
    marginLeft: 14,
    minWidth: 0,
  },
  name: {
    fontSize: 21,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  username: {
    marginTop: 4,
    color: "rgba(255,255,255,0.76)",
    fontSize: 13,
    fontWeight: "600",
  },
  statusPill: {
    marginTop: 10,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "900",
  },
  infoGrid: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  infoTile: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
    padding: 12,
  },
  infoLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.72)",
    fontWeight: "800",
    textTransform: "uppercase",
  },
  infoValue: {
    marginTop: 5,
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },
  summaryStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
    marginBottom: 8,
  },
  summaryPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#E8F5EA",
    borderWidth: 1,
    borderColor: "#CFE7D3",
  },
  summaryPillText: {
    marginLeft: 6,
    color: "#166534",
    fontSize: 12,
    fontWeight: "800",
  },
  summaryPillSoft: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F3F1DF",
    borderWidth: 1,
    borderColor: "#E8E0B5",
  },
  summaryPillSoftText: {
    marginLeft: 6,
    color: "#6B7C3F",
    fontSize: 12,
    fontWeight: "800",
  },
  section: {
    marginTop: 18,
  },
  sectionTitle: {
    marginBottom: 10,
    color: "#10251B",
    fontSize: 14,
    fontWeight: "900",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E1EAE4",
    shadowColor: "#0F2319",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: "#E7F4EA",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  actionCopy: {
    flex: 1,
  },
  actionTitle: {
    color: "#10251B",
    fontSize: 15,
    fontWeight: "900",
  },
  actionSubtitle: {
    marginTop: 3,
    color: "#6B7280",
    fontSize: 12,
    fontWeight: "600",
  },
  dangerCard: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF5F5",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  dangerCopy: {
    flex: 1,
  },
  dangerTitle: {
    color: "#991B1B",
    fontWeight: "900",
    fontSize: 14,
  },
  dangerSub: {
    color: "#B45353",
    fontSize: 12,
    marginTop: 3,
    fontWeight: "600",
  },
  deleteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
  },
  deleteText: {
    color: "#B91C1C",
    fontWeight: "900",
  },
});

function createProfileThemeStyles(theme) {
  return StyleSheet.create({
    screen: {
      backgroundColor: theme.background,
    },
    card: {
      backgroundColor: theme.card,
      borderColor: theme.border,
    },
    softIcon: {
      backgroundColor: theme.primarySoft,
    },
    text: {
      color: theme.text,
    },
    subtext: {
      color: theme.subtext,
    },
  });
}
