import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Read-only probing of the Claude CLI's own transcripts in
 * `~/.claude/projects/<project-key>/<sdk-session-id>.jsonl`.
 *
 * Why this exists: a sidequest is spawned as a *second* CLI process resuming
 * the parent's SDK session at a specific message uuid (`--resume-session-at`).
 * The CLI resolves that uuid against the JSONL on disk, which it writes
 * asynchronously from the stream we've already relayed to the renderer. The
 * sidequest panel forks at the newest assistant reply — the one least likely
 * to have been flushed — so "the message I can see" and "the message the CLI
 * can find" routinely disagree for a few hundred milliseconds. When they do,
 * the CLI prints `No message found with message.uuid of: <uuid>` and exits 1,
 * which surfaces as a dead, unrecoverable sidequest.
 *
 * `forkFrom` already races the same flush and guards it with `retryOnce`; this
 * module is the equivalent guard for the `resumeSessionAt` path, which can't
 * use a plain retry because the failure happens inside the SDK loop rather
 * than in a promise we await.
 *
 * Everything here is best-effort and never throws: a probe that can't answer
 * returns "unknown" and the caller proceeds exactly as it did before.
 */

/** Root the CLI stores transcripts under. `CLAUDE_CONFIG_DIR` wins when set. */
function projectsRoot(): string {
	const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
	return join(configDir || join(homedir(), ".claude"), "projects");
}

/**
 * Locate a session's JSONL by id, searching *every* project directory.
 *
 * No project-key assumption on purpose — the same reason `sdkForkSession` and
 * `sdkDeleteSession` are called without a `dir` in `SessionManager`: the
 * session may have been minted under a project key that no longer matches what
 * `resolveEffectiveCwd()` resolves to today (e.g. a worktree since removed).
 */
export async function findTranscriptFile(
	sdkSessionId: string,
): Promise<string | null> {
	if (!sdkSessionId) return null;
	const root = projectsRoot();
	let dirs: string[];
	try {
		dirs = await readdir(root);
	} catch {
		return null; // no ~/.claude/projects at all
	}
	for (const d of dirs) {
		const candidate = join(root, d, `${sdkSessionId}.jsonl`);
		try {
			const s = await stat(candidate);
			if (s.isFile()) return candidate;
		} catch {
			// not in this project dir — keep looking
		}
	}
	return null;
}

/**
 * Every message uuid in a session's transcript, or `null` when the transcript
 * can't be read at all (no such file, or an I/O error).
 *
 * `null` is deliberately distinct from an empty set: callers must not treat an
 * unreadable transcript as "the message isn't there", or a user whose
 * `~/.claude` lives somewhere unexpected would lose forking entirely.
 *
 * uuids are pulled out with a regex over the raw text rather than by parsing
 * each line as JSON. That is not just a speed choice — the CLI may be
 * mid-append while we read, and a torn final line is exactly the case we want
 * to report as absent, because the resuming CLI's own line-delimited parser
 * will drop it too.
 */
const UUID_FIELD_RE = /"uuid":"([^"]+)"/g;

export async function readTranscriptUuids(
	sdkSessionId: string,
): Promise<Set<string> | null> {
	const file = await findTranscriptFile(sdkSessionId);
	if (!file) return null;
	try {
		const text = await readFile(file, "utf8");
		const out = new Set<string>();
		for (const m of text.matchAll(UUID_FIELD_RE)) out.add(m[1]);
		return out;
	} catch {
		return null;
	}
}

/**
 * Is `uuid` present in `sdkSessionId`'s transcript? `null` = can't tell.
 *
 * `cache` lets a caller probing several candidates against the same (possibly
 * multi-megabyte) transcript read it once — the fork-point fallback walk in
 * `SessionManager.resolveViableForkSource` does exactly that.
 */
export async function transcriptHasUuid(
	sdkSessionId: string,
	uuid: string,
	cache?: Map<string, Set<string> | null>,
): Promise<boolean | null> {
	if (!uuid) return null;
	let uuids: Set<string> | null;
	if (cache?.has(sdkSessionId)) {
		uuids = cache.get(sdkSessionId) ?? null;
	} else {
		uuids = await readTranscriptUuids(sdkSessionId);
		cache?.set(sdkSessionId, uuids);
	}
	if (uuids === null) return null;
	return uuids.has(uuid);
}

/** How long to let the CLI's flush catch up, and how often to re-check. */
const UUID_WAIT_TIMEOUT_MS = 1000;
const UUID_POLL_INTERVAL_MS = 200;

/**
 * Wait (briefly) for `uuid` to show up in `sdkSessionId`'s transcript.
 *
 * Returns true as soon as it's there, false if it never arrives within the
 * budget, and true when the transcript can't be read at all — "unknown" must
 * fall through to the old behaviour of just trying the fork, not to the
 * fallback path.
 *
 * The budget is deliberately small. This runs between Cmd+S and the panel
 * becoming usable, and the flush it's waiting on is typically sub-second; a
 * longer wait would trade a rare error for a routine stall.
 */
export async function waitForUuid(
	sdkSessionId: string,
	uuid: string,
	timeoutMs = UUID_WAIT_TIMEOUT_MS,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const seen = await transcriptHasUuid(sdkSessionId, uuid);
		if (seen === null) return true; // can't tell — don't block the fork
		if (seen) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((r) => setTimeout(r, UUID_POLL_INTERVAL_MS));
	}
}
