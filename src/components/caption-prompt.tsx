import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { colors } from "@/constants/colors";

interface CaptionPromptProps {
  visible: boolean;
  onSubmit: (caption: string | null) => void;
  onSkip: () => void;
}

export default function CaptionPrompt({ visible, onSubmit, onSkip }: CaptionPromptProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (visible) setValue("");
  }, [visible]);

  const handleSave = () => {
    const trimmed = value.trim();
    onSubmit(trimmed.length > 0 ? trimmed : null);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip}>
      <TouchableWithoutFeedback onPress={onSkip}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <KeyboardAvoidingView
              style={styles.sheet}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              <Text style={styles.title}>Add a caption</Text>
              <Text style={styles.subtitle}>
                Optional. Skip if you don't need to label this photo.
              </Text>
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={setValue}
                placeholder="e.g. View from north entrance"
                placeholderTextColor={colors.text.muted}
                autoCapitalize="sentences"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSave}
                blurOnSubmit
              />
              <View style={styles.buttonRow}>
                <TouchableOpacity style={styles.skipBtn} onPress={onSkip} activeOpacity={0.7}>
                  <Text style={styles.skipBtnText}>Skip</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text.heading,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.muted,
    marginBottom: 16,
  },
  input: {
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
    color: colors.text.heading,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    minHeight: 52,
    marginBottom: 18,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  skipBtn: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  skipBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text.body,
  },
  saveBtn: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.primary.DEFAULT,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
  },
});
