"""Explore a benchmark run against the corpus it was run on.

Read-only by design. This loads what the generator and the runner already
wrote and shows it; it computes no matching and no metrics. Those belong to the
scorer, in TypeScript, alongside the types that define them — a second
implementation here could disagree with it, and then there would be two answers
to the same question with nothing to say which is right.

What it is for is looking: which labels the pipeline finds, which formats it
struggles with, and what a single record's planted values and detections look
like side by side.

    uv run marimo edit notebooks/explore.py
"""

import marimo

__generated_with = "0.23.16"
app = marimo.App(width="medium")


@app.cell
def _():
    import altair as alt
    import marimo as mo
    import polars as pl

    # Loading lives in plain modules, so it can be imported, tested, and
    # type-checked without marimo's cell semantics in the way.
    from reader import load_run, load_truth, with_format
    from session import find_runs, open_session, summary_table

    return (
        alt,
        find_runs,
        load_run,
        load_truth,
        mo,
        open_session,
        pl,
        summary_table,
        with_format,
    )


@app.cell
def _(mo):
    mo.md("""
    # Benchmark run

    A corpus of synthetic documents with known planted values, what a
    pipeline reported finding in them, and — where a report has been
    written — what became of each one.

    Scoring happens in TypeScript, next to the types that define what a match
    is. Run `synthetic score --report ./report` and the scored sections
    below fill in; without one, the raw sides are still shown side by side.
    """)
    return


@app.cell
def _(find_runs, mo):
    runs = find_runs()
    run_picker = mo.ui.dropdown(
        options={path.name: path for path in runs},
        value=runs[0].name if runs else None,
        label="Run",
    )
    run_picker if runs else mo.md(
        "**No runs found.** Generate a corpus and run `run` first."
    )
    return (run_picker,)


@app.cell
def _(mo, open_session, run_picker, summary_table):
    # Stops here when there is no run, leaving the message above readable
    # rather than replacing it with the exception `open_session` would raise.
    mo.stop(
        not run_picker.options,
        mo.md("*Nothing to explore until a run exists.*"),
    )

    session = open_session(run_picker.value)
    mo.md(summary_table(session))
    return (session,)


@app.cell
def _(load_run, load_truth, session, with_format):
    planted = load_truth(session.corpus_dir)
    found = with_format(load_run(session.run_dir), planted)
    return found, planted


@app.cell
def _(mo):
    mo.md("""
    ## Raw counts

    What was planted against what came back, per label, with nothing matched
    up. A label with equal counts on both sides has not necessarily been
    scored well — the detections may sit on the wrong values entirely. Useful
    when there is no report, and as a check that the scorer saw what the run
    actually holds.
    """)
    return


@app.cell
def _(found, pl, planted):
    planted_by_label = planted.group_by("label").agg(
        pl.len().alias("planted"),
        (pl.col("expect") == "ignored").sum().alias("must_not_detect"),
    )
    found_by_label = (
        found.filter(pl.col("label").is_not_null())
        .group_by("label")
        .agg(pl.len().alias("detected"))
    )

    by_label = (
        planted_by_label.join(found_by_label, on="label", how="full", coalesce=True)
        .fill_null(0)
        .sort("planted", descending=True)
    )
    by_label
    return (by_label,)


@app.cell
def _(alt, by_label, mo, pl):
    chart_data = by_label.unpivot(
        index="label",
        on=["planted", "detected"],
        variable_name="side",
        value_name="count",
    ).filter(pl.col("count") > 0)

    mo.ui.altair_chart(
        alt.Chart(chart_data)
        .mark_bar()
        .encode(
            y=alt.Y("label:N", sort="-x", title=None),
            x=alt.X("count:Q", title="occurrences"),
            yOffset="side:N",
            color=alt.Color("side:N", title=None),
            tooltip=["label", "side", "count"],
        )
        .properties(height=alt.Step(12))
    )
    return


@app.cell
def _(mo):
    mo.md("""
    ## By format

    Where a pipeline reads a document differently, this is where it shows.
    A format whose planted values never come back is usually one whose text
    the pipeline did not extract, rather than one whose values it failed to
    recognise.
    """)
    return


@app.cell
def _(found, pl, planted):
    by_format = (
        planted.group_by("format")
        .agg(pl.len().alias("planted"), pl.col("record").n_unique().alias("records"))
        .join(
            found.filter(pl.col("label").is_not_null())
            .group_by("format")
            .agg(pl.len().alias("detected")),
            on="format",
            how="left",
        )
        .fill_null(0)
        .with_columns(
            (pl.col("detected") / pl.col("planted")).round(2).alias("ratio"),
        )
        .sort("planted", descending=True)
    )
    by_format
    return


@app.cell
def _(mo):
    mo.md("""
    ## One record

    The planted values and the detections for a single document, so a
    disagreement can be looked at directly rather than inferred from counts.
    """)
    return


@app.cell
def _(mo, pl, planted):
    record_ids = planted.select(pl.col("record").unique().sort()).to_series().to_list()
    record_picker = mo.ui.dropdown(
        options=record_ids,
        value=record_ids[0] if record_ids else None,
        label="Record",
    )
    record_picker
    return (record_picker,)


@app.cell
def _(mo, pl, planted, record_picker):
    # Stacked, because only a cell's last expression renders: a bare `mo.md`
    # above the table is discarded, leaving two adjacent tables whose meaning
    # has to be inferred from their columns.
    mo.vstack(
        [
            mo.md("**Planted**"),
            planted.filter(pl.col("record") == record_picker.value)
            .select("label", "surface", "expect", "adversarial", "start", "end", "text")
            .sort("start"),
        ]
    )
    return


@app.cell
def _(found, mo, pl, record_picker):
    mo.vstack(
        [
            mo.md("**Detected**"),
            found.filter(pl.col("record") == record_picker.value)
            .select("label", "confidence", "recognizer", "start", "end", "failed")
            .sort("start"),
        ]
    )
    return


@app.cell
def _(mo):
    mo.md("""
    ## Values that must survive

    A corpus plants decoys — a catalog number shaped like an account, a
    published switchboard, a public CVE — that a pipeline is expected to
    leave alone. A detection overlapping one of these is over-redaction, and
    the reason a benchmark that measures only recall is not a benchmark.
    """)
    return


@app.cell
def _(pl, planted):
    planted.filter(pl.col("expect") == "ignored").select(
        "record", "label", "adversarial", "text"
    )
    return


if __name__ == "__main__":
    app.run()
