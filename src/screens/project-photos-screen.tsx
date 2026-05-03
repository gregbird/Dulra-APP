import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useNetworkStore } from "@/lib/network";
import { savePhotoLocally, getCachedProjectSites } from "@/lib/database";
import { uploadPhoto } from "@/lib/photo-service";
import { refreshPendingCount } from "@/lib/sync-service";
import CameraCapture from "@/components/camera-capture";
import CaptionPrompt from "@/components/caption-prompt";
import SitePicker from "@/components/site-picker";
import type { ProjectSite } from "@/types/project";

interface ProjectPhoto {
  id: string;
  storage_path: string;
  watermarked_path: string | null;
  caption: string | null;
  taken_at: string | null;
  publicUrl: string;
  watermarkedUrl: string | null;
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const GRID_PADDING = 12;
const GRID_GAP = 8;
const COLUMNS = 3;
const TILE_SIZE = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

export default function ProjectPhotosScreen() {
  const { id, siteId: siteIdParam } = useLocalSearchParams<{ id: string; siteId?: string }>();
  const router = useRouter();
  const isOnline = useNetworkStore((s) => s.isOnline);
  const [photos, setPhotos] = useState<ProjectPhoto[]>([]);
  const [projectName, setProjectName] = useState("");
  const [sites, setSites] = useState<ProjectSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(siteIdParam ?? null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [captionVisible, setCaptionVisible] = useState(false);
  const [pendingCapturedUri, setPendingCapturedUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // Single-site projects auto-resolve to that site, so the user never sees
  // a picker for them. Multi-site projects fall through to whatever the user
  // explicitly chose (or null = "All Sites" when reading, "must pick" when
  // adding a new photo).
  const effectiveSiteId = useMemo(() => {
    if (sites.length === 1) return sites[0].id;
    return selectedSiteId;
  }, [sites, selectedSiteId]);

  const buildPublicUrl = useCallback((path: string): string => {
    return supabase.storage.from("project-photos").getPublicUrl(path).data.publicUrl;
  }, []);

  const loadSites = useCallback(async () => {
    if (!id) return;
    if (!useNetworkStore.getState().isOnline) {
      const cached = await getCachedProjectSites(id);
      setSites(cached as ProjectSite[]);
      return;
    }
    try {
      const { data } = await supabase
        .from("project_sites")
        .select("id, project_id, site_code, site_name, sort_order, county")
        .eq("project_id", id)
        .order("sort_order");
      if (data) setSites(data as ProjectSite[]);
    } catch {
      const cached = await getCachedProjectSites(id);
      setSites(cached as ProjectSite[]);
    }
  }, [id]);

  const fetchPhotos = useCallback(async () => {
    if (!id) return;
    try {
      const { data: proj } = await supabase
        .from("projects")
        .select("name")
        .eq("id", id)
        .single();
      if (proj?.name) setProjectName(proj.name);

      // Site-level photos: tagged 'site' and no FK to a survey/habitat/note.
      // The tag is the source of truth (web's gallery is tag-driven); the
      // FK-null guard is belt-and-braces in case an older row was tagged
      // without going through this flow.
      let query = supabase
        .from("photos")
        .select("id, storage_path, watermarked_path, caption, taken_at, tags, site_id, survey_id, habitat_polygon_id, target_note_id")
        .eq("project_id", id)
        .contains("tags", ["site"])
        .is("survey_id", null)
        .is("habitat_polygon_id", null)
        .is("target_note_id", null);

      // Multi-site: scope to the picked site. Single-site projects auto-pick
      // their only site so this still narrows correctly. "All Sites" view
      // (multi-site, no selection) shows everything.
      if (effectiveSiteId) {
        query = query.eq("site_id", effectiveSiteId);
      }

      const { data, error } = await query.order("taken_at", { ascending: false, nullsFirst: false });
      if (error) throw error;

      const mapped: ProjectPhoto[] = (data ?? []).map((row) => ({
        id: row.id,
        storage_path: row.storage_path,
        watermarked_path: row.watermarked_path,
        caption: row.caption,
        taken_at: row.taken_at,
        publicUrl: buildPublicUrl(row.storage_path),
        watermarkedUrl: row.watermarked_path ? buildPublicUrl(row.watermarked_path) : null,
      }));
      setPhotos(mapped);
    } catch {
      // Offline / RLS / whatever — leave whatever we already had on screen
      // so the user can still see the last successful fetch. Future work:
      // add a cached_project_photos table when offline viewing of existing
      // site photos becomes important.
    }
  }, [id, buildPublicUrl, effectiveSiteId]);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  useEffect(() => {
    fetchPhotos().finally(() => setLoading(false));
  }, [fetchPhotos]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadSites(), fetchPhotos()]);
    setRefreshing(false);
  };

  const handleAddPhotoPress = () => {
    if (sites.length > 1 && !effectiveSiteId) {
      Alert.alert(
        "Select a Site",
        "Please pick a site from the picker above before adding a site photo.",
      );
      return;
    }
    Alert.alert(
      "Add Photo",
      undefined,
      [
        { text: "Take Photo", onPress: () => setCameraVisible(true) },
        { text: "Choose from Library", onPress: pickFromLibrary },
        { text: "Cancel", style: "cancel" },
      ],
      { cancelable: true },
    );
  };

  const pickFromLibrary = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (result.canceled || !result.assets[0]) return;
      setPendingCapturedUri(result.assets[0].uri);
      setCaptionVisible(true);
    } catch {
      Alert.alert("Library Unavailable", "Could not open the photo library. Check Settings.");
    }
  };

  const handleCameraCapture = (uri: string) => {
    setCameraVisible(false);
    setPendingCapturedUri(uri);
    setCaptionVisible(true);
  };

  const handleCaptionSubmit = async (caption: string | null) => {
    setCaptionVisible(false);
    if (!pendingCapturedUri || !id) {
      setPendingCapturedUri(null);
      return;
    }
    const localUri = pendingCapturedUri;
    setPendingCapturedUri(null);
    setUploading(true);

    const siteIdForUpload = effectiveSiteId;

    if (isOnline) {
      const result = await uploadPhoto({
        localUri,
        projectId: id,
        projectName,
        tags: ["site"],
        caption,
        siteId: siteIdForUpload,
      });
      setUploading(false);
      if (result) {
        await fetchPhotos();
      } else {
        // Online upload failed — fall through to offline queue so the photo
        // isn't lost. User sees a single "Saved Offline" notice.
        await savePhotoLocally({
          localUri,
          projectId: id,
          projectName,
          tags: ["site"],
          caption,
          siteId: siteIdForUpload,
        });
        await refreshPendingCount();
        Alert.alert("Saved Offline", "Upload failed; the photo is queued and will sync later.");
      }
      return;
    }

    await savePhotoLocally({
      localUri,
      projectId: id,
      projectName,
      tags: ["site"],
      caption,
      siteId: siteIdForUpload,
    });
    await refreshPendingCount();
    setUploading(false);
    Alert.alert("Saved Offline", "Photo queued. It will sync when you're back online.");
  };

  const handleCaptionSkip = () => handleCaptionSubmit(null);

  const photoUrls = photos.map((p) => p.watermarkedUrl ?? p.publicUrl);

  const renderTile = ({ item, index }: { item: ProjectPhoto; index: number }) => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => setViewerIndex(index)}
      style={[styles.tile, { width: TILE_SIZE, height: TILE_SIZE }]}
    >
      <Image
        source={{ uri: item.watermarkedUrl ?? item.publicUrl }}
        style={styles.tileImage}
        resizeMode="cover"
      />
      {item.caption ? (
        <View style={styles.captionOverlay}>
          <Text style={styles.captionText} numberOfLines={1}>{item.caption}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: "Photos" }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Photos",
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace(`/project/${id}`);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={28} color={colors.primary.DEFAULT} />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.container}>
        {sites.length > 1 && (
          <View style={styles.sitePickerWrap}>
            <SitePicker
              sites={sites}
              selectedSiteId={selectedSiteId}
              onSelect={setSelectedSiteId}
            />
          </View>
        )}
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id}
          renderItem={renderTile}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary.DEFAULT} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="images-outline" size={48} color={colors.text.muted} />
              <Text style={styles.emptyText}>No site photos yet</Text>
              <Text style={styles.emptySub}>
                Tap the camera button to add a photo of the site itself.
              </Text>
            </View>
          }
        />

        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.85}
          onPress={handleAddPhotoPress}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Ionicons name="camera" size={26} color={colors.white} />
          )}
        </TouchableOpacity>

        <CameraCapture
          visible={cameraVisible}
          onClose={() => setCameraVisible(false)}
          onCapture={handleCameraCapture}
        />

        <CaptionPrompt
          visible={captionVisible}
          onSubmit={handleCaptionSubmit}
          onSkip={handleCaptionSkip}
        />

        <FullscreenGallery
          urls={photoUrls}
          visible={viewerIndex !== null}
          initialIndex={viewerIndex ?? 0}
          onClose={() => setViewerIndex(null)}
        />
      </View>
    </>
  );
}

function FullscreenGallery({
  urls, visible, initialIndex, onClose,
}: {
  urls: string[];
  visible: boolean;
  initialIndex: number;
  onClose: () => void;
}) {
  // Stays mounted; visibility is the Modal's job. Reset the displayed index
  // every time the gallery opens so a previous "navigated to photo 3" state
  // doesn't bleed into a fresh tap on photo 0. Keying internal state to
  // visible+initialIndex avoids the black-screen-on-reopen issue we saw
  // with conditional inline rendering.
  const [index, setIndex] = useState(initialIndex);
  const screen = Dimensions.get("window");

  useEffect(() => {
    if (visible) setIndex(initialIndex);
  }, [visible, initialIndex]);

  const safeIndex = Math.min(Math.max(index, 0), Math.max(urls.length - 1, 0));
  const url = urls[safeIndex];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaView style={styles.galleryOverlay}>
        <View style={styles.galleryHeader}>
          <Text style={styles.galleryCounter}>{safeIndex + 1} / {urls.length}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={28} color={colors.white} />
          </TouchableOpacity>
        </View>
        <View style={styles.galleryImageWrap}>
          {/*
            ScrollView's built-in pinch-to-zoom (maximumZoomScale) — same
            pattern as photo-viewer.tsx. Keying on safeIndex forces a remount
            on page change so the zoom level resets cleanly.
          */}
          {url ? (
            <ScrollView
              key={safeIndex}
              maximumZoomScale={5}
              minimumZoomScale={1}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.galleryZoomContent}
            >
              <Image
                source={{ uri: url }}
                style={{ width: screen.width, height: screen.height * 0.75 }}
                resizeMode="contain"
              />
            </ScrollView>
          ) : null}
        </View>
        {urls.length > 1 && (
          <View style={styles.galleryNav}>
            <TouchableOpacity
              style={[styles.galleryNavBtn, safeIndex === 0 && styles.galleryNavDisabled]}
              onPress={() => setIndex((i) => (i > 0 ? i - 1 : i))}
              disabled={safeIndex === 0}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={28} color={safeIndex === 0 ? "#555" : colors.white} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.galleryNavBtn, safeIndex === urls.length - 1 && styles.galleryNavDisabled]}
              onPress={() => setIndex((i) => (i < urls.length - 1 ? i + 1 : i))}
              disabled={safeIndex === urls.length - 1}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-forward" size={28} color={safeIndex === urls.length - 1 ? "#555" : colors.white} />
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background.page },
  sitePickerWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
    backgroundColor: colors.background.page,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  list: { padding: GRID_PADDING, paddingBottom: 100 },
  tile: {
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: colors.background.card,
  },
  tileImage: { width: "100%", height: "100%" },
  captionOverlay: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8, paddingVertical: 4,
  },
  captionText: { color: colors.white, fontSize: 12, fontWeight: "500" },
  empty: {
    alignItems: "center",
    paddingTop: 80,
    gap: 10,
    paddingHorizontal: 24,
  },
  emptyText: { fontSize: 17, color: colors.text.body, fontWeight: "500" },
  emptySub: { fontSize: 14, color: colors.text.muted, textAlign: "center" },
  fab: {
    position: "absolute",
    right: 20, bottom: 28,
    width: 60, height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary.DEFAULT,
    justifyContent: "center", alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  galleryOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.95)",
  },
  galleryHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12,
  },
  galleryCounter: { fontSize: 16, fontWeight: "600", color: colors.white },
  galleryImageWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  galleryZoomContent: { flex: 1, justifyContent: "center", alignItems: "center" },
  galleryNav: {
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 32,
  },
  galleryNavBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center", alignItems: "center",
  },
  galleryNavDisabled: { opacity: 0.3 },
});
