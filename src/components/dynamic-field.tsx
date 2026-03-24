import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/constants/colors";
import SelectModal from "@/components/select-modal";
import type { TemplateField } from "@/types/survey-template";

interface DynamicFieldProps {
  field: TemplateField;
  value: string | number | null;
  onChange: (value: string | number | null) => void;
  onNext?: () => void;
  isLast?: boolean;
  registerRef?: (el: TextInput | null) => void;
}

export default function DynamicField({
  field,
  value,
  onChange,
  onNext,
  isLast,
  registerRef,
}: DynamicFieldProps) {
  const [selectVisible, setSelectVisible] = useState(false);
  const returnKey = isLast ? "done" : "next";

  const renderLabel = () => (
    <View style={styles.labelRow}>
      <Text style={styles.label}>
        {field.label}
        {field.required && <Text style={styles.required}> *</Text>}
      </Text>
      {field.unit && <Text style={styles.unit}>{field.unit}</Text>}
    </View>
  );

  const renderHelpText = () =>
    field.helpText ? (
      <Text style={styles.helpText}>{field.helpText}</Text>
    ) : null;

  if (field.type === "text") {
    return (
      <View style={styles.container}>
        {renderLabel()}
        {renderHelpText()}
        <TextInput
          ref={registerRef}
          style={styles.input}
          value={value?.toString() ?? ""}
          onChangeText={(text) => onChange(text || null)}
          placeholder={field.placeholder}
          placeholderTextColor={colors.text.muted}
          autoCapitalize="sentences"
          returnKeyType={returnKey}
          onSubmitEditing={onNext}
          blurOnSubmit={!onNext}
        />
      </View>
    );
  }

  if (field.type === "number") {
    return (
      <View style={styles.container}>
        {renderLabel()}
        {renderHelpText()}
        <TextInput
          ref={registerRef}
          style={styles.input}
          value={value != null ? String(value) : ""}
          onChangeText={(text) => {
            if (text === "") {
              onChange(null);
              return;
            }
            const num = parseFloat(text);
            if (!isNaN(num)) onChange(num);
          }}
          placeholder={field.placeholder}
          placeholderTextColor={colors.text.muted}
          keyboardType="numeric"
          returnKeyType={returnKey}
          onSubmitEditing={onNext}
          blurOnSubmit={!onNext}
        />
      </View>
    );
  }

  if (field.type === "select" && field.options) {
    const selectedOption = field.options.find((o) => o.value === value);
    return (
      <View style={styles.container}>
        {renderLabel()}
        {renderHelpText()}
        <TouchableOpacity
          style={styles.selectButton}
          activeOpacity={0.7}
          onPress={() => setSelectVisible(true)}
        >
          <Text
            style={[
              styles.selectText,
              !selectedOption && styles.selectPlaceholder,
            ]}
          >
            {selectedOption?.label ?? field.placeholder ?? "Select..."}
          </Text>
          <Ionicons
            name="chevron-down"
            size={20}
            color={colors.text.muted}
          />
        </TouchableOpacity>
        <SelectModal
          visible={selectVisible}
          title={field.label}
          options={field.options}
          selectedValue={value?.toString() ?? null}
          onSelect={(val) => onChange(val)}
          onClose={() => setSelectVisible(false)}
        />
      </View>
    );
  }

  if (field.type === "textarea") {
    return (
      <View style={styles.container}>
        {renderLabel()}
        {renderHelpText()}
        <TextInput
          style={[styles.input, styles.textarea]}
          value={value?.toString() ?? ""}
          onChangeText={(text) => onChange(text || null)}
          placeholder={field.placeholder}
          placeholderTextColor={colors.text.muted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          returnKeyType="default"
          blurOnSubmit={false}
        />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text.heading,
  },
  required: {
    color: "#EF4444",
  },
  unit: {
    fontSize: 14,
    color: colors.text.muted,
    fontWeight: "500",
  },
  helpText: {
    fontSize: 14,
    color: colors.text.muted,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: colors.text.heading,
    minHeight: 52,
  },
  textarea: {
    minHeight: 110,
    paddingTop: 14,
  },
  selectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.background.card,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  selectText: {
    fontSize: 17,
    color: colors.text.heading,
  },
  selectPlaceholder: {
    color: colors.text.muted,
  },
});
