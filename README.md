<div align="center">

# Synthetic

**Synthetic document corpora with known ground truth, for benchmarking redaction.**

Generate documents whose sensitive values are fabricated and planted at known
positions, then score a pipeline on exactly what it caught, missed, and
over-redacted.

[![Build](https://img.shields.io/github/actions/workflow/status/nvisycom/synthetic/build.yml?branch=main&label=build&style=flat-square)](https://github.com/nvisycom/synthetic/actions/workflows/build.yml)
[![Security](https://img.shields.io/github/actions/workflow/status/nvisycom/synthetic/security.yml?branch=main&label=security&style=flat-square)](https://github.com/nvisycom/synthetic/actions/workflows/security.yml)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

[**nvisy.com**](https://nvisy.com) · [**docs.nvisy.com**](https://docs.nvisy.com)

</div>

Redaction accuracy cannot be measured on real customer documents, because they
come with no answer key. There is no way to know whether a pipeline caught every
sensitive value, only that it caught the ones a reviewer happened to spot. This
harness sidesteps that: it fabricates the values, plants them at recorded
positions, and so knows the complete answer before scoring begins.

The approach is described in
[Benchmarking on synthetic documents](https://nvisy.com/blog/benchmarking-on-synthetic-documents).

> [!WARNING]
> **Only text-bearing formats render.** `txt`, `json`, `csv`, and `xml` are
> generated, submitted, and scored end to end; PDF, images, and audio are not
> started, and the image and audio coordinate systems are defined but unused.

## Features

**Known ground truth**  
Every sensitive value is fabricated and planted at a recorded position, so recall and precision are computed exactly rather than sampled.

**Modality-level scoring**  
A PDF's text layer, embedded images, and scanned pages score independently, turning one number for a file into a diagnosis of which component failed.

**Per-entity metrics**  
Results break down by entity type instead of aggregating, because a name in running prose behaves nothing like an account number in a table.

**Boundary accuracy**  
Scoring checks that a redaction covers the whole value and no more, including values broken across line, page, and cell boundaries.

**Adversarial by construction**  
Names colliding with common words, one person written six ways, order numbers shaped like SSNs, OCR-damaged scans, and phonetically transcribed audio.

**Regression detection**  
Run the corpus after a pipeline change to catch losses confined to a single entity type, and to verify identical inputs still produce identical output.

## Architecture

The core is TypeScript: corpus planning, ground truth, and all scoring live
there, sharing entity and detection types with
[`@nvisy/sdk`](https://github.com/nvisycom/sdk-ts) so the two cannot drift.

Renderers for binary and media formats run as Python subprocesses behind a JSON
render-job contract, where that ecosystem is markedly stronger. Ground truth is
never taken on a renderer's word: planted values are verified against the
artifact actually produced.

## Layout

| Path      | Holds                                               | Tracked |
| --------- | --------------------------------------------------- | ------- |
| `data/`   | Record specifications and curated adversarial cases | Yes     |
| `corpus/` | Rendered documents and their ground-truth manifest  | No      |
| `runs/`   | What a pipeline reported, one file per record       | No      |
| `report/` | What the scorer concluded about a run               | No      |

Only `data/` is source. A corpus is reproducible from it plus a seed, a run
from a corpus, and a report from the two, so none is committed — rendered scans
and audio reach gigabytes. That split is also what pins a benchmark: a score is
only comparable across runs if the specifications and seed that produced it
are.

## Requirements

- Node.js 24.0.0 or higher
- Python 3.12 or higher, for the binary and media renderers

## Usage

```bash
npm install
```

Build a corpus from the tracked specifications, then submit it to a pipeline:

```bash
synthetic generate --seed 42 --out ./corpus
synthetic run --corpus ./corpus --out ./runs
```

The seed is required rather than defaulted, because a score is only meaningful
alongside the corpus that produced it, and `--seed 42` is the whole record of
which corpus that was. `run` takes no seed: it reads the corpus it is given and
records that corpus' digest, so a run can only ever be compared against what it
actually ran on.

`run` provisions its own workspace, policy, and pipeline and deletes them
afterwards, so a run cannot inherit configuration from a previous one. It uses
`NVISY_API_TOKEN` when set, and otherwise signs up for a throwaway account.
Add `--development` to run against a local server.

It scores what came back and prints the result. Pass `--report ./report` to
write the full report, or `--no-score` to collect detections without grading
them.

## Scoring

`score` grades a run that already exists:

```bash
synthetic score --corpus ./corpus --run ./runs/42-abc123 --report ./report
```

`--report` names a directory, laid out the way a corpus and a run are: a
summary in `report.json` beside a `records/` directory holding what became of
each planted value. The summary is bounded — its breakdowns are keyed by label,
format, and surface form — so it stays a few kilobytes whether twelve records
were scored or a hundred thousand, while the detail that grows with the corpus
stays out of the way until something needs looking at.

Separate from `run` because the two cost very different things. A run costs a
network round trip per record; scoring costs nothing, so a change to how
matching works re-grades an existing run in milliseconds rather than
resubmitting it. A run records its corpus' digest, and `score` refuses a pair
that does not match — numbers from a mismatched pair look entirely ordinary and
mean nothing.

The report breaks recall down by label, format, surface form, and adversarial
kind, because a single number hides the failures worth catching. A value found
under the wrong label is reported as its own outcome rather than as a miss: a
redactor still removes it, so nothing leaks, but the taxonomy was wrong.
Alongside recall it reports what happened to the values planted to be *ignored*,
without which a pipeline that redacts everything would score perfectly.

## Notebooks

Two marimo notebooks read what the harness writes:

```bash
make explore
```

`score.py` shows what the scorer concluded — recall by label, format, surface
form, and adversarial kind, the values that leaked, and where a redaction would
have clipped one. `explore.py` shows the two sides unmatched, for the questions
that come before scoring: what a spec plants, and what a pipeline returned.

One server lists both. Loading lives in `notebooks/reader/`, a plain package
rather than notebook cells, so it is imported, tested, and type-checked like
anything else. `notebooks/exports/` holds executed copies GitHub renders inline.

Every target has a `make` equivalent — `make generate`, `make run`, `make
score`, `make explore` — and `make help` lists them.

## Project

- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)
- **License**: MIT, see [LICENSE](LICENSE)

## Support

- **Documentation**: [docs.nvisy.com](https://docs.nvisy.com)
- **Email**: [support@nvisy.com](mailto:support@nvisy.com)
