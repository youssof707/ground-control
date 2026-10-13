import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	McpChangedEvent,
	McpServerState,
	McpServerView,
} from "@shared/schemas/mcp";
import { T } from "../../../design/tokens";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useWorkspaces, workspaceLabel } from "../hooks/useWorkspaces";
import { Segmented } from "./BabysitRules";

const PENDING_REFRESH_MS = 2000;

const SCOPE_ORDER = ["enterprise", "user", "project", "local", "claudeai"];

const SCOPE_LABELS: Record<string, string> = {
	enterprise: "Enterprise",
	managed: "Enterprise",
	user: "User",
	project: "Project",
	local: "Local",
	claudeai: "claude.ai",
	dynamic: "Session",
};

const STATE_STYLE: Record<
	McpServerState,
	{ label: string; color: string; bg: string; border: string }
> = {
	connected: { label: "Connected", color: T.ok, bg: T.okSoft, border: T.okBorder },
	failed: { label: "Failed", color: T.danger, bg: T.dangerSoft, border: T.dangerBorder },
	"needs-auth": { label: "Needs auth", color: T.warn, bg: T.warnSoft, border: T.warnBorder },
	pending: { label: "Connecting", color: T.info, bg: T.infoSoft, border: T.infoBorder },
	disabled: { label: "Disabled", color: T.textMute, bg: T.neutralSoft, border: T.borderSoft },
};

type EnabledValue = "on" | "off";

const ENABLED_OPTIONS = [
	{ value: "off", label: "Off", tone: T.textDim },
	{ value: "on", label: "On", tone: T.ok },
] as const satisfies readonly { value: EnabledValue; label: string; tone: string }[];

type RowAction = "authenticate" | "reconnect" | "toggle";

interface RowActivity {
	busy: RowAction | null;
	error: string | null;
	note: string | null;
}

const IDLE_ACTIVITY: RowActivity = { busy: null, error: null, note: null };

function scopeKey(scope: string | undefined): string {
	if (!scope) return "other";
	return scope === "managed" ? "enterprise" : scope;
}

function scopeLabel(key: string): string {
	return SCOPE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function messageOf(err: unknown): string {
	const raw = err instanceof Error ? err.message : String(err);
	return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

function useDefaultCwd(initialCwd: string | null, workspaces: string[]): string {
	const lastUsed = useSettingsStore((s) => s.lastUsedWorkspace);
	return initialCwd ?? lastUsed ?? workspaces[0] ?? "";
}

export function McpServersPanel({ initialCwd }: { initialCwd: string | null }) {
	const workspaces = useWorkspaces();
	const defaultCwd = useDefaultCwd(initialCwd, workspaces);
	const [cwd, setCwd] = useState(defaultCwd);
	const [servers, setServers] = useState<McpServerView[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [filter, setFilter] = useState("");
	const [expanded, setExpanded] = useState<string | null>(null);
	const [activity, setActivity] = useState<Record<string, RowActivity>>({});
	const requestSeq = useRef(0);

	const workspaceOptions = useMemo(() => {
		const all = new Set(workspaces);
		if (cwd) all.add(cwd);
		return Array.from(all);
	}, [workspaces, cwd]);

	const refresh = useCallback(async () => {
		const seq = ++requestSeq.current;
		try {
			const next = await window.claude.mcpStatus(cwd);
			if (seq !== requestSeq.current) return;
			setServers(next);
			setLoadError(null);
		} catch (err) {
			if (seq !== requestSeq.current) return;
			setLoadError(messageOf(err));
		}
	}, [cwd]);

	useEffect(() => {
		setServers(null);
		setLoadError(null);
		setActivity({});
		setExpanded(null);
		void refresh();
		return () => {
			void window.claude.mcpRelease(cwd);
		};
	}, [cwd, refresh]);

	useEffect(
		() =>
			window.claude.on("mcp:changed", (payload) => {
				if ((payload as McpChangedEvent).cwd !== cwd) return;
				setActivity((prev) => {
					const next: Record<string, RowActivity> = {};
					for (const [name, a] of Object.entries(prev)) {
						next[name] = { ...a, note: null };
					}
					return next;
				});
				void refresh();
			}),
		[cwd, refresh],
	);

	const anyPending = servers?.some((s) => s.status === "pending") ?? false;
	useEffect(() => {
		if (!anyPending) return;
		const timer = setTimeout(() => void refresh(), PENDING_REFRESH_MS);
		return () => clearTimeout(timer);
	}, [anyPending, servers, refresh]);

	const patchActivity = (name: string, patch: Partial<RowActivity>) =>
		setActivity((prev) => ({
			...prev,
			[name]: { ...(prev[name] ?? IDLE_ACTIVITY), ...patch },
		}));

	const runAction = async (
		name: string,
		action: RowAction,
		perform: () => Promise<string | null>,
	) => {
		patchActivity(name, { busy: action, error: null, note: null });
		try {
			const note = await perform();
			patchActivity(name, { busy: null, note });
		} catch (err) {
			patchActivity(name, { busy: null, error: messageOf(err) });
		}
		await refresh();
	};

	const authenticate = (name: string) =>
		runAction(name, "authenticate", async () => {
			const result = await window.claude.mcpAuthenticate(cwd, name);
			if (!result.opened) return null;
			return result.awaitingCallback
				? "Finish signing in in your browser."
				: "Finish connecting on claude.ai, then press Reconnect.";
		});

	const reconnect = (name: string) =>
		runAction(name, "reconnect", async () => {
			await window.claude.mcpReconnect(cwd, name);
			return null;
		});

	const toggle = (name: string, enabled: boolean) =>
		runAction(name, "toggle", async () => {
			await window.claude.mcpToggle(cwd, name, enabled);
			return null;
		});

	const groups = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		const visible = (servers ?? []).filter(
			(s) => !needle || s.name.toLowerCase().includes(needle),
		);
		const byScope = new Map<string, McpServerView[]>();
		for (const s of visible) {
			const key = scopeKey(s.scope);
			byScope.set(key, [...(byScope.get(key) ?? []), s]);
		}
		const rank = (key: string) => {
			const i = SCOPE_ORDER.indexOf(key);
			return i === -1 ? SCOPE_ORDER.length : i;
		};
		return Array.from(byScope.entries())
			.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
			.map(([key, list]) => ({
				key,
				list: list.sort((a, b) => a.name.localeCompare(b.name)),
			}));
	}, [servers, filter]);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<div style={{ display: "flex", gap: 8 }}>
				<WorkspaceSelect value={cwd} options={workspaceOptions} onChange={setCwd} />
				<button
					type="button"
					className="btn"
					onClick={() => void refresh()}
					style={{ flexShrink: 0 }}
				>
					Refresh
				</button>
			</div>

			<input
				type="text"
				placeholder="Filter servers…"
				value={filter}
				onChange={(e) => setFilter(e.target.value)}
				spellCheck={false}
				style={{
					width: "100%",
					boxSizing: "border-box",
					height: 32,
					padding: "0 10px",
					borderRadius: 7,
					border: `0.5px solid ${T.border}`,
					background: T.bg,
					color: T.text,
					fontFamily: "inherit",
					fontSize: 12.5,
					outline: "none",
				}}
			/>

			{loadError ? (
				<Notice tone={T.danger}>{loadError}</Notice>
			) : servers === null ? (
				<Notice tone={T.textMute}>
					<span
						className="asyncy-btn-spinner bg-task-spinner"
						aria-hidden
						style={{ marginRight: 8 }}
					/>
					Checking MCP servers…
				</Notice>
			) : servers.length === 0 ? (
				<Notice tone={T.textMute}>No MCP servers configured for this workspace.</Notice>
			) : groups.length === 0 ? (
				<Notice tone={T.textMute}>No servers match “{filter}”.</Notice>
			) : (
				groups.map((g) => (
					<div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						<div
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: T.textMute,
								letterSpacing: "0.4px",
								textTransform: "uppercase",
								marginTop: 4,
							}}
						>
							{scopeLabel(g.key)} ({g.list.length})
						</div>
						{g.list.map((server) => (
							<ServerRow
								key={server.name}
								server={server}
								activity={activity[server.name] ?? IDLE_ACTIVITY}
								expanded={expanded === server.name}
								onToggleExpanded={() =>
									setExpanded((cur) => (cur === server.name ? null : server.name))
								}
								onAuthenticate={() => void authenticate(server.name)}
								onReconnect={() => void reconnect(server.name)}
								onSetEnabled={(enabled) => void toggle(server.name, enabled)}
							/>
						))}
					</div>
				))
			)}
		</div>
	);
}

function WorkspaceSelect({
	value,
	options,
	onChange,
}: {
	value: string;
	options: string[];
	onChange: (cwd: string) => void;
}) {
	return (
		<select
			aria-label="Workspace"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			style={{
				flex: 1,
				minWidth: 0,
				height: 32,
				padding: "0 8px",
				borderRadius: 7,
				border: `0.5px solid ${T.border}`,
				background: T.surface,
				color: T.text,
				fontFamily: "inherit",
				fontSize: 12.5,
				colorScheme: "dark",
			}}
		>
			{options.length === 0 ? (
				<option value="">No workspace (user and enterprise servers only)</option>
			) : (
				options.map((cwd) => (
					<option key={cwd} value={cwd}>
						{workspaceLabel(cwd)}
					</option>
				))
			)}
		</select>
	);
}

function Notice({ tone, children }: { tone: string; children: React.ReactNode }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				padding: "14px 12px",
				borderRadius: 8,
				border: `0.5px solid ${T.borderSoft}`,
				background: T.surfaceLow,
				color: tone,
				fontSize: 12.5,
				lineHeight: 1.45,
				overflowWrap: "anywhere",
			}}
		>
			{children}
		</div>
	);
}

function ServerRow({
	server,
	activity,
	expanded,
	onToggleExpanded,
	onAuthenticate,
	onReconnect,
	onSetEnabled,
}: {
	server: McpServerView;
	activity: RowActivity;
	expanded: boolean;
	onToggleExpanded: () => void;
	onAuthenticate: () => void;
	onReconnect: () => void;
	onSetEnabled: (enabled: boolean) => void;
}) {
	const disabled = server.status === "disabled";
	const busy = activity.busy !== null;
	const showAuthenticate = server.status === "needs-auth";
	const showReconnect = server.status === "failed" || server.status === "connected";

	return (
		<div
			style={{
				borderRadius: 8,
				border: `0.5px solid ${expanded ? T.border : T.borderSoft}`,
				background: T.surfaceLow,
				overflow: "hidden",
			}}
		>
			<div
				role="button"
				tabIndex={0}
				aria-expanded={expanded}
				onClick={onToggleExpanded}
				onKeyDown={(e) => {
					if (e.target !== e.currentTarget) return;
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onToggleExpanded();
					}
				}}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "10px 12px",
					cursor: "pointer",
				}}
			>
				<span
					style={{
						flex: 1,
						minWidth: 0,
						fontFamily: T.mono,
						fontSize: 12.5,
						color: disabled ? T.textMute : T.text,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{server.name}
				</span>
				<div
					onClick={(e) => e.stopPropagation()}
					style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}
				>
					{showAuthenticate ? (
						<RowButton
							label="Authenticate"
							pending={activity.busy === "authenticate"}
							disabled={busy}
							onClick={onAuthenticate}
						/>
					) : null}
					{showReconnect ? (
						<RowButton
							label="Reconnect"
							pending={activity.busy === "reconnect"}
							disabled={busy}
							onClick={onReconnect}
						/>
					) : null}
					<Segmented
						label={`Enable ${server.name}`}
						value={disabled ? "off" : "on"}
						options={ENABLED_OPTIONS}
						onChange={(v) => {
							if ((v === "on") === !disabled) return;
							onSetEnabled(v === "on");
						}}
						disabled={busy}
					/>
					<StatePill status={server.status} />
				</div>
			</div>

			{activity.note || activity.error ? (
				<div
					style={{
						padding: "0 12px 10px",
						fontSize: 12,
						color: activity.error ? T.danger : T.textDim,
						overflowWrap: "anywhere",
					}}
				>
					{activity.error ?? activity.note}
				</div>
			) : null}

			{expanded ? <ServerDetails server={server} /> : null}
		</div>
	);
}

function RowButton({
	label,
	pending,
	disabled,
	onClick,
}: {
	label: string;
	pending: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="btn"
			onClick={onClick}
			disabled={disabled}
			aria-busy={pending}
			style={{ height: 24, padding: "0 10px", fontSize: 12 }}
		>
			{pending ? <span className="asyncy-btn-spinner bg-task-spinner" aria-hidden /> : label}
		</button>
	);
}

function StatePill({ status }: { status: McpServerState }) {
	const style = STATE_STYLE[status];
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 9px",
				borderRadius: 11,
				background: style.bg,
				border: `0.5px solid ${style.border}`,
				color: style.color,
				fontSize: 11.5,
				fontWeight: 500,
				whiteSpace: "nowrap",
				minWidth: 74,
				justifyContent: "center",
				boxSizing: "border-box",
			}}
		>
			{status === "pending" ? (
				<span className="asyncy-btn-spinner bg-task-spinner" aria-hidden />
			) : (
				<span
					style={{ width: 6, height: 6, borderRadius: "50%", background: style.color }}
				/>
			)}
			{style.label}
		</span>
	);
}

function ServerDetails({ server }: { server: McpServerView }) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 8,
				padding: "10px 12px 12px",
				borderTop: `0.5px solid ${T.borderSoft}`,
				fontSize: 12,
				color: T.textDim,
			}}
		>
			{server.target ? (
				<DetailLine label={server.transport ?? "target"}>
					<span style={{ fontFamily: T.mono, overflowWrap: "anywhere" }}>{server.target}</span>
				</DetailLine>
			) : null}
			{server.error ? (
				<DetailLine label="error">
					<span
						style={{
							fontFamily: T.mono,
							color: T.danger,
							whiteSpace: "pre-wrap",
							overflowWrap: "anywhere",
						}}
					>
						{server.error}
					</span>
				</DetailLine>
			) : null}
			{server.tools.length > 0 ? (
				<DetailLine label={`tools (${server.tools.length})`}>
					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						{server.tools.map((tool) => (
							<div key={tool.name} style={{ lineHeight: 1.4 }}>
								<span style={{ fontFamily: T.mono, color: T.text }}>{tool.name}</span>
								{tool.description ? (
									<span style={{ color: T.textMute }}>
										{" "}
										— {tool.description.split("\n")[0]}
									</span>
								) : null}
							</div>
						))}
					</div>
				</DetailLine>
			) : server.status === "connected" ? (
				<DetailLine label="tools">
					<span style={{ color: T.textMute }}>None</span>
				</DetailLine>
			) : null}
			{!server.target && !server.error && server.tools.length === 0 && server.status !== "connected" ? (
				<span style={{ color: T.textMute }}>No details available.</span>
			) : null}
		</div>
	);
}

function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div style={{ display: "flex", gap: 10 }}>
			<span
				style={{
					flexShrink: 0,
					width: 76,
					fontSize: 11,
					color: T.textMute,
					textTransform: "uppercase",
					letterSpacing: "0.3px",
					paddingTop: 1,
				}}
			>
				{label}
			</span>
			<div style={{ flex: 1, minWidth: 0 }}>{children}</div>
		</div>
	);
}
