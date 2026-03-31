import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { colors } from "@/constants/colors";
import type { Profile } from "@/types/project";

const roleLabels: Record<string, { label: string; color: string }> = {
  admin: { label: "Admin", color: colors.role.admin },
  project_manager: { label: "Project Manager", color: colors.role.pm },
  assessor: { label: "Ecologist", color: colors.role.ecologist },
  ecologist: { label: "Ecologist", color: colors.role.ecologist },
  junior: { label: "Junior Ecologist", color: colors.role.junior },
  third_party: { label: "3rd Party", color: colors.role.thirdParty },
  client: { label: "Client", color: colors.role.client },
};

export default function SettingsScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await supabase
          .from("profiles")
          .select("id, email, full_name, role, organization_id")
          .eq("id", user.id)
          .single();

        if (data) setProfile(data as Profile);
      } catch {
        /* offline */
      }
      setLoading(false);
    };

    fetchProfile();
  }, []);

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </View>
    );
  }

  const role = profile?.role ? roleLabels[profile.role] : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile?.full_name
              ?.split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2) ?? "?"}
          </Text>
        </View>

        <Text style={styles.name}>{profile?.full_name ?? "Unknown"}</Text>
        <Text style={styles.email}>{profile?.email ?? ""}</Text>

        {role && (
          <View
            style={[styles.roleBadge, { backgroundColor: role.color + "18" }]}
          >
            <Text style={[styles.roleText, { color: role.color }]}>
              {role.label}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <View style={styles.menuLeft}>
            <Ionicons name="log-out-outline" size={22} color="#EF4444" />
            <Text style={[styles.menuText, { color: "#EF4444" }]}>
              Sign Out
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.text.muted}
          />
        </TouchableOpacity>
      </View>

      <Text style={styles.version}>Dulra Mobile v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.page,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background.page,
  },
  profileCard: {
    backgroundColor: colors.background.card,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary.DEFAULT + "18",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.primary.DEFAULT,
  },
  name: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.text.heading,
    marginBottom: 4,
  },
  email: {
    fontSize: 15,
    color: colors.text.body,
    marginBottom: 12,
  },
  roleBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleText: {
    fontSize: 14,
    fontWeight: "600",
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.background.card,
    borderRadius: 14,
    padding: 16,
    minHeight: 52,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  menuLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  menuText: {
    fontSize: 16,
    fontWeight: "500",
  },
  version: {
    textAlign: "center",
    fontSize: 13,
    color: colors.text.muted,
  },
});
