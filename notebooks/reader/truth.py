"""Reading a corpus' ground truth into dataframes.

One module per artifact the harness writes, mirroring how it writes them: a
corpus here, a run in `run`, a report in `report`. They are read at different
times and for different reasons — a corpus is worth loading without any run at
all, to see what a spec actually plants.

Plain Python rather than notebook cells, so it can be imported, tested, and
type-checked without marimo's cell semantics in the way — and so a second
notebook reuses it instead of copying it.

Nothing here interprets what it reads. Deciding whether a detection matches a
planted value is the scorer's job, in TypeScript, next to the types that define
what a match is.
"""

from pathlib import Path

import polars as pl

from reader.location import first_range


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
                first_range(frame, "location", "start"),
                first_range(frame, "location", "end"),
            )
        )
        .drop("location", "modalityId")
    )

    return occurrences.join(entities, on=["record", "entityId"], how="left")
