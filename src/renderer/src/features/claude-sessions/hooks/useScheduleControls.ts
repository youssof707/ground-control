import { useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import type { Schedule } from "@shared/schemas/schedules";
import { useSchedulesStore } from "../stores/useSchedulesStore";
import { useSessionsStore } from "../stores/useSessionsStore";
import { useInterruptStore } from "../stores/useInterruptStore";
import { stopScheduledRun } from "../lib/sessionControlActions";

export function scheduleErrorMessage(err: unknown): string {
	const raw = err instanceof Error ? err.message : String(err);
	return raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

export function useScheduleControls(schedule: Schedule) {
	const [error, setError] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);
	const navigate = useNavigate();
	const viewedSessionId = useMatch("/sessions/:id")?.params.id;
	const lastSession = useSessionsStore((s) =>
		schedule.lastSessionId ? s.sessions[schedule.lastSessionId] : undefined,
	);
	const stoppableSessionId =
		lastSession?.status === "running" ||
		lastSession?.status === "awaiting_permission"
			? lastSession.id
			: undefined;
	const running = starting || stoppableSessionId !== undefined;
	const stopping = useInterruptStore((s) =>
		stoppableSessionId ? !!s.interrupting[stoppableSessionId] : false,
	);

	const attempt = async (fn: () => Promise<void>) => {
		setError(null);
		try {
			await fn();
		} catch (err) {
			setError(scheduleErrorMessage(err));
		}
	};

	const setEnabled = (enabled: boolean) =>
		attempt(async () => {
			const updated = await window.claude.setScheduleEnabled(
				schedule.id,
				enabled,
			);
			useSchedulesStore.getState().upsert(updated);
		});

	const setAlwaysShowStatus = (alwaysShowStatus: boolean) =>
		attempt(async () => {
			useSchedulesStore.getState().upsert({ ...schedule, alwaysShowStatus });
			try {
				const updated = await window.claude.setScheduleAlwaysShowStatus(
					schedule.id,
					alwaysShowStatus,
				);
				useSchedulesStore.getState().upsert(updated);
			} catch (err) {
				useSchedulesStore.getState().upsert(schedule);
				throw err;
			}
		});

	const runNow = async () => {
		setStarting(true);
		const viewingPrevious =
			viewedSessionId !== undefined &&
			viewedSessionId === schedule.lastSessionId;
		await attempt(async () => {
			const sessionId = await window.claude.runScheduleNow(schedule.id);
			if (viewingPrevious) navigate(`/sessions/${sessionId}`);
		});
		setStarting(false);
	};

	const stopRun = () =>
		attempt(async () => {
			if (stoppableSessionId) await stopScheduledRun(stoppableSessionId);
		});

	const remove = () =>
		attempt(async () => {
			await window.claude.removeSchedule(schedule.id);
			useSchedulesStore.getState().remove(schedule.id);
		});

	const clearStatus = () =>
		attempt(async () => {
			useSchedulesStore.getState().upsert({ ...schedule, status: undefined });
			await window.claude.clearScheduleStatus(schedule.id);
		});

	return {
		error,
		lastSession,
		running,
		stopping,
		canStop: stoppableSessionId !== undefined,
		setEnabled,
		setAlwaysShowStatus,
		runNow,
		stopRun,
		remove,
		clearStatus,
	};
}
