# Notebooks

Interactive views of a benchmark run and the corpus it was run against.

```bash
make explore                # lists both notebooks from one server
uv run marimo edit .        # the same thing, without make
uv run marimo run  .        # read-only apps
```

`uv` installs the dependencies on first run; nothing is needed beforehand.

| Notebook     | Shows                                              | Needs    |
| ------------ | -------------------------------------------------- | -------- |
| `score.py`   | What the scorer concluded, and what leaked         | A report |
| `explore.py` | Both sides unmatched: what was planted, what found | A run    |

`score.py` is the one to open after a run: recall by label, format, surface
form, and adversarial kind, the values a pipeline missed, the ones it found
under another name, and where a redaction would have clipped one. `explore.py`
answers what comes before that — what a spec actually plants, what a pipeline
actually returned, and whether a format came back at all.

## Loading

Reading lives in `reader/`, a plain package rather than notebook cells, so it
can be imported, tested, and type-checked without marimo's cell semantics in the
way — and so a second notebook reuses it instead of copying it.

| Module               | Reads                                    |
| -------------------- | ---------------------------------------- |
| `reader/truth.py`    | A corpus' ground truth                   |
| `reader/run.py`      | What a pipeline reported                 |
| `reader/report.py`   | What the scorer concluded                |
| `reader/location.py` | The coordinate shape the first two share |
| `session.py`         | Which run a notebook is about            |

One module per artifact, mirroring how the harness writes them. `session.py`
holds the part both notebooks start with: find a run, and check it belongs to
the corpus beside it — a run scored against the wrong corpus produces numbers
that look entirely ordinary and mean nothing.

## Scoring belongs to the scorer

These notebooks read verdicts; they do not reach them. Matching a detection to a
planted value is the TypeScript scorer's job, next to the types that define what
a match is. A second implementation here could disagree with it, and then there
would be two answers to the same question and nothing to say which is right —
the same reason ground truth is verified against the artifact rather than
assumed from it.

The one thing computed here is rates from counts: a report stores counts and
nothing else, and storing both would invite the two to disagree.

## Viewing on GitHub

`exports/` holds executed copies with their output embedded, so a notebook can
be read in the repository without running anything. See
[exports/README.md](exports/README.md).

```bash
make export
```

## Tooling

`uv` for the environment, `ruff` for lint and formatting, `ty` for types,
`pytest` for the reader tests.

Two ruff rules are relaxed for marimo's cell semantics: a bare expression at the
end of a cell is that cell's output rather than a mistake, and a cell's
arguments are named for the variables they receive. `exports/` is excluded from
both tools — it is generated, and a snapshot of whatever the source said when it
was made.
