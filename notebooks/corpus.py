"""Reading a corpus and a benchmark run into dataframes.

Plain Python rather than notebook cells, so it can be imported, tested, and
type-checked without marimo's cell semantics in the way — and so a second
notebook reuses it instead of copying it.

Nothing here interprets what it reads. Deciding whether a detection matches a
planted value is the scorer's job, in TypeScript, next to the types that define
what a match is. These functions only reshape what the generator and the runner
already wrote.
"""

from pathlib import Path

import polars as pl

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


def _first_range(frame: pl.DataFrame, column: str, field: str) -> pl.Expr:
    """Reads one end of a location's first byte range.

    A tabular value is addressed by cell rather than by an offset into the
    document, so it has no range. When *no* location in the frame has one, the
    struct carries no `ranges` field at all and reading it raises — so the
    column is filled with nulls instead.
    """
    dtype = frame.schema[column]
    fields = set(dtype.to_schema()) if isinstance(dtype, pl.Struct) else set()
    if "ranges" not in fields:
        return pl.lit(None, dtype=pl.Int64).alias(field)

    return (
        pl.col(column)
        .struct.field("ranges")
        .list.first()
        .struct.field(field)
        .alias(field)
    )


def _entity_columns(truth: pl.DataFrame) -> set[str]:
    """The fields entities actually carry in this corpus."""
    dtype = truth.schema["entities"]
    inner = dtype.inner if isinstance(dtype, pl.List) else dtype
    return set(inner.to_schema()) if isinstance(inner, pl.Struct) else set()


def load_truth(corpus_dir: Path) -> pl.DataFrame:
    """Every planted value in a corpus, one row per occurrence.

    The concat is diagonal because truth files differ in shape: an entity
    carries `expect` and `adversarial` only when it has them, so a uniform
    vstack rejects them.
    """
    paths = sorted(corpus_dir.glob("records/*/truth.json"))
    if not paths:
        message = f"No records under {corpus_dir}"
        raise FileNotFoundError(message)

    truth = pl.concat([pl.read_json(path) for path in paths], how="diagonal_relaxed")

    entities = (
        truth.select("id", "format", "specId", "entities")
        # Renamed before unnesting, since an entity has its own `id`.
        .rename({"id": "record"})
        .explode("entities")
        .unnest("entities")
        .rename({"id": "entityId"})
        # `expect` and `adversarial` are absent from the frame entirely when no
        # entity in the corpus carries one, so they are filled rather than
        # selected — selecting a column that does not exist raises.
        .with_columns(
            *(
                pl.lit(None, dtype=pl.String).alias(name)
                for name in ("expect", "adversarial")
                if name not in _entity_columns(truth)
            )
        )
        .select(
            "record", "format", "specId", "entityId", "label", "expect", "adversarial"
        )
    )

    occurrences = (
        truth.select("id", "occurrences")
        .rename({"id": "record"})
        .explode("occurrences")
        .unnest("occurrences")
        .rename({"id": "occurrenceId"})
        .pipe(
            lambda frame: frame.with_columns(
                _first_range(frame, "location", "start"),
                _first_range(frame, "location", "end"),
            )
        )
        .drop("location", "modalityId")
    )

    return occurrences.join(entities, on=["record", "entityId"], how="left")


def load_run(run_dir: Path) -> pl.DataFrame:
    """Every detection in a run, one row each, plus a row per failed record."""
    paths = sorted((run_dir / "records").glob("*.json"))
    if not paths:
        message = f"No outcomes under {run_dir}"
        raise FileNotFoundError(message)

    outcomes = pl.concat([pl.read_json(path) for path in paths], how="diagonal_relaxed")

    detected = (
        outcomes.filter(pl.col("status") == "detected")
        .select("recordId", "detected")
        .explode("detected")
        .unnest("detected")
        .pipe(
            lambda frame: frame.with_columns(
                _first_range(frame, "location", "start"),
                _first_range(frame, "location", "end"),
                pl.lit(None, dtype=pl.String).alias("failed"),
            )
        )
        .rename({"recordId": "record"})
        .select(DETECTION_COLUMNS)
    )

    # A run with no failures has no `stage` column at all, since the concat only
    # sees the shape of the files that exist.
    if "stage" not in outcomes.columns:
        return detected

    failed = (
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

    return pl.concat([detected, failed], how="vertical")


def with_format(found: pl.DataFrame, planted: pl.DataFrame) -> pl.DataFrame:
    """Attaches each record's format, which only the corpus knows.

    A run records what came back, not what the document was, so a failed record
    would otherwise have no format to group by.
    """
    return found.join(
        planted.select("record", "format").unique(), on="record", how="left"
    )
