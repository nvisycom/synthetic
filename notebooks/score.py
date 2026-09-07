import marimo

__generated_with = "0.24.0"
app = marimo.App(width="medium")


@app.cell
def _():
    import altair as alt
    import marimo as mo
    import polars as pl

    # Loading lives in plain modules, so it can be imported, tested, and
    # type-checked without marimo's cell semantics in the way.
    from reader import (
        load_details,
        load_report,
        report_outcomes,
        report_tallies,
        unscored_records,
    )
    from session import find_runs, open_session, summary_table

    return (
        alt,
        find_runs,
        load_details,
        load_report,
        mo,
        open_session,
        pl,
        report_outcomes,
        report_tallies,
        summary_table,
        unscored_records,
    )


@app.cell
def _(mo):
    mo.md("""
    # Score

    What a pipeline found of what was planted, and what it got wrong.

    Recall counts a value found under the wrong label, because a redactor
    still removes it and nothing leaks; `strict` requires the label to agree,
    and the gap between them is what a taxonomy error looks like. Alongside
    both, what happened to the values planted to be *ignored* — without which
    a pipeline that redacts everything would score perfectly.

    For the two sides unmatched, see `explore.py`.
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
        mo.md("*Nothing to score until a run exists.*"),
    )

    session = open_session(run_picker.value)
    mo.md(summary_table(session))
    return (session,)


@app.cell
def _(load_details, load_report, mo, session):
    mo.stop(
        session.report_dir is None,
        mo.md(
            f"""
            /// admonition | Not scored yet
            This run has no report. Write one:

            ```bash
            synthetic score --corpus ./corpus --run {session.run_dir} --report ./report
            ```
            ///
            """
        ),
    )

    # Only the summary is needed for the headline numbers; the per-record
    # detail grows with the corpus and is read separately for that reason.
    # Rebound so the guard above is visible to a type checker: `mo.stop` ends
    # the cell, but nothing in its signature says so.
    report_dir = session.report_dir
    assert report_dir is not None

    report = load_report(report_dir)
    details = load_details(report_dir)
    return details, report


@app.cell
def _(mo):
    mo.md("""
    ## Headline

    One line each for the questions the benchmark asks: how much was found,
    how much was labelled correctly, how much of each value a redaction would
    have covered, and how much of what should have survived did.
    """)
    return


@app.cell
def _(mo, report):
    _t = report["totals"]
    _located = _t["found"] + _t["mislabelled"]
    _cover = _t["boundary"]["covered"] + _t["boundary"]["missed"]

    def _pct(numerator: float, denominator: float) -> str:
        return "—" if not denominator else f"{numerator / denominator * 100:.1f}%"

    _planted = _t["planted"]
    _kept = _t["decoys"] - _t["overRedacted"]

    mo.md(
        f"""
        | | |
        |---|---|
        | Found | {_located} of {_planted} — {_pct(_located, _planted)} |
        | Correctly labelled | {_pct(_t["found"], _planted)} |
        | Boundary coverage | {_pct(_t["boundary"]["covered"], _cover)} |
        | Decoys left alone | {_pct(_kept, _t["decoys"])} |
        | Detections on nothing planted | {report["unplanted"]} |
        | Records never processed | {report["failedRecords"]} |
        """
    )
    return


@app.cell
def _(mo, report_tallies):
    breakdown = mo.ui.dropdown(
        options={
            "label": "byLabel",
            "format": "byFormat",
            "surface form": "bySurface",
            "adversarial kind": "byAdversarial",
        },
        value="label",
        label="Break down by",
    )
    breakdown
    return (breakdown,)


@app.cell
def _(breakdown, pl, report, report_tallies):
    tallies = report_tallies(report, breakdown.value or "byLabel")
    tallies.select(
        "key",
        "planted",
        "found",
        "mislabelled",
        "missed",
        pl.col("recall").round(3),
        pl.col("strict").round(3),
        pl.col("coverage").round(3),
        # Found values whose boundary neither side stated a width for, so
        # `coverage` beside it is computed over fewer values than were found.
        "unmeasured",
        "decoys",
        "overRedacted",
    )
    return (tallies,)


@app.cell
def _(alt, mo, pl, tallies):
    mo.stop(tallies.height == 0, mo.md("*Nothing planted under this breakdown.*"))

    # Only what was planted to be found: a decoy has no recall to plot, and
    # including it would draw an empty bar next to a real one.
    _data = tallies.filter(pl.col("planted") > 0).with_columns(
        pl.col("recall").fill_null(0),
        pl.col("strict").fill_null(0),
    )

    mo.ui.altair_chart(
        alt.Chart(_data)
        .transform_fold(["recall", "strict"], as_=["measure", "value"])
        .mark_bar()
        .encode(
            y=alt.Y(
                "key:N",
                sort=alt.EncodingSortField("planted", order="descending"),
                title=None,
            ),
            x=alt.X("value:Q", title="recall", scale=alt.Scale(domain=[0, 1])),
            yOffset="measure:N",
            color=alt.Color("measure:N", title=None),
            tooltip=[
                "key:N",
                "measure:N",
                alt.Tooltip("value:Q", format=".1%"),
                "planted:Q",
            ],
        )
        .properties(height=alt.Step(12))
    )
    return


@app.cell
def _(mo):
    mo.md("""
    ## What was missed

    The values a pipeline did not find, and the ones it found under another
    name. A run's headline number says how much leaked; this says what.
    """)
    return


@app.cell
def _(details, pl, report_outcomes):
    outcomes = report_outcomes(details)
    outcomes.filter(pl.col("outcome") == "missed").select(
        "record", "format", "label", "surface", "adversarial", "text"
    )
    return (outcomes,)


@app.cell
def _(mo, outcomes, pl):
    _wrong = outcomes.filter(pl.col("outcome") == "mislabelled")
    mo.vstack(
        [
            mo.md("**Found under another label**"),
            _wrong.select("record", "label", "reported", "text")
            if _wrong.height
            else mo.md("*None — every value found was labelled correctly.*"),
        ]
    )
    return


@app.cell
def _(mo, outcomes, pl):
    # Over-redaction: a value planted to survive that was redacted anyway. As
    # damaging to a document as a miss is to a person, and invisible to any
    # measure of recall.
    _over = outcomes.filter(pl.col("outcome") == "over-redacted")
    mo.vstack(
        [
            mo.md("**Redacted despite being planted to survive**"),
            _over.select("record", "label", "reported", "text")
            if _over.height
            else mo.md("*None — every decoy survived.*"),
        ]
    )
    return


@app.cell
def _(mo):
    mo.md("""
    ## Boundary

    Whether a detection covered the whole value and no more. Measured only
    for values that were found, so a miss cannot masquerade as a boundary
    problem. `missed` bytes are what a redaction would leave behind;
    `spilled` bytes are document it would destroy.
    """)
    return


@app.cell
def _(mo, outcomes, pl):
    _imperfect = outcomes.filter(
        (pl.col("boundaryMissed") > 0) | (pl.col("spilled") > 0)
    )
    _imperfect.select(
        "record", "label", "text", "covered", "boundaryMissed", "spilled"
    ).sort("boundaryMissed", descending=True) if _imperfect.height else mo.md(
        "*Every value found was covered exactly.*"
    )
    return


@app.cell
def _(details, mo, unscored_records):
    # Kept apart from the scores rather than folded in: a record that never
    # reached the pipeline was not missed, it was never looked at, and counting
    # it as a miss would blame detection for a transport failure.
    _unscored = unscored_records(details)
    mo.vstack(
        [
            mo.md("**Records the pipeline never processed**"),
            _unscored
            if _unscored.height
            else mo.md("*None — every record was scored.*"),
        ]
    )
    return


if __name__ == "__main__":
    app.run()
