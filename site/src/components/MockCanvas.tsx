import type { CSSProperties, ReactNode } from "react";
import { cx } from "../lib/cx";

type Props = {
	width: number;
	height: number;
	children: ReactNode;
	className?: string;
};

export function MockCanvas({ width, height, children, className }: Props) {
	const fit: CSSProperties = {
		containerType: "inline-size",
		aspectRatio: `${width} / ${height}`,
	};
	const canvas: CSSProperties = {
		width,
		height,
		transformOrigin: "top left",
		transform: `scale(calc(100cqw / ${width}px))`,
	};
	return (
		<div className={cx("relative w-full overflow-clip", className)} style={fit}>
			<div className="absolute top-0 left-0 text-[13px] text-gc-text" style={canvas}>
				{children}
			</div>
		</div>
	);
}
