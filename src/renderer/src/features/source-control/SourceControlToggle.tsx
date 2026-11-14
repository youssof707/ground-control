import { T } from "../../design/tokens";
import { useSourceControlStore } from "./useSourceControlStore";

export function SourceControlToggle() {
	const open = useSourceControlStore((s) => s.open);
	const setOpen = useSourceControlStore((s) => s.setOpen);

	return (
		<button
			type="button"
			onClick={() => setOpen(!open)}
			aria-pressed={open}
			style={{
				display: "inline-flex",
				alignItems: "center",
				padding: "6px 12px",
				borderRadius: 8,
				fontSize: 13,
				fontWeight: 500,
				color: open ? T.text : T.textMute,
				background: open ? T.surface : "transparent",
				boxShadow: open ? `inset 0 0 0 0.5px ${T.border}` : "none",
				border: "none",
				cursor: "pointer",
				marginRight: 6,
			}}
		>
			Source Control
		</button>
	);
}
