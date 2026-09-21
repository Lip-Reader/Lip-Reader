# Chaplin AI — Design

## Prompt (source of truth)

> mobile app UI, glassmorphism aesthetic with frosted glass panels, soft lighting,
> pastel color palette featuring blues and purples, layered composition with depth,
> modern and creative mood, smooth rendering technique
>
> Negative: low contrast, harsh shadows, cluttered layout, dark themes, pixelation,
> excessive detail, watermark, outdated design elements
>
> Parameters: --ar 16:9 --style raw --stylize 250

Inspiration: iOS 26 liquid glass. Everything sits on a soft pastel light field;
panels are frosted glass floating above it. Light theme only.

## Tokens (`src/ui/theme.ts`)

| Token | Value | Use |
|---|---|---|
| `bg0 / bg1 / bg2` | `#EEF2FF` → `#F5F0FF` → `#E0F2FE` | page gradient |
| `blobA / blobB` | `#C7B8FF` / `#A7D8FF` | drifting light blobs behind glass |
| `accent` | `#7C6CF6` | primary action, links, active state |
| `accent2` | `#60A5FA` | secondary highlight |
| `text` | `#1E1B4B` | body text on glass |
| `muted` | `#6B6A8A` | secondary text |
| `glass` | `rgba(255,255,255,0.55)` | panel fill |
| `glassStrong` | `rgba(255,255,255,0.80)` | buttons, inputs |
| `glassBorder` | `rgba(255,255,255,0.75)` | 1px panel border |
| `danger / success` | `#F87171` / `#34D399` | stop / ok |
| radius | 12 / 18 / 28 / pill | small / panel / card / buttons |
| blur | 40–70 | `BlurView` intensity |
| shadow | `0 8 28 rgba(99,91,255,0.14)` | the only shadow; never darker |
| type | 34/28/20 headings, 16 body, 13 caption, weights 600/500/400 | system font, Inter on web |

## Components (`src/ui`)

- **Background** — gradient + two blurred blobs, always under every screen except the live camera.
- **GlassPanel** — blur + fill + border + soft shadow. Content padding 16–20. `liquid` variant (landing cards): 22% white fill, blur 80, a diagonal white sheen on the top half, a faint accent tint and a single hairline border — the iOS 26 liquid-glass look.
- **GlassButton** — pill, 52px tall, variants `primary` (accent gradient, white text), `ghost` (glassStrong, dark text), `danger` (danger fill, white text). Pressed: scale 0.97.
- **IconButton** — 44×44 glass circle, one icon, used for the fixed Settings (top-left) and Admin (top-right) controls.
- **Toast** — small glass pill at the top, auto-hides in 4 s.
- **Emoji as icons** — landing steps and settings section titles use one emoji each (🎥 ✨ 🔊 🎙️ 👤 💬) instead of icon fonts; keeps copy short and friendly.
- **Quality pill** — Talk screen, under the top controls, while idle or recording: estimated distance plus light, contrast, sharpness, head turn and movement, smoothed and refreshed once a second; each number and its colour hold still until the value really moves, so the pill is calm while the speaker is. Each number is `success` (best), white (fine) or `danger` (bad); the limits live in one table in `recorder.web.tsx`. A red distance always comes with words ("too close", "too far", "no face found"), and the pill stays in place when the face is lost instead of disappearing.
- **Selected chip** — a selected segment (e.g. Voices / Record my voice) uses the dark `text` color as fill with white text so it always contrasts with the light glass.
- **Long lists** — capped at ~330px with internal scroll and a "Show more" step of 5, so the page itself never becomes one long scroll.

## Motion

- Landing entrance: logo glow pulse (3.2 s loop), headline fade-up, feature lines staggered by 0.3 s, blobs drift (9 s loop). Whole entrance < 2.5 s. Honors reduced motion.
- Buttons: press scale 0.97, 120 ms.
- Sentence reveal: words go from 40% to 100% opacity in time with the audio.

## Layout

- Mobile first. Talk and Settings content column max 480px, centered; Admin max 1100px.
- Breakpoints: `< 640` phone, `640–1023` tablet, `≥ 1024` desktop (admin rail appears).
- Safe areas respected on every fixed control.
- Camera preview is full-bleed, un-mirrored, with a 45% dim overlay while a sentence is shown.

## Hard rules (from the negative prompt)

- No dark theme, no pure black backgrounds outside the live camera view.
- No harsh or dark shadows; one soft tinted shadow only.
- Text contrast ≥ 4.5:1 on glass (`text` on `glass` passes).
- One primary action per screen; no more than three controls visible on Talk.
- No decorative detail that does not carry information.
