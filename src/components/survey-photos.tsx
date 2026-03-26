import { useEffect, useState, useImperativeHandle, forwardRef } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Dimensions,
  SafeAreaView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import { uploadPhoto } from "@/lib/photo-service";
import { useNetworkStore } from "@/lib/network";
import CameraCapture from "@/components/camera-capture";

const thumbSize = (Dimensions.get("window").width - 32 - 24) / 3;

interface SavedPhoto {
  id: string;
  storage_path: string;
  watermarked_path: string | null;
}

interface PendingPhoto {
  uri: string;
  uploading: boolean;
  failed: boolean;
}

export interface SurveyPhotosHandle {
  getPendingUris: () => string[];
  clearPending: (newSurveyId?: string) => void;
}

interface SurveyPhotosProps {
  surveyId: string | null;
  projectId: string;
  projectName?: string;
}

export default forwardRef<SurveyPhotosHandle, SurveyPhotosProps>(
  function SurveyPhotos({ surveyId, projectId, projectName }, ref) {
    const [saved, setSaved] = useState<SavedPhoto[]>([]);
    const [pending, setPending] = useState<PendingPhoto[]>([]);
    const [loading, setLoading] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);

    useImperativeHandle(ref, () => ({
      getPendingUris: () => pending.map((p) => p.uri),
      clearPending: (newSurveyId?: string) => {
        setPending([]);
        const sid = newSurveyId ?? surveyId;
        const online = useNetworkStore.getState().isOnline;
        if (sid && online) refetchSaved(sid);
      },
    }));

    const refetchSaved = async (sid: string) => {
      try {
        const { data, error } = await supabase
          .from("photos")
          .select("id, storage_path, watermarked_path")
          .eq("survey_id", sid)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (data) setSaved(data);
      } catch { /* offline */ }
    };

    useEffect(() => {
      if (!surveyId) return;
      const isOnline = useNetworkStore.getState().isOnline;
      if (!isOnline) { setLoading(false); return; }
      setLoading(true);
      refetchSaved(surveyId).finally(() => setLoading(false));
    }, [surveyId]);

    const uploadImmediately = async (uri: string) => {
      if (!surveyId) return;
      const result = await uploadPhoto({ localUri: uri, projectId, projectName, surveyId });
      if (result) {
        setPending((prev) => prev.filter((p) => p.uri !== uri));
        refetchSaved(surveyId);
      } else {
        setPending((prev) =>
          prev.map((p) => (p.uri === uri ? { ...p, uploading: false, failed: true } : p))
        );
      }
    };

    const retryUpload = (uri: string) => {
      setPending((prev) =>
        prev.map((p) => (p.uri === uri ? { ...p, uploading: true, failed: false } : p))
      );
      uploadImmediately(uri);
    };

    const addPhoto = (uri: string) => {
      const isOnline = useNetworkStore.getState().isOnline;
      if (surveyId && isOnline) {
        setPending((prev) => [...prev, { uri, uploading: true, failed: false }]);
        uploadImmediately(uri);
      } else {
        setPending((prev) => [...prev, { uri, uploading: false, failed: false }]);
      }
    };

    const handleCapture = (uri: string) => addPhoto(uri);

    const handlePickFromGallery = async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (result.canceled || !result.assets[0]) return;
      addPhoto(result.assets[0].uri);
    };

    const removePending = (index: number) => {
      setPending((prev) => prev.filter((_, i) => i !== index));
    };

    const deleteSavedPhoto = (photo: SavedPhoto) => {
      Alert.alert("Delete Photo", "Are you sure you want to delete this photo?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await supabase.storage.from("project-photos").remove([photo.storage_path]);
            await supabase.from("photos").delete().eq("id", photo.id);
            setSaved((prev) => prev.filter((p) => p.id !== photo.id));
          },
        },
      ]);
    };

    const getPublicUrl = (path: string) => {
      const { data } = supabase.storage.from("project-photos").getPublicUrl(path);
      return data.publicUrl;
    };

    const getDisplayUrl = (photo: SavedPhoto) => {
      return getPublicUrl(photo.watermarked_path ?? photo.storage_path);
    };

    const isOnline = useNetworkStore((s) => s.isOnline);
    const totalCount = saved.length + pending.length;

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="camera-outline" size={22} color={colors.primary.DEFAULT} />
            <Text style={styles.title}>Photos ({totalCount})</Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setCameraOpen(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="camera" size={20} color={colors.primary.DEFAULT} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handlePickFromGallery}
              activeOpacity={0.7}
            >
              <Ionicons name="images" size={20} color={colors.primary.DEFAULT} />
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} style={{ padding: 20 }} />
        ) : totalCount > 0 ? (
          <View style={styles.grid}>
            {pending.map((photo, i) => (
              <View key={`p-${i}`} style={styles.thumbWrap}>
                <Image source={{ uri: photo.uri }} style={styles.thumb} />
                {photo.uploading && (
                  <View style={styles.uploadingOverlay}>
                    <ActivityIndicator size="small" color={colors.white} />
                  </View>
                )}
                {photo.failed && (
                  <TouchableOpacity
                    style={styles.uploadingOverlay}
                    onPress={() => retryUpload(photo.uri)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="reload" size={22} color={colors.white} />
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                )}
                {!photo.uploading && (
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => removePending(i)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={22} color="#EF4444" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {isOnline && saved.map((photo, i) => (
              <View key={photo.id} style={styles.thumbWrap}>
                <TouchableOpacity activeOpacity={0.8} onPress={() => setViewerIndex(i)}>
                  <Image
                    source={{ uri: getDisplayUrl(photo) }}
                    style={styles.thumb}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => deleteSavedPhoto(photo)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={22} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))}
            {!isOnline && saved.length > 0 && (
              <Text style={styles.offlineText}>{saved.length} saved photos — visible when online</Text>
            )}
          </View>
        ) : (
          <Text style={styles.emptyText}>No photos yet</Text>
        )}

        <CameraCapture
          visible={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onCapture={handleCapture}
        />

        <Modal visible={viewerIndex !== null} transparent animationType="fade" onRequestClose={() => setViewerIndex(null)}>
          <SafeAreaView style={styles.viewer}>
            <View style={styles.viewerHeader}>
              <Text style={styles.viewerCount}>
                {viewerIndex !== null ? `${viewerIndex + 1} / ${saved.length}` : ""}
              </Text>
              <TouchableOpacity onPress={() => setViewerIndex(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={28} color="#FFF" />
              </TouchableOpacity>
            </View>
            <ScrollView maximumZoomScale={5} minimumZoomScale={1} centerContent contentContainerStyle={styles.viewerBody}>
              {viewerIndex !== null && saved[viewerIndex] && (
                <Image
                  source={{ uri: getDisplayUrl(saved[viewerIndex]) }}
                  style={styles.viewerImage}
                  resizeMode="contain"
                />
              )}
            </ScrollView>
            {saved.length > 1 && (
              <View style={styles.viewerNav}>
                <TouchableOpacity
                  style={[styles.navBtn, viewerIndex === 0 && styles.navDisabled]}
                  disabled={viewerIndex === 0}
                  onPress={() => setViewerIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
                >
                  <Ionicons name="chevron-back" size={28} color={viewerIndex === 0 ? "#555" : "#FFF"} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.navBtn, viewerIndex === saved.length - 1 && styles.navDisabled]}
                  disabled={viewerIndex === saved.length - 1}
                  onPress={() => setViewerIndex((i) => (i !== null && i < saved.length - 1 ? i + 1 : i))}
                >
                  <Ionicons name="chevron-forward" size={28} color={viewerIndex === saved.length - 1 ? "#555" : "#FFF"} />
                </TouchableOpacity>
              </View>
            )}
          </SafeAreaView>
        </Modal>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background.card, borderRadius: 14,
    marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden",
  },
  header: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", padding: 18,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 17, fontWeight: "600", color: colors.text.heading },
  actions: { flexDirection: "row", gap: 8 },
  actionButton: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: colors.primary.DEFAULT + "15",
    justifyContent: "center", alignItems: "center",
  },
  grid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
    paddingHorizontal: 18, paddingBottom: 18,
  },
  thumbWrap: { position: "relative" },
  thumb: {
    width: thumbSize, height: thumbSize,
    borderRadius: 10, backgroundColor: colors.background.page,
  },
  uploadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 10, backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center", alignItems: "center",
  },
  removeButton: { position: "absolute", top: -6, right: -6 },
  pendingBadge: {
    position: "absolute", bottom: 4, left: 4,
    backgroundColor: colors.primary.DEFAULT,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  pendingText: { fontSize: 10, fontWeight: "700", color: colors.white },
  retryText: { fontSize: 11, fontWeight: "600", color: colors.white, marginTop: 2 },
  emptyText: {
    fontSize: 15, color: colors.text.muted,
    paddingHorizontal: 18, paddingBottom: 18,
  },
  offlineText: {
    fontSize: 14, color: colors.text.muted, fontStyle: "italic",
    paddingBottom: 4,
  },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)" },
  viewerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12 },
  viewerCount: { fontSize: 16, fontWeight: "600", color: "#FFF" },
  viewerBody: { flex: 1, justifyContent: "center", alignItems: "center" },
  viewerImage: { width: Dimensions.get("window").width, height: Dimensions.get("window").height * 0.75 },
  viewerNav: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 20 },
  navBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(255,255,255,0.15)", justifyContent: "center", alignItems: "center" },
  navDisabled: { opacity: 0.3 },
});
