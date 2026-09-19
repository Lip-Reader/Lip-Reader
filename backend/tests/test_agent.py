"""Agent-level tests for conversation-aware correction.

The agent is a single LLM call that always sees the recent conversation (when
given), so a context-implausible word must be fixed to a visually similar one
on that one call - and a correction that already fits must not be second-guessed.
"""

import pytest

from backend.app import config
from backend.app.agent import run_agent

pytestmark = pytest.mark.skipif(
    not config.ANTHROPIC_API_KEY, reason="ANTHROPIC_API_KEY not configured"
)


class TestNoConversation:
    def test_normal_sentences(self):
        for raw in [
            "I NEED MY BEDICINE NOW",
            "IM SO EXCITED TO ME YOU TODAY",
            "CAN YOU TURN OF THE LIGHT PLEASE",
        ]:
            result = run_agent(raw)
            assert [s["module"] for s in result["steps"]] == ["correct"]
            assert result["response"][-1] in ".?!"

    def test_correction_quality(self):
        result = run_agent("I NEED MY BEDICINE NOW")
        assert "medicine" in result["response"].lower()


class TestConversationContext:
    @pytest.mark.parametrize(
        "raw,conversation,expected_word",
        [
            (
                "WHERES MY BILL",
                [
                    {"role": "other", "content": "The nurse has your evening medication ready."},
                    {"role": "self", "content": "Thank you, I was waiting for it."},
                ],
                "pill",
            ),
            (
                "CAN YOU TURN UP THE HEAT",
                [{"role": "other", "content": "I love this song, it's my favorite."}],
                "beat",
            ),
        ],
    )
    def test_contextual_correction(self, raw, conversation, expected_word):
        result = run_agent(raw, conversation)
        assert [s["module"] for s in result["steps"]] == ["correct"]
        assert expected_word in result["response"].lower()

    def test_context_that_fits_is_left_alone(self):
        result = run_agent(
            "WHERES MY BILL",
            [{"role": "other", "content": "The electricity invoice arrived in the mail."}],
        )
        assert "bill" in result["response"].lower()


class TestHistoryFiltering:
    def test_window_and_role_filtering(self):
        # >10 messages are clamped, junk roles dropped, without errors
        conversation = [
            {"role": "other", "content": f"filler message {i}"} for i in range(12)
        ] + [{"role": "narrator", "content": "ignored"}, {"role": "self", "content": "  "}]
        result = run_agent("I NEED MY BEDICINE NOW", conversation)
        prompt_input = result["steps"][0]["prompt"]["input"]
        assert "filler message 1\n" not in prompt_input  # clamped to last 10
        assert "filler message 2" in prompt_input
        assert "filler message 11" in prompt_input
        assert "ignored" not in prompt_input
