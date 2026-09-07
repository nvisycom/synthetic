"""Finding the run a notebook is about.

Both notebooks start the same way: pick a run, check it belongs to the corpus
beside it, and load what it needs. That is here rather than duplicated in each,
because the check is the part worth getting right — a run scored against the
wrong corpus produces numbers that look entirely ordinary and mean nothing.

Plain functions rather than notebook cells, so this is testable. The one thing
left to a cell is the dropdown, since a UI element belongs to the notebook that
displays it.
"""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

#: The repository root, from this file's location.
ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Session:
    """A run, the corpus it was made against, and whether they match."""

    run_dir: Path
    run: dict

    corpus_dir: Path
    manifest: dict

    #: The report directory, when one has been written for this run.
    report_dir: Path | None

    #: Whether the corpus on disk is the one the run was made against.
    same_corpus: bool


def find_runs(root: Path = ROOT) -> list[Path]:
    """Every run under `root`, newest first."""
    return sorted(
        (path.parent for path in root.glob("runs/*/run.json")),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )


def open_session(run_dir: Path | None, root: Path = ROOT) -> Session:
    """Loads a run and the corpus beside it.

    `run_dir` may be None — a dropdown has no value until it is touched, and it
    is never touched when a notebook runs as a script — in which case the newest
    run is used.
    """
    if run_dir is None:
        runs = find_runs(root)
        if not runs:
            message = "No runs found. Generate a corpus and run `run` first."
            raise FileNotFoundError(message)
        run_dir = runs[0]

    # `json` rather than polars for these two: an index is one object read for
    # scalar fields, not a table. `pl.read_json` would return a one-row frame to
    # immediately index back out of. Everything row-shaped is polars.
    run = json.loads((run_dir / "run.json").read_text())

    corpus_dir = root / "corpus"
    manifest = json.loads((corpus_dir / "manifest.json").read_text())

    # The digest, not the seed. Two corpora can share a seed and differ — the
    # specs in `data/` may have changed since — and comparing a run against a
    # corpus it was not made from silently attributes detections to the wrong
    # planted values.
    digest = hashlib.sha256((corpus_dir / "manifest.json").read_bytes()).hexdigest()

    # Beside the run first, then the repository root, which is where `make
    # score` writes one.
    candidates = [run_dir / "report", root / "report"]
    report_dir = next(
        (path for path in candidates if (path / "report.json").exists()), None
    )

    return Session(
        run_dir=run_dir,
        run=run,
        corpus_dir=corpus_dir,
        manifest=manifest,
        report_dir=report_dir,
        same_corpus=digest == run["corpusDigest"],
    )


def summary_table(session: Session) -> str:
    """The run's identity, as markdown.

    Shown at the top of every notebook, so whatever is below it is never read
    without knowing which run produced it.
    """
    mismatch = (
        ""
        if session.same_corpus
        else " ⚠️ **this corpus is not the one the run was made against**"
    )
    run = session.run

    return f"""
        | | |
        |---|---|
        | Run | `{run["id"]}` |
        | Corpus seed | {run["corpusSeed"]}{mismatch} |
        | Pipeline | `{run["pipeline"]}` |
        | Records | {len(run["records"])} |
        | Labels in scope | {len(session.manifest["labels"])} |
        | Started | {run["startedAt"]} |
        | Scored | {"yes" if session.report_dir else "no — run `synthetic score`"} |
        """
