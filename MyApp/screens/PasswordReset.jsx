import React, { useContext, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import api from "../lib/api";
import PasswordStrengthMeter from "./components/PasswordStrengthMeter";
import useFormAutoScroll from "./hooks/useFormAutoScroll";
import { getPasswordError } from "./utils/validation";
import { UserContext } from "./UserContext";

export default function PasswordReset({ route, navigation }) {
  const userId = route?.params?.userId;
  const email = route?.params?.email;
  const resetToken = route?.params?.resetToken;

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSkipPanel, setShowSkipPanel] = useState(false);
  const { scrollRef, registerInput, scrollToInput } = useFormAutoScroll(36);
  const { setUser } = useContext(UserContext);

  const passwordError = getPasswordError(newPassword);
  const confirmError =
    confirmPassword && newPassword !== confirmPassword ? "Passwords do not match." : "";
  const canSubmit =
    Boolean(userId) &&
    Boolean(resetToken) &&
    !passwordError &&
    !confirmError &&
    Boolean(confirmPassword) &&
    !submitting;

  const updatePassword = async () => {
    if (!userId || !resetToken) {
      Alert.alert("Reset unavailable", "Missing account information. Please verify again.");
      navigation.replace("EmailVerifyer");
      return;
    }

    if (!canSubmit) {
      Alert.alert("Check password", passwordError || confirmError || "Complete all fields.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.post("/user/forgot-password/reset-password", {
        userId,
        resetToken,
        newPassword,
      });
      const updatedUser = res?.data?.user;

      Alert.alert("Password updated", "Password changed successfully.", [
        {
          text: "Continue",
          onPress: () => {
            if (updatedUser) {
              setUser({ ...updatedUser, id: updatedUser._id }, { persist: true });
            } else {
              navigation.replace("LogIn");
            }
          },
        },
      ]);
    } catch (error) {
      Alert.alert(
        "Reset failed",
        error.response?.data?.message || "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const skipReset = async () => {
    if (!userId || !resetToken) {
      Alert.alert("Reset unavailable", "OTP verification is required before skipping.");
      navigation.replace("EmailVerifyer");
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.post("/user/forgot-password/skip-reset", {
        userId,
        resetToken,
      });
      const updatedUser = res?.data?.user;

      if (updatedUser) {
        setUser({ ...updatedUser, id: updatedUser._id }, { persist: true });
      } else {
        navigation.replace("LogIn");
      }
    } catch (error) {
      Alert.alert(
        "Skip unavailable",
        error.response?.data?.message || "Please verify your OTP again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (showSkipPanel) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerContainer}>
          <View style={styles.card}>
            <View style={styles.iconCircle}>
              <Ionicons name="shield-checkmark-outline" size={24} color="#14532D" />
            </View>
            <Text style={styles.title}>Password Change Skipped</Text>
            <Text style={styles.subtitle}>
              You have successfully verified your identity, but your password has not been changed.
              For your account security, you may be asked to complete this process again the next
              time you use Forgot Password. You can also update your password anytime through
              Settings and Security.
            </Text>

            <TouchableOpacity
              style={[styles.button, submitting && styles.buttonDisabled]}
              onPress={skipReset}
              disabled={submitting}
            >
              <Text style={styles.buttonText}>
                {submitting ? "Continuing..." : "Understood"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setShowSkipPanel(false)}
              disabled={submitting}
            >
              <Text style={styles.secondaryButtonText}>Go Back and Change Password</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.container}
        >
          <View style={styles.card}>
            <View style={styles.iconCircle}>
              <Ionicons name="lock-closed-outline" size={24} color="#14532D" />
            </View>
            <Text style={styles.title}>Set new password</Text>
            <Text style={styles.subtitle}>
              {email ? `For ${email}` : "Create a new password for your account."}
            </Text>

            <TextInput
              placeholder="New password"
              secureTextEntry={!showPassword}
              value={newPassword}
              onChangeText={setNewPassword}
              onFocus={() => scrollToInput("newPassword")}
              onLayout={registerInput("newPassword")}
              maxLength={64}
              style={styles.input}
              placeholderTextColor="#7b867f"
            />
            {!!newPassword && !!passwordError && (
              <Text style={styles.error}>{passwordError}</Text>
            )}
            <PasswordStrengthMeter
              password={newPassword}
              style={styles.strengthMeter}
              textColor="#647067"
              mutedColor="#94A3B8"
              surfaceColor="#EEF4EF"
              borderColor="#DCE7DD"
            />

            <TextInput
              placeholder="Confirm password"
              secureTextEntry={!showPassword}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              onFocus={() => scrollToInput("confirmPassword")}
              onLayout={registerInput("confirmPassword")}
              maxLength={64}
              style={styles.input}
              placeholderTextColor="#7b867f"
            />
            {!!confirmError && <Text style={styles.error}>{confirmError}</Text>}

            <TouchableOpacity
              style={styles.toggle}
              onPress={() => setShowPassword((value) => !value)}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={17}
                color="#14532D"
              />
              <Text style={styles.toggleText}>
                {showPassword ? "Hide passwords" : "Show passwords"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, !canSubmit && styles.buttonDisabled]}
              onPress={updatePassword}
              disabled={!canSubmit}
            >
              <Text style={styles.buttonText}>
                {submitting ? "Updating..." : "Reset password"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setShowSkipPanel(true)}
              disabled={submitting}
            >
              <Text style={styles.secondaryButtonText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F4F8F2",
  },
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    padding: 22,
    borderWidth: 1,
    borderColor: "#E1EAE4",
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E7F0E2",
    marginBottom: 14,
  },
  title: {
    color: "#10251B",
    fontSize: 24,
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 20,
    color: "#647067",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: "#CBD8CF",
    borderRadius: 16,
    padding: 14,
    backgroundColor: "#FBFDFC",
    marginBottom: 10,
  },
  error: {
    marginBottom: 10,
    color: "#B91C1C",
    fontSize: 12,
    fontWeight: "800",
  },
  strengthMeter: {
    marginBottom: 12,
  },
  toggle: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 16,
  },
  toggleText: {
    color: "#14532D",
    fontSize: 12,
    fontWeight: "900",
  },
  button: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#14532D",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#CBD8CF",
    backgroundColor: "#FFFFFF",
  },
  secondaryButtonText: {
    color: "#14532D",
    fontWeight: "900",
    textAlign: "center",
  },
});
