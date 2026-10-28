import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Schedule } from "@shared/schemas/schedules";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { TabStrip } from "../../../design/TabStrip";
import { T } from "../../../design/tokens";
import {
	useSchedulerModalStore,
	type SchedulerTab,
} from "../stores/useSchedulerModalStore";
import { useSchedulesStore } from "../stores/useSchedulesStore";
import {
	ScheduleFormFields,
	draftFromSchedule,
	validateDraft,
	type ScheduleDraft,
} from "./ScheduleForm";
import { SchedulesPanel } from "./SchedulesPanel";
import { CountPill } from "./SchedulerButton";
import { ModelPickerModal } from "./ModelPickerModal";
import { useScheduledUnreadIds } from "../hooks/useScheduledUnreadIds";
import { useReadStore } from "../stores/useReadStore";
import { ScheduledSessionsPanel } from "./ScheduledSessionsPanel";

const NOW_TICK_MS = 30_000;

type View =
	| { kind: "list" }
	| { kind: "create" }
	| { kind: "edit"; schedule: Schedule };

function useNowTick(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(timer);
	}, [intervalMs]);
	return now;
}

function errorMessage(err: unknown): string {
	const raw = err instanceof Error ? err.message : String(err);
	return raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

export function SchedulerModal() {
	const openTab = useSchedulerModalStore((s) => s.openTab);
	const close = useSchedulerModalStore((s) => s.close);
	if (!openTab) return null;
	return <SchedulerDialog key={openTab} initialTab={openTab} onClose={close} />;
}

function SchedulerDialog({
	initialTab,
	onClose,
}: {
	initialTab: SchedulerTab;
	onClose: () => void;
}) {
	const [tab, setTab] = useState<SchedulerTab>(initialTab);
	const [view, setView] = useState<View>({ kind: "list" });
	const [draft, setDraft] = useState<ScheduleDraft>(() => draftFromSchedule());
	const [busy, setBusy] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const modelPickerOpenRef = useRef(false);
	modelPickerOpenRef.current = modelPickerOpen;
	const [error, setError] = useState<string | null>(null);
	const now = useNowTick(NOW_TICK_MS);
	const unreadIds = useScheduledUnreadIds();
	const markAllRead = useReadStore((s) => s.markAllRead);
	const navigate = useNavigate();
	const openCreate = () => {
		setDraft(draftFromSchedule());
		setError(null);
		setView({ kind: "create" });
	};
	const openEdit = (schedule: Schedule) => {
		setDraft(draftFromSchedule(schedule));
		setError(null);
		setView({ kind: "edit", schedule });
	};
	const backToList = () => {
		if (busy) return;
		setError(null);
		setView({ kind: "list" });
	};
	const openSession = (sessionId: string) => {
		navigate(`/sessions/${sessionId}`);
		onClose();
	};

	const validation = validateDraft(draft);
	const canSave = view.kind !== "list" && validation.ok && !busy;

	const save = async () => {
		if (view.kind === "list" || !validation.ok || busy) return;
		setBusy(true);
		setError(null);
		try {
			if (view.kind === "create") {
				const created = await window.claude.createSchedule(validation.input);
				useSchedulesStore.getState().upsert(created);
			} else {
				const updated = await window.claude.updateSchedule({
					id: view.schedule.id,
					...validation.input,
				});
				useSchedulesStore.getState().upsert(updated);
			}
			setView({ kind: "list" });
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	const submitRef = useRef<(() => void) | null>(null);
	submitRef.current = canSave ? () => void save() : null;
	const escapeRef = useRef<() => void>(() => {});
	escapeRef.current = view.kind === "list" ? onClose : backToList;

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (modelPickerOpenRef.current) return;
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				escapeRef.current();
				return;
			}
			if (e.key === "Enter" && e.metaKey && !e.ctrlKey && !e.altKey) {
				if (!submitRef.current) return;
				e.preventDefault();
				e.stopPropagation();
				submitRef.current();
			}
		};
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, []);

	const backdropProps = useBackdropDismiss(
		busy || modelPickerOpen ? undefined : onClose,
	);

	const title =
		view.kind === "list"
			? "Scheduler"
			: view.kind === "create"
				? "New schedule"
				: "Edit schedule";

	return (
		<>
			<div className="modal-backdrop" {...backdropProps}>
				<div
					className="modal-card"
					role="dialog"
					aria-modal="true"
					aria-labelledby="scheduler-title"
					style={{
						width: "min(560px, calc(100vw - 32px))",
						height: "min(640px, calc(91vh - 24px))",
						alignSelf: "flex-start",
						marginTop: "9vh",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
						boxSizing: "border-box",
					}}
				>
					<h2 id="scheduler-title" className="modal-title" style={{ margin: 0 }}>
						{title}
					</h2>

					{view.kind === "list" ? (
						<TabStrip
							idPrefix="scheduler"
							ariaLabel="Scheduler sections"
							value={tab}
							onChange={setTab}
							tabs={[
								{ id: "schedules", label: "Schedules" },
								{
									id: "sessions",
									label: "Logs",
									badge:
									unreadIds.length > 0 ? (
										<CountPill
											n={unreadIds.length}
											fg={T.accent}
											bg={T.accentSoft}
										/>
									) : null,
								},
							]}
						/>
					) : (
						<div
							style={{
								margin: "14px -22px 0",
								borderBottom: `0.5px solid ${T.border}`,
							}}
						/>
					)}

					<div
						role={view.kind === "list" ? "tabpanel" : undefined}
						aria-labelledby={
							view.kind === "list" ? `scheduler-tab-${tab}` : undefined
						}
						style={{
							flex: 1,
							minHeight: 0,
							overflowY: "auto",
							margin: "0 -22px",
							padding: "18px 22px 4px",
						}}
					>
						{view.kind !== "list" ? (
							<ScheduleFormFields
								value={draft}
								onChange={setDraft}
								onPickModel={() => setModelPickerOpen(true)}
								disabled={busy}
							/>
						) : tab === "schedules" ? (
							<SchedulesPanel
								now={now}
								onEdit={openEdit}
								onOpenSession={openSession}
							/>
						) : (
							<ScheduledSessionsPanel onOpenSession={openSession} />
						)}
					</div>

					{error ? (
						<div className="modal-error" style={{ marginTop: 10 }}>
							{error}
						</div>
					) : null}

					<div
						className="modal-actions"
						style={{
							margin: "0 -22px",
							padding: "14px 22px 0",
							borderTop: `0.5px solid ${T.borderSoft}`,
						}}
					>
						{view.kind === "list" ? (
							<>
								{tab === "schedules" ? (
									<button
										className="btn btn-primary"
										onClick={openCreate}
										style={{ marginRight: "auto" }}
									>
										New schedule
									</button>
								) : (
									<button
										className="btn"
										onClick={() => markAllRead(unreadIds)}
										disabled={unreadIds.length === 0}
										style={{ marginRight: "auto" }}
									>
										Mark all as read
									</button>
								)}
								<button className="btn" onClick={onClose}>
									Done
								</button>
							</>
						) : (
							<>
								<button className="btn" onClick={backToList} disabled={busy}>
									Cancel
								</button>
								<button
									className="btn btn-primary"
									onClick={() => void save()}
									disabled={!canSave}
								>
									{busy ? (
										<span className="asyncy-btn-spinner" aria-hidden />
									) : view.kind === "create" ? (
										"Create"
									) : (
										"Save"
									)}
								</button>
							</>
						)}
					</div>
				</div>
			</div>
			<ModelPickerModal
				open={modelPickerOpen}
				effectiveModel={draft.model}
				subtitle="Used for every run of this schedule."
				focusComposerAfterSelect={false}
				onSelect={(model) => setDraft((d) => ({ ...d, model }))}
				onClose={() => setModelPickerOpen(false)}
			/>
		</>
	);
}
