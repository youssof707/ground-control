import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import {
	DEFAULT_PERMISSION_DENY_MESSAGE,
	DEFAULT_PLAN_DENY_MESSAGE,
	babysitRuleKindForTool,
	isBabysitArmed,
	normalizeBabysitConfig,
	type BabysitConfig,
} from "../../shared/claude-sessions/babysit";
import * as windows from "../windows";

/**
 * Owner of babysit mode: which sessions are being babysat, with what rules,
 * and what answer each rule gives to a prompt.
 *
 * Lives in main, next to `PermissionBroker`, because the broker is the one
 * place every plan approval, permission request and AskUserQuestion passes
 * through. Deciding there — before the request is stored, broadcast or
 * notified — means a babysat prompt never shows a card, never plays the
 * notification sound and never bumps the dock badge.
 *
 * In memory only, by design: a plain Map that never touches `core/store`.
 * Quitting the app ends all babysitting. A reloaded window re-primes from
 * `babysit:list`, the same way the background-task chip does.
 *
 * One set of rules per session, covering its sidequest too. Configs are only
 * ever set for real session ids; a sidequest asks the broker under its own
 * id, so the `decide` wiring in `sessionsHandlers` maps it to its parent's id
 * before the lookup here.
 */
export class Babysitter {
	private configs = new Map<string, BabysitConfig>();

	/**
	 * Start, update or stop babysitting. `null` — or a config where every
	 * rule is "do nothing" — stops it. Returns what was stored.
	 */
	set(sessionId: string, config: BabysitConfig | null): BabysitConfig | null {
		const next = config ? normalizeBabysitConfig(config) : null;
		if (!next || !isBabysitArmed(next)) {
			this.clear(sessionId);
			return null;
		}
		this.configs.set(sessionId, next);
		// `windows.broadcast`, not `SessionManager.send`: the latter drops
		// payloads for tombstoned session ids, and `clear` below must still
		// reach the renderer for a session that is mid-delete.
		windows.broadcast("babysit:changed", { sessionId, config: next });
		return next;
	}

	clear(sessionId: string): void {
		if (!this.configs.delete(sessionId)) return;
		windows.broadcast("babysit:changed", { sessionId, config: null });
	}

	list(): Record<string, BabysitConfig> {
		return Object.fromEntries(this.configs);
	}

	/**
	 * The babysitter's answer to a prompt, or `null` to leave it for the
	 * user (session not babysat, that rule is "do nothing", or the prompt is
	 * in a shape we don't understand).
	 */
	decide(args: {
		sessionId: string;
		toolName: string;
		input: Record<string, unknown>;
	}): PermissionResult | null {
		const config = this.configs.get(args.sessionId);
		if (!config) return null;

		const kind = babysitRuleKindForTool(args.toolName);

		if (kind === "question") {
			const rule = config.question;
			if (rule.action !== "answer") return null;
			const answers = presetAnswers(args.input, rule.message);
			if (!answers) return null;
			return {
				behavior: "allow",
				updatedInput: { ...args.input, answers },
			};
		}

		const rule = kind === "plan" ? config.plan : config.permission;
		if (rule.action === "approve") {
			return { behavior: "allow", updatedInput: args.input };
		}
		if (rule.action === "deny") {
			return {
				behavior: "deny",
				message:
					rule.message ||
					(kind === "plan"
						? DEFAULT_PLAN_DENY_MESSAGE
						: DEFAULT_PERMISSION_DENY_MESSAGE),
			};
		}
		return null;
	}
}

/**
 * Build the `answers` map AskUserQuestion expects — question text → answer —
 * giving every question the same preset. This is the shape the manual card
 * submits for a free-text "Other" answer, so multi-select questions need no
 * special case.
 *
 * Returns null when the input isn't a non-empty list of questions with text,
 * so a malformed prompt falls through to the normal card instead of being
 * "answered" with an empty map.
 */
function presetAnswers(
	input: Record<string, unknown>,
	answer: string,
): Record<string, string> | null {
	const questions = input.questions;
	if (!Array.isArray(questions) || questions.length === 0) return null;
	const answers: Record<string, string> = {};
	for (const q of questions) {
		const text = (q as { question?: unknown } | null)?.question;
		if (typeof text !== "string" || text.length === 0) return null;
		answers[text] = answer;
	}
	return answers;
}
