import { T } from "./tokens";

export function Switch({
	checked,
	onChange,
	label,
	disabled,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			style={{
				flexShrink: 0,
				width: 30,
				height: 18,
				padding: 2,
				borderRadius: 9,
				border: `0.5px solid ${checked ? T.ok : T.border}`,
				background: checked ? T.ok : T.surfaceLow,
				cursor: disabled ? "default" : "pointer",
				opacity: disabled ? 0.5 : 1,
				transition: "background 120ms ease, border-color 120ms ease",
				outline: "none",
			}}
		>
			<span
				style={{
					display: "block",
					width: 12,
					height: 12,
					borderRadius: 6,
					background: checked ? T.bg : T.textDim,
					transform: `translateX(${checked ? 12 : 0}px)`,
					transition: "transform 120ms ease, background 120ms ease",
				}}
			/>
		</button>
	);
}
