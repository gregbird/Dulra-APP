import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import type { HabitatPolygon } from "@/types/habitat";
import { conditionColors } from "@/types/habitat";

interface HabitatListProps {
  habitats: HabitatPolygon[];
  refreshing: boolean;
  onRefresh: () => void;
}

export default function HabitatList({ habitats, refreshing, onRefresh }: HabitatListProps) {
  const router = useRouter();
  const renderHabitat = ({ item }: { item: HabitatPolygon }) => {
    const cond = item.condition ? conditionColors[item.condition] : null;

    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => router.push(`/habitat/${item.id}`)}>
        <View style={styles.cardHeader}>
          {item.fossitt_code && (
            <View style={styles.codeBadge}>
              <Text style={styles.codeText}>{item.fossitt_code}</Text>
            </View>
          )}
          <Text style={styles.name} numberOfLines={2}>
            {item.fossitt_name ?? "Unknown Habitat"}
          </Text>
        </View>

        <View style={styles.details}>
          {item.area_hectares != null && (
            <View style={styles.detailItem}>
              <Ionicons name="resize-outline" size={15} color={colors.text.body} />
              <Text style={styles.detailText}>{item.area_hectares} ha</Text>
            </View>
          )}
          {cond && (
            <View style={[styles.tag, { backgroundColor: cond.color + "1A" }]}>
              <Text style={[styles.tagText, { color: cond.color }]}>{cond.label}</Text>
            </View>
          )}
          {item.eu_annex_code && (
            <View style={[styles.tag, { backgroundColor: "#2563EB1A" }]}>
              <Text style={[styles.tagText, { color: "#2563EB" }]}>EU {item.eu_annex_code}</Text>
            </View>
          )}
        </View>

        {item.notes && (
          <Text style={styles.notes} numberOfLines={2}>{item.notes}</Text>
        )}
        <Ionicons name="chevron-forward" size={20} color={colors.text.muted} style={styles.chevron} />
      </TouchableOpacity>
    );
  };

  return (
    <FlatList
      data={habitats}
      keyExtractor={(item) => item.id}
      renderItem={renderHabitat}
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
          <Ionicons name="leaf-outline" size={48} color={colors.text.muted} />
          <Text style={styles.emptyText}>No habitat data</Text>
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
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  codeBadge: {
    backgroundColor: colors.primary.DEFAULT + "15",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  codeText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary.dark,
  },
  name: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text.heading,
    flex: 1,
  },
  details: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  detailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  detailText: {
    fontSize: 15,
    color: colors.text.body,
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
  notes: {
    fontSize: 15,
    color: colors.text.body,
    marginTop: 10,
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
