import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/colors";
import {
  siblingsInGroup,
  canAddVisit,
  visitLabel,
  type VisitSurveyLike,
} from "@/lib/visit-groups";

interface Props {
  /** ID of the survey currently being viewed (parent of any new Add Visit). */
  surveyId: string;
  projectId: string;
  /** Visit group the current survey belongs to, or null if it's standalone. */
  groupId: string | null;
  /** This survey's own visit number — shown in a badge to anchor the user. */
  currentVisitNumber: number | null;
  /** All cached + pending surveys for the project; computed by the parent. */
  groupSurveys: VisitSurveyLike[];
  /** Inherited site for multi-site projects. NULL when single-site. */
  siteId: string | null;
}

/**
 * Visits panel rendered at the bottom of every survey detail screen
 * (survey-form-screen and releve-survey-form-screen). Lists every other
 * visit in the group as tappable rows and exposes the Add Visit button
 * unless gating fires:
 *   - Standalone surveys: button visible (first tap converts to a group).
 *   - Grouped + at least one in-progress: button visible.
 *   - Grouped + all completed: button hidden, replaced with a hint.
 *
 * Add Visit navigation: routes to /survey/add-visit with the parent's
 * id and project; siteId is preserved as a query param so multi-site
 * projects keep the new visit on the same site without re-asking the
 * user. The Add Visit screen itself looks up the rest from cache.
 */
export default function VisitsCard({
  surveyId,
  projectId,
  groupId,
  currentVisitNumber,
  groupSurveys,
  siteId,
}: Props) {
  const router = useRouter();
  const siblings = groupId ? siblingsInGroup(groupSurveys, groupId, surveyId) : [];
  const showAddVisit = canAddVisit(groupSurveys, groupId);

  return (
    <View style={styles.section}>
      <View style={styles.visitsHeader}>
        <Text style={styles.sectionTitle}>Visits</Text>
        {currentVisitNumber != null && (
          <View style={styles.currentVisitBadge}>
            <Text style={styles.currentVisitText}>Current: {visitLabel(currentVisitNumber)}</Text>
          </View>
        )}
      </View>

      {siblings.length > 0 && (
        <View style={styles.visitsList}>
          {siblings.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.visitRow}
              activeOpacity={0.7}
              // Both survey types share the same /survey/[id] route — the
              // releve detail screen redirects internally, so this single
              // path works for navigating between any visit pair.
              onPress={() => router.push(`/survey/${s.id}`)}
            >
              <View style={styles.visitRowLeft}>
                <Ionicons
                  name={s.status === "completed" ? "checkmark-circle" : "ellipse-outline"}
                  size={20}
                  color={s.status === "completed" ? colors.status.onTrack : colors.status.atRisk}
                />
                <Text style={styles.visitRowText}>{visitLabel(s.visit_number)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {siblings.length === 0 && groupId && (
        <Text style={styles.visitsEmpty}>No other visits in this group yet.</Text>
      )}

      {showAddVisit ? (
        <TouchableOpacity
          style={styles.addVisitButton}
          activeOpacity={0.8}
          onPress={() => router.push(
            `/survey/add-visit?fromSurveyId=${surveyId}&projectId=${projectId}` +
            (siteId ? `&siteId=${siteId}` : "")
          )}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.primary.DEFAULT} />
          <Text style={styles.addVisitText}>Add Visit</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.visitsEmpty}>
          All visits in this group are completed.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.background.card,
    borderRadius: 14, marginBottom: 12,
    borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden",
  },
  visitsHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8,
  },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: colors.text.heading },
  currentVisitBadge: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 10, backgroundColor: colors.primary.DEFAULT + "1A",
  },
  currentVisitText: { fontSize: 12, fontWeight: "700", color: colors.primary.DEFAULT },
  visitsList: { paddingHorizontal: 18, paddingBottom: 4 },
  visitRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F1F1F4",
  },
  visitRowLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  visitRowText: { fontSize: 15, color: colors.text.body, fontWeight: "500" },
  visitsEmpty: {
    paddingHorizontal: 18, paddingVertical: 12,
    fontSize: 13, color: colors.text.muted,
  },
  addVisitButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    margin: 14, paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.primary.DEFAULT,
    backgroundColor: colors.primary.DEFAULT + "0D",
  },
  addVisitText: { fontSize: 15, fontWeight: "600", color: colors.primary.DEFAULT },
});
