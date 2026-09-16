import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { ReactNode, useEffect } from "react";
import { Pressable, StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { absoluteFill, colors, fontFamily, radius, shadow } from "./theme";

export function Background({ children, style }: { children?: ReactNode; style?: ViewStyle }) {
  const drift = useSharedValue(0);
  useEffect(() => {
    drift.value = withRepeat(withTiming(1, { duration: 9000 }), -1, true);
  }, [drift]);
  const blobA = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value * 24 }, { translateY: drift.value * -30 }],
  }));
  const blobB = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value * -20 }, { translateY: drift.value * 26 }],
  }));
  return (
    <View style={[styles.fill, style]}>
      <LinearGradient colors={[colors.bg0, colors.bg1, colors.bg2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill} />
      <Animated.View style={[styles.blob, { backgroundColor: colors.blobA, top: -120, left: -120 }, blobA]} />
      <Animated.View style={[styles.blob, { backgroundColor: colors.blobB, top: "35%", right: -140 }, blobB]} />
      <BlurView tint="light" intensity={90} style={styles.fill} />
      {children}
    </View>
  );
}

export function GlassPanel({
  children,
  style,
  strong,
  intensity = 50,
}: {
  children: ReactNode;
  style?: ViewStyle;
  strong?: boolean;
  intensity?: number;
}) {
  return (
    <View style={[styles.panelOuter, style]}>
      <View style={styles.panelInner}>
        <BlurView tint="light" intensity={intensity} style={styles.fill} />
        <View style={[styles.fill, { backgroundColor: strong ? colors.glassStrong : colors.glass }]} />
        <View style={styles.panelContent}>{children}</View>
      </View>
    </View>
  );
}

type Variant = "primary" | "ghost" | "danger";

export function GlassButton({
  label,
  onPress,
  variant = "ghost",
  icon,
  disabled,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: ReactNode;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const fill = { primary: colors.accent, ghost: colors.glassStrong, danger: colors.danger }[variant];
  const color = variant === "ghost" ? colors.text : colors.white;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: fill, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        style,
      ]}
    >
      {icon}
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  name,
  onPress,
  label,
  style,
  testID,
}: {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  style?: ViewStyle;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.iconButton, { transform: [{ scale: pressed ? 0.94 : 1 }] }, style]}
    >
      <Ionicons name={name} size={22} color={colors.text} />
    </Pressable>
  );
}

export function FixedControls({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.fixedRow, { top: insets.top + 12 }]}>{children}</View>;
}

export function Toast({ text, onHide }: { text: string | null; onHide: () => void }) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!text) return;
    const id = setTimeout(onHide, 4000);
    return () => clearTimeout(id);
  }, [text, onHide]);
  if (!text) return null;
  return (
    <View style={[styles.toast, { top: insets.top + 16 }]} accessibilityRole="alert">
      <Text style={styles.toastText}>{text}</Text>
    </View>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Body({ children, style, muted }: { children: ReactNode; style?: TextStyle; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: colors.muted }, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  fill: { ...absoluteFill },
  blob: { position: "absolute", width: 420, height: 420, borderRadius: 210, opacity: 0.75 },
  panelOuter: { borderRadius: radius.lg, ...shadow },
  panelInner: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  panelContent: { padding: 18 },
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    ...shadow,
  },
  buttonText: { fontSize: 17, fontWeight: "600", fontFamily },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: "center",
    justifyContent: "center",
    ...shadow,
  },
  fixedRow: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 30,
  },
  toast: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: colors.glassStrong,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 50,
    ...shadow,
  },
  toastText: { color: colors.text, fontSize: 14, fontWeight: "500", fontFamily },
  title: { fontSize: 28, fontWeight: "600", color: colors.text, fontFamily, letterSpacing: -0.3 },
  body: { fontSize: 16, color: colors.text, fontFamily, lineHeight: 23 },
});
