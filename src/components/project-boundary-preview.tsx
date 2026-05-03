import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MapView, { Polygon, PROVIDER_DEFAULT } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import {
  fetchProjectBoundary,
  flattenBoundaryCoordinates,
  polygonToCoordinates,
  type ProjectBoundary,
} from "@/lib/project-boundary";

interface Props {
  projectId: string;
  /** Currently selected site ID (from project detail SitePicker). null = "All Sites". */
  selectedSiteId: string | null;
  /** Tap callback — opens the fullscreen map screen. */
  onPress: () => void;
}

const PREVIEW_HEIGHT = 200;
const FIT_PADDING = { top: 30, right: 30, bottom: 30, left: 30 };

/**
 * Read-only map card shown on the project detail screen. Renders the
 * project boundary plus all site polygons, fitted to bounds. The card is
 * tappable; the parent navigates to the fullscreen route. Internal map
 * gestures stay disabled — this is a preview, not an interactive widget.
 */
export default function ProjectBoundaryPreview({ projectId, selectedSiteId, onPress }: Props) {
  const [data, setData] = useState<ProjectBoundary | null>(null);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProjectBoundary(projectId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const allCoords = data ? flattenBoundaryCoordinates(data) : [];
  const hasGeometry = allCoords.length > 0;

  // Fit the camera to all geometry once layout completes. The layout-driven
  // trigger matters: fitToCoordinates before the map is laid out is a no-op,
  // so we wait for onMapReady AND for our data state, then fire once.
  const handleMapReady = () => {
    if (mapRef.current && allCoords.length > 0) {
      mapRef.current.fitToCoordinates(allCoords, { edgePadding: FIT_PADDING, animated: false });
    }
  };

  if (loading) {
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card}>
        <View style={[styles.placeholder, styles.center]}>
          <ActivityIndicator size="small" color={colors.primary.DEFAULT} />
        </View>
      </TouchableOpacity>
    );
  }

  if (!data || !hasGeometry) {
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card} disabled>
        <View style={[styles.placeholder, styles.center]}>
          <Ionicons name="map-outline" size={32} color={colors.text.muted} />
          <Text style={styles.placeholderText}>Boundary not set</Text>
          <Text style={styles.placeholderSub}>The project hasn't been mapped yet.</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={styles.card}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        onMapReady={handleMapReady}
      >
        {data.sites.map((site) => {
          const coords = polygonToCoordinates(site.boundary);
          if (coords.length === 0) return null;
          const isPrimary = selectedSiteId === null || site.id === selectedSiteId;
          return (
            <Polygon
              key={site.id}
              coordinates={coords}
              strokeColor={isPrimary ? colors.primary.DEFAULT : "#94a3b8"}
              strokeWidth={isPrimary ? 3 : 2}
              fillColor={isPrimary ? colors.primary.DEFAULT + "33" : "transparent"}
            />
          );
        })}
        {/* Project-level boundary fallback when no site polygons exist. */}
        {data.sites.length === 0 && data.projectBoundary?.geometry && (
          <Polygon
            coordinates={polygonToCoordinates(data.projectBoundary.geometry)}
            strokeColor={colors.primary.DEFAULT}
            strokeWidth={3}
            fillColor={colors.primary.DEFAULT + "33"}
          />
        )}
      </MapView>

      <View style={styles.tapHint}>
        <Ionicons name="expand-outline" size={16} color={colors.white} />
        <Text style={styles.tapHintText}>Open map</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    height: PREVIEW_HEIGHT,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.background.card,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  map: { flex: 1 },
  placeholder: {
    flex: 1,
    backgroundColor: colors.background.page,
    paddingHorizontal: 16,
    gap: 6,
  },
  center: { justifyContent: "center", alignItems: "center" },
  placeholderText: { fontSize: 15, fontWeight: "600", color: colors.text.body, marginTop: 8 },
  placeholderSub: { fontSize: 13, color: colors.text.muted, textAlign: "center" },
  tapHint: {
    position: "absolute",
    right: 12, bottom: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
  },
  tapHintText: { fontSize: 13, fontWeight: "600", color: colors.white },
});
