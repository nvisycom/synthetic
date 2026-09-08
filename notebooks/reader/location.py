"""Reading a location out of what the harness wrote.

Ground truth and a run both record where a value sits, in the same shape,
because the generator and the runner write the same `location` struct. Reading
it lives here so the two readers cannot drift into disagreeing about what a
range is.
"""

import polars as pl


def first_range(frame: pl.DataFrame, column: str, field: str) -> pl.Expr:
    """Reads one end of a location's first byte range.

    Every text and tabular location carries one, indexing the raw file. An image
    or audio location does not, and when *no* location in the frame has one the
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
