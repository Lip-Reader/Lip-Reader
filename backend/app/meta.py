"""Static metadata served by /api/team_info and /api/agent_info."""
from .corrector import LLM_SYSTEM_PROMPT_BASE

TEAM_INFO = {
    "group_batch_order_number": "1_1",
    "team_name": "Chaplin AI",
    "students": [
        {"name": "Adam Sion", "email": "adamsion74@gmail.com"},
        {"name": "Jonathan Eshel", "email": "jonathan.eshel1@gmail.com"},
    ],
}

# A real recorded run: every word with the model's options and how sure it was of each.
_EXAMPLE_PROMPT = (
    "I(100%)/HE(0%)/AND(0%) WOULD(100%)/WOULDN(0%)/WAS(0%) LIKE(100%)/WANT(0%)/SAY(0%) "
    "TO(100%)/YOU(0%)/WE(0%) EAT(100%)/SWEET(0%)/WHEAT(0%) MURDER(42%)/BURN(16%)/BURG(13%) "
    "AT(89%)/AND(8%)/AS(0%) FRENCH(100%)/FRIEND(0%)/FRIENDS(0%) RICE(78%)/PHRASE(9%)/FR(6%)"
)
_EXAMPLE_MODEL = "I WOULD LIKE TO EAT MURDER AT FRENCH RICE"
_EXAMPLE_RESPONSE = "I would like to eat a burger and French fries."
_EXAMPLE_STEPS = [
    {
        "module": "vsr",
        "prompt": {"input": "<video clip>", "fps": 30.0},
        "response": {"model": _EXAMPLE_MODEL, "word_options": _EXAMPLE_PROMPT},
    },
    {
        "module": "correct",
        "prompt": {"system": LLM_SYSTEM_PROMPT_BASE, "input": f"Correct this:\n{_EXAMPLE_PROMPT}"},
        "response": {"corrected": _EXAMPLE_RESPONSE},
    },
]

AGENT_INFO = {
    "description": (
        "Chaplin AI is a lip-reading communication agent for non-vocal patients. "
        "A webcam clip is read by a VSR (visual speech recognition) model (module 'vsr'), "
        "which gives every word with its likely alternatives and how sure it was of each. "
        "A single LLM call (module 'correct') turns those word options into a natural, "
        "punctuated sentence, helped by examples the clinician confirmed for this speaker "
        "and notes about the patient, both sent from the device with the clip."
    ),
    "purpose": (
        "Turn imperfect lip-read word options into reliable, naturally punctuated "
        "sentences so ventilated / non-vocal patients can communicate, using what is "
        "known about the speaker to resolve words that look alike on the lips."
    ),
    "prompt_template": {
        "template": (
            "Send the model's word options as the prompt: each word as its top option and "
            "up to two alternatives with a confidence percentage, e.g. "
            "\"I(91%)/HOW(1%)/HI(0%) NEED(80%)/KNEAD(12%) MY(100%) BEDICINE(60%)/MEDICINE(35%)\". "
            "The agent returns the corrected sentence. POST /api/execute_lips with a short "
            "mp4/webm clip of the speaker; the `vsr` step reads it and the `correct` step "
            "returns the corrected sentence. Optional form fields: `duration_ms` (how long the "
            "recording ran, for the real frame rate), `examples` (JSON list of "
            "{\"phrase\", \"model_output\"} pairs confirmed for this speaker) and `notes` "
            "(JSON list of short notes about the patient)."
        )
    },
    "prompt_examples": [
        {
            "prompt": _EXAMPLE_PROMPT,
            "full_response": _EXAMPLE_RESPONSE,
            "steps": _EXAMPLE_STEPS,
        },
    ],
}
