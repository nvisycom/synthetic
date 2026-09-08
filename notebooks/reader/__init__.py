"""Reading what the harness writes.

One module per artifact, mirroring how they are written and when they are
read: a corpus in `truth`, a benchmark run in `run`, a scored report in
`report`, and in `location` the coordinate shape the first two share.

They are separate because they answer different questions and are useful
apart. A corpus loads without any run at all, to see what a spec plants; a run
loads without a report, to see what a pipeline said; only a report carries a
verdict about the two together.

Re-exported here so a notebook imports one name per thing it needs rather than
tracking which module each lives in.
"""

from reader.location import first_range
from reader.report import (
    load_details,
    load_report,
    report_outcomes,
    report_tallies,
    unscored_records,
)
from reader.run import load_run, with_format
from reader.truth import load_truth

__all__ = [
    "first_range",
    "load_details",
    "load_report",
    "load_run",
    "load_truth",
    "report_outcomes",
    "report_tallies",
    "unscored_records",
    "with_format",
]
