/**
 * Babysit mode: per-session rules for answering Claude's prompts while the
 * user is away. Shared by main (which owns the live config and makes the
 * decisions) and the renderer (which edits it in the Babysitter modal).
 *
 * Plain interfaces rather than zod schemas on purpose — same reasoning as
 * `LiveBackgroundTask`: this is transient, process-lifetime state that is
 * never written to disk, so there is no file format to validate.
 */

/**
 * Plan approval and tool-permission prompts. "Deny" and "deny with a message"
 * are ONE action: an empty `message` sends the default deny text for that
 * prompt kind (see the `DEFAULT_*_DENY_MESSAGE` constants below).
 */
export type BabysitGateRule =
	| { action: "none" }
	| { action: "approve" }
	| { action: "deny"; message: string };

/** AskUserQuestion prompts. `message` is the preset answer, never empty. */
export type BabysitQuestionRule =
	| { action: "none" }
	| { action: "answer"; message: string };

export interface BabysitConfig {
	/** `ExitPlanMode` — Claude asks to leave plan mode and start building. */
	plan: BabysitGateRule;
	/** Every other tool-permission prompt. */
	permission: BabysitGateRule;
	/** `AskUserQuestion` — the same answer goes to every question asked. */
	question: BabysitQuestionRule;
}

export type BabysitRuleKind = keyof BabysitConfig;

export const EMPTY_BABYSIT_CONFIG: BabysitConfig = {
	plan: { action: "none" },
	permission: { action: "none" },
	question: { action: "none" },
};

/**
 * What a blank deny message sends. These are the exact strings the manual
 * cards send ("Keep planning" on `PlanApprovalCard`, "Deny" on
 * `DefaultPermissionCard`), so a babysat blank deny is indistinguishable to
 * Claude from the user clicking the button themselves.
 */
export const DEFAULT_PLAN_DENY_MESSAGE =
	"Keep planning — don't exit plan mode yet.";
export const DEFAULT_PERMISSION_DENY_MESSAGE = "Denied by user";

/** Cap on any babysitter message, enforced in the modal and again in main. */
export const BABYSIT_MESSAGE_MAX_LENGTH = 2000;

/**
 * Which rule governs a prompt. The mapping is exclusive: a plan approval or a
 * question is never treated as a generic permission, so "approve every
 * permission" can't silently approve a plan or answer a question with nothing.
 */
export function babysitRuleKindForTool(toolName: string): BabysitRuleKind {
	if (toolName === "ExitPlanMode") return "plan";
	if (toolName === "AskUserQuestion") return "question";
	return "permission";
}

/** True when at least one rule does something — i.e. babysitting is on. */
export function isBabysitArmed(config: BabysitConfig): boolean {
	return (
		config.plan.action !== "none" ||
		config.permission.action !== "none" ||
		config.question.action !== "none"
	);
}

function cleanMessage(raw: unknown): string {
	return typeof raw === "string"
		? raw.trim().slice(0, BABYSIT_MESSAGE_MAX_LENGTH)
		: "";
}

function normalizeGateRule(rule: BabysitGateRule | undefined): BabysitGateRule {
	if (rule?.action === "approve") return { action: "approve" };
	if (rule?.action === "deny") {
		return { action: "deny", message: cleanMessage(rule.message) };
	}
	return { action: "none" };
}

/**
 * Canonical form of a config: messages trimmed and capped, and an "answer"
 * with nothing to say collapsed to "none" (an empty answer would be worse
 * than leaving the question for the user). Tolerates a partial object since
 * it also runs on whatever arrives over IPC.
 */
export function normalizeBabysitConfig(
	config: Partial<BabysitConfig> | null | undefined,
): BabysitConfig {
	const answer =
		config?.question?.action === "answer"
			? cleanMessage(config.question.message)
			: "";
	return {
		plan: normalizeGateRule(config?.plan),
		permission: normalizeGateRule(config?.permission),
		question: answer ? { action: "answer", message: answer } : { action: "none" },
	};
}
