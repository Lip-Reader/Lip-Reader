"""Static metadata served by /api/team_info and /api/agent_info."""
from .agent.prompts import SYSTEM_PROMPT

TEAM_INFO = {
    "group_batch_order_number": "1_1",
    "team_name": "Chaplin AI",
    "students": [
        {"name": "Adam Sion", "email": "adamsion74@gmail.com"},
        {"name": "Jonathan Eshel", "email": "jonathan.eshel1@gmail.com"},
    ],
}

_EXAMPLE_PROMPT = "THANK YOU DARLING YOU ARE JUST TOO KIND TODAY"
_EXAMPLE_RESPONSE = "Thank you, darling, you are just too kind today."
_EXAMPLE_STEPS = [
    {
        "module": "correct",
        "prompt": {"system": SYSTEM_PROMPT, "input": f"Input: {_EXAMPLE_PROMPT}"},
        "response": {"corrected": _EXAMPLE_RESPONSE},
    },
]

# Real recorded run: the conversation implies medication, so the visually
# similar 'pill' is chosen over the transcribed 'bill'.
_CTX_PROMPT = "WHERES MY BILL"
_CTX_CONVERSATION = [
    {"role": "other", "content": "The nurse has your evening medication ready."},
    {"role": "self", "content": "Thank you, I was waiting for it."},
]
_CTX_RESPONSE = "Where's my pill?"
_CTX_TRANSCRIPT = (
    "Conversation so far (the speaker is 'You'):\n"
    "Other: The nurse has your evening medication ready.\n"
    "You: Thank you, I was waiting for it."
)
_CTX_STEPS = [
    {
        "module": "correct",
        "prompt": {
            "system": SYSTEM_PROMPT,
            "input": f"{_CTX_TRANSCRIPT}\n\nInput: {_CTX_PROMPT}",
        },
        "response": {"corrected": _CTX_RESPONSE},
    },
]

AGENT_INFO = {
    "description": (
        "Chaplin AI is a lip-reading communication agent for non-vocal patients. "
        "A webcam clip is transcribed by a VSR (visual speech recognition) model "
        "(module 'vsr'), then a single LLM call (module 'correct') turns the noisy "
        "all-caps transcription into a natural, punctuated sentence - using the "
        "recent conversation (short-term memory, last 10 messages) to pick between "
        "visually similar words when one fits the context better."
    ),
    "purpose": (
        "Turn imperfect all-caps lip-read transcriptions into reliable, naturally "
        "punctuated sentences so ventilated / non-vocal patients can communicate, "
        "using the surrounding conversation to resolve words that are ambiguous "
        "in isolation but implied by context."
    ),
    "prompt_template": {
        "template": (
            "Send the raw lip-read transcription as the prompt, ideally in all-caps, "
            "e.g. \"IM SO EXCITED TO ME YOU TODAY\". The agent returns the corrected "
            "sentence. Any noisy English sentence works — POST /api/execute with "
            "{\"prompt\": \"<RAW TRANSCRIPTION>\"}. Optionally add \"conversation\": "
            "[{\"role\": \"self\"|\"other\", \"content\": \"...\"}] — the chat so far; "
            "it's used to fix words that don't fit the context."
        )
    },
    "prompt_examples": [
        {
            "prompt": _EXAMPLE_PROMPT,
            "full_response": _EXAMPLE_RESPONSE,
            "steps": _EXAMPLE_STEPS,
        },
        {
            "prompt": _CTX_PROMPT,
            "conversation": _CTX_CONVERSATION,
            "full_response": _CTX_RESPONSE,
            "steps": _CTX_STEPS,
        },
    ],
}
