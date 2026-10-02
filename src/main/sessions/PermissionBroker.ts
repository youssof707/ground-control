import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type {
	PermissionDecision,
	PermissionRequest,
} from "../../shared/claude-sessions/types";
import { NotificationManager } from "../ipc/notifications";
import * as windows from "../windows";

type Resolver = (result: PermissionResult) => void;

export class PermissionBroker {
	private pending = new Map<
		string,
		{ request: PermissionRequest; resolve: Resolver }
	>();
	// Tool names the user has chosen to always allow for the lifetime of this
	// app process. Not persisted — clearing the set requires restarting the app.
	private alwaysAllowTools = new Set<string>();

	constructor(
		private notifications: NotificationManager,
		private getSessionTitle: (sessionId: string) => string | undefined,
		/** Called after a permission / plan / ask-user response resolves, so
		 * SessionManager can re-record the branch checkpoint and dismiss the
		 * red BranchChip on any user interaction (not just sends). Optional
		 * to keep tests / alternate wirings simple. */
		private onUserCheckpoint?: (sessionId: string) => void,
		/** Called when the user answers an ExitPlanMode card — on all three
		 * buttons (approve, keep planning, stop) — so SessionManager can
		 * persist the plan text into the transcript. Without this the plan
		 * only ever lived in the transient card and vanished on click.
		 *
		 * Deliberately hung off `handleResponse` rather than the `canUseTool`
		 * await in SessionManager: `ask()` never rejects (cancelAllForSession
		 * and the no-window path both *resolve* with a deny), so the awaiting
		 * side can't tell a real click from a cancellation. This can. */
		private onPlanDecision?: (sessionId: string, planText: string) => void,
		/** Babysit mode's hook: given a prompt, return the answer to give on
		 * the user's behalf, or null to leave it for the user. Consulted
		 * before a request is stored, broadcast or notified, so an
		 * auto-answered prompt never produces a card, a notification sound
		 * or a dock badge. See `Babysitter`. */
		private autoDecide?: (args: {
			sessionId: string;
			toolName: string;
			input: Record<string, unknown>;
		}) => PermissionResult | null,
	) {
		ipcMain.on("permission:respond", (_e, decision: PermissionDecision) => {
			this.handleResponse(decision);
		});
	}

	ask(args: {
		sessionId: string;
		toolName: string;
		input: Record<string, unknown>;
	}): Promise<PermissionResult> {
		// Diagnostic: confirm on-device that the SDK is reaching the broker for
		// this tool. Keep this until plan-mode approval flow is proven stable.
		console.log(
			`[broker] ask tool=${args.toolName} session=${args.sessionId}`,
		);
		if (this.alwaysAllowTools.has(args.toolName)) {
			return Promise.resolve({
				behavior: "allow",
				updatedInput: args.input,
			});
		}

		// Babysit mode. After the always-allow check (an always-allowed tool
		// never prompts, so there is nothing to babysit) and before anything
		// below registers the request.
		const auto = this.autoDecide?.(args);
		if (auto) {
			console.log(
				`[broker] babysitter answered tool=${args.toolName} session=${args.sessionId} behavior=${auto.behavior}`,
			);
			// No card will ever show this plan, so the transcript copy is the
			// only place the user can read what was approved or denied.
			this.notePlanDecision(args);
			// Deliberately no `onUserCheckpoint`: the user did not engage
			// with the session, so the branch baseline must not move.
			return Promise.resolve(auto);
		}

		const requestId = randomUUID();
		const request: PermissionRequest = {
			requestId,
			sessionId: args.sessionId,
			toolName: args.toolName,
			input: args.input,
			createdAt: Date.now(),
		};

		return new Promise<PermissionResult>((resolve) => {
			this.pending.set(requestId, { request, resolve });
			this.syncBadge();
			if (windows.count() === 0) {
				this.pending.delete(requestId);
				this.syncBadge();
				resolve({ behavior: "deny", message: "No window available" });
				return;
			}
			windows.broadcast("permission:request", request);
			this.notifications.notifyPermissionRequest(
				request,
				this.getSessionTitle(args.sessionId),
			);
		});
	}

	/**
	 * Snapshot of pending permission requests. Used by `permissions:list` so a
	 * window opened mid-flight can show requests that were already waiting
	 * before it existed.
	 */
	listPending(): PermissionRequest[] {
		return [...this.pending.values()].map((e) => e.request);
	}

	cancelAllForSession(sessionId: string, reason = "Session cancelled") {
		for (const [id, entry] of this.pending) {
			if (entry.request.sessionId === sessionId) {
				this.pending.delete(id);
				entry.resolve({ behavior: "deny", message: reason });
				windows.broadcast("permission:resolved", { requestId: id });
			}
		}
		this.syncBadge();
	}

	/**
	 * Run babysit mode over the prompts already waiting for a session.
	 * Called when babysitting is switched on or its rules change, so a card
	 * that is on screen at that moment is answered instead of being stranded
	 * until the user clicks it. Prompts the rules don't cover stay pending.
	 */
	answerPendingForSession(sessionId: string) {
		if (!this.autoDecide) return;
		for (const [id, entry] of this.pending) {
			if (entry.request.sessionId !== sessionId) continue;
			const auto = this.autoDecide(entry.request);
			if (!auto) continue;
			this.pending.delete(id);
			windows.broadcast("permission:resolved", { requestId: id });
			this.notePlanDecision(entry.request);
			entry.resolve(auto);
		}
		this.syncBadge();
	}

	/**
	 * Copy an answered plan into the transcript. Must run before the request
	 * is resolved, so the bubble is broadcast while the SDK is still blocked
	 * — it can't be interleaved with the tool_result the deny/allow is about
	 * to produce.
	 */
	private notePlanDecision(request: {
		sessionId: string;
		toolName: string;
		input: Record<string, unknown>;
	}) {
		if (request.toolName !== "ExitPlanMode") return;
		const plan = (request.input as { plan?: unknown }).plan;
		// Matches the card's own "(No plan text provided.)" guard: an empty
		// plan would render as a blank assistant bubble, not nothing.
		if (typeof plan === "string" && plan.trim().length > 0) {
			this.onPlanDecision?.(request.sessionId, plan.trim());
		}
	}

	private handleResponse(d: PermissionDecision) {
		const entry = this.pending.get(d.requestId);
		if (!entry) return;
		this.pending.delete(d.requestId);
		this.syncBadge();
		windows.broadcast("permission:resolved", { requestId: d.requestId });
		// The user actively engaged with this session — re-anchor the
		// branch baseline so the red chip clears if they happened to
		// answer the prompt on a different branch than their last message.
		// Fires on both allow and deny — either way they "used" the session.
		this.onUserCheckpoint?.(entry.request.sessionId);
		this.notePlanDecision(entry.request);
		if (d.behavior === "allow") {
			// ExitPlanMode is the plan-approval gate — it must always require an
			// explicit click. Refuse to silently always-allow it even if a UI
			// somewhere mistakenly passes remember=true.
			if (d.remember && entry.request.toolName !== "ExitPlanMode") {
				this.alwaysAllowTools.add(entry.request.toolName);
			}
			entry.resolve({
				behavior: "allow",
				updatedInput: d.updatedInput ?? entry.request.input,
			});
		} else {
			entry.resolve({ behavior: "deny", message: d.message });
		}
	}

	private syncBadge() {
		this.notifications.setPendingCount(this.pending.size);
	}
}
