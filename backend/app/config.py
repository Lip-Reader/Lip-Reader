"""Config + sys.path bootstrap (makes the vendored pipelines/espnet importable)."""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
for p in (str(REPO_ROOT), str(BACKEND_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

load_dotenv(REPO_ROOT / ".env", override=True)

# --- VSR ----------------------------------------------------------------
VSR_CONFIG = os.getenv("VSR_CONFIG", str(REPO_ROOT / "assets" / "configs" / "LRS3_V_WER19.1.ini"))
VSR_DETECTOR = os.getenv("VSR_DETECTOR", "mediapipe")
VSR_API_BASE = os.getenv("VSR_API_BASE", "https://adamsi--chaplin-ai-backend.modal.run")

IS_VERCEL = bool(os.getenv("VERCEL"))
DISABLE_VSR = os.getenv("DISABLE_VSR", "1" if IS_VERCEL else "0").lower() in ("1", "true", "yes")

# --- LLM ----------------------------------------------------------------
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-5")

# --- Database (Supabase Postgres, session pooler URL) -------------------
DATABASE_URL = os.getenv("DATABASE_URL")

# --- Auth (Clerk) -------------------------------------------------------
CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY")

# --- Inworld TTS --------------------------------------------------------
INWORLD_API_KEY = os.getenv("INWORLD_API_KEY")
DEFAULT_VOICE_ID = os.getenv("INWORLD_VOICE_ID", "Ashley")

# --- Persistence --------------------------------------------------------
# serverless filesystems are read-only outside /tmp
_DEFAULT_VOICE_DIR = "/tmp/chaplin_voices" if IS_VERCEL else str(REPO_ROOT / "backend" / "storage" / "voices")
VOICE_STORAGE_DIR = Path(os.getenv("VOICE_STORAGE_DIR", _DEFAULT_VOICE_DIR))
try:
    VOICE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    pass

# --- CORS ---------------------------------------------------------------
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4173,http://localhost",
).split(",")
