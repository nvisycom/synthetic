"""Tests for the run reader.

These exist because the reading code is a package rather than notebook cells: a
cell can only be checked by opening it and looking, while this runs in CI.
"""

from pathlib import Path

import polars as pl
import pytest

from reader.conftest import _outcome, _truth, _write, _write_outcome
from reader.run import load_run, with_format
from reader.truth import load_truth


def test_reads_detections(tmp_path: Path) -> None:
    _write_outcome(tmp_path, _outcome("rec_0001"))
    found = load_run(tmp_path)

    row = found.row(0, named=True)
    assert row["label"] == "email_address"
    assert row["confidence"] == pytest.approx(0.9)
    assert row["failed"] is None


def test_reads_a_run_with_no_failures(tmp_path: Path) -> None:
    # No outcome carries `stage`, so the column does not exist at all — the
    # case that broke the first version of this loader.
    _write_outcome(tmp_path, _outcome("rec_0001"))
    assert load_run(tmp_path).height == 1


def test_keeps_a_failed_record_as_a_row(tmp_path: Path) -> None:
    # A failure must survive as a row, or a report would silently describe
    # fewer records than the run covered.
    _write_outcome(tmp_path, _outcome("rec_0001"))
    _write_outcome(
        tmp_path,
        {
            "status": "failed",
            "recordId": "rec_0002",
            "stage": "upload",
            "message": "fetch failed",
        },
    )

    found = load_run(tmp_path)
    assert found.height == 2
    failed = found.filter(pl.col("failed").is_not_null()).row(0, named=True)
    assert failed["record"] == "rec_0002"
    assert failed["label"] is None


def test_reads_a_run_where_every_record_failed(tmp_path: Path) -> None:
    # The mirror of the no-failures case: no outcome carries `detected`, so the
    # column does not exist. A pipeline that stops answering produces exactly
    # this, and it is the run most worth being able to read.
    for record in ("rec_0001", "rec_0002"):
        _write_outcome(
            tmp_path,
            {
                "status": "failed",
                "recordId": record,
                "stage": "upload",
                "message": "fetch failed",
            },
        )

    found = load_run(tmp_path)
    assert found.height == 2
    assert found["label"].null_count() == 2
    assert set(found["failed"].to_list()) == {"upload"}


def test_attaches_the_format_a_run_does_not_know(tmp_path: Path) -> None:
    corpus, run = tmp_path / "corpus", tmp_path / "run"
    _write(corpus, _truth("rec_0001", format="csv"))
    _write_outcome(run, _outcome("rec_0001"))

    found = with_format(load_run(run), load_truth(corpus))
    assert found.row(0, named=True)["format"] == "csv"
