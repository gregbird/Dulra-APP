import { View, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Project: {id}</Text>
    </View>
  );
}
