import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import {
  getPermissionStatus,
  openLocationSettings,
  requestPermission,
  type LocationPermissionStatus,
} from "@/lib/location";

interface LocationPermissionModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function LocationPermissionModal({
  visible,
  onClose,
}: LocationPermissionModalProps) {
  const [status, setStatus] = useState<LocationPermissionStatus>("undetermined");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setWorking(false);
    getPermissionStatus().then(setStatus);
  }, [visible]);

  const handleAllow = async () => {
    setWorking(true);
    const next = await requestPermission();
    setStatus(next);
    setWorking(false);
    if (next === "granted") onClose();
  };

  const handleOpenSettings = async () => {
    await openLocationSettings();
    // We don't auto-close here — when the user returns to the app, the
    // useLocation hook's AppState listener refreshes status. They can dismiss
    // the modal manually with "Maybe later" if they didn't change the setting.
  };

  const renderUndetermined = () => (
    <>
      <View style={styles.iconWrap}>
        <Ionicons name="location" size={56} color={colors.primary.DEFAULT} />
      </View>
      <Text style={styles.title}>Enable Location Access</Text>
      <Text style={styles.body}>
        Your location is recorded with each survey so field data can be mapped
        accurately. You can also enter coordinates manually if you prefer.
      </Text>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={handleAllow}
        disabled={working}
        activeOpacity={0.8}
      >
        {working ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.primaryButtonText}>Allow Location</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={onClose} activeOpacity={0.6}>
        <Text style={styles.secondaryButtonText}>Maybe later</Text>
      </TouchableOpacity>
    </>
  );

  const renderDenied = () => (
    <>
      <View style={[styles.iconWrap, styles.iconWrapWarning]}>
        <Ionicons name="location-outline" size={56} color={colors.status.atRisk} />
      </View>
      <Text style={styles.title}>Location is Disabled</Text>
      <Text style={styles.body}>
        Location access was denied. To use automatic GPS tagging, enable
        location permission for Dulra in your device settings. You can still
        enter coordinates manually in the meantime.
      </Text>
      <TouchableOpacity style={styles.primaryButton} onPress={handleOpenSettings} activeOpacity={0.8}>
        <Text style={styles.primaryButtonText}>Open Settings</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={onClose} activeOpacity={0.6}>
        <Text style={styles.secondaryButtonText}>Maybe later</Text>
      </TouchableOpacity>
    </>
  );

  const renderGranted = () => (
    <>
      <View style={[styles.iconWrap, styles.iconWrapSuccess]}>
        <Ionicons name="checkmark-circle" size={56} color={colors.status.onTrack} />
      </View>
      <Text style={styles.title}>Location Enabled</Text>
      <Text style={styles.body}>
        Dulra has access to your location. GPS data will be recorded with new
        surveys and photos automatically.
      </Text>
      <TouchableOpacity style={styles.primaryButton} onPress={onClose} activeOpacity={0.8}>
        <Text style={styles.primaryButtonText}>Done</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet}>
          <View style={styles.content}>
            {status === "granted"
              ? renderGranted()
              : status === "denied"
              ? renderDenied()
              : renderUndetermined()}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.white,
    borderRadius: 20,
    overflow: "hidden",
  },
  content: {
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: "center",
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary.DEFAULT + "15",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  iconWrapWarning: {
    backgroundColor: colors.status.atRisk + "15",
  },
  iconWrapSuccess: {
    backgroundColor: colors.status.onTrack + "15",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text.heading,
    textAlign: "center",
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.text.body,
    textAlign: "center",
    marginBottom: 28,
  },
  primaryButton: {
    width: "100%",
    backgroundColor: colors.primary.DEFAULT,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.white,
  },
  secondaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: colors.text.muted,
  },
});
