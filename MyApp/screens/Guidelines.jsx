// screens/Guidelines.jsx
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Linking,
  TextInput,
  Modal,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import api from "../lib/api";
import styles, { COLORS } from "../Designs/Guidelines";
import { UserContext } from "./UserContext";
import { NotificationContext } from "./contexts/NotificationContext";
import { ThemeContext } from "./contexts/ThemeContext";
import {
  isSafeHttpUrl,
  sanitizeSearchText,
  safeDisplayText,
} from "./utils/validation";

export default function GuidelinesListScreen({ navigation, route }) {
  const { user } = useContext(UserContext) || {};
  const { refreshNotifications } = useContext(NotificationContext) || {};
  const { theme } = useContext(ThemeContext);
  const themed = useMemo(() => createThemedGuidelineStyles(theme), [theme]);
  const [guidelines, setGuidelines] = useState([]);
  const [filteredGuidelines, setFilteredGuidelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selectedGuideline, setSelectedGuideline] = useState(null);
  const openedRouteGuidelineIdRef = useRef(null);
  const categories = ["all", "earthquake", "flood", "typhoon", "general"];

  useEffect(() => {
    fetchGuidelines();
  }, [selectedCategory, user?._id]);

  useEffect(() => {
    handleSearch(searchText);
  }, [searchText, guidelines]);

 const fetchGuidelines = async () => {
  try {
    setLoading(true);
    const params = {};
    if (selectedCategory !== "all") params.category = selectedCategory;

    const response = await api.get("/api/guidelines", {
      params: {
        ...params,
        userId: user?._id,
      },
      validateStatus: (status) => status === 200 || status === 404,
    });

    if (response.status === 404) {
      setGuidelines([]);
      setFilteredGuidelines([]);
      return;
    }

    const items = Array.isArray(response.data) ? response.data : [];
    const visibleItems = items.filter((item) => {
      const status = String(item?.status || "").toLowerCase();
      return status !== "draft" && status !== "archived";
    });

    setGuidelines(visibleItems);
    setFilteredGuidelines(visibleItems);
    console.log("[guidelines] fetched published count", visibleItems.length);
    await refreshNotifications?.();
  } catch (error) {
    console.log("Error fetching guidelines:", {
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
      setFilteredGuidelines(guidelines);
      setSuggestions([]);
      return;
    }

    const filtered = guidelines.filter((item) =>
      safeDisplayText(item?.title, "")
        .toLowerCase()
        .includes(cleanText.toLowerCase())
    );

    setFilteredGuidelines(filtered);
    setSuggestions(
      filtered
        .map((item) => safeDisplayText(item?.title, "Untitled guideline"))
        .slice(0, 5)
    );
  };

  const selectSuggestion = (title) => {
    setSearchText(title);
    setSuggestions([]);
  };

  const updateGuidelineInState = (nextItem) => {
    setGuidelines((prev) =>
      prev.map((item) => (item._id === nextItem._id ? { ...item, ...nextItem } : item))
    );
    setFilteredGuidelines((prev) =>
      prev.map((item) => (item._id === nextItem._id ? { ...item, ...nextItem } : item))
    );
    setSelectedGuideline((current) =>
      current?._id === nextItem._id ? { ...current, ...nextItem } : current
    );
  };

  const openGuideline = async (item) => {
    setSelectedGuideline(item);
    if (!user?._id || !item?._id || item.viewedByCurrentUser) return;

    try {
      const response = await api.post(`/api/guidelines/${item._id}/view`, {
        userId: user._id,
      });
      updateGuidelineInState(response.data);
    } catch (error) {
      console.log("Error recording guideline view:", error?.message);
    }
  };

  useEffect(() => {
    const routeGuidelineId = route?.params?.guidelineId
      ? String(route.params.guidelineId)
      : "";

    if (!routeGuidelineId || openedRouteGuidelineIdRef.current === routeGuidelineId) {
      return;
    }

    const matchingGuideline = guidelines.find(
      (item) => String(item?._id || item?.id || "") === routeGuidelineId
    );

    if (matchingGuideline) {
      openedRouteGuidelineIdRef.current = routeGuidelineId;
      openGuideline(matchingGuideline);
      return;
    }

    let active = true;

    const fetchGuidelineFromNotification = async () => {
      try {
        const response = await api.get(`/api/guidelines/${routeGuidelineId}`, {
          params: { userId: user?._id },
        });

        if (!active || !response?.data?._id) return;

        openedRouteGuidelineIdRef.current = routeGuidelineId;
        setGuidelines((prev) => {
          const exists = prev.some(
            (item) => String(item?._id || item?.id || "") === routeGuidelineId
          );
          return exists ? prev : [response.data, ...prev];
        });
        setFilteredGuidelines((prev) => {
          const exists = prev.some(
            (item) => String(item?._id || item?.id || "") === routeGuidelineId
          );
          return exists ? prev : [response.data, ...prev];
        });
        openGuideline(response.data);
      } catch (error) {
        console.log("[guidelines] notification open failed:", error?.message);
      }
    };

    fetchGuidelineFromNotification();

    return () => {
      active = false;
    };
  }, [guidelines, route?.params?.guidelineId, user?._id]);

  const toggleGuidelineLike = async (item) => {
    if (!user?._id || !item?._id) return;

    try {
      const response = await api.post(`/api/guidelines/${item._id}/like`, {
        userId: user._id,
      });
      updateGuidelineInState(response.data);
    } catch (error) {
      console.log("Error toggling guideline like:", error?.message);
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.card, themed.card]}
      onPress={() => openGuideline(item)}
      activeOpacity={0.88}
    >
      {getPrimaryImage(item) && (
        <ResponsiveAttachmentImage
          uri={getPrimaryImage(item).fileUrl}
          style={localStyles.postImage}
          maxHeight={230}
          minHeight={170}
          onPress={() => openGuideline(item)}
        />
      )}
      <View style={localStyles.postBody}>
        <Text style={[styles.title, themed.text]} numberOfLines={2}>
          {safeDisplayText(item?.title, "Untitled guideline")}
        </Text>

        {!!item.description && (
          <Text style={[styles.desc, themed.mutedText]} numberOfLines={3}>
            {safeDisplayText(item?.description, "")}
          </Text>
        )}

        <View style={localStyles.engagementLine}>
          <EngagementRow item={item} />
          <TouchableOpacity
            style={[
              localStyles.likeButton,
              item.likedByCurrentUser && localStyles.likeButtonActive,
              !user?._id && localStyles.likeButtonDisabled,
            ]}
            disabled={!user?._id}
            onPress={() => toggleGuidelineLike(item)}
          >
            <Ionicons
              name={item.likedByCurrentUser ? "heart" : "heart-outline"}
              size={17}
              color={item.likedByCurrentUser ? "#FFFFFF" : COLORS.green}
            />
            <Text
              style={[
                localStyles.likeButtonText,
                item.likedByCurrentUser && localStyles.likeButtonTextActive,
              ]}
            >
              {item.likedByCurrentUser ? "Liked" : "Like"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={localStyles.postMetaRow}>
          <Text style={localStyles.readMoreText}>Read More</Text>
          <View style={styles.metaRow}>
            <MetaPill text={item.category || "general"} />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={[styles.loading, themed.screen]}>
        <ActivityIndicator size="large" color={COLORS.green} />
      </View>
    );
  }

  return (
    <View style={[styles.container, themed.screen]}>
      <View style={[styles.phone, themed.screen]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={[styles.backBtn, themed.surfaceBorder]}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="chevron-back" size={22} color={theme.primary} />
          </TouchableOpacity>

          <View style={styles.headerCopy}>
            <Text style={[styles.headerTitle, themed.text]}>Guidelines</Text>
          </View>
        </View>

        <View style={[styles.searchWrap, themed.surfaceBorder]}>
          <Ionicons name="search-outline" size={18} color={theme.mutedText} />
          <TextInput
            style={[styles.searchInput, themed.text]}
            placeholder="Search by title"
            value={searchText}
            onChangeText={handleSearch}
            placeholderTextColor={theme.mutedText}
          />
        </View>

        {suggestions.length > 0 && (
          <View style={[styles.suggestionsContainer, themed.surfaceBorder]}>
            {suggestions.map((title, index) => (
              <TouchableOpacity
                key={`${title}-${index}`}
                onPress={() => selectSuggestion(title)}
                style={styles.suggestionItem}
              >
                <Ionicons
                  name="return-down-forward-outline"
                  size={15}
                  color="#647067"
                />
                <Text style={[styles.suggestionText, themed.text]}>{title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.filterBlock}>
          <Text style={[styles.filterTitle, themed.text]}>Categories</Text>
          <Text style={[styles.filterSubtitle, themed.mutedText]}>
            Quickly narrow the list by hazard type.
          </Text>
        </View>

        <View style={styles.filterContainer}>
          {categories.map((cat) => {
            const active = selectedCategory === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.chip, themed.surfaceBorder, active && styles.chipActive]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text style={[styles.chipText, themed.mutedText, active && styles.chipTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <FlatList
          data={filteredGuidelines}
          keyExtractor={(item, index) =>
            String(item?._id || item?.id || index)
          }
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons
                name="document-text-outline"
                size={28}
                color="#94A3B8"
              />
              <Text style={styles.emptyTitle}>No guidelines found</Text>
              <Text style={styles.emptyText}>
                Try a different search or category.
              </Text>
            </View>
          }
        />

        <GuidelineModal
          item={selectedGuideline}
          userId={user?._id}
          onToggleLike={toggleGuidelineLike}
          onClose={() => setSelectedGuideline(null)}
        />
      </View>
    </View>
  );
}

function MetaPill({ text, tone }) {
  return (
    <View style={[styles.metaPill, tone === "warning" && styles.metaPillWarning]}>
      <Text
        style={[styles.metaText, tone === "warning" && styles.metaTextWarning]}
      >
        {String(text).toUpperCase()}
      </Text>
    </View>
  );
}

function GuidelineModal({ item, userId, onToggleLike, onClose }) {
  const [selectedImage, setSelectedImage] = useState(null);

  if (!item) return null;

  return (
    <>
      <Modal
        transparent
        animationType="fade"
        visible={!!item}
        onRequestClose={onClose}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <TouchableOpacity style={styles.closeIcon} onPress={onClose}>
                <Ionicons name="chevron-back" size={23} color="#10251B" />
              </TouchableOpacity>
              <Text style={localStyles.modalHeaderTitle}>Guidelines</Text>
              <View style={localStyles.modalHeaderSpacer} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={localStyles.modalScrollContent}>
              <Text style={styles.modalTitle}>
                {safeDisplayText(item?.title, "Untitled guideline")}
              </Text>

              {getPrimaryImage(item) && (
                <ResponsiveAttachmentImage
                  uri={getPrimaryImage(item).fileUrl}
                  style={localStyles.modalPostImage}
                  maxHeight={520}
                  minHeight={220}
                  onPress={() => setSelectedImage(getPrimaryImage(item))}
                />
              )}

              <Text style={localStyles.articleByline}>By MDRRMO</Text>
              <Text style={localStyles.articleDate}>{formatDate(item?.createdAt)}</Text>

              {!!item.description && (
                <Text style={styles.modalDesc}>
                  {safeDisplayText(item?.description, "")}
                </Text>
              )}

              <View style={localStyles.modalEngagementRow}>
                <EngagementRow item={item} />
                <TouchableOpacity
                  style={[
                    localStyles.likeButton,
                    item.likedByCurrentUser && localStyles.likeButtonActive,
                    !userId && localStyles.likeButtonDisabled,
                  ]}
                  disabled={!userId}
                  onPress={() => onToggleLike?.(item)}
                >
                  <Ionicons
                    name={item.likedByCurrentUser ? "heart" : "heart-outline"}
                    size={17}
                    color={item.likedByCurrentUser ? "#FFFFFF" : COLORS.green}
                  />
                  <Text
                    style={[
                      localStyles.likeButtonText,
                      item.likedByCurrentUser && localStyles.likeButtonTextActive,
                    ]}
                  >
                    {item.likedByCurrentUser ? "Liked" : "Like"}
                  </Text>
                </TouchableOpacity>
              </View>

              {getNonImageAttachments(item).length > 0 && (
                <View style={styles.attachments}>
                  <Text style={styles.attachHeader}>Files</Text>

                  {getNonImageAttachments(item).map((file, index) => (
                    <TouchableOpacity
                      key={index}
                      style={styles.fileRow}
                      onPress={() => {
                        if (!isSafeHttpUrl(file?.fileUrl)) return;
                        Linking.openURL(file.fileUrl);
                      }}
                    >
                      <Ionicons
                        name="document-attach-outline"
                        size={18}
                        color={COLORS.link}
                      />
                      <Text style={styles.link}>
                        {safeDisplayText(file?.fileName, "Attachment")}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
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
          title={safeDisplayText(item?.title, "Guideline image")}
          onClose={() => setSelectedImage(null)}
        />
      </Modal>
    </>
  );
}

function EngagementRow({ item }) {
  const views = Number(item?.viewCount ?? item?.views ?? 0);
  const likes = Number(item?.likeCount ?? 0);

  return (
    <View style={localStyles.engagementRow}>
      <View style={localStyles.engagementPill}>
        <Ionicons name="eye-outline" size={14} color="#647067" />
        <Text style={localStyles.engagementText}>{views} seen</Text>
      </View>
      <View style={localStyles.engagementPill}>
        <Ionicons name="heart-outline" size={14} color="#647067" />
        <Text style={localStyles.engagementText}>{likes} likes</Text>
      </View>
    </View>
  );
}

function ResponsiveAttachmentImage({
  uri,
  onPress,
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
        if (active) {
          setAspectRatio(4 / 3);
        }
      }
    );

    return () => {
      active = false;
    };
  }, [uri]);

  const imageNode = (
    <View style={[localStyles.imageFrame, { minHeight, maxHeight }]}>
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

function ZoomableImageViewer({ image, title, onClose }) {
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
        if (active) {
          setAspectRatio(4 / 3);
        }
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
  const viewerMinHeight = Math.max(height - 210, 320);

  return (
    <View style={styles.imageViewerScreen}>
      <View style={styles.imageViewerHeader}>
        <TouchableOpacity style={styles.imageViewerBack} onPress={onClose}>
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          <Text style={styles.imageViewerBackText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.imageViewerControls}>
          <TouchableOpacity
            style={styles.imageViewerControlBtn}
            onPress={() =>
              setScale((current) => Math.max(1, Number((current - 0.25).toFixed(2))))
            }
          >
            <Ionicons name="remove" size={18} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.imageViewerControlBtn}
            onPress={() => setScale(1)}
          >
            <Text style={styles.imageViewerControlText}>
              {Math.round(clampedScale * 100)}%
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.imageViewerControlBtn}
            onPress={() =>
              setScale((current) => Math.min(3, Number((current + 0.25).toFixed(2))))
            }
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
            { minHeight: viewerMinHeight, width: Math.max(width, scaledWidth + 32) },
          ]}
        >
          <Image
            source={{ uri: image.fileUrl }}
            style={{
              width: scaledWidth,
              height: scaledHeight,
            }}
            resizeMode="contain"
          />
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function getCategoryIcon(category) {
  switch (String(category || "").toLowerCase()) {
    case "earthquake":
      return "pulse-outline";
    case "flood":
      return "water-outline";
    case "typhoon":
      return "rainy-outline";
    default:
      return "reader-outline";
  }
}

function isImageAttachment(file) {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(file?.fileUrl || "");
}

function getPrimaryImage(item) {
  return (item?.attachments || []).find(isImageAttachment) || null;
}

function getNonImageAttachments(item) {
  return (item?.attachments || []).filter((file) => !isImageAttachment(file));
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Recently";

  return date.toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function createThemedGuidelineStyles(theme) {
  return StyleSheet.create({
    screen: {
      backgroundColor: theme.background,
    },
    card: {
      backgroundColor: theme.card,
      borderColor: theme.border,
    },
    surfaceBorder: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
    },
    text: {
      color: theme.text,
    },
    mutedText: {
      color: theme.mutedText,
    },
    softIcon: {
      backgroundColor: theme.primarySoft,
    },
  });
}

const localStyles = StyleSheet.create({
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  publisherAvatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.greenSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  publisherCopy: {
    flex: 1,
  },
  publisherName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "900",
  },
  publisherMeta: {
    marginTop: 2,
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  postBody: {
    padding: 16,
    gap: 10,
  },
  postImage: {
    width: "100%",
    backgroundColor: "#DCE7D8",
  },
  modalPostImage: {
    width: "100%",
    borderRadius: 8,
    backgroundColor: "#DCE7D8",
    marginTop: 18,
    marginBottom: 18,
  },
  imageFrame: {
    width: "100%",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#EEF4EE",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(220,231,216,0.92)",
  },
  postMetaRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  readMoreText: {
    color: COLORS.link,
    fontSize: 13,
    fontWeight: "900",
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
  },
  engagementPill: {
    minHeight: 28,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: "#F8FAF7",
    borderWidth: 1,
    borderColor: "#E2E8E2",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  engagementText: {
    color: "#647067",
    fontSize: 11,
    fontWeight: "800",
  },
  modalEngagementRow: {
    marginTop: 18,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  likeButton: {
    minHeight: 36,
    paddingHorizontal: 13,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: COLORS.green,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  likeButtonActive: {
    backgroundColor: COLORS.green,
  },
  likeButtonDisabled: {
    opacity: 0.5,
  },
  likeButtonText: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: "900",
  },
  likeButtonTextActive: {
    color: "#FFFFFF",
  },
  modalHeaderTitle: {
    flex: 1,
    color: COLORS.text,
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
  articleByline: {
    color: COLORS.textMuted,
    fontSize: 15,
    fontWeight: "800",
  },
  articleDate: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
});
