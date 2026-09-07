"""Tests for finding the run a notebook is about."""

import hashlib
import json
from pathlib import Path

import pytest

from session import find_runs, open_session, summary_table


def _corpus(root: Path, seed: int = 42) -> str:
    """Writes a manifest and returns its digest."""
    corpus = root / "corpus"
    corpus.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 1,
        "seed": seed,
        "generator": "ts:0.1.0",
        "labels": ["person_name", "email_address"],
        "createdAt": "2026-01-01T00:00:00.000Z",
        "records": [],
    }
    path = corpus / "manifest.json"
    path.write_text(json.dumps(manifest))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _run(root: Path, name: str, digest: str, seed: int = 42) -> Path:
    run_dir = root / "runs" / name
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run.json").write_text(
        json.dumps(
            {
                "version": 1,
                "id": name,
                "corpusSeed": seed,
                "corpusDigest": digest,
                "workspace": "ws",
                "pipeline": "benchmark",
                "runner": "0.1.0",
                "startedAt": "2026-01-01T00:00:00.000Z",
                "finishedAt": "2026-01-01T00:00:01.000Z",
                "records": [],
            }
        )
    )
    return run_dir


def test_find_runs_returns_newest_first(tmp_path: Path) -> None:
    digest = _corpus(tmp_path)
    older = _run(tmp_path, "42-aaa", digest)
    newer = _run(tmp_path, "42-bbb", digest)
    # Make the ordering explicit rather than relying on write speed.
    import os

    os.utime(older / "run.json", (1, 1))

    assert [path.name for path in find_runs(tmp_path)] == [newer.name, older.name]


def test_open_session_falls_back_to_the_newest_run(tmp_path: Path) -> None:
    # A dropdown has no value until it is touched, and it is never touched when
    # a notebook runs as a script.
    digest = _corpus(tmp_path)
    _run(tmp_path, "42-aaa", digest)

    session = open_session(None, tmp_path)
    assert session.run["id"] == "42-aaa"
    assert session.same_corpus


def test_open_session_says_when_no_run_exists(tmp_path: Path) -> None:
    _corpus(tmp_path)

    with pytest.raises(FileNotFoundError, match="No runs found"):
        open_session(None, tmp_path)


def test_open_session_notices_a_corpus_the_run_was_not_made_against(
    tmp_path: Path,
) -> None:
    # The check the whole module exists for: two corpora can share a seed and
    # differ, and comparing across them attributes detections to the wrong
    # planted values while looking entirely ordinary.
    _corpus(tmp_path)
    run_dir = _run(tmp_path, "42-aaa", "b" * 64)

    session = open_session(run_dir, tmp_path)
    assert not session.same_corpus
    assert "not the one the run was made against" in summary_table(session)


def test_open_session_finds_a_report_beside_the_run(tmp_path: Path) -> None:
    digest = _corpus(tmp_path)
    run_dir = _run(tmp_path, "42-aaa", digest)
    (run_dir / "report").mkdir()
    (run_dir / "report" / "report.json").write_text("{}")

    assert open_session(run_dir, tmp_path).report_dir == run_dir / "report"


def test_open_session_finds_a_report_at_the_root(tmp_path: Path) -> None:
    digest = _corpus(tmp_path)
    run_dir = _run(tmp_path, "42-aaa", digest)
    (tmp_path / "report").mkdir()
    (tmp_path / "report" / "report.json").write_text("{}")

    assert open_session(run_dir, tmp_path).report_dir == tmp_path / "report"


def test_open_session_reports_no_report_when_none_was_written(tmp_path: Path) -> None:
    digest = _corpus(tmp_path)
    run_dir = _run(tmp_path, "42-aaa", digest)

    session = open_session(run_dir, tmp_path)
    assert session.report_dir is None
    assert "run `synthetic score`" in summary_table(session)
