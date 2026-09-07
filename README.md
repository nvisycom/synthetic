<div align="center">

# Synthetic

**Synthetic document corpora with known ground truth, for benchmarking redaction.**

Generate documents whose sensitive values are fabricated and planted at known
positions, then score a pipeline on exactly what it caught, missed, and
over-redacted.

[![Build](https://img.shields.io/github/actions/workflow/status/nvisycom/synthetic/build.yml?branch=main&label=build&style=flat-square)](https://github.com/nvisycom/synthetic/actions/workflows/build.yml)
[![Security](https://img.shields.io/github/actions/workflow/status/nvisycom/synthetic/security.yml?branch=main&label=security&style=flat-square)](https://github.com/nvisycom/synthetic/actions/workflows/security.yml)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE.txt)

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
> **Scoring is not implemented.** A corpus can be generated and submitted to a
> pipeline, and the result explored, but the metrics themselves — recall,
> precision, boundary accuracy — are still to come. Only text-bearing formats
> render; PDF, images, and audio are not started.

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

| Path      | Holds                                                   | Tracked |
| --------- | ------------------------------------------------------- | ------- |
| `data/`   | Record specifications and curated adversarial cases     | Yes     |
| `corpus/` | Rendered documents and their ground-truth manifest      | No      |
| `runs/`   | Redaction output and scored reports                     | No      |

Only `data/` is source. A corpus is reproducible from it plus a seed, and a
run from a corpus, so neither is committed — rendered scans and audio reach
gigabytes. That split is also what pins a benchmark: a score is only
comparable across runs if the specifications and seed that produced it are.

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
synthetic bench --corpus ./corpus --out ./runs
```

The seed is required rather than defaulted, because a score is only meaningful
alongside the corpus that produced it, and `--seed 42` is the whole record of
which corpus that was. `bench` takes no seed: it reads the corpus it is given
and records that corpus' digest, so a run can only ever be compared against
what it actually ran on.

`bench` provisions its own workspace, policy, and pipeline and deletes them
afterwards, so a run cannot inherit configuration from a previous one. It uses
`NVISY_API_TOKEN` when set, and otherwise signs up for a throwaway account.
Add `--development` to run against a local server.

`score` is declared but not implemented.

Every target has a `make` equivalent — `make generate`, `make bench`,
`make explore` — and `make help` lists them.

## Project

- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)
- **License**: MIT, see [LICENSE.txt](LICENSE.txt)

## Support

- **Documentation**: [docs.nvisy.com](https://docs.nvisy.com)
- **Email**: [support@nvisy.com](mailto:support@nvisy.com)
