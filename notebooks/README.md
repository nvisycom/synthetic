# Notebooks

Interactive exploration of a benchmark run against the corpus it was run on.

```bash
uv run marimo edit notebooks/explore.py     # edit and explore
uv run marimo run  notebooks/explore.py     # read-only app
```

`uv` installs the dependencies on first run; nothing is needed beforehand.

## Viewing on GitHub

GitHub renders `.ipynb` inline, so a notebook can be read in the repo without
running anything:

```bash
make explore-export        # executes it and embeds the output
```

The export executes the notebook and embeds its output, so it shows the numbers
from whichever run was on disk when it was made. Re-run `make explore-export`
after a run worth publishing.

`explore.py` is the source of truth; the `.ipynb` is a rendering of it.

## Read-only, on purpose

These notebooks load what the generator and the runner already wrote. They
compute no matching and no metrics.

Scoring belongs to the TypeScript scorer, next to the types that define what a
match is. A second implementation here could disagree with it, and then there
would be two answers to the same question and nothing to say which is right —
the same reason ground truth is verified against the artifact rather than
assumed from it.

What a notebook is good for is looking: which labels a pipeline finds, which
formats it struggles with, and what one record's planted values and detections
look like side by side.

## Tooling

`uv` for the environment, `ruff` for lint and formatting, `ty` for types.

Two ruff rules are relaxed for marimo's cell semantics: a bare expression at the
end of a cell is that cell's output rather than a mistake, and a cell's
arguments are named for the variables they receive.
