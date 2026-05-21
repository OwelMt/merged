// screens/PasswordSecurity.jsx
import React, { useContext, useMemo, useState } from "react";
import {
  TextInput,
  View,
  Text,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  Switch,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import api from "../lib/api";
import { UserContext } from "./UserContext";
import { useTheme } from "./contexts/ThemeContext";
import PasswordStrengthMeter from "./components/PasswordStrengthMeter";
import styles, { COLORS } from "../Designs/PasswordSecurity";
import { getPasswordError, getPasswordRequirements } from "./utils/validation";

function getUserId(user) {
  return user?._id || user?.id || user?.userId || "";
}

export default function PasswordSecurity({ navigation }) {
  const { user, setUser } = useContext(UserContext);
  const { theme } = useTheme();
  const themed = useMemo(() => createPasswordThemeStyles(theme), [theme]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [newPasswordError, setNewPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(
    Boolean(user?.twoFactorEnabled)
  );

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [submitError, setSubmitError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isToggling2FA, setIsToggling2FA] = useState(false);

  const userId = getUserId(user);

  const handleNewPassword = (text) => {
    const cleanText = text.trim();

    setNewPassword(cleanText);
    setSubmitError("");
    setNewPasswordError(getPasswordError(cleanText));

    if (confirmPassword && cleanText !== confirmPassword) {
      setConfirmPasswordError("Passwords do not match.");
    } else {
      setConfirmPasswordError("");
    }
  };

  const handleConfirmPassword = (text) => {
    const cleanText = text.trim();

    setConfirmPassword(cleanText);
    setSubmitError("");

    if (cleanText.length === 0) {
      setConfirmPasswordError("Confirm password is required.");
    } else if (cleanText !== newPassword) {
      setConfirmPasswordError("Passwords do not match.");
    } else {
      setConfirmPasswordError("");
    }
  };

  const updatePassword = async () => {
    const cleanCurrentPassword = currentPassword.trim();

    setSubmitError("");

    if (!userId) {
      setSubmitError("Missing user ID. Please log in again.");
      Alert.alert("Update failed", "Missing user ID. Please log in again.");
      return;
    }

    if (!cleanCurrentPassword) {
      setSubmitError("Current password is required.");
      return;
    }

    const passwordError = getPasswordError(newPassword);
    if (passwordError) {
      setNewPasswordError(passwordError);
      setSubmitError("Please fix the password errors first.");
      return;
    }

    if (!newPassword || !confirmPassword) {
      setSubmitError("Password fields cannot be empty.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setConfirmPasswordError("Passwords do not match.");
      setSubmitError("Passwords do not match.");
      return;
    }

    if (newPassword === cleanCurrentPassword) {
      setSubmitError("New password must be different from the current password.");
      return;
    }

    if (isSaving) return;

    try {
      setIsSaving(true);

      const response = await api.put(`/user/update/${userId}`, {
        password: newPassword,
      });

      const updatedUser = response?.data || {};

      setUser({
        ...user,
        ...updatedUser,
        _id: updatedUser?._id || user?._id || userId,
        id: updatedUser?.id || user?.id || userId,
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNewPasswordError("");
      setConfirmPasswordError("");
      setSubmitError("");

      Alert.alert("Security updated", "Your password has been updated.");
    } catch (error) {
      console.log("Password update failed:", {
        url: `/user/update/${userId}`,
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
      });

      const message =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        "Failed to update password.";

      setSubmitError(message);
      Alert.alert("Update failed", message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggle2FA = async (value) => {
    if (!userId || isToggling2FA) {
      if (!userId) {
        Alert.alert("Update failed", "Missing user ID. Please log in again.");
      }
      return;
    }

    const previousValue = twoFactorEnabled;

    try {
      setIsToggling2FA(true);
      setTwoFactorEnabled(value);

      await api.put(`/user/twofactor/${userId}`, {
        enabled: value,
      });

      setUser({
        ...user,
        _id: user?._id || userId,
        id: user?.id || userId,
        twoFactorEnabled: value,
      });
    } catch (err) {
      console.log("Two-factor update failed:", {
        url: `/user/twofactor/${userId}`,
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
      });

      setTwoFactorEnabled(previousValue);

      Alert.alert(
        "Update failed",
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          "Unable to update two-factor authentication."
      );
    } finally {
      setIsToggling2FA(false);
    }
  };

  if (!user) return <Text>No user logged in</Text>;

  const matches = Boolean(confirmPassword && !confirmPasswordError);

  return (
    <KeyboardAvoidingView
      style={[styles.webFrame, themed.screen]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
    >
      <ScrollView
        style={[styles.phone, themed.screen]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={[styles.backBtn, themed.card]}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="chevron-back" size={22} color={theme.primary} />
          </TouchableOpacity>

          <View style={styles.headerCopy}>
            <Text style={[styles.headerTitle, themed.text]}>Password & Security</Text>
            <Text style={[styles.subText, themed.subtext]}>
              Protect account access and sign-in recovery.
            </Text>
          </View>
        </View>

        <View style={[styles.securityHero, themed.card]}>
          <View style={[styles.heroIcon, themed.softCard]}>
            <Ionicons
              name="shield-checkmark-outline"
              size={28}
              color={theme.primary}
            />
          </View>

          <View style={styles.heroCopy}>
            <Text style={[styles.heroTitle, themed.text]}>Security center</Text>
            <Text style={[styles.heroText, themed.subtext]}>
              Use a unique password and keep two-factor authentication ready for
              sensitive changes.
            </Text>
          </View>
        </View>

        <View style={[styles.sectionCard, themed.card]}>
          <Text style={[styles.sectionTitle, themed.text]}>Change password</Text>

          <PasswordField
            label="Current Password"
            value={currentPassword}
            onChangeText={(value) => {
              setCurrentPassword(value.trim());
              if (submitError) setSubmitError("");
            }}
            visible={showCurrentPassword}
            onToggleVisibility={() => setShowCurrentPassword((prev) => !prev)}
            theme={theme}
            themed={themed}
          />

          <PasswordField
            label="New Password"
            value={newPassword}
            onChangeText={handleNewPassword}
            visible={showNewPassword}
            onToggleVisibility={() => setShowNewPassword((prev) => !prev)}
            theme={theme}
            themed={themed}
          />

          {newPasswordError ? (
            <Text style={styles.error}>{newPasswordError}</Text>
          ) : null}

          <PasswordStrengthMeter
            password={newPassword}
            style={localStyles.strengthMeter}
            textColor={theme.subtext}
            mutedColor={theme.subtext}
            surfaceColor={theme.surfaceAlt}
            borderColor={theme.border}
          />

          <PasswordField
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={handleConfirmPassword}
            visible={showConfirmPassword}
            onToggleVisibility={() => setShowConfirmPassword((prev) => !prev)}
            theme={theme}
            themed={themed}
          />

          {confirmPasswordError ? (
            <Text style={styles.error}>{confirmPasswordError}</Text>
          ) : null}

          {submitError ? <Text style={styles.error}>{submitError}</Text> : null}

          <View style={styles.ruleGrid}>
            {getPasswordRequirements(newPassword).map((item) => (
              <Rule key={item.key} checked={item.met} text={item.label} theme={theme} />
            ))}
            <Rule checked={matches} text="Matches" theme={theme} />
          </View>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.buttonPrimary }, isSaving && { opacity: 0.65 }]}
            onPress={updatePassword}
            disabled={isSaving}
          >
            <Text style={styles.buttonText}>
              {isSaving ? "Saving..." : "Save Security Settings"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.twoFAWrapper, themed.card]}>
          <View style={styles.twoFATop}>
            <View style={[styles.twoFAIcon, themed.softCard]}>
              <Ionicons name="key-outline" size={20} color={theme.primary} />
            </View>

            <View style={styles.twoFACopy}>
              <Text style={[styles.sectionTitle, themed.text]}>Two-Factor Authentication</Text>
              <Text style={[styles.subInfo, themed.subtext]}>
                Require a verification code when signing in.
              </Text>
            </View>

            <Switch
              value={twoFactorEnabled}
              onValueChange={toggle2FA}
              disabled={isToggling2FA}
            />
          </View>

          <Text style={[styles.status, twoFactorEnabled && styles.statusEnabled]}>
            {twoFactorEnabled ? "Enabled" : "Disabled"}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  onToggleVisibility,
  theme,
  themed,
}) {
  return (
    <View style={styles.inputWrap}>
      <Text style={[styles.inputLabel, themed.text]}>{label}</Text>

      <View style={localStyles.passwordFieldShell}>
        <TextInput
          style={[styles.input, localStyles.passwordInput, themed.input]}
          placeholder={label}
          placeholderTextColor={theme.subtext}
          secureTextEntry={!visible}
          value={value}
          onChangeText={onChangeText}
        />

        <TouchableOpacity
          style={localStyles.passwordToggle}
          onPress={onToggleVisibility}
          activeOpacity={0.82}
        >
          <Ionicons
            name={visible ? "eye-off-outline" : "eye-outline"}
            size={18}
            color={theme.primary}
          />
          <Text style={[localStyles.passwordToggleText, { color: theme.primary }]}>
            {visible ? "Hide" : "Show"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Rule({ checked, text, theme }) {
  return (
    <View style={[styles.rulePill, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, checked && styles.rulePillOk]}>
      <Ionicons
        name={checked ? "checkmark-circle" : "ellipse-outline"}
        size={14}
        color={checked ? "#166534" : "#94A3B8"}
      />
      <Text style={[styles.ruleText, { color: theme.subtext }, checked && styles.ruleTextOk]}>{text}</Text>
    </View>
  );
}

const localStyles = StyleSheet.create({
  passwordFieldShell: {
    position: "relative",
    justifyContent: "center",
  },
  passwordInput: {
    paddingRight: 76,
  },
  passwordToggle: {
    position: "absolute",
    right: 12,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#EFF5EF",
    borderWidth: 1,
    borderColor: "#DCE7DD",
    flexDirection: "row",
    alignItems: "center",
  },
  passwordToggleText: {
    marginLeft: 4,
    color: "#355A2C",
    fontSize: 12,
    fontWeight: "800",
  },
  strengthMeter: {
    marginTop: 10,
  },
});

function createPasswordThemeStyles(theme) {
  return StyleSheet.create({
    screen: {
      backgroundColor: theme.background,
    },
    card: {
      backgroundColor: theme.card,
      borderColor: theme.border,
    },
    softCard: {
      backgroundColor: theme.primarySoft,
      borderColor: theme.border,
    },
    text: {
      color: theme.text,
    },
    subtext: {
      color: theme.subtext,
    },
    input: {
      backgroundColor: theme.inputBackground,
      borderColor: theme.border,
      color: theme.text,
    },
  });
}
