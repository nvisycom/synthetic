# Exports

Notebooks executed once and committed with their output embedded, so GitHub
renders them inline — charts, tables and all — without anyone cloning the
repository or starting a server.

These are the one derived artifact this project tracks. A corpus, a run, and a
report are all reproducible and all grow without bound, so they stay out of git;
an export is a fixed-size snapshot whose entire purpose is to be read where it
sits.

## Regenerating

```bash
make export
```

Runs the notebook against whatever corpus, run, and report are present and
rewrites the export. The output embedded here is therefore a picture of one
particular run — useful as an illustration, not as a result to cite. The numbers
that count come from `synthetic score`.

Regenerate after changing a notebook, or the committed copy shows the old one.
