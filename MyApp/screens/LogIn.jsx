import React, { useContext, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import SagipBayanLogoWhite from "../stores/assets/sagipbayanlogowhite.png";
import api from "../lib/api";
import styles, { COLORS } from "../Designs/LogIn";
import { UserContext } from "./UserContext";
import { sanitizeUsername } from "./utils/validation";

export default function LogIn({ navigation }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);

  const { setUser } = useContext(UserContext);

  const getLoginErrorMessage = (err) => {
    const raw =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "";
    const text = String(raw).toLowerCase();

    if (text.includes("verified")) {
      return "Please complete phone and email verification before signing in.";
    }

    if (err?.response?.status === 401 || text.includes("invalid")) {
      return "Invalid username or password.";
    }

    if (text.includes("network") || text.includes("timeout")) {
      return "Please check your connection and try again.";
    }

    return raw || "Login failed. Please check your account.";
  };

  const validate = () => {
    if (!sanitizeUsername(username)) {
      setError("Username is required.");
      return false;
    }

    if (!String(password || "").trim()) {
      setError("Password is required.");
      return false;
    }

    return true;
  };

  const handleLogin = async () => {
    setError("");

    if (isSubmitting || !validate()) return;

    setIsSubmitting(true);

    try {
      const cleanUsername = sanitizeUsername(username);
      const res = await api.post("/user/login", {
        username: cleanUsername,
        password: String(password || "").trim(),
      });
      const data = res.data || {};

      if (data.twoFactor && data.email) {
        navigation.navigate("VerifyOtp", {
          userId: data.userId,
          email: data.email,
          purpose: "two_factor",
        });
        await api.post("/user/send-otp", { email: data.email, purpose: "two_factor" });
        return;
      }

      if (!data.user?._id) {
        setError("We could not complete sign-in. Please try again.");
        return;
      }

      setUser({
        ...data.user,
        id: data.user._id,
      }, { persist: staySignedIn });

      setUsername("");
      setPassword("");
    } catch (err) {
      setError(getLoginErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.header}>
            <View pointerEvents="none" style={styles.headerPattern}>
              <View style={styles.headerGlow} />
              <View style={styles.headerCircleTop} />
              <View style={styles.headerCircleLeft} />
              <View style={styles.headerCircleRight} />
              <View style={styles.headerGoldDot} />
            </View>

            <Image
              source={SagipBayanLogoWhite}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.headerTitle}>Let's get you Login!</Text>
            <Text style={styles.headerSubtitle}>
              Hi! Welcome back, you've been missed
            </Text>
          </View>

          <View style={styles.panel}>
            <View style={styles.panelContent}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Username</Text>
                <TextInput
                  ref={usernameRef}
                  style={[
                    styles.inputField,
                    focusedField === "username" && styles.inputFieldFocused,
                  ]}
                  placeholder="Enter username"
                  placeholderTextColor={COLORS.placeholder}
                  value={username}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onFocus={() => setFocusedField("username")}
                  onBlur={() =>
                    setFocusedField((current) =>
                      current === "username" ? null : current
                    )
                  }
                  onChangeText={(text) => setUsername(sanitizeUsername(text))}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Password</Text>
                <View style={styles.passwordWrap}>
                  <TextInput
                    ref={passwordRef}
                    style={[
                      styles.inputField,
                      styles.passwordField,
                      focusedField === "password" && styles.inputFieldFocused,
                    ]}
                    placeholder="Enter password"
                    placeholderTextColor={COLORS.placeholder}
                    secureTextEntry={!showPassword}
                    value={password}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                    onFocus={() => setFocusedField("password")}
                    onBlur={() =>
                      setFocusedField((current) =>
                        current === "password" ? null : current
                      )
                    }
                    onChangeText={setPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowPassword((value) => !value)}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={showPassword ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color={COLORS.muted}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.optionsRow}>
                <TouchableOpacity
                  style={styles.staySignedInButton}
                  activeOpacity={0.82}
                  onPress={() => setStaySignedIn((value) => !value)}
                >
                  <Ionicons
                    name={staySignedIn ? "checkbox" : "square-outline"}
                    size={19}
                    color={COLORS.primary}
                  />
                  <Text style={styles.staySignedInText}>Remember me</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => navigation.navigate("EmailVerifyer")}>
                  <Text style={styles.linkText}>Forgot Password?</Text>
                </TouchableOpacity>
              </View>

              {!!error && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={17} color={COLORS.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.loginButton, isSubmitting && styles.loginButtonDisabled]}
                onPress={handleLogin}
                disabled={isSubmitting}
                activeOpacity={0.86}
              >
                {isSubmitting ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
                <Text style={styles.loginButtonText}>
                  {isSubmitting ? "Signing in..." : "Sign In"}
                </Text>
              </TouchableOpacity>

              <Text style={styles.registerText}>
                Don't have an account?{" "}
                <Text
                  style={styles.registerLink}
                  onPress={() => navigation.navigate("DataPrivacy")}
                >
                  Sign Up
                </Text>
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
