import { useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";

interface CameraCaptureProps {
  visible: boolean;
  onClose: () => void;
  onCapture: (uri: string) => void;
}

export default function CameraCapture({ visible, onClose, onCapture }: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
    setCapturing(false);
    if (photo?.uri) {
      onCapture(photo.uri);
      onClose();
    }
  };

  const renderContent = () => {
    if (!permission) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.white} />
        </View>
      );
    }

    if (!permission.granted) {
      const handleAllow = async () => {
        const result = await requestPermission();
        if (!result.granted) {
          Alert.alert(
            "Camera Access Denied",
            "Please enable camera access in Settings to take photos.",
            [{ text: "OK", onPress: onClose }]
          );
        }
      };

      return (
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={56} color={colors.white} />
          <Text style={styles.permText}>Camera access is required to take photos</Text>
          <TouchableOpacity style={styles.permButton} onPress={handleAllow} activeOpacity={0.8}>
            <Text style={styles.permButtonText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <CameraView ref={cameraRef} style={styles.camera} facing={facing} enableTorch={flash}>
        <SafeAreaView style={styles.overlay}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={30} color={colors.white} />
            </TouchableOpacity>
            <View style={styles.topActions}>
              <TouchableOpacity
                onPress={() => setFlash((f) => !f)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name={flash ? "flash" : "flash-off"} size={26} color={flash ? "#FBBF24" : colors.white} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="camera-reverse-outline" size={28} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.captureButton}
              onPress={handleCapture}
              disabled={capturing}
              activeOpacity={0.7}
            >
              {capturing ? (
                <ActivityIndicator color={colors.text.heading} />
              ) : (
                <View style={styles.captureInner} />
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </CameraView>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>{renderContent()}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 16 },
  permText: { fontSize: 18, color: colors.white, textAlign: "center", lineHeight: 26 },
  permButton: {
    backgroundColor: colors.primary.DEFAULT, paddingHorizontal: 28,
    paddingVertical: 14, borderRadius: 12, marginTop: 8,
  },
  permButtonText: { fontSize: 17, fontWeight: "600", color: colors.white },
  camera: { flex: 1 },
  overlay: { flex: 1, justifyContent: "space-between" },
  topBar: {
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 12, alignItems: "center",
  },
  topActions: { flexDirection: "row", gap: 20, alignItems: "center" },
  bottomBar: { alignItems: "center", paddingBottom: 40 },
  captureButton: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: "rgba(255,255,255,0.3)",
    justifyContent: "center", alignItems: "center",
    borderWidth: 4, borderColor: colors.white,
  },
  captureInner: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: colors.white,
  },
});
