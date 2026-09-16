// Static mirror of the demo presets seeded by the DDL in backend/app/db.py.
// Presets are immutable in the DB (is_preset = TRUE, delete/append return 403)
// and their run never touches the store, so the modal renders them instantly
// from this constant instead of two API round-trips. KEEP IN SYNC with the
// seed list in db.py - the ids are the seeded UUIDs.
import { ChatMessage } from "./chat";

export type DemoPreset = {
  id: string;
  title: string; // the noisy sentence to correct
  context: ChatMessage[]; // the one other-person message shown as conversation
};

function preset(n: number, title: string, otherMessage: string): DemoPreset {
  return {
    id: `00000000-0000-0000-0000-00000000000${n}`,
    title,
    context: [{ id: n, role: "other", content: otherMessage }],
  };
}

// 1-2 need the conversation to resolve correctly; 3-6 are correctable from
// the sentence alone.
export const DEMO_PRESETS: DemoPreset[] = [
  preset(1, "LEGNOP JALES", "Who is your favorite NBA player?"),
  preset(2, "WHERES MY BILL", "The nurse has your evening medication ready."),
  preset(3, "IM SO EXCITED TO ME YOU TODAY", "Good morning! The new doctor will visit you soon."),
  preset(4, "PLEASE BRING ME A GLASS OF WHAT ER", "Lunch is almost ready for you."),
  preset(5, "I FILL A LOT OF PAIN IN MY BAG", "How are you feeling after the surgery?"),
  preset(6, "I WOULD LIKE TO SEA MY FAMILY TO MORROW", "Visiting hours are from ten to noon."),
];
