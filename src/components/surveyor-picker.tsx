import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import SelectModal from "@/components/select-modal";
import { supabase } from "@/lib/supabase";
import { getCachedProfiles } from "@/lib/database";

interface SurveyorPickerProps {
  value: string | null;
  currentUserId: string | null;
  currentUserName: string | null;
  onChange: (userId: string, name: string) => void;
}

interface Member {
  id: string;
  name: string;
}

export default function SurveyorPicker({ value, currentUserId, currentUserName, onChange }: SurveyorPickerProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      // Cache-first: cacheAllData at app launch already populated profiles.
      // Only hit the network when the cache is empty (fresh install, cleared storage).
      const cached = await getCachedProfiles();
      if (cached.length > 0) {
        setMembers(
          cached
            .filter((p) => p.full_name)
            .map((p) => ({ id: p.id, name: p.full_name ?? "" }))
        );
        return;
      }

      try {
        const { data } = await supabase.from("profiles").select("id, full_name").order("full_name");
        if (data) {
          setMembers(
            data
              .filter((p) => p.full_name)
              .map((p) => ({ id: p.id, name: p.full_name ?? "" }))
          );
        }
      } catch { /* offline + empty cache — picker still shows current user as fallback */ }
    };
    load();
  }, []);

  const selectedId = value ?? currentUserId;
  const selectedName =
    members.find((m) => m.id === selectedId)?.name ??
    (selectedId === currentUserId ? currentUserName ?? "Me" : "Unknown");

  // Ensure current user is always in the list even if not yet cached
  const options = (() => {
    const list = [...members];
    if (currentUserId && !list.some((m) => m.id === currentUserId)) {
      list.unshift({ id: currentUserId, name: currentUserName ?? "Me" });
    }
    return list.map((m) => ({
      label: m.id === currentUserId ? `${m.name} (Me)` : m.name,
      value: m.id,
    }));
  })();

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Surveyor</Text>
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => setPickerOpen(true)}
        disabled={options.length <= 1}
      >
        <Ionicons name="person-outline" size={18} color={colors.text.muted} />
        <Text style={styles.name}>{selectedName}</Text>
        {options.length > 1 && (
          <Ionicons name="chevron-down" size={18} color={colors.text.muted} />
        )}
      </TouchableOpacity>

      <SelectModal
        visible={pickerOpen}
        title="Select Surveyor"
        options={options}
        selectedValue={selectedId}
        onSelect={(userId) => {
          const m = options.find((o) => o.value === userId);
          onChange(userId, m?.label.replace(/ \(Me\)$/, "") ?? "");
        }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "600", color: colors.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.background.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  name: { flex: 1, fontSize: 16, fontWeight: "500", color: colors.text.heading },
});
