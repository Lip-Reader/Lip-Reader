import { Platform } from "react-native";

export const colors = {
  bg0: "#EEF2FF",
  bg1: "#F5F0FF",
  bg2: "#E0F2FE",
  blobA: "#C7B8FF",
  blobB: "#A7D8FF",
  accent: "#7C6CF6",
  accent2: "#60A5FA",
  text: "#1E1B4B",
  muted: "#6B6A8A",
  glass: "rgba(255,255,255,0.55)",
  glassStrong: "rgba(255,255,255,0.80)",
  glassBorder: "rgba(255,255,255,0.75)",
  danger: "#F87171",
  success: "#34D399",
  white: "#FFFFFF",
};

export const radius = { sm: 12, md: 18, lg: 28, pill: 999 };

export const shadow = {
  shadowColor: "#635BFF",
  shadowOpacity: 0.14,
  shadowRadius: 28,
  shadowOffset: { width: 0, height: 8 },
  elevation: 6,
};

export const fontFamily = Platform.select({ web: "Inter, system-ui, -apple-system, sans-serif", default: undefined });

export const bp = { sm: 640, lg: 1024 };

export const absoluteFill = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };
