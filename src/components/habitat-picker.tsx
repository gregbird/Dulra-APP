import { useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  SafeAreaView,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import fossittAll from "@/lib/fossitt-codes.json";

const FOSSITT_LEVEL3 = (fossittAll as { code: string; name: string; level: number; parent?: string }[])
  .filter((f) => f.level === 3);

export { FOSSITT_LEVEL3 };

interface HabitatPickerProps {
  visible: boolean;
  selectedCode: string | null;
  onSelect: (code: string) => void;
  onClose: () => void;
}

export default function HabitatPicker({ visible, selectedCode, onSelect, onClose }: HabitatPickerProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return FOSSITT_LEVEL3;
    const lower = search.toLowerCase();
    return FOSSITT_LEVEL3.filter(
      (f) => f.code.toLowerCase().includes(lower) || f.name.toLowerCase().includes(lower),
    );
  }, [search]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Habitat Type</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={colors.text.heading} />
          </TouchableOpacity>
        </View>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={20} color={colors.text.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search code or name..."
            placeholderTextColor={colors.text.muted}
            value={search}
            onChangeText={setSearch}
            autoFocus
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={20} color={colors.text.muted} />
            </TouchableOpacity>
          )}
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.code}
          contentContainerStyle={{ padding: 12 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isSelected = item.code === selectedCode;
            return (
              <TouchableOpacity
                style={[styles.item, isSelected && styles.itemSelected]}
                activeOpacity={0.7}
                onPress={() => { onSelect(item.code); onClose(); setSearch(""); }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.code, isSelected && { color: colors.primary.DEFAULT }]}>{item.code}</Text>
                  <Text style={styles.name}>{item.name}</Text>
                </View>
                {isSelected && <Ionicons name="checkmark" size={22} color={colors.primary.DEFAULT} />}
              </TouchableOpacity>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 18, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", backgroundColor: colors.background.card },
  title: { fontSize: 18, fontWeight: "600", color: colors.text.heading },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 10, margin: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#F3F4F6", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  searchInput: { flex: 1, fontSize: 16, color: colors.text.heading, paddingVertical: 4 },
  item: { flexDirection: "row", alignItems: "center", backgroundColor: colors.background.card, borderRadius: 12, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: "#E5E7EB" },
  itemSelected: { borderColor: colors.primary.DEFAULT, backgroundColor: colors.primary.DEFAULT + "08" },
  code: { fontSize: 16, fontWeight: "700", color: colors.text.heading },
  name: { fontSize: 14, color: colors.text.body, marginTop: 2 },
});
