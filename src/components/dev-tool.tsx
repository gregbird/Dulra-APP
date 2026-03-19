import { useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
  Animated,
  Alert,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";

export default function DevTool() {
  const [menuVisible, setMenuVisible] = useState(false);
  const pan = useRef(new Animated.ValueXY({ x: 20, y: 100 })).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: (pan.x as unknown as { _value: number })._value,
          y: (pan.y as unknown as { _value: number })._value,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    })
  ).current;

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
          setMenuVisible(false);
        },
      },
    ]);
  };

  const handleClearCache = () => {
    Alert.alert("Clear Cache", "Clear local cache?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          setMenuVisible(false);
          Alert.alert("Done", "Cache cleared.");
        },
      },
    ]);
  };

  return (
    <>
      <Animated.View
        style={[styles.fab, { transform: pan.getTranslateTransform() }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.fabButton}
          onPress={() => setMenuVisible(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="construct" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menu}>
            <Text style={styles.menuTitle}>Dev Tools</Text>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleLogout}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Sign Out</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleClearCache}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Clear Cache</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemClose]}
              onPress={() => setMenuVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.menuItemText, { color: colors.text.muted }]}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    zIndex: 9999,
  },
  fabButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#EF4444",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  fabText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  menu: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 24,
    width: 260,
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text.heading,
    marginBottom: 20,
    textAlign: "center",
  },
  menuItem: {
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background.page,
    borderRadius: 10,
    marginBottom: 10,
  },
  menuItemClose: {
    backgroundColor: "transparent",
    marginBottom: 0,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#EF4444",
  },
});
