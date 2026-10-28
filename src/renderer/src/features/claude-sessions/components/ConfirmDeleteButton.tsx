import {
	useEffect,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
} from "react";
import { T } from "../../../design/tokens";

const CONFIRM_REVERT_MS = 3000;

export function ConfirmDeleteButton({
	label,
	onDelete,
}: {
	label: string;
	onDelete: () => Promise<void>;
}) {
	const [confirming, setConfirming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);
	useEffect(() => {
		return () => {
			mountedRef.current = false;
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);
	const handleClick = async (e: ReactMouseEvent<HTMLButtonElement>) => {
		e.stopPropagation();
		if (deleting) return;
		if (!confirming) {
			setConfirming(true);
			timerRef.current = setTimeout(() => {
				setConfirming(false);
				timerRef.current = null;
			}, CONFIRM_REVERT_MS);
			return;
		}
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		setConfirming(false);
		setDeleting(true);
		try {
			await onDelete();
		} catch {
			return;
		} finally {
			if (mountedRef.current) setDeleting(false);
		}
	};
	const pillStyle = {
		padding: "4px 10px",
		borderRadius: 6,
		border: `0.5px solid ${T.dangerBorder}`,
		background: T.dangerSoft,
		color: T.danger,
		fontSize: 11.5,
		fontWeight: 500,
		fontFamily: T.sans,
		lineHeight: 1.2,
		flexShrink: 0,
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
	} as const;
	if (deleting) {
		return (
			<button
				type="button"
				disabled
				aria-busy
				aria-label={`Deleting ${label}`}
				style={{ ...pillStyle, cursor: "default" }}
			>
				<span className="asyncy-btn-spinner" aria-hidden />
			</button>
		);
	}
	if (confirming) {
		return (
			<button
				type="button"
				onClick={handleClick}
				aria-label={`Confirm delete ${label}`}
				style={{ ...pillStyle, cursor: "pointer" }}
			>
				Confirm delete?
			</button>
		);
	}
	return (
		<button
			type="button"
			onClick={handleClick}
			aria-label={`Delete ${label}`}
			style={{
				width: 24,
				height: 24,
				padding: 0,
				borderRadius: 6,
				border: "none",
				background: "transparent",
				color: T.textMute,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				cursor: "pointer",
				flexShrink: 0,
			}}
		>
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
				<path
					d="M2.5 3.5h9M5.5 3.5V2.5h3v1M3.5 3.5l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8M6 6v4M8 6v4"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</button>
	);
}
