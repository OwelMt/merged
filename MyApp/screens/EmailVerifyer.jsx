import React, { useMemo, useRef, useState } from "react";
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
import useFormAutoScroll from "./hooks/useFormAutoScroll";
import { sanitizeEmailInput } from "./utils/validation";

const OTP_LENGTH = 6;

export default function EmailVerifyer({ navigation }) {
  const [step, setStep] = useState("identify");
  const [identifier, setIdentifier] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const { scrollRef, registerInput, scrollToInput } = useFormAutoScroll(36);
  const otpInputRef = useRef(null);

  const options = useMemo(
    () => (Array.isArray(lookupResult?.options) ? lookupResult.options : []),
    [lookupResult]
  );

  const lookupAccount = async () => {
    const cleanIdentifier = sanitizeEmailInput(identifier);

    if (!cleanIdentifier) {
      Alert.alert("Missing account", "Enter your email, username, or phone number.");
      return;
    }

    try {
      setLoading(true);
      const res = await api.post("/user/forgot-password/lookup", {
        identifier: cleanIdentifier,
      });
      const result = res?.data || {};

      if (!Array.isArray(result.options) || result.options.length === 0) {
        Alert.alert("No recovery method", "This account has no email or phone number.");
        return;
      }

      setLookupResult(result);
      setStep("choose");
    } catch (err) {
      Alert.alert(
        "Account not found",
        err.response?.data?.message || "We could not find that account."
      );
    } finally {
      setLoading(false);
    }
  };

  const sendOtp = async (channel) => {
    if (!lookupResult?.userId || !channel) return;

    try {
      setLoading(true);
      await api.post("/user/forgot-password/send-otp", {
        userId: lookupResult.userId,
        channel,
      });
      setSelectedChannel(channel);
      setOtp("");
      setStep("otp");
      requestAnimationFrame(() => otpInputRef.current?.focus?.());
    } catch (err) {
      Alert.alert(
        "Unable to send OTP",
        err.response?.data?.message || "Please try again shortly."
      );
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (!lookupResult?.userId || !selectedChannel || !/^\d{6}$/.test(otp)) {
      Alert.alert("Invalid code", "Please enter the full 6-digit OTP.");
      return;
    }

    try {
      setLoading(true);
      const res = await api.post("/user/forgot-password/verify-otp", {
        userId: lookupResult.userId,
        channel: selectedChannel,
        otp,
      });
      const result = res?.data || {};

      navigation.replace("PasswordReset", {
        userId: lookupResult.userId,
        resetToken: result.resetToken,
        channel: selectedChannel,
        email: identifier,
      });
    } catch (err) {
      Alert.alert(
        "Verification failed",
        err.response?.data?.message || "Invalid or expired OTP."
      );
    } finally {
      setLoading(false);
    }
  };

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
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            {step === "identify" && (
              <>
                <Text style={styles.eyebrow}>Account Recovery</Text>
                <Text style={styles.title}>Find your account</Text>
                <Text style={styles.subtitle}>
                  Enter your email, username, or phone number to choose a verification method.
                </Text>

                <TextInput
                  placeholder="Email, username, or phone number"
                  value={identifier}
                  onChangeText={setIdentifier}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={() => scrollToInput("identifier")}
                  onLayout={registerInput("identifier")}
                  maxLength={120}
                  style={styles.input}
                  placeholderTextColor="#7b867f"
                />

                <TouchableOpacity
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={lookupAccount}
                  disabled={loading}
                >
                  <Text style={styles.buttonText}>
                    {loading ? "Checking..." : "Continue"}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {step === "choose" && (
              <>
                <Text style={styles.eyebrow}>Account Recovery</Text>
                <Text style={styles.title}>Choose Verification Method</Text>
                <Text style={styles.subtitle}>
                  Please choose where you would like to receive your one-time password.
                </Text>

                {options.map((item) => (
                  <TouchableOpacity
                    key={item.channel}
                    style={styles.optionButton}
                    onPress={() => sendOtp(item.channel)}
                    disabled={loading}
                  >
                    <Ionicons
                      name={item.channel === "sms" ? "phone-portrait-outline" : "mail-outline"}
                      size={20}
                      color="#14532D"
                    />
                    <Text style={styles.optionText}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {step === "otp" && (
              <>
                <Text style={styles.eyebrow}>Verification</Text>
                <Text style={styles.title}>Enter OTP</Text>
                <Text style={styles.subtitle}>
                  We sent a 6-digit code by {selectedChannel === "sms" ? "SMS" : "Email"}.
                </Text>

                <TextInput
                  ref={otpInputRef}
                  placeholder="6-digit code"
                  value={otp}
                  onChangeText={(value) =>
                    setOtp(String(value || "").replace(/\D/g, "").slice(0, OTP_LENGTH))
                  }
                  keyboardType="number-pad"
                  maxLength={OTP_LENGTH}
                  style={[styles.input, styles.otpInput]}
                  placeholderTextColor="#7b867f"
                />

                <TouchableOpacity
                  style={[
                    styles.button,
                    (loading || otp.length !== OTP_LENGTH) && styles.buttonDisabled,
                  ]}
                  onPress={verifyOtp}
                  disabled={loading || otp.length !== OTP_LENGTH}
                >
                  <Text style={styles.buttonText}>
                    {loading ? "Verifying..." : "Verify OTP"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.linkButton} onPress={() => sendOtp(selectedChannel)}>
                  <Text style={styles.linkButtonText}>Resend code</Text>
                </TouchableOpacity>
              </>
            )}
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
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  backButton: {
    position: "absolute",
    top: 18,
    left: 20,
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 14,
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E1EAE4",
  },
  backText: {
    color: "#14532D",
    fontWeight: "900",
  },
  card: {
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    padding: 22,
    borderWidth: 1,
    borderColor: "#E1EAE4",
  },
  eyebrow: {
    color: "#1D6B41",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    marginTop: 6,
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
    marginBottom: 14,
  },
  otpInput: {
    textAlign: "center",
    fontSize: 20,
    letterSpacing: 0,
  },
  button: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#14532D",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  optionButton: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DCE7DD",
    backgroundColor: "#FBFDFC",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 10,
  },
  optionText: {
    flex: 1,
    color: "#10251B",
    fontWeight: "800",
  },
  linkButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  linkButtonText: {
    color: "#14532D",
    fontWeight: "900",
  },
});
