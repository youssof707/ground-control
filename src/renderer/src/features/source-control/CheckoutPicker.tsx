import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface PickerOption {
	value: string;
	name: string;
	tag?: string;
	detail?: string;
}

function ChevronIcon() {
	return (
		<svg className="scm-picker-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
			<path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
			<path d="M2.5 6.2L5 8.6L9.5 3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function CheckoutPicker({
	value,
	options,
	onChange,
	label,
}: {
	value: string;
	options: PickerOption[];
	onChange: (value: string) => void;
	label: string;
}) {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const baseId = useId();
	const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
	const current = options[selectedIndex];

	useEffect(() => {
		if (!open) return;
		menuRef.current?.focus({ preventScroll: true });
		const onDown = (e: MouseEvent): void => {
			if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
			setOpen(false);
		};
		const onBlur = (): void => setOpen(false);
		document.addEventListener("mousedown", onDown, true);
		window.addEventListener("blur", onBlur);
		return () => {
			document.removeEventListener("mousedown", onDown, true);
			window.removeEventListener("blur", onBlur);
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;
		menuRef.current
			?.querySelector<HTMLElement>(`[data-index="${active}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [open, active]);

	const show = (index: number): void => {
		setActive(index);
		setOpen(true);
	};

	const dismiss = (): void => {
		setOpen(false);
		triggerRef.current?.focus({ preventScroll: true });
	};

	const choose = (index: number): void => {
		const option = options[index];
		dismiss();
		if (option && option.value !== value) onChange(option.value);
	};

	const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			show(selectedIndex);
		}
	};

	const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
		const last = options.length - 1;
		const moves: Record<string, number> = {
			ArrowDown: Math.min(last, active + 1),
			ArrowUp: Math.max(0, active - 1),
			Home: 0,
			End: last,
			PageDown: Math.min(last, active + 8),
			PageUp: Math.max(0, active - 8),
		};
		if (e.key in moves) {
			e.preventDefault();
			setActive(moves[e.key]);
		} else if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			choose(active);
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			dismiss();
		} else if (e.key === "Tab") {
			setOpen(false);
		}
	};

	return (
		<div ref={rootRef} className="scm-picker">
			<button
				ref={triggerRef}
				type="button"
				className="scm-picker-trigger"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={`${label}: ${current?.name ?? ""}`}
				onClick={() => (open ? dismiss() : show(selectedIndex))}
				onKeyDown={onTriggerKeyDown}
			>
				<span className="scm-picker-name">{current?.name}</span>
				<ChevronIcon />
			</button>
			{open ? (
				<div
					ref={menuRef}
					className="scm-picker-menu"
					role="listbox"
					tabIndex={-1}
					aria-label={label}
					aria-activedescendant={`${baseId}-${active}`}
					onKeyDown={onMenuKeyDown}
				>
					{options.map((option, index) => (
						<div
							key={option.value}
							id={`${baseId}-${index}`}
							data-index={index}
							role="option"
							aria-selected={index === selectedIndex}
							data-active={index === active}
							className="scm-picker-option"
							onMouseMove={() => {
								if (index !== active) setActive(index);
							}}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => choose(index)}
						>
							<span className="scm-picker-check">{index === selectedIndex ? <CheckIcon /> : null}</span>
							<span className="scm-picker-name">{option.name}</span>
							{option.tag ? <span className="scm-picker-tag">{option.tag}</span> : null}
							{option.detail ? <span className="scm-picker-ref">{option.detail}</span> : null}
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
