import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import type { TemplateFieldOption } from "@/types/survey-template";

interface SelectModalProps {
  visible: boolean;
  title: string;
  options: TemplateFieldOption[];
  selectedValue: string | null;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export default function SelectModal({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
}: SelectModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={24} color={colors.text.heading} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={options}
          keyExtractor={(item) => item.value}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isSelected = item.value === selectedValue;
            return (
              <TouchableOpacity
                style={[styles.option, isSelected && styles.optionSelected]}
                activeOpacity={0.7}
                onPress={() => {
                  onSelect(item.value);
                  onClose();
                }}
              >
                <Text
                  style={[
                    styles.optionText,
                    isSelected && styles.optionTextSelected,
                  ]}
                >
                  {item.label}
                </Text>
                {isSelected && (
                  <Ionicons
                    name="checkmark"
                    size={22}
                    color={colors.primary.DEFAULT}
                  />
                )}
              </TouchableOpacity>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.page,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: colors.background.card,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text.heading,
  },
  list: {
    padding: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.background.card,
    borderRadius: 12,
    padding: 18,
    marginBottom: 8,
    minHeight: 56,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  optionSelected: {
    borderColor: colors.primary.DEFAULT,
    backgroundColor: colors.primary.DEFAULT + "08",
  },
  optionText: {
    fontSize: 17,
    color: colors.text.heading,
  },
  optionTextSelected: {
    fontWeight: "600",
    color: colors.primary.DEFAULT,
  },
});
