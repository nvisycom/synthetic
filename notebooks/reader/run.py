"""Reading a benchmark run into dataframes.

What a pipeline reported, record by record, exactly as the runner wrote it. A
run says nothing about whether a detection was right — that comparison is the
scorer's, and `report` reads its answer.

Worth reading on its own when the question is about the pipeline rather than
its accuracy: what it found, how confident it was, which recognizer fired, and
which records never came back at all.
"""

from pathlib import Path

import polars as pl

from reader.location import first_range

#: The dtype of each detection column, for building an empty frame.
_DETECTION_SCHEMA = {
    "record": pl.String,
    "label": pl.String,
    "confidence": pl.Float64,
    "recognizer": pl.String,
    "start": pl.Int64,
    "end": pl.Int64,
    "failed": pl.String,
}

#: Columns a detection frame carries, whether the record succeeded or failed.
DETECTION_COLUMNS = [
    "record",
    "label",
    "confidence",
    "recognizer",
    "start",
    "end",
    "failed",
]


def load_run(run_dir: Path) -> pl.DataFrame:
    """Every detection in a run, one row each, plus a row per failed record."""
    paths = sorted((run_dir / "records").glob("*.json"))
    if not paths:
        message = f"No outcomes under {run_dir}"
        raise FileNotFoundError(message)

    outcomes = pl.concat([pl.read_json(path) for path in paths], how="diagonal_relaxed")

    # A run where every record failed has no `detected` column at all, just as
    # one with no failures has no `stage`. Both happen: a pipeline that stops
    # answering produces the first.
    if "detected" not in outcomes.columns:
        detected = pl.DataFrame(schema=_DETECTION_SCHEMA)
    else:
        detected = _detected_frame(outcomes)

    if "stage" not in outcomes.columns:
        return detected

    return pl.concat([detected, _failed_frame(outcomes)], how="vertical")


def _detected_frame(outcomes: pl.DataFrame) -> pl.DataFrame:
    """The rows for records the pipeline processed."""
    return (
        outcomes.filter(pl.col("status") == "detected")
        .select("recordId", "detected")
        .explode("detected")
        .unnest("detected")
        .pipe(
            lambda frame: frame.with_columns(
                first_range(frame, "location", "start"),
                first_range(frame, "location", "end"),
                pl.lit(None, dtype=pl.String).alias("failed"),
            )
        )
        .rename({"recordId": "record"})
        .select(DETECTION_COLUMNS)
    )


def _failed_frame(outcomes: pl.DataFrame) -> pl.DataFrame:
    """The rows for records that never produced a detection."""
    return (
        outcomes.filter(pl.col("status") == "failed")
        .select("recordId", "stage")
        .rename({"recordId": "record", "stage": "failed"})
        .with_columns(
            pl.lit(None, dtype=pl.String).alias("label"),
            pl.lit(None, dtype=pl.Float64).alias("confidence"),
            pl.lit(None, dtype=pl.String).alias("recognizer"),
            pl.lit(None, dtype=pl.Int64).alias("start"),
            pl.lit(None, dtype=pl.Int64).alias("end"),
        )
        .select(DETECTION_COLUMNS)
    )


def with_format(found: pl.DataFrame, planted: pl.DataFrame) -> pl.DataFrame:
    """Attaches each record's format, which only the corpus knows.

    A run records what came back, not what the document was, so a failed record
    would otherwise have no format to group by.
    """
    return found.join(
        planted.select("record", "format").unique(), on="record", how="left"
    )
