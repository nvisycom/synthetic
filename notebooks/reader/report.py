"""Reading a scored report into dataframes.

What `synthetic score` concluded: every planted value paired with whatever
found it, and the tallies that follow. This is the only one of the three that
carries a verdict — a corpus knows what is there and a run knows what came
back, but neither says whether they agree.

A report is a directory, laid out as a corpus and a run are: a summary read in
full, and per-record detail read only when a record is looked at. The summary
is bounded, so it loads in the same time whatever the corpus' size; the detail
is a row per planted value and is read separately for that reason.

Rates are derived here rather than read, because a report stores counts and
nothing else. Storing both would invite the two to disagree.
"""

import json
from pathlib import Path

import polars as pl

#: The count columns every tally carries, for building an empty frame.
_TALLY_SCHEMA = {
    "planted": pl.Int64,
    "found": pl.Int64,
    "mislabelled": pl.Int64,
    "missed": pl.Int64,
    "decoys": pl.Int64,
    "overRedacted": pl.Int64,
    "covered": pl.Int64,
    "boundaryMissed": pl.Int64,
    "spilled": pl.Int64,
    "unmeasured": pl.Int64,
}

#: The dtype of each outcome column, for building an empty frame.
_OUTCOME_SCHEMA = {
    "record": pl.String,
    "format": pl.String,
    "specId": pl.String,
    "occurrenceId": pl.String,
    "label": pl.String,
    "surface": pl.String,
    "expect": pl.String,
    "adversarial": pl.String,
    "text": pl.String,
    "outcome": pl.String,
    "reported": pl.String,
    "covered": pl.Int64,
    "boundaryMissed": pl.Int64,
    "spilled": pl.Int64,
}


def load_report(report_dir: Path) -> dict:
    """Reads a report's summary.

    Returned as-is rather than reshaped, since the interesting parts are
    differently shaped: tallies are a table, the run's identity is not, and the
    per-record outcomes are a separate read entirely.
    """
    path = report_dir / "report.json"
    if not path.exists():
        message = f"No report at {path}"
        raise FileNotFoundError(message)

    report = json.loads(path.read_text())

    # Valid JSON is not necessarily a report. `null` and a list both parse
    # cleanly, and returning one would break at whichever field is read first
    # rather than here, where the file that is wrong can be named.
    if not isinstance(report, dict):
        message = f"{path} is not a report: expected an object"
        raise ValueError(message)

    return report


def report_tallies(report: dict, breakdown: str) -> pl.DataFrame:
    """One of a report's breakdowns as a frame, with its rates computed.

    The rates are derived here rather than read, because a report stores counts
    and nothing else: a rate is a view of them, and storing both invites the two
    to disagree.

    Recall counts a value found under the wrong label, since a redactor still
    removes it and nothing leaks; `strict` requires the label to agree. Both are
    reported because the gap between them is what a taxonomy error looks like.
    """
    rows = report.get(breakdown, {})
    if not rows:
        return pl.DataFrame(schema={"key": pl.String, **_TALLY_SCHEMA})

    frame = pl.DataFrame(
        [
            {
                "key": key,
                "planted": tally["planted"],
                "found": tally["found"],
                "mislabelled": tally["mislabelled"],
                "missed": tally["missed"],
                "decoys": tally["decoys"],
                "overRedacted": tally["overRedacted"],
                "covered": tally["boundary"]["covered"],
                "boundaryMissed": tally["boundary"]["missed"],
                "spilled": tally["boundary"]["spilled"],
                "unmeasured": tally.get("unmeasured", 0),
            }
            for key, tally in rows.items()
        ]
    )

    # Null rather than zero where there is nothing to measure: a label nobody
    # planted has no recall, and 0% would read as a failure.
    return frame.with_columns(
        pl.when(pl.col("planted") > 0)
        .then((pl.col("found") + pl.col("mislabelled")) / pl.col("planted"))
        .alias("recall"),
        pl.when(pl.col("planted") > 0)
        .then(pl.col("found") / pl.col("planted"))
        .alias("strict"),
        pl.when(pl.col("decoys") > 0)
        .then((pl.col("decoys") - pl.col("overRedacted")) / pl.col("decoys"))
        .alias("precision"),
        pl.when(pl.col("covered") + pl.col("boundaryMissed") > 0)
        .then(pl.col("covered") / (pl.col("covered") + pl.col("boundaryMissed")))
        .alias("coverage"),
    ).sort("planted", descending=True)


def load_details(report_dir: Path) -> list[dict]:
    """Reads every record's detail, in record order.

    Read separately from the summary because this is the part that grows with
    the corpus: a row per planted value, where the summary is bounded. A
    notebook showing headline numbers never pays for it.
    """
    return [
        json.loads(path.read_text())
        for path in sorted((report_dir / "records").glob("*.json"))
    ]


def _boundary(boundary: dict) -> dict:
    """The boundary columns, empty when nothing was measured.

    A found value has no boundary when neither side stated a width — a tabular
    detection naming a cell says which cell, not how much of the value it
    covered. Left null rather than zeroed, so a coverage figure describes the
    values it actually measured.
    """
    return {
        "covered": boundary.get("covered"),
        "boundaryMissed": boundary.get("missed"),
        "spilled": boundary.get("spilled"),
    }


def report_outcomes(records: list[dict]) -> pl.DataFrame:
    """Every planted value's verdict, one row each.

    The frame the per-record views are built from: what was planted, how it was
    written, and what became of it. A record the pipeline never processed
    contributes no rows — its values were not missed, they were never looked at,
    and counting them as misses would blame detection for a transport failure.
    """
    rows = [
        {
            "record": record["recordId"],
            "format": record["format"],
            "specId": record["specId"],
            "occurrenceId": occurrence["occurrenceId"],
            "label": occurrence["label"],
            "surface": occurrence["surface"],
            "expect": occurrence["expect"],
            "adversarial": occurrence.get("adversarial"),
            "text": occurrence["text"],
            "outcome": occurrence["outcome"]["kind"],
            "reported": occurrence["outcome"].get("reported"),
            # `or {}` rather than a `.get` default: a boundary is absent for a
            # value that was missed, and absent again for one found where
            # neither side stated a width. Null reads the same as missing here,
            # which is what it means.
            **_boundary(occurrence["outcome"].get("boundary") or {}),
        }
        for record in records
        for occurrence in record["occurrences"]
    ]

    if not rows:
        return pl.DataFrame(schema=_OUTCOME_SCHEMA)

    return pl.DataFrame(rows, schema=_OUTCOME_SCHEMA)


def unscored_records(records: list[dict]) -> pl.DataFrame:
    """Records the pipeline never processed, and how far each got.

    Kept separate from the scores rather than folded into them: a run that could
    not submit half its corpus covers fewer records than the corpus holds, and a
    report that does not say so overstates its own coverage.
    """
    rows = [
        {
            "record": record["recordId"],
            "format": record["format"],
            "stage": record["failed"]["stage"],
            "message": record["failed"]["message"],
        }
        for record in records
        if record.get("failed") is not None
    ]

    schema = {
        "record": pl.String,
        "format": pl.String,
        "stage": pl.String,
        "message": pl.String,
    }
    return pl.DataFrame(rows, schema=schema) if rows else pl.DataFrame(schema=schema)
