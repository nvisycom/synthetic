# Corpus specifications

Tracked inputs the corpus is built from. Small, reviewable, and versioned: these
files are the benchmark's source of truth, and a change here changes what every
score means.

```
synthetic generate --data ./data --seed 42 --out ./corpus
```

## Layout

Each spec is a directory under `specs/`:

```
specs/
  surface-variants/
    spec.json       which labels to plant, and how each is written
    template.txt    the document layout
```

Specs are named for the mechanism they probe, not their subject matter:
`checksum-pairs`, `context-window`, `weak-without-context`. The document a spec
happens to look like — a claim letter, an incident report — is how the case is
staged, not what it tests.

`spec.json` names the slots; the template places them with `{{slot}}`
placeholders, and `{{slot:surface}}` to write one in a particular form. The
template is a file of its own rather than a string inside the JSON so it reads
as the document it is — a layout change shows up in a diff as a layout change,
and whitespace is visible rather than escaped.

Each format stores its template in the shape its documents have, so the filename
follows the format:

| Format | Template | Holds |
| --- | --- | --- |
| `txt` | `template.txt` | the document's text |
| `csv` | `template.csv` | rows, the first being the header |
| `json` | `template.json` | the document, with placeholders in string values |
| `xml` | `template.json` | the element tree as `{ tag, attrs, text, children }` |

Placeholders are planted in content only. One in a JSON key, an XML tag, or an
attribute name is rejected rather than written verbatim.

## What belongs here

- **Entity dictionaries** — the pools that fabricated names, addresses, and
  identifiers are drawn from.
- **Record specifications** — the document shapes to generate, which entity
  types each carries, and in what formats and modalities.
- **Adversarial cases** — hand-written cases worth pinning: names colliding with
  common words, one person written six ways, order numbers shaped like SSNs.
  These are the values most likely to expose a regression, so they are curated
  rather than sampled.

Everything here is fabricated. No file in this directory may contain a real
person's data, a real account number, or anything derived from a customer
document.

## What does not belong here

Rendered output. `corpus/` holds the generated documents and their ground-truth
manifest, and `runs/` the redaction output and reports; both are gitignored.
They are reproducible from this directory plus a seed, and rendered scans and
audio reach gigabytes.

That reproducibility is the reason for the split: a corpus is a build artifact,
and the seed plus these specifications are what actually pin a benchmark run.
