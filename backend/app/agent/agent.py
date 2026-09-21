"""Single-pass corrector agent: reads the raw VSR text (+ recent conversation) and
returns a corrected sentence. Built with LangChain's create_agent - no tools, so
it's a single model call, no tool-calling loop.
"""
import logging

from langchain.agents import create_agent
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage

from .. import config
from .prompts import SYSTEM_PROMPT

log = logging.getLogger("chaplin.agent")

MEMORY_WINDOW = 10
MAX_MESSAGE_CHARS = 500

# no temperature: sampling params are rejected on Opus 5 and the other 4.7+ models.
llm = ChatAnthropic(
    model=config.LLM_MODEL,
    max_tokens=512,
    timeout=30,
    output_config={"effort": "low"},
)
agent = create_agent(model=llm, system_prompt=SYSTEM_PROMPT)


def _transcript(conversation: list[dict]) -> str:
    return "\n".join(
        f"{'You' if m['role'] == 'self' else 'Other'}: {m['content']}"
        for m in conversation
    )


def run_agent(raw_text: str, conversation: list[dict] | None = None) -> dict:
    history = [
        {"role": m["role"], "content": str(m["content"])[:MAX_MESSAGE_CHARS]}
        for m in (conversation or [])
        if isinstance(m, dict)
        and m.get("role") in ("self", "other")
        and str(m.get("content", "")).strip()
    ][-MEMORY_WINDOW:]

    user = f"Input: {raw_text}"
    transcript = _transcript(history)
    if transcript:
        user = f"Conversation so far (the speaker is 'You'):\n{transcript}\n\n{user}"

    result = agent.invoke({"messages": [HumanMessage(user)]})
    content = result["messages"][-1].content
    if isinstance(content, list):  # thinking blocks can precede the text block
        content = "".join(b.get("text", "") for b in content
                          if isinstance(b, dict) and b.get("type") == "text")
    text = content.strip()
    # The model sometimes narrates before answering ("the transcription seems too
    # garbled...") and the preamble would be shown to the patient and spoken aloud.
    # The sentence is always the last non-empty line.
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) > 1:
        log.warning("corrector preamble discarded: %s", " / ".join(lines[:-1])[:200])
        text = lines[-1]
    if text and text[-1] not in ".?!":
        text += "."

    step = {"module": "correct", "prompt": {"system": SYSTEM_PROMPT, "input": user}, "response": {"corrected": text}}
    return {"response": text, "steps": [step]}
