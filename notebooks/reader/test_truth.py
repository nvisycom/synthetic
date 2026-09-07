"""Tests for the corpus reader.

These exist because the reading code is a package rather than notebook cells: a
cell can only be checked by opening it and looking, while this runs in CI.
"""

from pathlib import Path

import pytest

from reader.conftest import _truth, _write
from reader.truth import load_truth

ROOT = Path(__file__).resolve().parent.parent.parent


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


def test_loads_the_repository_corpus() -> None:
    # Guards against a change to what the generator writes: the fixtures above
    # are hand-made, this reads whatever is actually on disk.
    corpus = ROOT / "corpus"
    if not (corpus / "manifest.json").exists():
        pytest.skip("no corpus generated")

    planted = load_truth(corpus)
    assert planted.height > 0
    assert planted["label"].null_count() == 0
