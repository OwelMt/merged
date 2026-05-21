import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import api from "../lib/api";
import { UserContext } from "./UserContext";
import { NotificationContext } from "./contexts/NotificationContext";
import { useTheme } from "./contexts/ThemeContext";
import { safeDisplayText, sanitizeSearchText } from "./utils/validation";

const CATEGORIES = ["all", "general", "advisory", "event", "service", "weather", "emergency"];

export default function AnnouncementScreen({ navigation, route }) {
  const { user } = useContext(UserContext) || {};
  const { refreshNotifications } = useContext(NotificationContext) || {};
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [announcements, setAnnouncements] = useState([]);
  const [filteredAnnouncements, setFilteredAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const openedRouteAnnouncementIdRef = useRef(null);

  useEffect(() => {
    fetchAnnouncements();
  }, [selectedCategory, user?._id]);

  useEffect(() => {
    handleSearch(searchText);
  }, [searchText, announcements]);

  useEffect(() => {
    const routeAnnouncementId = route?.params?.announcementId
      ? String(route.params.announcementId)
      : "";

    if (
      !routeAnnouncementId ||
      openedRouteAnnouncementIdRef.current === routeAnnouncementId
    ) {
      return;
    }

    const matchingAnnouncement = announcements.find(
      (item) => String(item?._id || item?.id || "") === routeAnnouncementId
    );

    if (matchingAnnouncement) {
      openedRouteAnnouncementIdRef.current = routeAnnouncementId;
      openAnnouncement(matchingAnnouncement);
      return;
    }

    let active = true;

    const fetchAnnouncementFromRoute = async () => {
      try {
        const response = await api.get(`/api/announcements/${routeAnnouncementId}`, {
          params: { userId: user?._id },
        });

        if (!active || !response?.data?._id) return;

        openedRouteAnnouncementIdRef.current = routeAnnouncementId;
        setAnnouncements((prev) => {
          const exists = prev.some(
            (item) => String(item?._id || item?.id || "") === routeAnnouncementId
          );
          return exists ? prev : [response.data, ...prev];
        });
        setFilteredAnnouncements((prev) => {
          const exists = prev.some(
            (item) => String(item?._id || item?.id || "") === routeAnnouncementId
          );
          return exists ? prev : [response.data, ...prev];
        });
        openAnnouncement(response.data);
      } catch (error) {
        console.log("[announcements] route open failed:", error?.message);
      }
    };

    fetchAnnouncementFromRoute();

    return () => {
      active = false;
    };
  }, [announcements, route?.params?.announcementId, user?._id]);

  const fetchAnnouncements = async () => {
    try {
      setLoading(true);
      const params = {};
      if (selectedCategory !== "all") params.category = selectedCategory;

      const response = await api.get("/api/announcements", {
        params: {
          ...params,
          userId: user?._id,
        },
        validateStatus: (status) => status === 200 || status === 404,
      });

      if (response.status === 404) {
        setAnnouncements([]);
        setFilteredAnnouncements([]);
        return;
      }

      const items = Array.isArray(response.data) ? response.data : [];
      const visibleItems = items.filter((item) => {
        const status = String(item?.status || "").toLowerCase();
        return status === "published";
      });

      setAnnouncements(visibleItems);
      setFilteredAnnouncements(visibleItems);
      console.log("[announcements] fetched published count", visibleItems.length);
      await refreshNotifications?.();
    } catch (error) {
      console.log("Error fetching announcements:", {
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (text) => {
    const cleanText = sanitizeSearchText(text);
    setSearchText(cleanText);

    if (!cleanText) {
      setFilteredAnnouncements(announcements);
      setSuggestions([]);
      return;
    }

    const query = cleanText.toLowerCase();
    const filtered = announcements.filter((item) => {
      const title = safeDisplayText(item?.title, "").toLowerCase();
      const description = safeDisplayText(item?.description, "").toLowerCase();
      return title.includes(query) || description.includes(query);
    });

    setFilteredAnnouncements(filtered);
    setSuggestions(
      filtered
        .map((item) => safeDisplayText(item?.title, "Untitled announcement"))
        .slice(0, 5)
    );
  };

  const updateAnnouncementInState = (nextItem) => {
    setAnnouncements((prev) =>
      prev.map((item) => (item._id === nextItem._id ? { ...item, ...nextItem } : item))
    );
    setFilteredAnnouncements((prev) =>
      prev.map((item) => (item._id === nextItem._id ? { ...item, ...nextItem } : item))
    );
    setSelectedAnnouncement((current) =>
      current?._id === nextItem._id ? { ...current, ...nextItem } : current
    );
  };

  const openAnnouncement = async (item) => {
    setSelectedAnnouncement(item);
    if (!user?._id || !item?._id || item.viewedByCurrentUser) return;

    try {
      const response = await api.post(`/api/announcements/${item._id}/view`, {
        userId: user._id,
      });
      updateAnnouncementInState(response.data);
    } catch (error) {
      console.log("Error recording announcement view:", error?.message);
    }
  };

  const toggleAnnouncementLike = async (item) => {
    if (!user?._id || !item?._id) return;

    try {
      const response = await api.post(`/api/announcements/${item._id}/like`, {
        userId: user._id,
      });
      updateAnnouncementInState(response.data);
    } catch (error) {
      console.log("Error toggling announcement like:", error?.message);
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => openAnnouncement(item)}
      activeOpacity={0.9}
    >
      {getPrimaryImage(item) && (
        <ResponsiveAttachmentImage
          uri={getPrimaryImage(item).fileUrl}
          frameStyle={styles.cardImageFrame}
          style={styles.postImage}
          maxHeight={230}
          minHeight={170}
          onPress={() => openAnnouncement(item)}
        />
      )}
      <View style={styles.postBody}>
        <Text style={styles.postTitle} numberOfLines={2}>
          {safeDisplayText(item?.title, "Untitled announcement")}
        </Text>

        {!!item.description && (
          <Text style={styles.postDescription} numberOfLines={3}>
            {safeDisplayText(item?.description, "")}
          </Text>
        )}

        <View style={styles.engagementLine}>
          <EngagementRow item={item} styles={styles} theme={theme} />
          <TouchableOpacity
            style={[
              styles.likeButton,
              item.likedByCurrentUser && styles.likeButtonActive,
              !user?._id && styles.likeButtonDisabled,
            ]}
            disabled={!user?._id}
            onPress={() => toggleAnnouncementLike(item)}
          >
            <Ionicons
              name={item.likedByCurrentUser ? "heart" : "heart-outline"}
              size={17}
              color={item.likedByCurrentUser ? theme.buttonText : theme.primary}
            />
            <Text
              style={[
                styles.likeButtonText,
                item.likedByCurrentUser && styles.likeButtonTextActive,
              ]}
            >
              {item.likedByCurrentUser ? "Liked" : "Like"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.postFooterRow}>
          <Text style={styles.readMoreText}>Read More</Text>
          <View style={styles.metaRow}>
            <MetaPill text={item.category || "general"} styles={styles} />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Announcements</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={theme.mutedText} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search announcements"
          value={searchText}
          onChangeText={handleSearch}
          placeholderTextColor={theme.mutedText}
        />
      </View>

      {suggestions.length > 0 && (
        <View style={styles.suggestionsContainer}>
          {suggestions.map((title, index) => (
            <TouchableOpacity
              key={`${title}-${index}`}
              onPress={() => {
                setSearchText(title);
                setSuggestions([]);
              }}
              style={styles.suggestionItem}
            >
              <Ionicons name="return-down-forward-outline" size={15} color={theme.mutedText} />
              <Text style={styles.suggestionText}>{title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.filterContainer}>
        {CATEGORIES.map((cat) => {
          const active = selectedCategory === cat;
          return (
            <TouchableOpacity
              key={cat}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filteredAnnouncements}
        keyExtractor={(item, index) => String(item?._id || item?.id || index)}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="newspaper-outline" size={30} color={theme.mutedText} />
            <Text style={styles.emptyTitle}>No announcements found</Text>
            <Text style={styles.emptyText}>Try a different search or category.</Text>
          </View>
        }
      />

      <AnnouncementModal
        item={selectedAnnouncement}
        userId={user?._id}
        styles={styles}
        theme={theme}
        onToggleLike={toggleAnnouncementLike}
        onClose={() => setSelectedAnnouncement(null)}
      />
    </View>
  );
}

function PostHeader({ item, styles, theme }) {
  return (
    <View style={styles.postHeader}>
      <View style={styles.publisherAvatar}>
        <Ionicons name="megaphone-outline" size={19} color={theme.primary} />
      </View>
      <View style={styles.publisherCopy}>
        <Text style={styles.publisherName}>MDRRMO</Text>
        <Text style={styles.publisherMeta}>
          {formatDate(item?.createdAt)} - Official announcement
        </Text>
      </View>
      <View style={styles.officialBadge}>
        <Ionicons name="checkmark-circle" size={14} color={theme.primary} />
        <Text style={styles.officialBadgeText}>Official</Text>
      </View>
    </View>
  );
}

function AnnouncementModal({ item, userId, styles, theme, onToggleLike, onClose }) {
  const [selectedImage, setSelectedImage] = useState(null);

  if (!item) return null;

  return (
    <>
      <Modal transparent animationType="fade" visible={!!item} onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <TouchableOpacity style={styles.closeIcon} onPress={onClose}>
                <Ionicons name="chevron-back" size={23} color={theme.text} />
              </TouchableOpacity>
              <Text style={styles.modalHeaderTitle}>Announcements</Text>
              <View style={styles.modalHeaderSpacer} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScrollContent}>
              <Text style={styles.modalTitle}>
                {safeDisplayText(item?.title, "Untitled announcement")}
              </Text>

              {getPrimaryImage(item) && (
                <ResponsiveAttachmentImage
                  uri={getPrimaryImage(item).fileUrl}
                  frameStyle={styles.modalImageFrame}
                  style={styles.modalImage}
                  maxHeight={540}
                  minHeight={230}
                  onPress={() => setSelectedImage(getPrimaryImage(item))}
                />
              )}

              <Text style={styles.articleByline}>By MDRRMO</Text>
              <Text style={styles.articleDate}>{formatDate(item?.createdAt)}</Text>

              {!!item.description && (
                <Text style={styles.modalDescription}>
                  {safeDisplayText(item?.description, "")}
                </Text>
              )}

              <View style={styles.modalEngagementRow}>
                <EngagementRow item={item} styles={styles} theme={theme} />
                <TouchableOpacity
                  style={[
                    styles.likeButton,
                    item.likedByCurrentUser && styles.likeButtonActive,
                    !userId && styles.likeButtonDisabled,
                  ]}
                  disabled={!userId}
                  onPress={() => onToggleLike?.(item)}
                >
                  <Ionicons
                    name={item.likedByCurrentUser ? "heart" : "heart-outline"}
                    size={17}
                    color={item.likedByCurrentUser ? theme.buttonText : theme.primary}
                  />
                  <Text
                    style={[
                      styles.likeButtonText,
                      item.likedByCurrentUser && styles.likeButtonTextActive,
                    ]}
                  >
                    {item.likedByCurrentUser ? "Liked" : "Like"}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!selectedImage}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setSelectedImage(null)}
      >
        <ZoomableImageViewer
          image={selectedImage}
          title={safeDisplayText(item?.title, "Announcement image")}
          styles={styles}
          onClose={() => setSelectedImage(null)}
        />
      </Modal>
    </>
  );
}

function EngagementRow({ item, styles, theme }) {
  const views = Number(item?.viewCount ?? item?.views ?? 0);
  const likes = Number(item?.likeCount ?? 0);

  return (
    <View style={styles.engagementRow}>
      <View style={styles.engagementPill}>
        <Ionicons name="eye-outline" size={14} color={theme.mutedText} />
        <Text style={styles.engagementText}>{views} seen</Text>
      </View>
      <View style={styles.engagementPill}>
        <Ionicons name="heart-outline" size={14} color={theme.mutedText} />
        <Text style={styles.engagementText}>{likes} likes</Text>
      </View>
    </View>
  );
}

function MetaPill({ text, tone, styles }) {
  return (
    <View style={[styles.metaPill, tone === "warning" && styles.metaPillWarning]}>
      <Text style={[styles.metaText, tone === "warning" && styles.metaTextWarning]}>
        {String(text).toUpperCase()}
      </Text>
    </View>
  );
}

function ResponsiveAttachmentImage({
  uri,
  onPress,
  frameStyle,
  style,
  minHeight = 180,
  maxHeight = 420,
}) {
  const [aspectRatio, setAspectRatio] = useState(4 / 3);

  useEffect(() => {
    if (!uri) return;

    let active = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (!active || !width || !height) return;
        setAspectRatio(width / height);
      },
      () => {
        if (active) setAspectRatio(4 / 3);
      }
    );

    return () => {
      active = false;
    };
  }, [uri]);

  const imageNode = (
    <View style={[frameStyle, { minHeight, maxHeight }]}>
      <Image source={{ uri }} style={[style, { aspectRatio }]} resizeMode="contain" />
    </View>
  );

  if (typeof onPress === "function") {
    return (
      <TouchableOpacity activeOpacity={0.92} onPress={onPress}>
        {imageNode}
      </TouchableOpacity>
    );
  }

  return imageNode;
}

function ZoomableImageViewer({ image, title, styles, onClose }) {
  const { width, height } = useWindowDimensions();
  const [scale, setScale] = useState(1);
  const [aspectRatio, setAspectRatio] = useState(4 / 3);

  useEffect(() => {
    setScale(1);
  }, [image]);

  useEffect(() => {
    if (!image?.fileUrl) return;

    let active = true;
    Image.getSize(
      image.fileUrl,
      (imgWidth, imgHeight) => {
        if (!active || !imgWidth || !imgHeight) return;
        setAspectRatio(imgWidth / imgHeight);
      },
      () => {
        if (active) setAspectRatio(4 / 3);
      }
    );

    return () => {
      active = false;
    };
  }, [image]);

  if (!image?.fileUrl) return null;

  const clampedScale = Math.max(1, Math.min(scale, 3));
  const baseWidth = Math.max(280, width - 32);
  const scaledWidth = baseWidth * clampedScale;
  const scaledHeight = scaledWidth / aspectRatio;

  return (
    <View style={styles.imageViewerScreen}>
      <View style={styles.imageViewerHeader}>
        <TouchableOpacity style={styles.imageViewerBack} onPress={onClose}>
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          <Text style={styles.imageViewerBackText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.imageViewerControls}>
          <TouchableOpacity
            style={styles.imageViewerControlButton}
            onPress={() => setScale((current) => Math.max(1, Number((current - 0.25).toFixed(2))))}
          >
            <Ionicons name="remove" size={18} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.imageViewerControlButton} onPress={() => setScale(1)}>
            <Text style={styles.imageViewerControlText}>{Math.round(clampedScale * 100)}%</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.imageViewerControlButton}
            onPress={() => setScale((current) => Math.min(3, Number((current + 0.25).toFixed(2))))}
          >
            <Ionicons name="add" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.imageViewerTitle} numberOfLines={2}>
        {title}
      </Text>

      <ScrollView horizontal bounces={false} maximumZoomScale={3} minimumZoomScale={1}>
        <ScrollView
          bounces={false}
          contentContainerStyle={[
            styles.imageViewerScrollContent,
            { minHeight: Math.max(height - 210, 320), width: Math.max(width, scaledWidth + 32) },
          ]}
        >
          <Image
            source={{ uri: image.fileUrl }}
            style={{ width: scaledWidth, height: scaledHeight }}
            resizeMode="contain"
          />
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function getPrimaryImage(item) {
  return (item?.attachments || []).find((file) =>
    /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(file?.fileUrl || "")
  ) || null;
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Recently";

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function makeStyles(theme) {
  const isDark = theme.mode === "dark";

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
      paddingHorizontal: 18,
      paddingTop: 28,
    },
    loading: {
      flex: 1,
      backgroundColor: theme.background,
      alignItems: "center",
      justifyContent: "center",
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 18,
    },
    backButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: theme.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    headerCopy: {
      flex: 1,
      paddingRight: 54,
    },
    headerTitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "900",
      textAlign: "center",
    },
    headerSubtitle: {
      marginTop: 3,
      color: theme.mutedText,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
    },
    heroCard: {
      minHeight: 104,
      borderRadius: 22,
      backgroundColor: isDark ? "#123323" : "#14532D",
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 14,
    },
    heroIconWrap: {
      width: 46,
      height: 46,
      borderRadius: 17,
      backgroundColor: "rgba(255,255,255,0.18)",
      alignItems: "center",
      justifyContent: "center",
    },
    heroCopy: {
      flex: 1,
    },
    heroTitle: {
      color: "#FFFFFF",
      fontSize: 16,
      fontWeight: "900",
    },
    heroText: {
      marginTop: 4,
      color: "rgba(255,255,255,0.82)",
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
    },
    heroCount: {
      minWidth: 62,
      minHeight: 58,
      borderRadius: 18,
      backgroundColor: "rgba(255,255,255,0.16)",
      alignItems: "center",
      justifyContent: "center",
    },
    heroCountValue: {
      color: "#FFFFFF",
      fontSize: 18,
      fontWeight: "900",
    },
    heroCountLabel: {
      color: "rgba(255,255,255,0.76)",
      fontSize: 10,
      fontWeight: "800",
      textTransform: "uppercase",
    },
    searchWrap: {
      minHeight: 48,
      borderRadius: 8,
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      marginBottom: 10,
    },
    searchInput: {
      flex: 1,
      color: theme.text,
      fontSize: 14,
      fontWeight: "700",
    },
    suggestionsContainer: {
      borderRadius: 18,
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 10,
      overflow: "hidden",
    },
    suggestionItem: {
      minHeight: 42,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    suggestionText: {
      color: theme.text,
      fontSize: 13,
      fontWeight: "700",
    },
    filterContainer: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 14,
      flexWrap: "wrap",
    },
    chip: {
      minHeight: 34,
      borderRadius: 8,
      paddingHorizontal: 13,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
      alignItems: "center",
      justifyContent: "center",
    },
    chipActive: {
      backgroundColor: theme.buttonPrimary,
      borderColor: theme.buttonPrimary,
    },
    chipText: {
      color: theme.mutedText,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "capitalize",
    },
    chipTextActive: {
      color: theme.buttonText,
    },
    listContent: {
      paddingBottom: 28,
      gap: 14,
    },
    card: {
      borderRadius: 8,
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 0,
      overflow: "hidden",
      shadowColor: "#0F2319",
      shadowOpacity: isDark ? 0.22 : 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
    postHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 12,
    },
    publisherAvatar: {
      width: 42,
      height: 42,
      borderRadius: 15,
      backgroundColor: theme.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    publisherCopy: {
      flex: 1,
    },
    publisherName: {
      color: theme.text,
      fontSize: 14,
      fontWeight: "900",
    },
    publisherMeta: {
      marginTop: 2,
      color: theme.mutedText,
      fontSize: 11,
      fontWeight: "700",
    },
    officialBadge: {
      minHeight: 28,
      paddingHorizontal: 9,
      borderRadius: 999,
      backgroundColor: theme.primarySoft,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    officialBadgeText: {
      color: theme.primary,
      fontSize: 10,
      fontWeight: "900",
    },
    postBody: {
      padding: 16,
      gap: 10,
    },
    postTitle: {
      color: theme.text,
      fontSize: 18,
      lineHeight: 23,
      fontWeight: "900",
    },
    postDescription: {
      color: theme.mutedText,
      fontSize: 13,
      lineHeight: 20,
      fontWeight: "600",
    },
    cardImageFrame: {
      width: "100%",
      overflow: "hidden",
      backgroundColor: theme.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    imageFrame: {
      width: "100%",
      borderRadius: 8,
      overflow: "hidden",
      backgroundColor: theme.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    postImage: {
      width: "100%",
      backgroundColor: theme.surfaceAlt,
    },
    modalImageFrame: {
      width: "100%",
      borderRadius: 8,
      overflow: "hidden",
      backgroundColor: theme.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 18,
      marginBottom: 18,
    },
    modalImage: {
      width: "100%",
      borderRadius: 8,
      backgroundColor: theme.surfaceAlt,
    },
    engagementLine: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    engagementRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
      flex: 1,
    },
    engagementPill: {
      minHeight: 28,
      paddingHorizontal: 9,
      borderRadius: 999,
      backgroundColor: theme.surfaceAlt,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    engagementText: {
      color: theme.mutedText,
      fontSize: 11,
      fontWeight: "800",
    },
    likeButton: {
      minHeight: 36,
      paddingHorizontal: 13,
      borderRadius: 8,
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.primary,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    likeButtonActive: {
      backgroundColor: theme.buttonPrimary,
    },
    likeButtonDisabled: {
      opacity: 0.55,
    },
    likeButtonText: {
      color: theme.primary,
      fontSize: 12,
      fontWeight: "900",
    },
    likeButtonTextActive: {
      color: theme.buttonText,
    },
    postFooterRow: {
      marginTop: 2,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    readMoreText: {
      color: "#0EA5E9",
      fontSize: 13,
      fontWeight: "900",
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      flexWrap: "wrap",
      flex: 1,
    },
    metaPill: {
      minHeight: 26,
      paddingHorizontal: 9,
      borderRadius: 999,
      backgroundColor: theme.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    metaPillWarning: {
      backgroundColor: isDark ? "rgba(251,191,36,0.16)" : "#FEF3C7",
    },
    metaText: {
      color: theme.primary,
      fontSize: 10,
      fontWeight: "900",
    },
    metaTextWarning: {
      color: theme.warning,
    },
    emptyState: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 42,
      paddingHorizontal: 18,
    },
    emptyTitle: {
      marginTop: 12,
      color: theme.text,
      fontSize: 15,
      fontWeight: "900",
    },
    emptyText: {
      marginTop: 5,
      color: theme.mutedText,
      textAlign: "center",
      fontSize: 12,
      lineHeight: 18,
      fontWeight: "700",
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: theme.background,
    },
    modalBox: {
      flex: 1,
      backgroundColor: theme.background,
      paddingHorizontal: 18,
      paddingTop: 28,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 28,
    },
    closeIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: theme.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    modalHeaderTitle: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
      fontWeight: "900",
      textAlign: "center",
    },
    modalHeaderSpacer: {
      width: 42,
      height: 42,
    },
    modalScrollContent: {
      paddingBottom: 32,
    },
    modalTitle: {
      color: theme.text,
      fontSize: 29,
      lineHeight: 36,
      fontWeight: "900",
    },
    modalDescription: {
      color: theme.text,
      fontSize: 16,
      lineHeight: 25,
      fontWeight: "600",
      marginTop: 16,
    },
    articleByline: {
      color: theme.mutedText,
      fontSize: 15,
      fontWeight: "800",
    },
    articleDate: {
      color: theme.mutedText,
      fontSize: 12,
      fontWeight: "600",
      marginTop: 4,
    },
    modalEngagementRow: {
      marginTop: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    imageViewerScreen: {
      flex: 1,
      backgroundColor: "#050807",
      paddingTop: 16,
    },
    imageViewerHeader: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    imageViewerBack: {
      minHeight: 40,
      paddingHorizontal: 10,
      borderRadius: 14,
      backgroundColor: "rgba(255,255,255,0.12)",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    imageViewerBackText: {
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: "900",
    },
    imageViewerControls: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    imageViewerControlButton: {
      minWidth: 40,
      minHeight: 40,
      borderRadius: 14,
      backgroundColor: "rgba(255,255,255,0.12)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 8,
    },
    imageViewerControlText: {
      color: "#FFFFFF",
      fontSize: 12,
      fontWeight: "900",
    },
    imageViewerTitle: {
      paddingHorizontal: 16,
      color: "#FFFFFF",
      fontSize: 14,
      fontWeight: "800",
      marginBottom: 8,
    },
    imageViewerScrollContent: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
      paddingBottom: 24,
    },
  });
}
