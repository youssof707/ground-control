import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Worktree } from "@shared/schemas/worktrees";
import { useWorktreesStore } from "../claude-sessions/stores/useWorktreesStore";
import { T } from "../../design/tokens";
import { CheckoutSection } from "./CheckoutSection";
import { useSourceControlStore } from "./useSourceControlStore";

const CLOCK_TICK_MS = 30_000;

function useClock(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
		return () => window.clearInterval(timer);
	}, []);
	return now;
}

function formatAge(fetchedAt: number, now: number): string {
	const minutes = Math.floor(Math.max(0, now - fetchedAt) / 60_000);
	if (minutes < 1) return "Updated just now";
	if (minutes < 60) return `Updated ${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `Updated ${hours}h ago`;
	return `Updated ${Math.floor(hours / 24)}d ago`;
}

const iconButtonStyle = {
	flexShrink: 0,
	width: 28,
	height: 28,
	borderRadius: 8,
	border: `0.5px solid ${T.border}`,
	background: T.surface,
	color: T.textDim,
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
} as const;

function Notice({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				padding: "14px 16px",
				fontSize: 12.5,
				color: T.textMute,
			}}
		>
			{children}
		</div>
	);
}

export function SourceControlPanel({
	rootCwd,
	activePath,
}: {
	rootCwd: string;
	activePath: string;
}) {
	const entry = useSourceControlStore((s) => s.byRoot[rootCwd]);
	const collapsed = useSourceControlStore((s) => s.collapsed);
	const toggleCollapsed = useSourceControlStore((s) => s.toggleCollapsed);
	const refresh = useSourceControlStore((s) => s.refresh);
	const setOpen = useSourceControlStore((s) => s.setOpen);
	const worktrees = useWorktreesStore((s) => s.worktrees);
	const now = useClock();

	const worktreeByPath = useMemo(() => {
		const map = new Map<string, Worktree>();
		for (const wt of Object.values(worktrees)) map.set(wt.worktreePath, wt);
		return map;
	}, [worktrees]);

	const snapshot = entry?.snapshot;
	const loading = entry?.loading ?? false;
	const checkouts = snapshot?.checkouts ?? [];
	const currentPath = checkouts.some((c) => c.path === activePath)
		? activePath
		: checkouts.find((c) => c.isMain)?.path;

	const status = snapshot
		? entry?.error === "failed"
			? "Refresh failed"
			: formatAge(snapshot.fetchedAt, now)
		: "";

	return (
		<div
			style={{
				flex: 1,
				minWidth: 0,
				height: "100%",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "10px 12px 10px 10px",
					borderBottom: `0.5px solid ${T.borderSoft}`,
					flexShrink: 0,
				}}
			>
				<span
					style={{
						fontSize: 13,
						fontWeight: 600,
						color: T.text,
						whiteSpace: "nowrap",
					}}
				>
					Source Control
				</span>
				<span
					aria-live="polite"
					style={{
						flex: 1,
						minWidth: 0,
						fontSize: 11.5,
						color: entry?.error === "failed" ? T.warn : T.textFaint,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
						textAlign: "right",
					}}
				>
					{status}
				</span>
				<button
					type="button"
					onClick={() => void refresh(rootCwd)}
					disabled={loading}
					aria-label="Refresh source control"
					aria-busy={loading || undefined}
					style={{ ...iconButtonStyle, cursor: loading ? "default" : "pointer" }}
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 14 14"
						fill="none"
						aria-hidden="true"
						style={{
							animation: loading ? "asyncy-spin 0.7s linear infinite" : "none",
						}}
					>
						<path
							d="M12 7a5 5 0 1 1-1.6-3.66"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
						/>
						<path
							d="M12 2.2v2.6H9.4"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
				<button
					type="button"
					onClick={() => setOpen(false)}
					aria-label="Hide source control"
					style={{ ...iconButtonStyle, cursor: "pointer" }}
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 12 12"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M4.5 2.5L8 6L4.5 9.5"
							stroke="currentColor"
							strokeWidth="1.4"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
			</div>
			<div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
				{snapshot ? (
					checkouts.map((checkout) => (
						<CheckoutSection
							key={checkout.path}
							checkout={checkout}
							worktree={
								checkout.isMain ? undefined : worktreeByPath.get(checkout.path)
							}
							isCurrent={checkouts.length > 1 && checkout.path === currentPath}
							collapsed={collapsed[checkout.path] === true}
							onToggle={() => toggleCollapsed(checkout.path)}
						/>
					))
				) : entry?.error === "not-a-repo" ? (
					<Notice>Not a git repository</Notice>
				) : entry?.error === "failed" ? (
					<Notice>Source control unavailable</Notice>
				) : (
					<Notice>Loading…</Notice>
				)}
			</div>
		</div>
	);
}
