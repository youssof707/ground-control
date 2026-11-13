import { AUTO_RESUME_TEXT } from "@shared/claude-sessions/transcript";
import type {
	PermissionRequest,
	SessionMessage,
} from "@shared/claude-sessions/types";
import { useDraftStore, type Draft } from "../stores/useDraftStore";
import {
	useModelPickerStore,
	type NextMessageModel,
} from "../stores/useModelPickerStore";
import { useQueuedMessagesStore } from "../stores/useQueuedMessagesStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useSidequestsStore } from "../stores/useSidequestsStore";
import { blocksOf } from "./messageContent";
import { sendToSidequest } from "./sidequestActions";
import { sendTurn } from "./sendTurn";

export function draftHasContent(draft: Draft | undefined): boolean {
	return !!draft && (draft.text.trim() !== "" || draft.images.length > 0);
}

export function composerHasContent(sessionId: string): boolean {
	return draftHasContent(useDraftStore.getState().draftsBySession[sessionId]);
}

export async function applyModelForMessage(
	sessionId: string,
	next: NextMessageModel | undefined,
): Promise<void> {
	if (!next) return;
	await useModelPickerStore
		.getState()
		.runSwitch(sessionId, next.model, () =>
			window.claude.setSessionModel(sessionId, next.model),
		);
	if (useModelPickerStore.getState().failed[sessionId]) {
		throw new Error("Couldn't switch model");
	}
}

export async function switchModelAndResume(
	sessionId: string,
	model: string | undefined,
): Promise<void> {
	useQueuedMessagesStore.getState().hold(sessionId);
	try {
		await window.claude.interruptSession(sessionId, {
			keepBackgroundTasks: true,
		});
		await window.claude.setSessionModel(sessionId, model);
		await sendTurn(sessionId, [{ type: "text", text: AUTO_RESUME_TEXT }]);
	} finally {
		useQueuedMessagesStore.getState().release(sessionId);
	}
}

export async function switchSidequestModelAndResume(
	parentSessionId: string,
	sidequestId: string,
	model: string | undefined,
): Promise<void> {
	useQueuedMessagesStore.getState().hold(sidequestId);
	try {
		await window.claude.interruptSession(sidequestId, {
			keepBackgroundTasks: true,
		});
		await window.claude.setSessionModel(sidequestId, model);
		const landedIn = await sendToSidequest(parentSessionId, sidequestId, [
			{ type: "text", text: AUTO_RESUME_TEXT },
		]);
		if (!landedIn) throw new Error("Couldn't start a sidequest to send to");
	} finally {
		useQueuedMessagesStore.getState().release(sidequestId);
	}
}

const DEFERRED_SWITCH_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
const TOOL_RESULT_WAIT_MS = 4000;

export function defersModelSwitch(toolName: string): boolean {
	return DEFERRED_SWITCH_TOOLS.has(toolName);
}

function sidequestFor(sidequestId: string) {
	return Object.values(useSidequestsStore.getState().byParent).find(
		(sq) => sq.sidequestId === sidequestId,
	);
}

function messagesFor(sessionId: string): SessionMessage[] {
	return (
		useSessionsStore.getState().sessions[sessionId]?.messages
		?? sidequestFor(sessionId)?.messages
		?? []
	);
}

function toolResultCount(sessionId: string, toolName: string): number {
	const toolUseIds = new Set<string>();
	let count = 0;
	for (const m of messagesFor(sessionId)) {
		for (const block of blocksOf(m)) {
			if (
				block.type === "tool_use"
				&& block.name === toolName
				&& typeof block.id === "string"
			) {
				toolUseIds.add(block.id);
			} else if (
				block.type === "tool_result"
				&& typeof block.tool_use_id === "string"
				&& toolUseIds.has(block.tool_use_id)
			) {
				count++;
			}
		}
	}
	return count;
}

function waitForToolResult(
	sessionId: string,
	toolName: string,
	before: number,
): Promise<void> {
	return new Promise((resolve) => {
		const check = () => {
			if (toolResultCount(sessionId, toolName) <= before) return;
			finish();
		};
		const unsubSessions = useSessionsStore.subscribe(check);
		const unsubSidequests = useSidequestsStore.subscribe(check);
		const timer = setTimeout(() => finish(), TOOL_RESULT_WAIT_MS);
		function finish() {
			clearTimeout(timer);
			unsubSessions();
			unsubSidequests();
			resolve();
		}
		check();
	});
}

async function resumeOnModel(
	sessionId: string,
	model: string | undefined,
): Promise<void> {
	const sidequest = sidequestFor(sessionId);
	if (sidequest) {
		await switchSidequestModelAndResume(
			sidequest.parentSessionId,
			sessionId,
			model,
		);
		return;
	}
	await switchModelAndResume(sessionId, model);
}

export function respondApplyingDeferredModel(
	req: PermissionRequest,
	respond: () => void,
): void {
	const picker = useModelPickerStore.getState();
	const deferred = defersModelSwitch(req.toolName)
		? picker.takeNextMessageModel(req.sessionId)
		: undefined;
	if (!deferred) {
		respond();
		return;
	}
	const before = toolResultCount(req.sessionId, req.toolName);
	respond();
	void picker.runSwitch(req.sessionId, deferred.model, async () => {
		await waitForToolResult(req.sessionId, req.toolName, before);
		await resumeOnModel(req.sessionId, deferred.model);
	});
}
