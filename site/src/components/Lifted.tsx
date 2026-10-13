import type { CSSProperties, ReactNode } from "react";
import { cx } from "../lib/cx";

type Props = {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
};

export function Lifted({ children, className, style }: Props) {
	return (
		<div
			className={cx("rounded-[20px] bg-white/[0.09] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]", className)}
			style={style}
		>
			{children}
		</div>
	);
}
