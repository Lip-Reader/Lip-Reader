"""The corrector: the word-options string, the prompt built around it, and the clean-up.

Everything but the two live tests runs without a key and without the network."""

import pytest

from backend.app import config, corrector
from backend.app.corrector import build_system_prompt, clean, format_words, top1

ALTS = [
    [("HELLO", 0.92), ("FELLOW", 0.05), ("HALLOW", 0.03)],
    [("MY", 0.85), ("BY", 0.10), ("WHY", 0.05)],
    [("NAME", 0.78)],
]


class TestFormatWords:
    def test_every_word_carries_its_options_and_percentages(self):
        result = format_words(ALTS)
        assert "HELLO(92%)/FELLOW(5%)/HALLOW(3%)" in result
        assert "MY(85%)/BY(10%)/WHY(5%)" in result
        assert "NAME(78%)" in result
        assert result == "HELLO(92%)/FELLOW(5%)/HALLOW(3%) MY(85%)/BY(10%)/WHY(5%) NAME(78%)"

    def test_nothing_read_is_an_empty_string(self):
        assert format_words([]) == ""


class TestTop1:
    def test_the_first_option_of_every_word(self):
        assert top1(ALTS, "ignored") == "HELLO MY NAME"

    def test_without_options_the_beam_transcript_stands(self):
        assert top1([], "HELLO MY NAME") == "HELLO MY NAME"
        assert top1([], "") == ""


class TestSystemPrompt:
    def test_base_only(self):
        assert build_system_prompt() == corrector.LLM_SYSTEM_PROMPT_BASE
        assert build_system_prompt([], []) == corrector.LLM_SYSTEM_PROMPT_BASE

    def test_examples_are_input_output_pairs(self):
        prompt = build_system_prompt([{"phrase": "Is Pearl eating well?",
                                       "model_output": "IS(90%) PEARL(40%)/BURL(30%)"}])
        assert "Examples from this speaker" in prompt
        assert "Input: IS(90%) PEARL(40%)/BURL(30%)\nOutput: Is Pearl eating well?" in prompt
        assert "About the speaker" not in prompt

    def test_notes_are_bullet_lines(self):
        prompt = build_system_prompt(notes=["He keeps bees", "His mare is called Pearl"])
        assert "About the speaker" in prompt
        assert "- He keeps bees" in prompt
        assert "- His mare is called Pearl" in prompt
        assert "Examples from this speaker" not in prompt

    def test_both_together(self):
        prompt = build_system_prompt([{"phrase": "Hello", "model_output": "HELLO(90%)"}],
                                     ["He keeps bees"])
        assert prompt.startswith(corrector.LLM_SYSTEM_PROMPT_BASE)
        assert "Input: HELLO(90%)\nOutput: Hello" in prompt
        assert "- He keeps bees" in prompt
        assert prompt.index("Examples from this speaker") < prompt.index("About the speaker")


class TestClean:
    def test_only_the_last_line_survives_and_the_label_goes(self):
        assert clean("thinking...\nCorrected: Where is my pill") == "Where is my pill."

    def test_a_finished_sentence_is_left_alone(self):
        assert clean("Hello?") == "Hello?"

    def test_nothing_stays_nothing(self):
        assert clean("") == ""


@pytest.mark.skipif(not config.ANTHROPIC_API_KEY, reason="ANTHROPIC_API_KEY not configured")
class TestLiveCorrection:
    def test_a_low_confidence_word_is_fixed_from_context(self):
        result = corrector.correct("I(100%) NEED(90%) MY(100%) BEDICINE(60%)/MEDICINE(35%) NOW(100%)")
        print(f"\n  corrected: {result!r}")
        assert "medicine" in result.lower()
        assert result[-1] in ".?!"

    def test_a_note_about_the_speaker_picks_the_lower_option(self):
        result = corrector.correct("SELL(90%) THE(100%) MONEY(58%)/HONEY(35%)",
                                   notes=["He keeps bees and sells honey"])
        print(f"\n  corrected: {result!r}")
        assert "honey" in result.lower()
