import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import type { TargetNote } from "@/types/habitat";
import { categoryLabels } from "@/types/habitat";

interface TargetNotesListProps {
  notes: TargetNote[];
  refreshing: boolean;
  onRefresh: () => void;
}

export default function TargetNotesList({ notes, refreshing, onRefresh }: TargetNotesListProps) {
  const router = useRouter();
  const renderNote = ({ item }: { item: TargetNote }) => {
    const cat = item.category ? categoryLabels[item.category] : null;
    const isHigh = item.priority === "high";

    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => router.push(`/target-note/${item.id}`)}>
        <View style={styles.cardHeader}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          {item.is_verified && (
            <Ionicons name="checkmark-circle" size={20} color={colors.primary.DEFAULT} />
          )}
        </View>

        <View style={styles.tags}>
          {cat && (
            <View style={[styles.tag, { backgroundColor: cat.color + "1A" }]}>
              <Text style={[styles.tagText, { color: cat.color }]}>{cat.label}</Text>
            </View>
          )}
          <View style={[styles.tag, { backgroundColor: isHigh ? "#DC26261A" : "#6B72801A" }]}>
            <Text style={[styles.tagText, { color: isHigh ? "#DC2626" : "#6B7280" }]}>
              {isHigh ? "High" : "Normal"}
            </Text>
          </View>
        </View>

        {item.description && (
          <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
        )}
        <Ionicons name="chevron-forward" size={20} color={colors.text.muted} style={styles.chevron} />
      </TouchableOpacity>
    );
  };

  return (
    <FlatList
      data={notes}
      keyExtractor={(item) => item.id}
      renderItem={renderNote}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary.DEFAULT}
        />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="flag-outline" size={48} color={colors.text.muted} />
          <Text style={styles.emptyText}>No target notes</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: colors.background.card,
    borderRadius: 14,
    padding: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text.heading,
    flex: 1,
  },
  tags: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 13,
    fontWeight: "600",
  },
  description: {
    fontSize: 15,
    color: colors.text.body,
    marginTop: 8,
    lineHeight: 21,
  },
  chevron: {
    position: "absolute",
    right: 18,
    top: 22,
  },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 17,
    color: colors.text.body,
  },
});
