import { useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Dimensions,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";

const screen = Dimensions.get("window");

interface PhotoViewerProps {
  photos: string[];
  imageWidth: number;
}

export default function PhotoViewer({ photos, imageWidth }: PhotoViewerProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [sizes, setSizes] = useState<Record<number, number>>({});

  const loadSize = (url: string, index: number) => {
    Image.getSize(url, (w, h) => {
      setSizes((prev) => ({ ...prev, [index]: (imageWidth / w) * h }));
    });
  };

  const selectedUrl = selectedIndex !== null ? photos[selectedIndex] : null;

  return (
    <>
      {photos.map((url, i) => (
        <TouchableOpacity
          key={i}
          activeOpacity={0.85}
          onPress={() => setSelectedIndex(i)}
        >
          <Image
            source={{ uri: url }}
            style={[styles.thumbnail, { width: imageWidth, height: sizes[i] ?? 200 }]}
            resizeMode="contain"
            onLoad={() => loadSize(url, i)}
          />
        </TouchableOpacity>
      ))}

      <Modal
        visible={selectedIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedIndex(null)}
      >
        <SafeAreaView style={styles.overlay}>
          <View style={styles.header}>
            <Text style={styles.counter}>
              {selectedIndex !== null ? `${selectedIndex + 1} / ${photos.length}` : ""}
            </Text>
            <TouchableOpacity
              onPress={() => setSelectedIndex(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.imageContainer}>
            {selectedUrl && (
              <ScrollView
                maximumZoomScale={5}
                minimumZoomScale={1}
                centerContent
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.zoomContainer}
              >
                <Image
                  source={{ uri: selectedUrl }}
                  style={styles.fullImage}
                  resizeMode="contain"
                />
              </ScrollView>
            )}
          </View>

          {photos.length > 1 && (
            <View style={styles.nav}>
              <TouchableOpacity
                style={[styles.navButton, selectedIndex === 0 && styles.navDisabled]}
                onPress={() => setSelectedIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
                disabled={selectedIndex === 0}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={28} color={selectedIndex === 0 ? "#555" : "#FFF"} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.navButton, selectedIndex === photos.length - 1 && styles.navDisabled]}
                onPress={() => setSelectedIndex((i) => (i !== null && i < photos.length - 1 ? i + 1 : i))}
                disabled={selectedIndex === photos.length - 1}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-forward" size={28} color={selectedIndex === photos.length - 1 ? "#555" : "#FFF"} />
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: colors.background.page,
    alignSelf: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  counter: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  imageContainer: {
    flex: 1,
  },
  zoomContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  fullImage: {
    width: screen.width,
    height: screen.height * 0.75,
  },
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  navButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  navDisabled: {
    opacity: 0.3,
  },
});
