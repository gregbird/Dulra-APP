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
    paddingHorizontal: 16,
  },
  menu: {
    backgroundColor: colors.white, borderRadius: 16, padding: 16,
    width: "100%", maxWidth: 340, maxHeight: "85%",
  },
  menuScroll: { flexShrink: 1 },
  menuScrollContent: { paddingBottom: 4 },
  menuTitle: {
    fontSize: 17, fontWeight: "700", color: colors.text.heading,
    marginBottom: 10, textAlign: "center",
  },
  sectionLabel: {
    fontSize: 11, fontWeight: "700", color: colors.text.muted,
    textTransform: "uppercase", letterSpacing: 0.6,
    marginTop: 14, marginBottom: 6, paddingHorizontal: 2,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E5E7EB",
    paddingTop: 10,
  },
  sectionLabelFirst: {
    marginTop: 2, borderTopWidth: 0, paddingTop: 0,
  },
  menuItem: {
    minHeight: 40, justifyContent: "center", alignItems: "center",
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.background.page,
    borderRadius: 10, marginBottom: 6,
  },
  menuItemSecondary: { backgroundColor: "#F3F4F6" },
  menuItemWarn: { backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#FCD34D" },
  menuItemDisabled: { opacity: 0.35 },
  menuItemClose: {
    backgroundColor: "#F3F4F6", marginTop: 12, marginBottom: 0,
    borderWidth: 0,
  },
  menuItemText: { fontSize: 14, fontWeight: "600", color: "#EF4444", textAlign: "center" },
  menuItemTextSecondary: { color: colors.text.heading },
  menuItemTextWarn: { color: "#92400E" },
  menuItemTextDisabled: { color: colors.text.muted },
  menuItemTextClose: { color: colors.text.body },
});
