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
    import json
    from pathlib import Path

    import altair as alt
    import marimo as mo
    import polars as pl

    # Loading lives in a plain module, so it can be imported, tested, and
    # type-checked without marimo's cell semantics in the way.
    from corpus import load_run, load_truth, with_format

    return Path, alt, json, load_run, load_truth, mo, pl, with_format


@app.cell
def _(mo):
    mo.md("""
    # Benchmark run

    A corpus of synthetic documents with known planted values, and what a
    pipeline reported finding in them.

    Nothing here is scored. A detection is only *matched* to a planted value
    by the scorer, which knows about span overlap, boundary tolerance, and
    label equivalence. This shows the two side by side so the shape of a run
    is visible before any of that is decided.
    """)
    return


@app.cell
def _(Path, mo):
    # Repository root, from this file's location.
    root = Path(__file__).resolve().parent.parent

    runs = sorted(
        (path.parent for path in root.glob("runs/*/run.json")),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )

    run_picker = mo.ui.dropdown(
        options={path.name: path for path in runs},
        value=runs[0].name if runs else None,
        label="Run",
    )
    run_picker if runs else mo.md(
        "**No runs found.** Generate a corpus and run `bench` first."
    )
    return root, run_picker, runs


@app.cell
def _(json, root, run_picker, runs):
    # The dropdown has no value until it is touched, and it is never touched
    # when the notebook is run as a script, so fall back to the newest run.
    run_dir = run_picker.value or (runs[0] if runs else None)
    if run_dir is None:
        raise FileNotFoundError(
            "No runs found. Generate a corpus and run `bench` first."
        )

    # `json` rather than polars for these two: an index is one object read for
    # scalar fields, not a table. `pl.read_json` would return a one-row frame to
    # immediately index back out of. Everything row-shaped below is polars.
    run = json.loads((run_dir / "run.json").read_text())

    # The corpus the run was made against. A run records the seed and the
    # manifest's digest, so a mismatch here means the corpus has been
    # regenerated since — and the two are no longer comparable.
    corpus_dir = root / "corpus"
    manifest = json.loads((corpus_dir / "manifest.json").read_text())
    return corpus_dir, manifest, run, run_dir


@app.cell
def _(manifest, mo, run):
    same_corpus = run["corpusSeed"] == manifest["seed"]
    mismatch = (
        "" if same_corpus else f" ⚠️ the corpus on disk is seed {manifest['seed']}"
    )

    mo.md(
        f"""
        | | |
        |---|---|
        | Run | `{run["id"]}` |
        | Corpus seed | {run["corpusSeed"]}{mismatch} |
        | Pipeline | `{run["pipeline"]}` |
        | Records | {len(run["records"])} |
        | Labels in scope | {len(manifest["labels"])} |
        | Started | {run["startedAt"]} |
        """
    )
    return


@app.cell
def _(corpus_dir, load_run, load_truth, run_dir, with_format):
    planted = load_truth(corpus_dir)
    found = with_format(load_run(run_dir), planted)
    return found, planted


@app.cell
def _(mo):
    mo.md("""
    ## By label

    What was planted against what came back, per label. These are counts,
    not a score: a detection is not attributed to a planted value here, so a
    label with equal counts on both sides has not necessarily been matched
    correctly.
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
    mo.md("**Planted**")
    planted.filter(pl.col("record") == record_picker.value).select(
        "label", "surface", "expect", "adversarial", "start", "end", "text"
    ).sort("start")
    return


@app.cell
def _(found, mo, pl, record_picker):
    mo.md("**Detected**")
    found.filter(pl.col("record") == record_picker.value).select(
        "label", "confidence", "recognizer", "start", "end", "failed"
    ).sort("start")
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
