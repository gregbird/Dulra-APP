import { useEffect, useRef } from "react";
import { Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNetworkStore } from "@/lib/network";
import { syncPendingData } from "@/lib/sync-service";
import { colors } from "@/constants/colors";

export default function SyncIndicator() {
  const insets = useSafeAreaInsets();
  const { isOnline, pendingCount, syncing } = useNetworkStore();

  useEffect(() => {
    if (isOnline && pendingCount > 0 && !syncing) {
      const timer = setTimeout(() => syncPendingData(), 1000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, pendingCount]);

  if (isOnline && pendingCount === 0 && !syncing) return null;

  const handlePress = () => {
    if (isOnline && pendingCount > 0 && !syncing) {
      syncPendingData();
    }
  };

  return (
    <TouchableOpacity
      style={[styles.container, !isOnline ? styles.offline : styles.pending, { paddingTop: insets.top + 6 }]}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      {!isOnline ? (
        <>
          <Ionicons name="cloud-offline-outline" size={16} color="#FFF" />
          <Text style={styles.text}>
            Offline{pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
          </Text>
        </>
      ) : syncing ? (
        <>
          <ActivityIndicator size="small" color="#FFF" />
          <Text style={styles.text}>Syncing...</Text>
        </>
      ) : (
        <>
          <Ionicons name="cloud-upload-outline" size={16} color="#FFF" />
          <Text style={styles.text}>{pendingCount} pending — tap to sync</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  offline: { backgroundColor: "#374151" },
  pending: { backgroundColor: colors.primary.DEFAULT },
  text: { fontSize: 13, fontWeight: "600", color: "#FFF" },
});
