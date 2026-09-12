import type { DraftSession } from "../stores/useDraftSessionsStore";
import { useSettingsStore } from "../stores/useSettingsStore";

/**
 * Convert a draft session into a real one. Subscribes to `session:started`
 * BEFORE invoking startSession so we don't race the broadcast — the
 * renderer-side startSession promise won't resolve until the SDK loop ends,
 * so the real id only arrives via the event. Pattern lifted from the
 * pre-draft `SessionsList.startWith()` flow.
 *
 * Extracted from `ImagePasteTextarea` (now the shared composer's
 * `useComposerTarget` hook) — pure imperative store/IPC code with no React,
 * same shape as `lib/sendTurn.ts`.
 */
export function createSessionFromDraft(draft: DraftSession): Promise<string> {
	// A blank name box means "auto-name me": send the provisional `Session N`
	// placeholder (never an empty title — the sidebar row would render blank
	// for the beat between `session:started` and the first message's patch)
	// and leave `titleLocked` false so SessionManager.pushUserMessage still
	// derives the real title from that first message. A name the user typed
	// is sent locked and is never overwritten afterwards.
	const typedTitle = draft.title.trim().slice(0, 200);
	const expectedTitle = typedTitle || draft.defaultTitle;
	return new Promise((resolve, reject) => {
		let off: (() => void) | null = window.claude.on(
			"session:started",
			(p) => {
				const s = p as {
					id: string;
					title?: string;
					cwd?: string;
					sdkSessionId?: string;
				};
				// `session:started` broadcasts on EVERY runLoop start, not just
				// this one — resumes (see sendTurn's resume-if-needed and
				// useQueuedMessageFlusher) and forks fire it too. Blindly
				// resolving on the first event risks promoting this draft onto
				// an unrelated session; since "Handoff & delete" chains a
				// deferred delete off the resolved id, a misfire would send the
				// handoff into the wrong conversation AND delete the source.
				// A genuine newborn from `run()` has no sdkSessionId yet and
				// carries exactly the cwd/title we just asked for.
				if (s.sdkSessionId) return;
				if (s.cwd !== draft.cwd || s.title !== expectedTitle) return;
				off?.();
				off = null;
				clearTimeout(timer);
				resolve(s.id);
			},
		);
		// Without a timeout, a dropped or mismatched broadcast wedges the
		// composer in `sending` forever with no recovery but a reload.
		const timer = setTimeout(() => {
			off?.();
			off = null;
			reject(new Error("Timed out waiting for the new session to start."));
		}, 20_000);
		// Remember which worktree this workspace was last actually used with,
		// so the next New Session / Cmd+N here pre-attaches it. Recorded at
		// promotion rather than at draft time because starting a session is
		// the honest signal — a draft the user abandons shouldn't retarget
		// anything. `draft.worktreeId` being undefined is meaningful and gets
		// written through: a plain session in this folder means "I'm on the
		// base checkout now", and forgets the previous pairing.
		useSettingsStore
			.getState()
			.setLastUsedWorktree(draft.cwd, draft.worktreeId);
		window.claude
			.startSession({
				title: expectedTitle,
				titleLocked: typedTitle.length > 0,
				cwd: draft.cwd,
				mode: draft.mode,
				// Carry the draft's worktree attachment forward. Main-side
				// SessionManager persists this onto the new session record
				// and rewires the SDK cwd to the worktree's checkout path
				// via resolveEffectiveCwd — see SessionManager.run.
				worktreeId: draft.worktreeId,
				// Carry the model override the user picked in the draft
				// header. Undefined = use the CLI default (SessionManager
				// stamps this onto the session record; the SDK loop reads
				// it on the first turn).
				model: draft.model,
				// Carry the sidebar group inherited from a handoff's source
				// session (undefined for ordinary drafts). Born-with rather
				// than set post-hoc — see DraftSession.groupId doc.
				groupId: draft.groupId,
			})
			.catch((err) => {
				off?.();
				off = null;
				clearTimeout(timer);
				reject(err);
			});
	});
}
