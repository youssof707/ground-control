import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export interface MenuItem {
	label: string;
	danger?: boolean;
	run: () => void;
}

const EDGE = 8;

export function ScmContextMenu({
	x,
	y,
	items,
	disabled,
	onClose,
}: {
	x: number;
	y: number;
	items: MenuItem[];
	disabled: boolean;
	onClose: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(-1);
	const [position, setPosition] = useState({ left: x, top: y });

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		setPosition({
			left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
			top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
		});
		el.focus({ preventScroll: true });
	}, [x, y]);

	useEffect(() => {
		const onDown = (e: MouseEvent): void => {
			if (e.target instanceof Node && ref.current?.contains(e.target)) return;
			onClose();
		};
		const onScroll = (e: Event): void => {
			if (e.target instanceof Node && ref.current?.contains(e.target)) return;
			onClose();
		};
		window.addEventListener("mousedown", onDown, true);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("blur", onClose);
		window.addEventListener("resize", onClose);
		return () => {
			window.removeEventListener("mousedown", onDown, true);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("blur", onClose);
			window.removeEventListener("resize", onClose);
		};
	}, [onClose]);

	const run = (item: MenuItem | undefined): void => {
		if (!item || disabled) return;
		onClose();
		item.run();
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
		const last = items.length - 1;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive(active >= last ? 0 : active + 1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive(active <= 0 ? last : active - 1);
		} else if (e.key === "Home") {
			e.preventDefault();
			setActive(0);
		} else if (e.key === "End") {
			e.preventDefault();
			setActive(last);
		} else if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			run(items[active]);
		} else if (e.key === "Escape" || e.key === "Tab") {
			e.preventDefault();
			e.stopPropagation();
			onClose();
		}
	};

	return (
		<div
			ref={ref}
			className="scm-ctx-menu"
			role="menu"
			tabIndex={-1}
			style={position}
			onKeyDown={onKeyDown}
			onContextMenu={(e) => e.preventDefault()}
			onMouseLeave={() => setActive(-1)}
		>
			{items.map((item, i) => (
				<div
					key={item.label}
					role="menuitem"
					tabIndex={-1}
					aria-disabled={disabled || undefined}
					className={item.danger ? "scm-ctx-item scm-ctx-danger" : "scm-ctx-item"}
					data-active={i === active || undefined}
					onMouseMove={() => {
						if (i !== active) setActive(i);
					}}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => run(item)}
				>
					{item.label}
				</div>
			))}
		</div>
	);
}
