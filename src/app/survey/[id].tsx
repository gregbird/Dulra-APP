import { View, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";

export default function SurveyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Survey: {id}</Text>
    </View>
  );
}
