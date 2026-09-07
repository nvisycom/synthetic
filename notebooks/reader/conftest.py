"""Fixtures shared by the reader tests.

The corpus and run writers live here because more than one test module needs
them: a run test that checks a format is attached needs a corpus to attach it
from, and duplicating the writer would let the two drift into disagreeing about
what the generator writes.
"""

import json
from pathlib import Path


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
                # What the file actually carries. Equal to `text` here because
                # plain text escapes nothing, but the field is required, and a
                # fixture missing it stops representing what the generator
                # writes.
                "written": "Dana Reyes",
                "location": {"kind": "text", "ranges": [{"start": 5, "end": 15}]},
            }
        ],
        **over,
    }


def _write(corpus: Path, truth: dict) -> None:
    directory = corpus / "records" / truth["id"]
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "truth.json").write_text(json.dumps(truth))


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
