"""Tests for the corpus and run loaders.

These exist because the loading code is a module rather than a notebook cell: a
cell can only be checked by opening it and looking, while this runs in CI.
"""

import json
from pathlib import Path

import polars as pl
import pytest

from corpus import load_run, load_truth, with_format

ROOT = Path(__file__).resolve().parent.parent


def _truth(record: str = "rec_0001", **over: object) -> dict:
    """A minimal answer key, shaped as the generator writes one."""
    return {
        "version": 1,
        "id": record,
        "format": "txt",
        "specId": "spec-1",
        "artifact": "document.txt",
        "digest": "a" * 64,
        "provenance": {"renderer": "ts:txt", "seed": 1},
        "modalities": [{"id": "mod_body", "kind": "text", "path": "body"}],
        "entities": [{"id": "ent_0", "label": "person_name", "value": "Dana Reyes"}],
        "occurrences": [
            {
                "id": "occ_0",
                "entityId": "ent_0",
                "modalityId": "mod_body",
                "surface": "canonical",
                "text": "Dana Reyes",
                "location": {"kind": "text", "ranges": [{"start": 5, "end": 15}]},
            }
        ],
        **over,
    }


def _write(corpus: Path, truth: dict) -> None:
    directory = corpus / "records" / truth["id"]
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "truth.json").write_text(json.dumps(truth))


def test_reads_planted_values(tmp_path: Path) -> None:
    _write(tmp_path, _truth())
    planted = load_truth(tmp_path)

    assert planted.height == 1
    row = planted.row(0, named=True)
    assert row["record"] == "rec_0001"
    assert row["label"] == "person_name"
    assert (row["start"], row["end"]) == (5, 15)


def test_joins_an_occurrence_to_its_entity(tmp_path: Path) -> None:
    # Two occurrences of one entity — the coreference case — must both carry
    # that entity's label rather than only the first.
    truth = _truth()
    truth["occurrences"].append(
        {
            "id": "occ_1",
            "entityId": "ent_0",
            "modalityId": "mod_body",
            "surface": "abbreviated",
            "text": "D. Reyes",
            "location": {"kind": "text", "ranges": [{"start": 40, "end": 48}]},
        }
    )
    _write(tmp_path, truth)

    planted = load_truth(tmp_path)
    assert planted.height == 2
    assert planted["label"].to_list() == ["person_name", "person_name"]


def test_reads_records_whose_entities_differ_in_shape(tmp_path: Path) -> None:
    # An entity carries `expect` only when it has one, so the files have
    # different schemas and a uniform concat would reject them.
    _write(tmp_path, _truth("rec_0001"))
    plain = _truth("rec_0002")
    plain["entities"][0]["expect"] = "ignored"
    plain["entities"][0]["adversarial"] = "format_collision"
    _write(tmp_path, plain)

    planted = load_truth(tmp_path)
    assert planted.height == 2
    assert set(planted["expect"].to_list()) == {None, "ignored"}


def test_leaves_a_tabular_location_without_offsets(tmp_path: Path) -> None:
    # A cell-addressed value has no document offset, and must read as null
    # rather than raising.
    truth = _truth()
    truth["occurrences"][0]["location"] = {
        "kind": "tabular",
        "row": 1,
        "column": 2,
        "source": [{"start": 10, "end": 20}],
    }
    _write(tmp_path, truth)

    planted = load_truth(tmp_path)
    assert planted.row(0, named=True)["start"] is None


def test_refuses_a_corpus_with_no_records(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_truth(tmp_path)


def _outcome(record: str, **over: object) -> dict:
    return {
        "status": "detected",
        "recordId": record,
        "detectionId": "det-1",
        "durationMs": 1200,
        "detected": [
            {
                "id": "e-1",
                "label": "email_address",
                "confidence": 0.9,
                "recognizer": "pattern",
                "location": {"kind": "text", "ranges": [{"start": 3, "end": 9}]},
            }
        ],
        **over,
    }


def _write_outcome(run: Path, outcome: dict) -> None:
    records = run / "records"
    records.mkdir(parents=True, exist_ok=True)
    (records / f"{outcome['recordId']}.json").write_text(json.dumps(outcome))


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


def test_attaches_the_format_a_run_does_not_know(tmp_path: Path) -> None:
    corpus, run = tmp_path / "corpus", tmp_path / "run"
    _write(corpus, _truth("rec_0001", format="csv"))
    _write_outcome(run, _outcome("rec_0001"))

    found = with_format(load_run(run), load_truth(corpus))
    assert found.row(0, named=True)["format"] == "csv"


def test_loads_the_repository_corpus() -> None:
    # Guards against a change to what the generator writes: the fixtures above
    # are hand-made, this reads whatever is actually on disk.
    corpus = ROOT / "corpus"
    if not (corpus / "manifest.json").exists():
        pytest.skip("no corpus generated")

    planted = load_truth(corpus)
    assert planted.height > 0
    assert planted["label"].null_count() == 0
