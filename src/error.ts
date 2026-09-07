/**
 * @fileoverview The errors this harness raises on purpose.
 *
 * A benchmark fails in two very different ways, and they want opposite
 * treatment. A spec that names an unknown label, a run submitted against the
 * wrong corpus, a server that is not answering — these are messages for whoever
 * ran the command, and a stack trace buries the sentence that matters under
 * frames they can do nothing about. A genuine fault is the reverse: there the
 * frames are the useful part.
 *
 * Extending {@link HarnessError} is what puts an error in the first category.
 * The CLI decides how to print one by asking whether it is an instance, so a new
 * error is handled correctly by existing it — there is no list to remember to
 * add it to. That list is what this replaces: it matched error names as
 * strings, and a scoring error added without updating it printed a stack trace
 * to the user while every test still passed.
 *
 * @module error
 */

/**
 * An error the harness raises deliberately, to be reported as a message.
 *
 * Never thrown directly. Each stage subclasses it so a caller can tell a
 * malformed spec from an unreachable server, and so the name that reaches the
 * user says which stage refused.
 */
export class HarnessError extends Error {
	/**
	 * Every problem found, one line each, when a check found several.
	 *
	 * Validating a manifest reports all of its problems rather than only the
	 * first, since fixing them one run at a time is miserable. Empty for the
	 * errors that describe a single situation.
	 *
	 * Assigned in the body rather than declared as a parameter property, which
	 * Node's type stripping does not support — the CLI runs from source, so a
	 * parameter property here would crash it while still passing tests, which
	 * compile through a transpiler that does support them.
	 */
	readonly issues: readonly string[];

	constructor(message: string, issues: readonly string[] = []) {
		super(message);
		this.issues = issues;
	}
}
