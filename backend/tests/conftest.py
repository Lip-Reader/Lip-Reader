"""Shared fixtures and hooks for the test suite."""

import json
import os
import tempfile
import filelock
import pytest

RESULTS_FILE = os.path.join(tempfile.gettempdir(), "lipreader_test_results.jsonl")
RESULTS_LOCK = RESULTS_FILE + ".lock"


def pytest_configure(config):
    """Clear results file at the start (only on controller / non-xdist)."""
    if not hasattr(config, "workerinput"):
        if os.path.exists(RESULTS_FILE):
            os.remove(RESULTS_FILE)


@pytest.fixture
def results_collector():
    """Append result dicts to a shared JSONL file (xdist-safe)."""

    class Collector(list):
        def append(self, item):
            super().append(item)
            lock = filelock.FileLock(RESULTS_LOCK)
            with lock:
                with open(RESULTS_FILE, "a") as f:
                    f.write(json.dumps(item) + "\n")

    return Collector()


def pytest_terminal_summary(terminalreporter, config):
    """Print aggregate pass rate and avg word overlap after all tests."""
    if not os.path.exists(RESULTS_FILE):
        return

    results = []
    with open(RESULTS_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                results.append(json.loads(line))

    if not results:
        return

    min_overlap = 0.9
    total = len(results)
    raw_pass = sum(1 for r in results if r["raw_overlap"] >= min_overlap)
    llm_pass = sum(1 for r in results if r["corrected_overlap"] >= min_overlap)
    avg_raw = sum(r["raw_overlap"] for r in results) / total
    avg_llm = sum(r["corrected_overlap"] for r in results) / total

    terminalreporter.write_sep("=", "LIPREADER SUMMARY")
    terminalreporter.write_line(f"  PASS RATE (>={min_overlap:.0%} word overlap)")
    terminalreporter.write_line(f"  Raw model:    {raw_pass}/{total} ({raw_pass/total:.0%})")
    terminalreporter.write_line(f"  After LLM:    {llm_pass}/{total} ({llm_pass/total:.0%})")
    terminalreporter.write_line("")
    terminalreporter.write_line(f"  AVG WORD OVERLAP")
    terminalreporter.write_line(f"  Raw model:    {avg_raw:.0%}")
    terminalreporter.write_line(f"  After LLM:    {avg_llm:.0%}")
    terminalreporter.write_sep("=", "")
