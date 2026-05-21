// screens/PersonalDetails.jsx
import React, { useContext, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";

import api from "../lib/api";
import { UserContext } from "./UserContext";
import { useTheme } from "./contexts/ThemeContext";
import styles, { COLORS } from "../Designs/PersonalDetails";
import useFormAutoScroll from "./hooks/useFormAutoScroll";
import {
  getPhoneError,
  getUsernameError,
  safeDisplayText,
  sanitizeIncidentText,
  sanitizePhoneLocal,
  sanitizeUsername,
} from "./utils/validation";

const DISTRICT_OPTIONS = [
  "District 1",
  "District 2",
  "District 3",
  "District 4",
];

const BARANGAY_BY_DISTRICT = {
  "District 1": [
    "Bagong Sikat",
    "Balbalino",
    "Banganan",
    "Langla",
    "Mabini",
    "Maligaya",
    "Santo Tomas South",
  ],
  "District 2": [
    "Imbunia",
    "Lambakin",
    "Marawa",
    "Naglabrahan",
    "San Josef",
    "San Roque",
    "Santo Tomas North",
  ],
  "District 3": [
    "Don Mariano Marcos",
    "Hilera",
    "Pinanggaan",
    "San Andres",
    "San Nicolas",
    "Ulanin-Pitak",
  ],
  "District 4": [
    "Calabasa",
    "Kasanglayan",
    "Pamacpacan",
    "Putlod",
    "Sapang",
  ],
};

function sanitizeStreetDetails(value) {
  return sanitizeIncidentText(value, 160).trimStart();
}

function getAddressError({ district, barangay, street }) {
  if (!district) return "Please select a district.";
  if (!barangay) return "Please select a barangay.";
  if (!street.trim()) return "Please enter your street or address details.";
  if (street.trim().length < 3) return "Street or address details are too short.";
  return "";
}

function buildFullAddress({ district, barangay, street }) {
  return [street, barangay, district, "Jaen, Nueva Ecija"]
    .filter(Boolean)
    .join(", ");
}

function getUserId(user) {
  return user?._id || user?.id || user?.userId || "";
}

export default function PersonalDetails({ navigation }) {
  const { user, setUser } = useContext(UserContext);
  const { theme } = useTheme();
  const themed = useMemo(() => createPersonalThemeStyles(theme), [theme]);

  const [username, setUsername] = useState(user?.username || "");
  const [phone, setPhone] = useState(
    String(user?.phone || user?.phoneNumber || "").replace(/^0+/, "")
  );

  const [district, setDistrict] = useState(user?.district || "");
  const [barangay, setBarangay] = useState(user?.barangay || "");
  const [street, setStreet] = useState(
    user?.street ||
      user?.streetAddress ||
      user?.addressLine ||
      user?.houseAddress ||
      ""
  );

  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { scrollRef, registerInput, scrollToInput } = useFormAutoScroll(36);

  const userId = getUserId(user);

  const barangayOptions = useMemo(() => {
    return BARANGAY_BY_DISTRICT[district] || [];
  }, [district]);

  if (!user) {
    return <Text>No user logged in</Text>;
  }

  const onChangeDistrict = (value) => {
    setDistrict(value);

    if (!value) {
      setBarangay("");
    } else if (!BARANGAY_BY_DISTRICT[value]?.includes(barangay)) {
      setBarangay("");
    }

    if (error) setError("");
  };

  const savePersonalDetails = async () => {
    setError("");

    if (!userId) {
      setError("Missing user ID. Please log in again.");
      Alert.alert("Update failed", "Missing user ID. Please log in again.");
      return;
    }

    const cleanUsername = sanitizeUsername(username);
    const usernameError = getUsernameError(cleanUsername);

    if (usernameError) {
      setError(usernameError);
      return;
    }

    const cleanPhone = sanitizePhoneLocal(phone);
    const phoneError = getPhoneError(cleanPhone);

    if (phoneError) {
      setError(phoneError);
      return;
    }

    const cleanDistrict = String(district || "").trim();
    const cleanBarangay = String(barangay || "").trim();
    const cleanStreet = sanitizeStreetDetails(street);

    const addressError = getAddressError({
      district: cleanDistrict,
      barangay: cleanBarangay,
      street: cleanStreet,
    });

    if (addressError) {
      setError(addressError);
      return;
    }

    if (isSaving) return;

    setIsSaving(true);

    const fullAddress = buildFullAddress({
      district: cleanDistrict,
      barangay: cleanBarangay,
      street: cleanStreet,
    });

    const payload = {
      username: cleanUsername,
      phoneNumber: cleanPhone,
      phone: cleanPhone,
      district: cleanDistrict,
      barangay: cleanBarangay,
      street: cleanStreet,
      streetAddress: cleanStreet,
      address: fullAddress,
    };

    try {
      const response = await api.put(`/user/update/${userId}`, payload);
      const updatedUser = response?.data || {};

      const nextUser = {
        ...user,
        ...updatedUser,
        _id: updatedUser?._id || user?._id || userId,
        id: updatedUser?.id || user?.id || userId,
        username: updatedUser?.username || cleanUsername,
        phone: updatedUser?.phone || cleanPhone,
        phoneNumber: updatedUser?.phoneNumber || cleanPhone,
        district: updatedUser?.district || cleanDistrict,
        barangay: updatedUser?.barangay || cleanBarangay,
        street: updatedUser?.street || cleanStreet,
        streetAddress: updatedUser?.streetAddress || cleanStreet,
        address: updatedUser?.address || fullAddress,
      };

      setUser(nextUser);

      Alert.alert("Details updated", "Your personal details have been saved.");
      navigation.goBack();
    } catch (updateError) {
      console.log("Personal details update failed:", {
        url: `/user/update/${userId}`,
        payload,
        message: updateError?.message,
        status: updateError?.response?.status,
        data: updateError?.response?.data,
      });

      const message =
        updateError?.response?.data?.message ||
        updateError?.response?.data?.error ||
        "Failed to update personal details.";

      setError(message);
      Alert.alert("Update failed", message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.webFrame, themed.screen]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
    >
      <ScrollView
        ref={scrollRef}
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
            <Text style={[styles.headerTitle, themed.text]}>Personal Details</Text>
            <Text style={[styles.subText, themed.subtext]}>
              Keep contact and address details accurate for alerts and recovery.
            </Text>
          </View>
        </View>

        <View style={[styles.summaryCard, themed.card]}>
          <View style={[styles.summaryIcon, themed.softCard]}>
            <Ionicons name="id-card-outline" size={23} color={theme.primary} />
          </View>

          <View style={styles.summaryCopy}>
            <Text style={[styles.summaryTitle, themed.text]}>
              {safeDisplayText(user.fname, "User")}{" "}
              {safeDisplayText(user.lname, "")}
            </Text>
            <Text style={[styles.summaryMeta, themed.subtext]}>
              {safeDisplayText(user.email, "No email")}
            </Text>
          </View>
        </View>

        <View style={[styles.sectionCard, themed.card]}>
          <Text style={[styles.sectionTitle, themed.text]}>Identity</Text>
          <Field label="First Name" value={user.fname} editable={false} theme={theme} />
          <Field label="Last Name" value={user.lname} editable={false} theme={theme} />
          <Field label="Email" value={user.email} editable={false} theme={theme} />
        </View>

        <View style={[styles.sectionCard, themed.card]}>
          <Text style={[styles.sectionTitle, themed.text]}>Editable details</Text>

          <Text style={[styles.label, themed.text]}>Username</Text>
          <Text style={[styles.helper, themed.subtext]}>
            Used as your resident identifier inside Sagip Bayan.
          </Text>
          <TextInput
            style={[styles.input, themed.input]}
            value={username}
            onChangeText={(text) => {
              setUsername(sanitizeUsername(text));
              if (error) setError("");
            }}
            placeholder="Username"
            placeholderTextColor={theme.subtext}
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => scrollToInput("username")}
            onLayout={registerInput("username")}
            maxLength={24}
          />

          <Text style={[styles.label, themed.text]}>Phone Number</Text>
          <Text style={[styles.helper, themed.subtext]}>
            Used for urgent messages and account recovery.
          </Text>
          <TextInput
            style={[styles.input, themed.input]}
            value={phone}
            onChangeText={(text) => {
              setPhone(sanitizePhoneLocal(text));
              if (error) setError("");
            }}
            keyboardType="phone-pad"
            placeholder="Phone Number"
            placeholderTextColor={theme.subtext}
            maxLength={10}
            onFocus={() => scrollToInput("phone")}
            onLayout={registerInput("phone")}
          />

          <Text style={[styles.label, themed.text]}>District</Text>
          <Text style={[styles.helper, themed.subtext]}>
            Select the district that your address belongs to.
          </Text>
          <View style={[styles.input, themed.input]}>
            <Picker
              selectedValue={district}
              onValueChange={onChangeDistrict}
              style={{ color: district ? theme.text : theme.subtext }}
            >
              <Picker.Item label="Select district" value="" />
              {DISTRICT_OPTIONS.map((item) => (
                <Picker.Item key={item} label={item} value={item} />
              ))}
            </Picker>
          </View>

          <Text style={[styles.label, themed.text]}>Barangay</Text>
          <Text style={[styles.helper, themed.subtext]}>
            Select your barangay so alerts can be matched to your area.
          </Text>
          <View style={[styles.input, themed.input]}>
            <Picker
              selectedValue={barangay}
              enabled={Boolean(district)}
              onValueChange={(value) => {
                setBarangay(value);
                if (error) setError("");
              }}
              style={{
                color: barangay ? theme.text : theme.subtext,
                opacity: district ? 1 : 0.6,
              }}
            >
              <Picker.Item
                label={district ? "Select barangay" : "Select district first"}
                value=""
              />
              {barangayOptions.map((item) => (
                <Picker.Item key={item} label={item} value={item} />
              ))}
            </Picker>
          </View>

          <Text style={[styles.label, themed.text]}>Street / Address Details</Text>
          <Text style={[styles.helper, themed.subtext]}>
            Enter house number, street, purok, or other address details.
          </Text>
          <TextInput
            style={[styles.input, themed.input]}
            value={street}
            onChangeText={(text) => {
              setStreet(sanitizeStreetDetails(text));
              if (error) setError("");
            }}
            placeholder="House no., street, purok, landmark"
            placeholderTextColor={theme.subtext}
            autoCapitalize="words"
            maxLength={160}
            onFocus={() => scrollToInput("street")}
            onLayout={registerInput("street")}
          />

          <View
            style={{
              marginTop: 2,
              marginBottom: 12,
              padding: 12,
              borderRadius: 14,
              backgroundColor: theme.surfaceAlt,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "800",
                color: theme.subtext,
                marginBottom: 4,
                textTransform: "uppercase",
              }}
            >
              Full Address Preview
            </Text>
            <Text
              style={{
                fontSize: 13,
                lineHeight: 18,
                color: theme.text,
                fontWeight: "700",
              }}
            >
              {district || barangay || street
                ? buildFullAddress({
                    district: String(district || "").trim(),
                    barangay: String(barangay || "").trim(),
                    street: sanitizeStreetDetails(street),
                  })
                : "No address set yet"}
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.buttonPrimary }, isSaving && { opacity: 0.65 }]}
            onPress={savePersonalDetails}
            disabled={isSaving}
          >
            <Text style={styles.buttonText}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, editable, theme }) {
  return (
    <View style={[styles.readOnlyField, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
      <Text style={[styles.readOnlyLabel, { color: theme.subtext }]}>{label}</Text>
      <Text style={[styles.readOnlyValue, { color: theme.text }]} numberOfLines={1}>
        {safeDisplayText(value, "Not set")}
      </Text>
      {!editable && (
        <Ionicons name="lock-closed-outline" size={15} color={theme.subtext} />
      )}
    </View>
  );
}

function createPersonalThemeStyles(theme) {
  return {
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
  };
}
