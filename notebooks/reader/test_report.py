"""Tests for the report reader."""

import json
from pathlib import Path

import polars as pl
import pytest

from reader.report import (
    load_details,
    load_report,
    report_outcomes,
    report_tallies,
    unscored_records,
)


def _write(report_dir: Path, report: dict) -> None:
    """Writes a report the way `synthetic score` lays one out."""
    records = report.pop("records", [])
    (report_dir / "records").mkdir(parents=True, exist_ok=True)
    (report_dir / "report.json").write_text(json.dumps(report))
    for record in records:
        path = report_dir / "records" / f"{record['recordId']}.json"
        path.write_text(json.dumps(record))


def _report(**over: object) -> dict:
    """A minimal report, shaped as `synthetic score` writes one."""
    return {
        "version": 1,
        "runId": "run-1",
        "corpusSeed": 42,
        "corpusDigest": "d" * 64,
        "scoredAt": "2026-01-01T00:00:00.000Z",
        "failedRecords": 0,
        "totals": _tally(planted=2, found=1, missed=1),
        "byLabel": {
            "email_address": _tally(planted=1, found=1, covered=10),
            "person_name": _tally(planted=1, missed=1),
        },
        "byFormat": {"txt": _tally(planted=2, found=1, missed=1)},
        "bySurface": {},
        "byAdversarial": {},
        "unplanted": 0,
        "records": [
            {
                "recordId": "rec_0001",
                "format": "txt",
                "specId": "spec-1",
                "occurrences": [
                    {
                        "occurrenceId": "occ_0",
                        "label": "email_address",
                        "surface": "canonical",
                        "text": "a@b.c",
                        "expect": "detected",
                        "outcome": {
                            "kind": "found",
                            "detectionId": "d1",
                            "boundary": {"covered": 10, "missed": 0, "spilled": 2},
                        },
                    },
                    {
                        "occurrenceId": "occ_1",
                        "label": "person_name",
                        "surface": "misspelled",
                        "text": "Dana",
                        "expect": "detected",
                        "adversarial": "common_word",
                        "outcome": {"kind": "missed"},
                    },
                ],
                "unplanted": [],
            }
        ],
        **over,
    }


def _tally(**over: object) -> dict:
    """A tally with every count at zero unless a test says otherwise."""
    boundary = {
        "covered": over.pop("covered", 0),
        "missed": over.pop("boundaryMissed", 0),
        "spilled": over.pop("spilled", 0),
    }
    return {
        "planted": 0,
        "found": 0,
        "mislabelled": 0,
        "missed": 0,
        "decoys": 0,
        "overRedacted": 0,
        **over,
        "boundary": boundary,
    }


def test_load_report_reads_a_written_report(tmp_path: Path) -> None:
    _write(tmp_path, _report())

    assert load_report(tmp_path)["runId"] == "run-1"


def test_load_report_reads_the_summary_without_the_detail(tmp_path: Path) -> None:
    # The point of the split: a headline number costs one small file, whatever
    # the corpus' size.
    _write(tmp_path, _report())

    assert "records" not in load_report(tmp_path)
    assert len(load_details(tmp_path)) == 1


def test_load_report_says_which_file_is_missing(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="No report at"):
        load_report(tmp_path / "nowhere")


def test_report_tallies_derives_rates_from_counts(tmp_path: Path) -> None:
    frame = report_tallies(_report(), "byLabel")

    email = frame.filter(pl.col("key") == "email_address").row(0, named=True)
    assert email["recall"] == 1.0
    assert email["strict"] == 1.0
    assert email["coverage"] == 1.0

    person = frame.filter(pl.col("key") == "person_name").row(0, named=True)
    assert person["recall"] == 0.0


def test_report_tallies_counts_a_mislabelled_value_in_recall_only() -> None:
    # A value found under the wrong label is located, so a redactor removes it
    # and nothing leaks — but the taxonomy was wrong, so it is not a strict hit.
    report = _report(
        byLabel={"case_number": _tally(planted=2, found=0, mislabelled=1, missed=1)}
    )

    row = report_tallies(report, "byLabel").row(0, named=True)
    assert row["recall"] == 0.5
    assert row["strict"] == 0.0


def test_report_tallies_leaves_a_rate_null_when_nothing_was_planted() -> None:
    # Absent is not the same as failed, and 0% would read as a regression.
    report = _report(byLabel={"iban": _tally(decoys=2)})

    row = report_tallies(report, "byLabel").row(0, named=True)
    assert row["recall"] is None
    assert row["precision"] == 1.0


def test_report_tallies_returns_an_empty_frame_for_an_absent_breakdown() -> None:
    frame = report_tallies(_report(), "bySurface")

    assert frame.height == 0
    assert "planted" in frame.columns


def test_report_outcomes_gives_one_row_per_planted_value() -> None:
    frame = report_outcomes(_report()["records"])

    assert frame.height == 2
    assert set(frame["outcome"]) == {"found", "missed"}

    found = frame.filter(pl.col("outcome") == "found").row(0, named=True)
    assert found["covered"] == 10
    assert found["spilled"] == 2

    missed = frame.filter(pl.col("outcome") == "missed").row(0, named=True)
    assert missed["adversarial"] == "common_word"
    assert missed["covered"] is None


def test_report_outcomes_handles_a_report_with_no_records() -> None:
    frame = report_outcomes([])

    assert frame.height == 0
    assert "outcome" in frame.columns


def test_unscored_records_lists_what_the_pipeline_never_processed() -> None:
    # A run that could not submit part of its corpus covers fewer records than
    # the corpus holds, and folding that into the scores would hide it.
    report = _report(
        records=[
            {
                "recordId": "rec_0002",
                "format": "csv",
                "specId": "spec-2",
                "failed": {"stage": "upload", "message": "connection reset"},
                "occurrences": [],
                "unplanted": [],
            }
        ]
    )

    frame = unscored_records(report["records"])
    assert frame.height == 1
    assert frame.row(0, named=True)["stage"] == "upload"

    # And its values are absent from the outcomes rather than counted as missed.
    assert report_outcomes(report["records"]).height == 0


def test_unscored_records_is_empty_when_every_record_was_processed() -> None:
    frame = unscored_records(_report()["records"])

    assert frame.height == 0
    assert "stage" in frame.columns
