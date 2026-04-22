import { StyleSheet } from "react-native";
import { colors } from "@/constants/colors";

export const devToolStyles = StyleSheet.create({
  fab: { position: "absolute", zIndex: 9999 },
  fabButton: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: "#EF4444",
    justifyContent: "center", alignItems: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
  },
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center", alignItems: "center",
  },
  menu: {
    backgroundColor: colors.white, borderRadius: 16, padding: 20,
    width: 300, maxHeight: "80%",
  },
  menuScroll: { flexShrink: 1 },
  menuScrollContent: { paddingBottom: 4 },
  menuTitle: {
    fontSize: 18, fontWeight: "700", color: colors.text.heading,
    marginBottom: 16, textAlign: "center",
  },
  sectionLabel: {
    fontSize: 12, fontWeight: "700", color: colors.text.muted,
    textTransform: "uppercase", letterSpacing: 0.5,
    marginTop: 8, marginBottom: 8, paddingHorizontal: 4,
  },
  menuItem: {
    minHeight: 44, justifyContent: "center", alignItems: "center",
    paddingHorizontal: 12, backgroundColor: colors.background.page,
    borderRadius: 10, marginBottom: 8,
  },
  menuItemSecondary: { backgroundColor: "#F3F4F6" },
  menuItemWarn: { backgroundColor: "#FEF3C7" },
  menuItemDisabled: { opacity: 0.4 },
  menuItemClose: { backgroundColor: "transparent", marginTop: 8, marginBottom: 0 },
  menuItemText: { fontSize: 15, fontWeight: "600", color: "#EF4444", textAlign: "center" },
  menuItemTextSecondary: { color: colors.text.heading },
  menuItemTextWarn: { color: "#92400E" },
  menuItemTextDisabled: { color: colors.text.muted },
});
