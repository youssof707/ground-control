import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionMessage } from "@shared/claude-sessions/types";
import { MarkdownText } from "./MarkdownText";
import { T } from "../../../design/tokens";
import {
	blocksOfSdk,
	type ContentBlock,
	type SdkLike,
} from "../lib/messageContent";

// Re-exported for existing consumers (ToolRunGroup, groupMessages) that
// import the type from this module.
export type { ContentBlock };

// Messages are immutable in the Zustand store (only appended, never mutated),
// so React.memo with default shallow comparison safely short-circuits
// re-renders of already-rendered messages. This is what prevents the message
// list from re-running ReactMarkdown + rehype-highlight on every parent
// re-render. For memo to actually short-circuit, the parent must pass a
// stable `onFork` reference (via useCallback).
export const MessageView = memo(function MessageView({
	m,
	onFork,
	forkPending,
}: {
	m: SessionMessage;
	onFork?: (messageId: string) => void;
	forkPending?: boolean;
}) {
	const sdk = m.content as SdkLike;
	if (m.role === "assistant") {
		return (
			<AssistantMessage
				sdk={sdk}
				messageId={m.id}
				onFork={onFork}
				forkPending={forkPending}
			/>
		);
	}
	if (m.role === "user") return <UserMessage sdk={sdk} />;
	if (m.role === "system") return null;
	if (m.role === "result") return null;
	return null;
});

function AssistantMessage({
	sdk,
	messageId,
	onFork,
	forkPending,
}: {
	sdk: SdkLike;
	messageId: string;
	onFork?: (messageId: string) => void;
	forkPending?: boolean;
}) {
	const [hovered, setHovered] = useState(false);
	const blocks = blocksOfSdk(sdk);
	if (blocks.length === 0) return null;
	// Fork is only available for assistant messages with an SDK uuid (which
	// the SDK requires for `upToMessageId`). Skip the button otherwise so
	// users don't click into a guaranteed-error path.
	const sdkUuid = (sdk as { uuid?: unknown }).uuid;
	const canFork =
		!!onFork && typeof sdkUuid === "string" && sdkUuid.length > 0;
	return (
		<div
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				position: "relative",
				display: "flex",
				gap: 14,
				marginBottom: 22,
				maxWidth: 760,
				marginLeft: "auto",
				marginRight: "auto",
			}}
		>
			<Avatar />
			<div
				style={{
					flex: 1,
					minWidth: 0,
					fontSize: 14,
					color: T.text,
					lineHeight: 1.6,
				}}
			>
				{blocks.map((b, i) => {
					if (b.type === "text") {
						return <MarkdownText key={i} text={b.text ?? ""} />;
					}
					if (b.type === "tool_use") {
						return <ToolUsePill key={i} block={b} />;
					}
					return <RawBlock key={i} block={b} />;
				})}
			</div>
			{canFork ? (
				<MessageActionsMenu
					rowHovered={hovered}
					pending={!!forkPending}
					onFork={() => onFork?.(messageId)}
					blocks={blocks}
				/>
			) : null}
		</div>
	);
}

// Rough on-screen height of the open menu panel (2 items × ~26 px + 8 px
// padding + 1 px border). Used only to decide whether to flip the panel
// upward when there isn't enough room below the trigger.
const MENU_ESTIMATED_HEIGHT = 72;
const MENU_VIEWPORT_MARGIN = 8;
const MENU_TRIGGER_GAP = 4;

function MessageActionsMenu({
	rowHovered,
	pending,
	onFork,
	blocks,
}: {
	rowHovered: boolean;
	pending: boolean;
	onFork: () => void;
	blocks: ContentBlock[];
}) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const [menuPos, setMenuPos] = useState<{
		top: number;
		left: number;
	} | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);

	// While open: close on outside click, Escape, scroll (any scroll container,
	// caught with the capture phase), and window resize. Scroll/resize close
	// rather than reposition because the trigger could move arbitrarily and
	// keeping the panel attached visually isn't worth the complexity.
	useEffect(() => {
		if (!open) return;
		const onMouseDown = (e: MouseEvent) => {
			const target = e.target instanceof Node ? e.target : null;
			if (!target) return;
			if (triggerRef.current && triggerRef.current.contains(target)) return;
			if (panelRef.current && panelRef.current.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		const close = () => setOpen(false);
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("scroll", close, true);
		window.addEventListener("resize", close);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("resize", close);
		};
	}, [open]);

	const toggleOpen = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (open) {
			setOpen(false);
			return;
		}
		const rect = triggerRef.current?.getBoundingClientRect();
		if (rect) {
			const wouldOverflowBottom =
				rect.bottom +
					MENU_TRIGGER_GAP +
					MENU_ESTIMATED_HEIGHT +
					MENU_VIEWPORT_MARGIN >
				window.innerHeight;
			setMenuPos({
				top: wouldOverflowBottom
					? rect.top - MENU_TRIGGER_GAP - MENU_ESTIMATED_HEIGHT
					: rect.bottom + MENU_TRIGGER_GAP,
				left: rect.left,
			});
		}
		setOpen(true);
	};

	const handleFork = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (pending) return;
		setOpen(false);
		onFork();
	};

	const handleCopy = async (e: React.MouseEvent) => {
		e.stopPropagation();
		const text = messageBlocksToText(blocks);
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// noop — clipboard write can fail in some contexts
		}
		setCopied(true);
		setTimeout(() => {
			setCopied(false);
			setOpen(false);
		}, 1200);
	};

	// Trigger is visible whenever the row is hovered OR the menu is open.
	// Keeping it visible while open prevents the affordance from disappearing
	// mid-interaction when the cursor leaves the row (e.g., to click an item
	// in the portal'd panel, which sits outside the row's bounding box).
	const showTrigger = rowHovered || open;

	return (
		<>
			<div
				// Anchored just below the 28×28 avatar at the row's top-left.
				// `left: 3` centers the 22 px wide button under the 28 px avatar;
				// `top: 30` leaves a 2 px gap below the avatar.
				style={{ position: "absolute", top: 30, left: 3 }}
			>
				<button
					ref={triggerRef}
					type="button"
					onClick={toggleOpen}
					aria-label="Message actions"
					aria-haspopup="menu"
					aria-expanded={open}
					style={{
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						width: 22,
						height: 22,
						padding: 0,
						borderRadius: 5,
						border: "none",
						background: "transparent",
						color: T.textFaint,
						cursor: "pointer",
						opacity: showTrigger ? 1 : 0,
						pointerEvents: showTrigger ? "auto" : "none",
						transition: "opacity 0.12s",
					}}
				>
					{/* Horizontal ellipsis: standard "more actions" affordance. */}
					<svg width="13" height="13" viewBox="0 0 12 12" fill="none">
						<circle cx="2" cy="6" r="1.1" fill="currentColor" />
						<circle cx="6" cy="6" r="1.1" fill="currentColor" />
						<circle cx="10" cy="6" r="1.1" fill="currentColor" />
					</svg>
				</button>
			</div>
			{open && menuPos
				? createPortal(
					<div
						ref={panelRef}
						role="menu"
						style={{
							position: "fixed",
							top: menuPos.top,
							left: menuPos.left,
							minWidth: 160,
							padding: 4,
							background: T.surface,
							border: `0.5px solid ${T.border}`,
							borderRadius: 8,
							boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
							zIndex: 10000,
							display: "flex",
							flexDirection: "column",
						}}
					>
						<MenuItem
							label={pending ? "Forking…" : "Fork"}
							disabled={pending}
							onClick={handleFork}
						/>
						<MenuItem
							label={copied ? "Copied!" : "Copy message"}
							onClick={handleCopy}
						/>
					</div>,
					document.body,
				)
				: null}
		</>
	);
}

function MenuItem({
	label,
	disabled,
	onClick,
}: {
	label: string;
	disabled?: boolean;
	onClick: (e: React.MouseEvent) => void;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			onClick={(e) => {
				if (disabled) {
					e.stopPropagation();
					return;
				}
				onClick(e);
			}}
			disabled={disabled}
			style={{
				display: "block",
				width: "100%",
				textAlign: "left",
				padding: "6px 10px",
				borderRadius: 5,
				border: "none",
				background: "transparent",
				color: disabled ? T.textMute : T.text,
				fontSize: 13,
				fontFamily: "inherit",
				cursor: disabled ? "default" : "pointer",
			}}
			onMouseEnter={(e) => {
				if (disabled) return;
				e.currentTarget.style.background = T.surfaceHi;
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.background = "transparent";
			}}
		>
			{label}
		</button>
	);
}

function UserMessage({ sdk }: { sdk: SdkLike }) {
	const blocks = blocksOfSdk(sdk);
	const isToolResult = blocks.length > 0 && blocks[0].type === "tool_result";

	if (isToolResult) {
		return (
			<div
				style={{
					display: "flex",
					gap: 14,
					marginBottom: 14,
					maxWidth: 760,
					marginLeft: "auto",
					marginRight: "auto",
				}}
			>
				<div style={{ width: 28, flexShrink: 0 }} />
				<div style={{ flex: 1, minWidth: 0 }}>
					{blocks.map((b, i) => (
						<ToolResultPill key={i} block={b} />
					))}
				</div>
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				justifyContent: "flex-end",
				marginBottom: 18,
				maxWidth: 760,
				marginLeft: "auto",
				marginRight: "auto",
			}}
		>
			<div
				style={{
					maxWidth: "78%",
					padding: "12px 16px",
					borderRadius: 14,
					background: T.surface,
					border: `0.5px solid ${T.border}`,
					fontSize: 14,
					color: T.text,
					lineHeight: 1.55,
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				{blocks.map((b, i) => {
					if (b.type === "text") {
						return (
							<div
								key={i}
								style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
							>
								{b.text}
							</div>
						);
					}
					if (b.type === "image" && b.source?.data) {
						return (
							<img
								key={i}
								src={`data:${b.source.media_type ?? "image/png"};base64,${b.source.data}`}
								alt=""
								style={{
									maxWidth: 280,
									maxHeight: 280,
									borderRadius: 8,
									border: `0.5px solid ${T.border}`,
									objectFit: "contain",
								}}
							/>
						);
					}
					return <RawBlock key={i} block={b} />;
				})}
			</div>
		</div>
	);
}

function Avatar() {
	return (
		<div
			style={{
				width: 28,
				height: 28,
				borderRadius: 8,
				flexShrink: 0,
				background: T.accentSoft,
				border: `0.5px solid ${T.accentBorder}`,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				color: T.accent,
				fontFamily: T.mono,
				fontSize: 13,
				fontWeight: 700,
			}}
		>
			C
		</div>
	);
}

export function ToolUsePill({ block }: { block: ContentBlock }) {
	const summary = summarizeToolInput(block);
	return (
		<details
			style={{
				marginBottom: 6,
				borderRadius: 8,
				background: T.surfaceLow,
				border: `0.5px solid ${T.borderSoft}`,
				padding: "8px 12px",
				fontFamily: T.mono,
				fontSize: 12.5,
			}}
		>
			<summary
				style={{
					cursor: "pointer",
					listStyle: "none",
					display: "flex",
					alignItems: "center",
					gap: 10,
				}}
			>
				<span
					style={{
						fontSize: 10.5,
						fontWeight: 600,
						padding: "2px 7px",
						borderRadius: 4,
						background: T.surfaceHi,
						color: T.textDim,
						letterSpacing: 0.4,
						textTransform: "uppercase",
						fontFamily: T.sans,
					}}
				>
					{block.name ?? "tool"}
				</span>
				{summary ? (
					<span
						style={{
							color: T.textDim,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							flex: 1,
						}}
					>
						{summary}
					</span>
				) : null}
			</summary>
			<pre
				style={{
					margin: "8px 0 0",
					fontSize: 12,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					overflowWrap: "anywhere",
					fontFamily: T.mono,
					maxWidth: "100%",
					maxHeight: 320,
					overflow: "auto",
					color: T.textDim,
				}}
			>
				{JSON.stringify(block.input ?? {}, null, 2)}
			</pre>
		</details>
	);
}

export function ToolResultPill({ block }: { block: ContentBlock }) {
	const isError = block.is_error === true;
	const text = stringifyToolResult(block.content);
	const truncated = text.length > 240 ? text.slice(0, 240) + "…" : text;
	return (
		<details
			style={{
				marginBottom: 6,
				borderRadius: 8,
				background: isError ? T.dangerSoft : T.surfaceLow,
				border: `0.5px solid ${isError ? T.dangerBorder : T.borderSoft}`,
				padding: "8px 12px",
				fontFamily: T.mono,
				fontSize: 12.5,
			}}
		>
			<summary
				style={{
					cursor: "pointer",
					listStyle: "none",
					display: "flex",
					alignItems: "center",
					gap: 10,
				}}
			>
				<span
					style={{
						fontSize: 10.5,
						fontWeight: 600,
						padding: "2px 7px",
						borderRadius: 4,
						background: isError ? T.dangerSoft : T.surfaceHi,
						color: isError ? T.danger : T.textDim,
						letterSpacing: 0.4,
						textTransform: "uppercase",
						fontFamily: T.sans,
					}}
				>
					{isError ? "error" : "result"}
				</span>
				<span
					style={{
						color: T.textDim,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						flex: 1,
					}}
				>
					{truncated.replace(/\n/g, " ⏎ ")}
				</span>
			</summary>
			<pre
				style={{
					margin: "8px 0 0",
					fontSize: 12,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					overflowWrap: "anywhere",
					fontFamily: T.mono,
					maxWidth: "100%",
					maxHeight: 320,
					overflow: "auto",
					color: T.textDim,
				}}
			>
				{text}
			</pre>
		</details>
	);
}

export function RawBlock({ block }: { block: ContentBlock }) {
	return (
		<details>
			<summary style={{ fontSize: 12, color: T.textMute, cursor: "pointer" }}>
				{block.type ?? "block"}
			</summary>
			<pre
				style={{
					fontSize: 12,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					fontFamily: T.mono,
					color: T.textDim,
				}}
			>
				{JSON.stringify(block, null, 2)}
			</pre>
		</details>
	);
}

function messageBlocksToText(blocks: ContentBlock[]): string {
	return blocks
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text as string)
		.join("\n\n")
		.trim();
}

function summarizeToolInput(block: ContentBlock): string {
	const input = block.input as Record<string, unknown> | undefined;
	if (!input) return "";
	if (typeof input.command === "string") return input.command;
	if (typeof input.file_path === "string") return input.file_path;
	if (typeof input.path === "string") return input.path;
	if (typeof input.url === "string") return input.url;
	const keys = Object.keys(input).slice(0, 3);
	return keys.length ? keys.join(", ") : "";
}

function stringifyToolResult(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((c) => {
				if (typeof c === "string") return c;
				if (c && typeof c === "object" && "text" in c)
					return String((c as { text: unknown }).text);
				return JSON.stringify(c);
			})
			.join("\n");
	}
	return JSON.stringify(content, null, 2);
}
