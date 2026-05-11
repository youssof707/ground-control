import { useCallback, useEffect, useState } from "react";
import { useSessionNotesStore } from "../../stores/useSessionNotesStore";
import { NoteCard } from "./NoteCard";
import { T } from "../../../../design/tokens";

/**
 * Right-side panel listing all notes for the active session. Mirrors
 * InboxSidebar's chrome (header + scroll body + close X) but is wrapped
 * by NotesSidebarShell which owns the resize handle and the outer width.
 *
 * Hydration is **per-session and lazy** — we fetch on mount and refetch
 * on `state:changed` rather than embedding notes hydration in the global
 * bootstrap. Notes don't surface anywhere outside this panel, so global
 * hydration would be wasted work and would amplify multi-window churn.
 */
export function SessionNotesPanel({
	sessionId,
	onClose,
}: {
	sessionId: string;
	onClose: () => void;
}) {
	const notes = useSessionNotesStore(
		(s) => s.notesBySession[sessionId] ?? EMPTY,
	);
	const hydrateForSession = useSessionNotesStore((s) => s.hydrateForSession);
	const createNote = useSessionNotesStore((s) => s.createNote);

	const [refreshError, setRefreshError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const fresh = await window.claude.listNotes(sessionId);
			hydrateForSession(sessionId, fresh);
			setRefreshError(null);
		} catch (err) {
			setRefreshError(
				err instanceof Error ? err.message : "Failed to load notes",
			);
		}
	}, [sessionId, hydrateForSession]);

	// Initial fetch + cross-window sync. Listener cleanup is critical — the
	// panel can be re-mounted on every toggle and we don't want stacked
	// listeners.
	useEffect(() => {
		void refresh();
		const off = window.claude.on("state:changed", () => {
			void refresh();
		});
		return () => {
			off();
		};
	}, [refresh]);

	const onAdd = async () => {
		try {
			await createNote(sessionId);
		} catch (err) {
			setRefreshError(
				err instanceof Error ? err.message : "Failed to create note",
			);
		}
	};

	return (
		<div
			style={{
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column",
				background: T.win,
			}}
		>
			<header
				style={{
					flexShrink: 0,
					padding: "20px 20px 16px",
					display: "flex",
					alignItems: "flex-start",
					justifyContent: "space-between",
					gap: 12,
				}}
			>
				<div style={{ minWidth: 0 }}>
					<h1
						style={{
							margin: 0,
							fontSize: 20,
							fontWeight: 600,
							color: T.text,
							letterSpacing: "-0.3px",
						}}
					>
						Notes
					</h1>
				</div>
				<div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
					<button
						type="button"
						onClick={onAdd}
						style={{
							padding: "6px 12px",
							borderRadius: 8,
							border: `0.5px solid ${T.border}`,
							background: T.surface,
							color: T.text,
							fontSize: 12.5,
							fontWeight: 500,
							cursor: "pointer",
							fontFamily: T.sans,
						}}
					>
						+ Add note
					</button>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close notes"
						style={{
							flexShrink: 0,
							width: 28,
							height: 28,
							borderRadius: 8,
							border: `0.5px solid ${T.border}`,
							background: T.surface,
							color: T.textDim,
							cursor: "pointer",
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
							<path
								d="M3 3l6 6M9 3l-6 6"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>
			</header>

			<div
				style={{
					flex: 1,
					overflow: "auto",
					minHeight: 0,
					padding: "16px 16px 24px",
				}}
			>
				{refreshError ? (
					<div
						style={{
							fontSize: 12,
							color: T.danger,
							background: T.dangerSoft,
							border: `0.5px solid ${T.dangerBorder}`,
							padding: 10,
							borderRadius: 8,
							marginBottom: 12,
						}}
					>
						{refreshError}
					</div>
				) : null}
				{notes.length === 0 ? (
					<div
						style={{
							fontSize: 12.5,
							color: T.textMute,
							padding: "20px 16px",
							textAlign: "center",
							lineHeight: 1.5,
						}}
					>
						Notes are private to this session. Click <b>+ Add note</b> to start.
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
						{notes.map((n) => (
							<NoteCard key={n.id} note={n} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

// Stable empty array — passing `[]` inline would re-create the reference on
// every render and force consumers to re-run effects depending on it.
const EMPTY: never[] = [];
