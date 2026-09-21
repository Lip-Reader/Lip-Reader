import type { Language } from "./api";

const STRINGS = {
  // Talk screen
  settingsLabel: { en: "Settings", he: "הגדרות" },
  flipCameraLabel: { en: "Flip camera", he: "החלף מצלמה" },
  adminLabel: { en: "Admin", he: "ניהול" },
  resetLabel: { en: "Reset", he: "איפוס" },
  talkLabel: { en: "Talk", he: "דבר" },
  uploadLabel: { en: "Upload a video", he: "העלאת סרטון" },
  notAVideoToast: { en: "That file is not a video.", he: "הקובץ הזה אינו סרטון." },
  cameraDeniedLabel: {
    en: "Camera access is blocked. You can still upload a video.",
    he: "הגישה למצלמה חסומה. עדיין אפשר להעלות סרטון.",
  },
  cameraFailedLabel: {
    en: "The camera didn't start. You can still upload a video.",
    he: "המצלמה לא הופעלה. עדיין אפשר להעלות סרטון.",
  },
  stopLabel: { en: "Stop", he: "עצור" },
  speakLabel: { en: "Speak", he: "השמע" },
  preparingLabel: { en: "Preparing…", he: "מכין…" },
  listeningLabel: { en: "Listening", he: "מקשיב" },
  warmingLabel: { en: "Waking the lip-reading model up…", he: "מעיר את מנוע קריאת השפתיים…" },
  unavailableLabel: { en: "The lip-reading service is not responding.", he: "שירות קריאת השפתיים אינו מגיב." },
  pausedLabel: { en: "Lip reading is paused by the admin.", he: "קריאת השפתיים מושהית על ידי המנהל." },
  cameraNotReady: { en: "Camera is not ready yet.", he: "המצלמה עדיין לא מוכנה." },
  vsrUnavailableToast: { en: "The lip-reading service is unavailable right now.", he: "שירות קריאת השפתיים אינו זמין כרגע." },
  genericErrorToast: { en: "Something went wrong. Tap Talk to try again.", he: "משהו השתבש. הקישו על דבר כדי לנסות שוב." },
  retryLabel: { en: "Retry", he: "נסה שוב" },
  cmUnit: { en: "cm", he: "ס״מ" },
  tooCloseLabel: { en: "too close", he: "קרוב מדי" },
  tooFarLabel: { en: "too far", he: "רחוק מדי" },
  cutOffLabel: { en: "face cut off", he: "הפנים חתוכות" },
  lightLabel: { en: "light", he: "אור" },
  contrastLabel: { en: "contrast", he: "ניגודיות" },
  sharpLabel: { en: "sharpness", he: "חדות" },
  turnLabel: { en: "head turn", he: "סיבוב ראש" },
  moveLabel: { en: "movement", he: "תנועה" },
  whichOne: { en: "Which one?", he: "איזה מהם?" },
  noneOfThese: { en: "None of these", he: "אף אחד מאלה" },

  // Settings screen
  settingsTitle: { en: "Settings", he: "הגדרות" },
  voiceSectionTitle: { en: "🎙️ Voice", he: "🎙️ קול" },
  voiceSectionHint: { en: "This is how Chaplin will speak for you.", he: "כך צ'פלין ידבר בשבילך." },
  languageSectionTitle: { en: "🌍 Language", he: "🌍 שפה" },
  languageSectionHint: {
    en: "What you speak. Hebrew works from a list of phrases you teach Chaplin.",
    he: "השפה שבה אתם מדברים. עברית פועלת מתוך רשימת משפטים שתלמדו את צ'פלין.",
  },
  phrasesSectionTitle: { en: "🗣️ My phrases", he: "🗣️ המשפטים שלי" },
  phrasesSectionHint: {
    en: "Pick a phrase, mouth it three times, and Chaplin learns how you say it.",
    he: "בחרו משפט, בטאו אותו בשפתיים שלוש פעמים, וצ'פלין ילמד איך אתם אומרים אותו.",
  },
  accountSectionTitle: { en: "👤 Account", he: "👤 חשבון" },
  signInCloudHint: { en: "Sign in to keep your voice on every device ☁️", he: "התחברו כדי לשמור את הקול שלכם בכל מכשיר ☁️" },
  localOnlyHint: { en: "Settings are saved on this device 📱", he: "ההגדרות נשמרות במכשיר הזה 📱" },
  signInLabel: { en: "Sign in", he: "התחברות" },
  signOutLabel: { en: "Sign out", he: "התנתקות" },
  feedbackSectionTitle: { en: "💬 Feedback", he: "💬 משוב" },
  feedbackPlaceholder: { en: "Tell us what would help 🙌", he: "ספרו לנו מה יעזור 🙌" },
  feedbackSendLabel: { en: "Send", he: "שליחה" },
  feedbackSentMsg: { en: "Thanks, your message was sent 💜", he: "תודה, ההודעה נשלחה 💜" },
  feedbackErrorMsg: { en: "Couldn't send right now. Try again later.", he: "לא ניתן היה לשלוח כעת. נסו שוב מאוחר יותר." },

  // Voice picker
  voicesTab: { en: "🎭 Voices", he: "🎭 קולות" },
  recordMyVoiceTab: { en: "🎤 Record my voice", he: "🎤 הקלטת הקול שלי" },
  searchVoicesPlaceholder: { en: "Search voices", he: "חיפוש קולות" },
  noVoicesMatch: { en: "No voices match.", he: "לא נמצאו קולות תואמים." },
  couldntLoadVoices: { en: "Couldn't load voices.", he: "לא ניתן היה לטעון קולות." },
  couldntSaveVoice: { en: "Couldn't save that voice. Try again.", he: "לא ניתן היה לשמור את הקול. נסו שוב." },
  recordVoiceHint: {
    en: "Read a few sentences out loud for about 20 seconds, then stop.",
    he: "קראו כמה משפטים בקול רם במשך כ-20 שניות, ואז עצרו.",
  },
  startRecordingLabel: { en: "Start recording", he: "התחילו הקלטה" },
  couldntCreateVoice: { en: "Couldn't create the voice. Try again.", he: "לא ניתן היה ליצור את הקול. נסו שוב." },

  // Phrase bank enrollment header
  backLabel: { en: "Back", he: "חזרה" },
} as const;

export type StringKey = keyof typeof STRINGS;

/** Look up one UI string for the given language. Pure function - no React dependency,
 * so any component that already has `language` from useSettings() can call it directly. */
export function t(language: Language, key: StringKey): string {
  return STRINGS[key][language];
}

export function showMoreLabel(language: Language, n: number): string {
  return language === "he" ? `עוד (${n}) ▾` : `Show more (${n}) ▾`;
}
