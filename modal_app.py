"""Deploy the vsr_lip_reader service to Modal.

Setup:
  uv run modal setup
  uv run modal volume create chaplin-weights
  uv run modal volume put chaplin-weights benchmarks/LRS3 /LRS3
  # Modal secret `chaplin-secrets`: ANTHROPIC_API_KEY

Deploy:
  uv run modal deploy modal_app.py
"""
import modal

REMOTE_ROOT = "/root/chaplin"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "opencv-python>=4.5.5.62",
        "scipy>=1.3.0",
        "scikit-image>=0.13.0",
        "av>=10.0.0",
        "six>=1.16.0",
        "mediapipe==0.10.21",
        "torch==2.5.1",
        "torchvision==0.20.1",
        "torchaudio==2.5.1",
        "anthropic",
        "langchain",
        "langgraph",
        "langchain-anthropic",
        "python-dotenv",
        "fastapi",
        "uvicorn[standard]",
        "python-multipart",
        "httpx",
    )
    .env(
        {
            "DISABLE_VSR": "0",
            "CORS_ORIGINS": (
                "https://chaplin-ai.vercel.app,"
                "http://localhost:5173,http://localhost:4173"
            ),
        }
    )
    .workdir(REMOTE_ROOT)
    .add_local_dir("backend", remote_path=f"{REMOTE_ROOT}/backend",
                   ignore=["**/__pycache__", "storage"])
    .add_local_dir("assets", remote_path=f"{REMOTE_ROOT}/assets")
)

weights = modal.Volume.from_name("chaplin-weights")

app = modal.App("chaplin-ai")


@app.cls(
    image=image,
    gpu="T4",
    volumes={f"{REMOTE_ROOT}/benchmarks": weights},
    secrets=[modal.Secret.from_name("chaplin-secrets")],
    timeout=600,
    scaledown_window=900,
    cpu=2.0,
    memory=8192,
    enable_memory_snapshot=True,
)
class Backend:
    @modal.enter(snap=True)
    def load_model(self):
        # snapshotted once: torch import + weights parsed into RAM, on CPU only.
        # CUDA must not be touched here (GPU snapshots are experimental and were
        # failing on every cold start); the GPU move happens after restore.
        import os
        import sys

        os.chdir(REMOTE_ROOT)
        sys.path.insert(0, REMOTE_ROOT)
        from backend.app import vsr

        vsr.get_model(device="cpu")

    @modal.enter(snap=False)
    def to_gpu(self):
        from backend.app import vsr

        vsr.move_model_to_device()

    # label keeps the pre-class URL (adamsi--chaplin-ai-backend.modal.run),
    # which the SPA hardcodes as VSR_BASE
    @modal.asgi_app(label="chaplin-ai-backend")
    def serve(self):
        from backend.app.vsr_main import app as fastapi_app

        return fastapi_app
