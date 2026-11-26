import { useMatch } from "react-router-dom";
import { T } from "../../../design/tokens";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { isSidequestId } from "../stores/useSidequestsStore";
import {
	useActiveRightPanel,
	useRightPanelStore,
} from "../stores/useRightPanelStore";

export function InboxButton() {
	const activeSessionId = useMatch("/sessions/:id/*")?.params.id;
	const active = useActiveRightPanel(activeSessionId) === "inbox";
	const inboxOpen = useRightPanelStore((s) => s.inboxOpen);
	const badge = usePermissionsStore(
		(s) => s.queue.filter((q) => !isSidequestId(q.sessionId)).length,
	);

	return (
		<button
			type="button"
			className="btn"
			aria-label={badge > 0 ? `Inbox, ${badge} waiting` : "Inbox"}
			aria-pressed={active}
			onClick={() => useRightPanelStore.getState().setInboxOpen(!inboxOpen)}
			style={{
				position: "relative",
				width: 32,
				padding: 0,
				color: active ? T.text : T.textDim,
				background: active ? T.surfaceHi : undefined,
			}}
		>
			<InboxIcon />
			{badge > 0 ? (
				<span
					style={{
						position: "absolute",
						top: -4,
						right: -4,
						minWidth: 16,
						height: 16,
						padding: "0 4px",
						borderRadius: 8,
						background: T.warn,
						color: T.bg,
						fontSize: 10,
						fontWeight: 700,
						lineHeight: "16px",
						textAlign: "center",
						fontVariantNumeric: "tabular-nums",
						boxSizing: "border-box",
						pointerEvents: "none",
					}}
				>
					{badge > 99 ? "99+" : badge}
				</span>
			) : null}
		</button>
	);
}

function InboxIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
			<path
				d="M1.75 7.6l1.6-4.4a1.2 1.2 0 0 1 1.13-.8h5.04a1.2 1.2 0 0 1 1.13.8l1.6 4.4v2.8a1.2 1.2 0 0 1-1.2 1.2H2.95a1.2 1.2 0 0 1-1.2-1.2V7.6z"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
			<path
				d="M1.75 7.6h2.9l.7 1.4h3.3l.7-1.4h2.9"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
