import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import { DOMIN_SCALE, COMMON_FLORA } from "@/constants/releve-data";
import SelectModal from "@/components/select-modal";
import type { ReleveSpeciesEntry } from "@/types/releve";

interface SpeciesRowProps {
  entry: ReleveSpeciesEntry;
  index: number;
  onChange: (index: number, field: keyof ReleveSpeciesEntry, value: string) => void;
  onRemove: (index: number) => void;
}

export default function SpeciesRow({ entry, index, onChange, onRemove }: SpeciesRowProps) {
  const [showDomin, setShowDomin] = useState(false);
  const [suggestions, setSuggestions] = useState<typeof COMMON_FLORA>([]);

  const handleLatinChange = (v: string) => {
    onChange(index, "species_name_latin", v);
    if (v.length >= 2) {
      const lower = v.toLowerCase();
      setSuggestions(COMMON_FLORA.filter((f) => f.latin.toLowerCase().includes(lower)).slice(0, 5));
    } else {
      setSuggestions([]);
    }
  };

  const selectFlora = (flora: { latin: string; english: string }) => {
    onChange(index, "species_name_latin", flora.latin);
    onChange(index, "species_name_english", flora.english);
    setSuggestions([]);
  };

  const dominLabel = entry.species_cover_domin != null
    ? String(entry.species_cover_domin)
    : "Select...";

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text style={styles.index}>#{index + 1}</Text>
        <TouchableOpacity onPress={() => onRemove(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="trash-outline" size={20} color="#DC2626" />
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        placeholder="Latin name *"
        placeholderTextColor={colors.text.muted}
        value={entry.species_name_latin}
        onChangeText={handleLatinChange}
      />
      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((flora) => (
            <TouchableOpacity key={flora.latin} style={styles.suggestionItem} onPress={() => selectFlora(flora)}>
              <Text style={styles.suggestionLatin}>{flora.latin}</Text>
              <Text style={styles.suggestionEnglish}>{flora.english}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <TextInput
        style={styles.input}
        placeholder="English name"
        placeholderTextColor={colors.text.muted}
        value={entry.species_name_english ?? ""}
        onChangeText={(v) => onChange(index, "species_name_english", v)}
      />
      <View style={styles.numbers}>
        <View style={styles.halfField}>
          <Text style={styles.fieldLabel}>DOMIN (1-10)</Text>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setShowDomin(true)}>
            <Text style={[styles.selectBtnText, entry.species_cover_domin == null && { color: colors.text.muted }]}>
              {dominLabel}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.text.muted} />
          </TouchableOpacity>
          <SelectModal
            visible={showDomin}
            title="DOMIN Scale"
            options={DOMIN_SCALE}
            selectedValue={entry.species_cover_domin != null ? String(entry.species_cover_domin) : null}
            onSelect={(v) => onChange(index, "species_cover_domin", v)}
            onClose={() => setShowDomin(false)}
          />
        </View>
        <View style={styles.halfField}>
          <Text style={styles.fieldLabel}>Cover %</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.text.muted}
            keyboardType="number-pad"
            value={entry.species_cover_pct != null ? String(entry.species_cover_pct) : ""}
            onChangeText={(v) => onChange(index, "species_cover_pct", v)}
          />
        </View>
      </View>
      <TextInput
        style={styles.input}
        placeholder="Notes"
        placeholderTextColor={colors.text.muted}
        value={entry.notes ?? ""}
        onChangeText={(v) => onChange(index, "notes", v)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  index: { fontSize: 15, fontWeight: "600", color: colors.text.muted },
  input: { backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text.heading, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 6 },
  numbers: { flexDirection: "row", gap: 10, marginVertical: 6 },
  halfField: { flex: 1 },
  fieldLabel: { fontSize: 14, fontWeight: "500", color: colors.text.body, marginBottom: 6 },
  selectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  selectBtnText: { fontSize: 16, color: colors.text.heading, flex: 1 },
  suggestions: { backgroundColor: colors.background.card, borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB", marginTop: -4, marginBottom: 8 },
  suggestionItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  suggestionLatin: { fontSize: 15, fontWeight: "500", color: colors.text.heading, fontStyle: "italic" },
  suggestionEnglish: { fontSize: 13, color: colors.text.muted, marginTop: 2 },
});
