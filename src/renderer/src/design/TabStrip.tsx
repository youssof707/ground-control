import { useState } from "react";
import { T } from "./tokens";

export interface TabSpec<K extends string> {
	id: K;
	label: string;
	accent?: string;
	indicator?: boolean;
	indicatorSoft?: string;
}

export function TabStrip<K extends string>({
	ariaLabel,
	idPrefix,
	tabs,
	value,
	onChange,
}: {
	ariaLabel: string;
	idPrefix: string;
	tabs: readonly TabSpec<K>[];
	value: K;
	onChange: (tab: K) => void;
}) {
	return (
		<div
			role="tablist"
			aria-label={ariaLabel}
			style={{
				display: "flex",
				gap: 20,
				margin: "14px -22px 0",
				padding: "0 22px",
				borderBottom: `0.5px solid ${T.border}`,
			}}
		>
			{tabs.map((t) => (
				<Tab
					key={t.id}
					id={`${idPrefix}-tab-${t.id}`}
					label={t.label}
					active={value === t.id}
					accent={t.accent ?? T.text}
					indicator={t.indicator}
					indicatorSoft={t.indicatorSoft}
					onClick={() => onChange(t.id)}
				/>
			))}
		</div>
	);
}

function Tab({
	id,
	label,
	active,
	accent,
	onClick,
	indicator,
	indicatorSoft,
}: {
	id: string;
	label: string;
	active: boolean;
	accent: string;
	onClick: () => void;
	indicator?: boolean;
	indicatorSoft?: string;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			role="tab"
			id={id}
			aria-selected={active}
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				position: "relative",
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				appearance: "none",
				border: "none",
				background: "none",
				padding: "10px 0 11px",
				fontFamily: "inherit",
				fontSize: 13,
				fontWeight: active ? 600 : 500,
				color: active || hover ? T.text : T.textDim,
				cursor: "pointer",
				transition: "color 80ms ease",
			}}
		>
			{label}
			{indicator ? (
				<span
					aria-hidden
					style={{
						width: 6,
						height: 6,
						borderRadius: "50%",
						background: accent,
						boxShadow: `0 0 0 3px ${indicatorSoft ?? `color-mix(in oklab, ${accent} 18%, transparent)`}`,
					}}
				/>
			) : null}
			<span
				aria-hidden
				style={{
					position: "absolute",
					left: 0,
					right: 0,
					bottom: -0.5,
					height: 2,
					borderRadius: 1,
					background: accent,
					opacity: active ? 1 : 0,
					transform: active ? "scaleX(1)" : "scaleX(0.6)",
					transition: "opacity 120ms ease, transform 120ms ease",
				}}
			/>
		</button>
	);
}
