import { Stack } from "expo-router";
import { colors } from "@/constants/colors";

export default function ProjectLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        animation: "slide_from_right",
        gestureEnabled: true,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.white },
        headerTintColor: colors.primary.DEFAULT,
        headerTitleStyle: { color: colors.text.heading, fontWeight: "600" },
        headerBackTitle: "Back",
      }}
    />
  );
}
