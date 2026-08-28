import { useEffect, useRef, useState, type CSSProperties } from "react";
import { T } from "../../../design/tokens";

/**
 * The floating "working ⟳ 32s" chip shown over a live transcript. Shared by
 * the main chat (`SessionChat`) and the sidequest panel so working state
 * looks identical in both — same spinner, same mono label, same easter egg.
 *
 * `session` is structural on purpose: the main chat passes a store session,
 * the sidequest panel passes its in-memory `SidequestState` (which has the
 * same three fields but no store row).
 */
export function ActivityChip({
	session,
	hasPending,
}: {
	session: { messages: { ts: number }[]; createdAt: number; status: string };
	hasPending: boolean;
}) {
	// Self-contained per-second tick so only this chip re-renders, not the
	// whole transcript tree (which would re-run react-markdown +
	// rehype-highlight for every message every second).
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(id);
	}, []);

	// Easter egg: click the chip to launch a tiny firework burst.
	const [bursts, setBursts] = useState<
		{
			id: number;
			particles: {
				tx: number;
				ty: number;
				color: string;
				size: number;
				delay: number;
				duration: number;
			}[];
		}[]
	>([]);
	const burstIdRef = useRef(0);
	const lastBurstAtRef = useRef(0);
	const handleFireworks = () => {
		const now = Date.now();
		if (now - lastBurstAtRef.current < 200) return; // throttle: ignore rapid re-clicks
		lastBurstAtRef.current = now;
		const id = ++burstIdRef.current;
		const palette = [
			"#ff6b9d",
			"#ffd166",
			"#06d6a0",
			"#4cc9f0",
			"#c77dff",
			"#ff9f43",
			"#ef476f",
		];
		const count = 14;
		const particles = Array.from({ length: count }, (_, i) => {
			// Even angular distribution with jitter
			const angle =
				(i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
			const distance = 32 + Math.random() * 32;
			return {
				tx: Math.cos(angle) * distance,
				ty: Math.sin(angle) * distance,
				color: palette[Math.floor(Math.random() * palette.length)],
				size: 3 + Math.random() * 2,
				delay: Math.random() * 60,
				duration: 750 + Math.random() * 350,
			};
		});
		setBursts((b) => [...b, { id, particles }]);
		window.setTimeout(() => {
			setBursts((b) => b.filter((x) => x.id !== id));
		}, 1300);
	};

	if (hasPending) return null;
	if (session.status === "idle") return null;

	const last =
		session.messages.length > 0
			? session.messages[session.messages.length - 1].ts
			: session.createdAt;
	const deltaSec = Math.max(0, Math.floor((Date.now() - last) / 1000));

	// Single muted neutral look — the active/quiet/stalled distinction is
	// just a wall-clock heuristic with no real liveness signal, so we drop it.
	const color = "oklch(0.55 0.008 70)";
	const border = "oklch(0.55 0.008 70 / 0.55)";
	const prefix = "working";

	return (
		<div
			onClick={handleFireworks}
			style={{
				position: "relative",
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 9px",
				borderRadius: 11,
				background: T.surface,
				border: `0.5px solid ${border}`,
				color,
				fontSize: 11.5,
				fontFamily: T.mono,
				fontVariantNumeric: "tabular-nums",
				cursor: "pointer",
				userSelect: "none",
			}}
		>
			<span
				aria-hidden
				style={{
					display: "inline-block",
					width: 9,
					height: 9,
					border: "1.5px solid currentColor",
					borderRightColor: "transparent",
					borderRadius: "50%",
					animation: "asyncy-spin 0.9s linear infinite",
				}}
			/>
			{prefix} {formatDelta(deltaSec)}

			{bursts.map((b) =>
				b.particles.map((p, i) => (
					<span
						key={`${b.id}-${i}`}
						aria-hidden
						style={
							{
								position: "absolute",
								left: "50%",
								top: "50%",
								width: p.size,
								height: p.size,
								background: p.color,
								borderRadius: "50%",
								pointerEvents: "none",
								boxShadow: `0 0 6px ${p.color}`,
								animation: `firework-particle ${p.duration}ms cubic-bezier(0.18, 0.7, 0.3, 1) ${p.delay}ms forwards`,
								"--fx-tx": `${p.tx}px`,
								"--fx-ty": `${p.ty}px`,
							} as CSSProperties
						}
					/>
				)),
			)}
		</div>
	);
}

function formatDelta(sec: number): string {
	if (sec < 5) return "now";
	if (sec < 60) return `${sec}s`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
	return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
