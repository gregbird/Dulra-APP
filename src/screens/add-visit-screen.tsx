import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import SurveyorPicker from "@/components/surveyor-picker";
import { supabase } from "@/lib/supabase";
import { surveyTypeLabels } from "@/types/survey";
import { saveAddVisit } from "@/lib/survey-save";
import {
  loadAllVisitSurveysForProject,
  getNextVisitNumber,
  type VisitSurveyLike,
} from "@/lib/visit-groups";

interface ParentInfo {
  surveyType: string;
  siteId: string | null;
  visitGroupId: string | null;
  visitNumber: number | null;
}

/**
 * Resolve the parent survey's type / site / visit grouping from the
 * combined cache+pending list — works offline and online without an
 * extra network round-trip. Returns null when the parent isn't anywhere
 * yet (shouldn't happen in normal flow, surfaces as an error toast).
 */
function findParent(
  surveys: ReadonlyArray<VisitSurveyLike>,
  parentSurveyId: string,
): ParentInfo | null {
  const match = surveys.find((s) => s.id === parentSurveyId);
  if (!match) return null;
  return {
    surveyType: match.survey_type,
    siteId: match.site_id ?? null,
    visitGroupId: match.visit_group_id,
    visitNumber: match.visit_number,
  };
}

export default function AddVisitScreen() {
  const params = useLocalSearchParams<{ fromSurveyId: string; projectId: string }>();
  const router = useRouter();
  const [parent, setParent] = useState<ParentInfo | null>(null);
  const [previewVisitNumber, setPreviewVisitNumber] = useState<number>(2);
  const [surveyorId, setSurveyorId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Current user — defaults the surveyor picker to "Me" without a network round-trip.
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          if (!cancelled) setCurrentUserId(session.user.id);
          try {
            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", session.user.id)
              .single();
            if (!cancelled && profile?.full_name) setCurrentUserName(profile.full_name);
          } catch { /* picker shows "Me" on offline */ }
        }
      } catch { /* not critical */ }

      if (!params.projectId || !params.fromSurveyId) {
        if (!cancelled) setLoading(false);
        return;
      }

      const all = await loadAllVisitSurveysForProject(params.projectId);
      const p = findParent(all, params.fromSurveyId);
      if (!cancelled) {
        setParent(p);
        if (p) {
          // Visit number preview: if parent already in a group, max+1 from
          // existing members; if standalone, the new visit will be #2 (parent
          // becomes #1 on save via the standalone→group conversion).
          const n = p.visitGroupId
            ? getNextVisitNumber(all, p.visitGroupId)
            : 2;
          setPreviewVisitNumber(n);
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params.projectId, params.fromSurveyId]);

  const handleSave = async () => {
    if (!parent || !params.projectId || !params.fromSurveyId) return;
    setSaving(true);
    const today = new Date().toISOString().split("T")[0];
    const result = await saveAddVisit({
      projectId: params.projectId,
      parentSurveyId: params.fromSurveyId,
      surveyType: parent.surveyType,
      surveyDate: today,
      notes: notes.trim() ? notes.trim() : null,
      surveyorId,
      siteId: parent.siteId,
    });
    setSaving(false);

    if (!result.success || !result.newSurveyId) {
      Alert.alert("Error", result.error ?? "Could not add visit. Try again.");
      return;
    }

    const message = result.offline
      ? `Visit ${result.visitNumber} saved locally. It will sync when online.`
      : `Visit ${result.visitNumber} added.`;

    Alert.alert(result.offline ? "Saved Offline" : "Visit added", message, [
      {
        text: "OK",
        onPress: () => {
          // Navigate the user straight to the new visit's form so they
          // can fill in the template. replace() so back goes to the
          // surveys list, not back to this Add Visit screen. Releve type
          // routes go to /releve-survey/[id] directly to skip the
          // survey-form-screen → releve redirect flash.
          const newId = result.newSurveyId;
          const path = parent.surveyType === "releve_survey"
            ? `/releve-survey/${newId}?projectId=${params.projectId}` +
              (parent.siteId ? `&siteId=${parent.siteId}` : "")
            : `/survey/${newId}`;
          router.replace(path);
        },
      },
    ]);
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: "Add Visit" }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
        </View>
      </>
    );
  }

  if (!parent) {
    return (
      <>
        <Stack.Screen options={{ title: "Add Visit" }} />
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.text.muted} />
          <Text style={styles.emptyTitle}>Parent survey not found</Text>
          <Text style={styles.emptyText}>
            Couldn't locate the survey to add a visit to. Try refreshing the list and tapping into it again.
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const today = new Date().toISOString().split("T")[0];
  const surveyTypeLabel = surveyTypeLabels[parent.surveyType] ?? parent.surveyType;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Add Visit",
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={28} color={colors.primary.DEFAULT} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
          <View style={styles.headerCard}>
            <Text style={styles.eyebrow}>Visit {previewVisitNumber}</Text>
            <Text style={styles.headerTitle}>{surveyTypeLabel}</Text>
            <Text style={styles.headerHint}>
              {parent.visitGroupId
                ? "Adding a new visit to this survey group."
                : "First visit added — this will create a group with the existing survey as Visit 1."}
            </Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Date</Text>
            <View style={styles.dateBox}>
              <Ionicons name="calendar-outline" size={18} color={colors.text.muted} />
              <Text style={styles.dateText}>{formatDateLong(today)}</Text>
            </View>
            <Text style={styles.helpText}>
              Date is set to today. Edit the visit later if it took place on a different day.
            </Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Surveyor</Text>
            <SurveyorPicker
              value={surveyorId}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              onChange={(userId) => setSurveyorId(userId)}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={styles.textArea}
              value={notes}
              onChangeText={setNotes}
              placeholder="Any quick notes about this visit"
              placeholderTextColor={colors.text.muted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              // Manual scroll-to-bottom on focus. The keyboard takes ~250ms
              // to fully animate up on iOS; scrolling immediately would
              // race the keyboard and end up under it. The setTimeout lets
              // the keyboard land before we measure / scroll.
              onFocus={() => {
                setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
              }}
            />
          </View>

          {/* Save button lives INSIDE the ScrollView so a fixed footer
              can't cover the focused Notes textarea when the keyboard
              opens. This form is short (3 fields) — the button is
              reachable without scrolling on every supported device. */}
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            disabled={saving}
            onPress={handleSave}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.saveButtonText}>Add Visit {previewVisitNumber}</Text>
            )}
          </TouchableOpacity>
      </ScrollView>
    </>
  );
}

function formatDateLong(d: string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.page },
  center: {
    flex: 1, justifyContent: "center", alignItems: "center",
    padding: 32, gap: 12, backgroundColor: colors.background.page,
  },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: colors.text.heading },
  emptyText: { fontSize: 16, color: colors.text.body, textAlign: "center", lineHeight: 22 },
  backButton: {
    marginTop: 8, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 10, backgroundColor: colors.primary.DEFAULT + "15",
  },
  backButtonText: { fontSize: 16, fontWeight: "600", color: colors.primary.DEFAULT },
  // Generous bottom padding gives automaticallyAdjustKeyboardInsets room
  // to scroll the focused textarea well clear of the keyboard top edge.
  // 400 leaves comfortable breathing room above the keyboard on iPhone 11
  // — smaller values (48, 220) left the textarea cramped right against
  // the keyboard with the user unable to see what they were typing.
  scrollContent: { padding: 16, paddingBottom: 400 },
  headerCard: {
    backgroundColor: colors.background.card,
    borderRadius: 14, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  eyebrow: {
    fontSize: 13, fontWeight: "700", letterSpacing: 0.4,
    color: colors.primary.DEFAULT, textTransform: "uppercase",
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: colors.text.heading, marginTop: 4 },
  headerHint: { fontSize: 14, color: colors.text.muted, marginTop: 6, lineHeight: 20 },
  fieldGroup: { marginBottom: 18 },
  label: { fontSize: 15, fontWeight: "600", color: colors.text.heading, marginBottom: 8 },
  dateBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 14,
    backgroundColor: colors.background.card,
    borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB",
  },
  dateText: { fontSize: 16, color: colors.text.body },
  helpText: { fontSize: 13, color: colors.text.muted, marginTop: 6 },
  textArea: {
    backgroundColor: colors.background.card,
    borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB",
    padding: 14, fontSize: 16, color: colors.text.body,
    minHeight: 100,
  },
  saveButton: {
    height: 52, borderRadius: 12,
    justifyContent: "center", alignItems: "center",
    backgroundColor: colors.primary.DEFAULT,
    marginTop: 8,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { fontSize: 16, fontWeight: "700", color: colors.white },
});
