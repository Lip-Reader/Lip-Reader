import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, radius } from "../../ui/theme";

export default function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; testID?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.item, active && styles.itemActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            testID={o.testID}
          >
            <Text style={[styles.text, active && styles.textActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.5)", borderRadius: radius.pill, padding: 4 },
  item: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: "center" },
  itemActive: { backgroundColor: colors.text },
  text: { color: colors.muted, fontWeight: "600", fontSize: 14, fontFamily },
  textActive: { color: colors.white },
});
