import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { TerminalConfig } from "@shared/schemas/terminals";
import { T } from "../../../design/tokens";
import { useInlineConfirm } from "../hooks/useInlineConfirm";
import {
	type TerminalGroup,
	groupLabel,
	useTerminalsStore,
} from "../stores/useTerminalsStore";

const SAVED_FLASH_MS = 1500;

const HEADER_BUTTON = {
	height: 26,
	padding: "0 10px",
	fontSize: 12,
} as const;

const ICON_BUTTON = {
	...HEADER_BUTTON,
	display: "inline-flex",
	alignItems: "center",
	gap: 6,
} as const;

type Anchor = { top: number; left: number };

function useAnchoredPopover(buttonRef: RefObject<HTMLButtonElement | null>) {
	const [anchor, setAnchor] = useState<Anchor | null>(null);
	const popoverRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!anchor) return;
		const onDocMouseDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (popoverRef.current?.contains(target)) return;
			if (buttonRef.current?.contains(target)) return;
			setAnchor(null);
		};
		const onResize = () => setAnchor(null);
		document.addEventListener("mousedown", onDocMouseDown);
		window.addEventListener("resize", onResize);
		return () => {
			document.removeEventListener("mousedown", onDocMouseDown);
			window.removeEventListener("resize", onResize);
		};
	}, [anchor, buttonRef]);

	const toggle = (): boolean => {
		if (anchor) {
			setAnchor(null);
			return false;
		}
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect) return false;
		setAnchor({ top: rect.bottom + 4, left: rect.right });
		return true;
	};

	return { anchor, popoverRef, toggle, close: () => setAnchor(null) };
}

function Popover({
	anchor,
	popoverRef,
	width,
	children,
}: {
	anchor: Anchor;
	popoverRef: RefObject<HTMLDivElement | null>;
	width: number;
	children: ReactNode;
}) {
	return createPortal(
		<div
			ref={popoverRef}
			style={{
				position: "fixed",
				top: anchor.top,
				left: anchor.left,
				transform: "translateX(-100%)",
				width,
				maxHeight: 320,
				overflowY: "auto",
				background: T.surfaceHi,
				border: `0.5px solid ${T.border}`,
				borderRadius: 8,
				padding: 4,
				zIndex: 1000,
				boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
			}}
		>
			{children}
		</div>,
		document.body,
	);
}

export function SaveConfigButton({ group }: { group: TerminalGroup }) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const popover = useAnchoredPopover(buttonRef);
	const [name, setName] = useState("");
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		if (!saved) return;
		const timer = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
		return () => clearTimeout(timer);
	}, [saved]);

	const open = () => {
		if (popover.toggle()) setName(groupLabel(group));
	};

	const save = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		popover.close();
		void useTerminalsStore
			.getState()
			.saveConfig(group.id, trimmed)
			.then((ok) => setSaved(ok));
	};

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				className="btn btn-ghost"
				onClick={open}
				style={{ ...ICON_BUTTON, color: saved ? T.ok : undefined }}
			>
				{saved ? <CheckIcon /> : <SaveIcon />}
				{saved ? "Saved" : "Save Config"}
			</button>
			{popover.anchor ? (
				<Popover
					anchor={popover.anchor}
					popoverRef={popover.popoverRef}
					width={240}
				>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							save();
						}}
						style={{ display: "flex", gap: 4 }}
					>
						<input
							autoFocus
							value={name}
							aria-label="Config name"
							onFocus={(e) => e.currentTarget.select()}
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Escape") popover.close();
							}}
							style={{
								flex: 1,
								minWidth: 0,
								height: 26,
								padding: "0 8px",
								borderRadius: 5,
								border: `0.5px solid ${T.border}`,
								background: T.surface,
								color: T.text,
								fontFamily: "inherit",
								fontSize: 12,
								outline: "none",
							}}
						/>
						<button
							type="submit"
							className="btn btn-primary"
							disabled={!name.trim()}
							style={HEADER_BUTTON}
						>
							Save
						</button>
					</form>
				</Popover>
			) : null}
		</>
	);
}

export function LoadConfigButton({ group }: { group: TerminalGroup }) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const popover = useAnchoredPopover(buttonRef);
	const [configs, setConfigs] = useState<TerminalConfig[] | null>(null);
	const cwd = group.terminals[0]?.cwd;

	const open = () => {
		if (!popover.toggle()) return;
		setConfigs(null);
		void window.claude
			.listTerminalConfigs()
			.then((all) => setConfigs(all.filter((c) => c.cwd === cwd)));
	};

	const load = (configId: string) => {
		popover.close();
		void useTerminalsStore.getState().loadConfig(configId, group.id);
	};

	const remove = (configId: string) => {
		setConfigs((list) => list?.filter((c) => c.id !== configId) ?? null);
		void window.claude.deleteTerminalConfig(configId);
	};

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				className="btn btn-ghost"
				aria-haspopup="menu"
				aria-expanded={popover.anchor !== null}
				onClick={open}
				style={ICON_BUTTON}
			>
				<LoadIcon />
				Load Config
			</button>
			{popover.anchor ? (
				<Popover
					anchor={popover.anchor}
					popoverRef={popover.popoverRef}
					width={240}
				>
					<div role="menu">
						{configs === null ? null : configs.length === 0 ? (
							<div
								style={{
									padding: "6px 8px",
									fontSize: 12,
									color: T.textMute,
								}}
							>
								No saved configs for this folder.
							</div>
						) : (
							configs.map((config) => (
								<ConfigItem
									key={config.id}
									config={config}
									onLoad={() => load(config.id)}
									onDelete={() => remove(config.id)}
								/>
							))
						)}
					</div>
				</Popover>
			) : null}
		</>
	);
}

function ConfigItem({
	config,
	onLoad,
	onDelete,
}: {
	config: TerminalConfig;
	onLoad: () => void;
	onDelete: () => void;
}) {
	const [hovered, setHovered] = useState(false);
	const remove = useInlineConfirm(onDelete);
	const count = config.commands.length;

	return (
		<div
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => {
				setHovered(false);
				remove.reset();
			}}
			style={{
				display: "flex",
				alignItems: "center",
				height: 28,
				borderRadius: 6,
				background: hovered ? T.surface : "transparent",
			}}
		>
			<button
				type="button"
				role="menuitem"
				onClick={onLoad}
				style={{
					appearance: "none",
					border: "none",
					background: "transparent",
					cursor: "pointer",
					flex: 1,
					minWidth: 0,
					height: "100%",
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "0 8px",
					textAlign: "left",
					fontFamily: "inherit",
				}}
			>
				<span
					style={{
						minWidth: 0,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						fontSize: 12.5,
						color: T.text,
					}}
				>
					{config.name}
				</span>
				<span
					style={{
						flexShrink: 0,
						fontSize: 11,
						color: T.textMute,
						whiteSpace: "nowrap",
					}}
				>
					{count} {count === 1 ? "terminal" : "terminals"}
				</span>
			</button>
			<button
				type="button"
				aria-label={
					remove.confirming
						? `Confirm delete config ${config.name}`
						: `Delete config ${config.name}`
				}
				onClick={remove.click}
				style={{
					appearance: "none",
					cursor: "pointer",
					fontFamily: "inherit",
					flexShrink: 0,
					marginRight: 4,
					height: 20,
					minWidth: 20,
					padding: remove.confirming ? "0 8px" : 0,
					borderRadius: 5,
					border: remove.confirming ? `0.5px solid ${T.dangerBorder}` : "none",
					background: remove.confirming ? T.dangerSoft : "transparent",
					color: remove.confirming ? T.danger : T.textMute,
					fontSize: 11,
					opacity: hovered || remove.confirming ? 1 : 0,
				}}
			>
				{remove.confirming ? "Delete?" : "×"}
			</button>
		</div>
	);
}

function SaveIcon() {
	return (
		<svg
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
			<path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
			<path d="M7 3v4a1 1 0 0 0 1 1h7" />
		</svg>
	);
}

function LoadIcon() {
	return (
		<svg
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
			<path
				d="M3 7.4l2.6 2.6L11 4.4"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
