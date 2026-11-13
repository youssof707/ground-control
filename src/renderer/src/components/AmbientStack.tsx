import type { ReactNode } from "react";

export function AmbientStack({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				position: "fixed",
				left: 16,
				bottom: 56,
				zIndex: 90,
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-start",
				gap: 8,
				userSelect: "none",
				pointerEvents: "none",
			}}
		>
			{children}
		</div>
	);
}
