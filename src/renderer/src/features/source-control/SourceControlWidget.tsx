import { useEffect } from "react";
import { BRANCH_PREFETCH_MAX_AGE_MS, refreshBranches } from "./branchCache";
import { compactCount, plural } from "./format";
import { branchSwitchKey, isHardFailure, runRemoteOp, stopAutoFix, useSourceControlStore } from "./useSourceControlStore";

export function FilesIcon({ size = 12 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
			<path
				d="M8.5 1.5H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4L8.5 1.5Z"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
			<path d="M8.5 1.5V4H11" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
			<path d="M5.5 8h3M7 6.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
		</svg>
	);
}

export function WorktreesIcon({ size = 12 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
			<path
				d="M1.5 3.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function BranchGlyph() {
	return (
		<svg width={12} height={12} viewBox="0 0 14 14" fill="none" aria-hidden="true">
			<circle cx="4" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2" />
			<circle cx="4" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.2" />
			<circle cx="10.5" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
			<path d="M4 4.5v5M10.5 6c0 2.4-3 2.6-6.2 3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
		</svg>
	);
}

function Arrow({ up }: { up: boolean }) {
	return (
		<svg width={10} height={10} viewBox="0 0 10 10" fill="none" aria-hidden="true">
			<path
				d={up ? "M5 8.5V1.8M2 4.6 5 1.6l3 3" : "M5 1.5v6.7M2 5.4l3 3 3-3"}
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function StopFixButton({ onStop }: { onStop: () => void }) {
	return (
		<button type="button" className="repo-card-fixing-stop" aria-label="Stop Claude" onClick={onStop}>
			<svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true">
				<rect width="8" height="8" rx="1.5" fill="currentColor" />
			</svg>
		</button>
	);
}

function changesPart(changed: number | undefined, conflicts: number): { text: string; tone: string } {
	if (changed === undefined) return { text: "Checking…", tone: "repo-card-tone-mute" };
	if (conflicts > 0) return { text: plural(conflicts, "conflict", "conflicts"), tone: "repo-card-tone-danger" };
	if (changed === 0) return { text: "Clean", tone: "repo-card-tone-mute" };
	return { text: `${compactCount(changed)} changed`, tone: "repo-card-tone-warn" };
}

export function SourceControlWidget({
	checkout,
	sessionId,
	branch: sessionBranch,
	lastUserMessageBranch,
	composerId,
}: {
	checkout: string | undefined;
	sessionId?: string;
	composerId?: string;
	branch?: string;
	lastUserMessageBranch?: string;
}) {
	const summary = useSourceControlStore((s) => (checkout ? s.byCheckout[checkout]?.summary : undefined));
	const error = useSourceControlStore((s) => (checkout ? s.byCheckout[checkout]?.error : undefined));
	const busy = useSourceControlStore((s) => (checkout ? s.remote[checkout]?.busy ?? null : null));
	const remoteError = useSourceControlStore((s) => (checkout ? s.remote[checkout]?.error ?? null : null));
	const fixing = useSourceControlStore((s) => (checkout ? s.remote[checkout]?.fixing ?? false : false));
	const commitBusy = useSourceControlStore((s) => (checkout ? s.commits[checkout]?.busy ?? null : null));
	const committing = commitBusy !== null;
	const openModal = useSourceControlStore((s) => s.openModal);
	const openBranches = useSourceControlStore((s) => s.openBranches);
	const dismissRemoteError = useSourceControlStore((s) => s.dismissRemoteError);
	const seenSwitch = useSourceControlStore((s) => (sessionId ? s.seenBranchSwitch[sessionId] : undefined));
	const markBranchSwitchSeen = useSourceControlStore((s) => s.markBranchSwitchSeen);
	const liveBranch = summary?.branch ?? null;

	useEffect(() => {
		if (!sessionId || !summary) return;
		const liveRef = summary.branch ?? (summary.head ? "HEAD" : null);
		if (liveRef && liveRef !== sessionBranch) {
			void window.claude.refreshBranch(sessionId).catch(() => undefined);
		}
	}, [sessionId, summary, sessionBranch]);

	if (!checkout || isHardFailure(error)) return null;

	const branch = summary ? liveBranch : sessionBranch && sessionBranch !== "HEAD" ? sessionBranch : null;
	const branchText = branch ?? (summary?.head ? `Detached at ${summary.head}` : summary ? "Detached HEAD" : "…");
	const switchKey =
		branch && lastUserMessageBranch && branch !== lastUserMessageBranch
			? branchSwitchKey(lastUserMessageBranch, branch)
			: null;
	const stale = switchKey !== null && seenSwitch !== switchKey;
	const openBranchModal = (id: string): void => {
		if (switchKey) markBranchSwitchSeen(id, switchKey);
		openBranches({ checkout, sessionId: id });
	};
	const worktreeName = summary?.worktreeName ?? null;
	let linked = 0;
	for (const w of summary?.worktrees ?? []) if (!w.isMain) linked++;
	const changes = changesPart(summary?.changed, summary?.conflicts ?? 0);
	const upstream = summary?.upstream ?? null;
	const unpublished = summary && branch && !upstream ? summary.unpublished : null;
	const ahead = upstream ? summary?.ahead ?? 0 : unpublished ?? 0;
	const behind = upstream ? summary?.behind ?? 0 : 0;
	const showPull = behind > 0;
	const showPush = upstream ? ahead > 0 : unpublished !== null;
	const run = (op: "pull" | "push"): void => void runRemoteOp(checkout, op, sessionId);

	const branchLabel = `${worktreeName ? `Worktree ${worktreeName}, branch` : "Branch"} ${branchText}${
		stale ? `, changed since your last message (was ${lastUserMessageBranch})` : ""
	}${sessionId ? ". Open branches" : ""}`;
	const changesLabel = `${changes.text}${linked > 0 ? `, ${plural(linked, "worktree", "worktrees")}` : ""}. Open source control`;

	return (
		<div className="repo-card-wrap">
			<div className="repo-card">
				<div className="repo-card-line">
					<button
						type="button"
						className={`repo-card-row repo-card-branch${stale ? " is-stale" : ""}`}
						disabled={!sessionId}
						onClick={sessionId ? () => openBranchModal(sessionId) : undefined}
						onPointerEnter={() => void refreshBranches(checkout, BRANCH_PREFETCH_MAX_AGE_MS)}
						aria-label={branchLabel}
						aria-haspopup={sessionId ? "dialog" : undefined}
					>
						<BranchGlyph />
						<span className="repo-card-ellipsis">{branchText}</span>
						{stale ? <span className="repo-card-stale-dot" aria-hidden="true" /> : null}
					</button>
					{showPull ? (
						<button
							type="button"
							className="repo-card-sync-btn is-pull"
							disabled={busy !== null || committing}
							onClick={() => run("pull")}
							aria-label={`Pull ${plural(behind, "commit", "commits")} from ${upstream}`}
						>
							{busy === "pull" ? <span className="repo-card-spinner" aria-hidden="true" /> : <Arrow up={false} />}
							<span>{compactCount(behind)}</span>
						</button>
					) : null}
					{showPush || committing ? (
						<button
							type="button"
							className={`repo-card-sync-btn ${ahead > 0 ? "is-push" : "is-idle"}`}
							disabled={busy !== null || committing}
							onClick={() => run("push")}
							aria-label={
								committing
									? "Committing"
									: upstream
										? `Push ${plural(ahead, "commit", "commits")} to ${upstream}`
										: `Publish ${branch} to origin with ${plural(ahead, "commit", "commits")}`
							}
						>
							{busy === "push" || committing ? (
								<span className="repo-card-spinner" aria-hidden="true" />
							) : (
								<Arrow up />
							)}
							{committing && ahead === 0 ? null : <span>{compactCount(ahead)}</span>}
						</button>
					) : null}
				</div>
				<button
					type="button"
					className="repo-card-row repo-card-meta"
					onClick={() => openModal(checkout, sessionId ?? composerId)}
					aria-label={changesLabel}
					aria-haspopup="dialog"
				>
					<span className={`repo-card-meta-item ${changes.tone}`}>
						<FilesIcon size={11} />
						<span>{changes.text}</span>
					</span>
					{worktreeName ? (
						<span className="repo-card-meta-item repo-card-worktree">
							<WorktreesIcon size={11} />
							<span className="repo-card-ellipsis">{worktreeName}</span>
						</span>
					) : linked > 0 ? (
						<span className="repo-card-meta-item repo-card-worktree">
							<WorktreesIcon size={11} />
							<span>{plural(linked, "worktree", "worktrees")}</span>
						</span>
					) : null}
				</button>
			</div>
			{fixing && busy ? (
				<div className="repo-card-fixing" role="status">
					<span className="repo-card-spinner" aria-hidden="true" />
					<span>{busy === "pull" ? "Pull failed, Claude is fixing it…" : "Push failed, Claude is fixing it…"}</span>
					<StopFixButton onStop={() => stopAutoFix(checkout)} />
				</div>
			) : commitBusy === "fixing" ? (
				<div className="repo-card-fixing" role="status">
					<span className="repo-card-spinner" aria-hidden="true" />
					<span>Commit failed, Claude is fixing it…</span>
					<StopFixButton onStop={() => stopAutoFix(checkout)} />
				</div>
			) : null}
			{remoteError ? (
				<div className="repo-card-error" role="alert">
					<span>{remoteError}</span>
					<button
						type="button"
						className="btn btn-ghost btn-icon"
						aria-label="Dismiss error"
						onClick={() => dismissRemoteError(checkout)}
					>
						×
					</button>
				</div>
			) : null}
		</div>
	);
}
