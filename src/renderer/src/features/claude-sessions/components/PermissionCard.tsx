import { useState } from "react";
import type { PermissionRequest } from "@shared/claude-sessions/types";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { PlanApprovalCard } from "./PlanApprovalCard";
import { ToolPreview } from "./ToolPreview";
import { T } from "../../../design/tokens";

export function PermissionCard({
	req,
	naked = false,
}: {
	req: PermissionRequest;
	/**
	 * When true, drop each variant's outer accent border / ring. Used when the
	 * card is already inside a chrome-providing container (e.g. InboxSidebar),
	 * where the extra border reads as a distracting double frame.
	 */
	naked?: boolean;
}) {
	if (req.toolName === "ExitPlanMode") {
		return <PlanApprovalCard req={req} naked={naked} />;
	}
	if (req.toolName === "AskUserQuestion") {
		return <AskUserQuestionCard req={req} naked={naked} />;
	}
	return <DefaultPermissionCard req={req} naked={naked} />;
}

function DefaultPermissionCard({
	req,
	naked,
}: {
	req: PermissionRequest;
	naked: boolean;
}) {
	const remove = usePermissionsStore((s) => s.remove);
	const [showDenyReason, setShowDenyReason] = useState(false);
	const [denyReason, setDenyReason] = useState("");

	const allow = () => {
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "allow",
		});
		remove(req.requestId);
	};
	const allowAlways = () => {
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "allow",
			remember: true,
		});
		remove(req.requestId);
	};
	const deny = (message: string) => {
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "deny",
			message,
		});
		remove(req.requestId);
	};

	return (
		<div
			style={{
				borderRadius: 10,
				background: T.surface,
				border: naked ? "none" : `0.5px solid ${T.accentBorder}`,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					padding: "12px 16px",
					display: "flex",
					alignItems: "center",
					gap: 10,
					borderBottom: `0.5px solid ${T.borderSoft}`,
				}}
			>
				<div
					style={{
						width: 22,
						height: 22,
						borderRadius: 6,
						background: T.accentSoft,
						border: `0.5px solid ${T.accentBorder}`,
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						color: T.accent,
						fontSize: 12,
					}}
				>
					🔧
				</div>
				<div style={{ fontSize: 12.5, color: T.text }}>
					<span style={{ color: T.textDim, marginRight: 6 }}>
						Tool request:
					</span>
					<strong style={{ fontFamily: T.mono }}>{req.toolName}</strong>
				</div>
			</div>

			<div style={{ padding: "14px 16px" }}>
				<ToolPreview
					toolName={req.toolName}
					input={req.input as Record<string, unknown>}
				/>
			</div>

			{showDenyReason ? (
				<div
					style={{
						padding: "12px 16px",
						borderTop: `0.5px solid ${T.borderSoft}`,
						display: "flex",
						flexDirection: "column",
						gap: 8,
					}}
				>
					<input
						autoFocus
						value={denyReason}
						onChange={(e) => setDenyReason(e.target.value)}
						placeholder="Reason for denying (sent to Claude)…"
						onKeyDown={(e) => {
							if (e.key === "Enter" && denyReason.trim()) {
								deny(denyReason.trim());
							}
							if (e.key === "Escape") setShowDenyReason(false);
						}}
						style={{
							fontSize: 13,
							padding: "8px 12px",
							borderRadius: 8,
							background: T.surfaceLow,
							border: `0.5px solid ${T.border}`,
							outline: "none",
						}}
					/>
					<div
						style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}
					>
						<button
							className="btn"
							onClick={() => {
								setShowDenyReason(false);
								setDenyReason("");
							}}
						>
							Cancel
						</button>
						<button
							className="btn btn-destructive"
							onClick={() => denyReason.trim() && deny(denyReason.trim())}
							disabled={!denyReason.trim()}
						>
							Send denial
						</button>
					</div>
				</div>
			) : (
				<div
					style={{
						padding: "10px 16px",
						display: "flex",
						justifyContent: "flex-end",
						gap: 8,
					}}
				>
					<button
						className="btn"
						onClick={() => setShowDenyReason(true)}
						title="Deny with a reason that gets sent back to Claude"
					>
						Deny…
					</button>
					<button
						className="btn"
						onClick={() => deny("Denied by user")}
					>
						Deny
					</button>
					<button className="btn btn-primary" onClick={allow}>
						Allow
					</button>
					<button
						className="btn btn-primary"
						onClick={allowAlways}
						title={`Auto-allow all future ${req.toolName} requests for the rest of this app session`}
					>
						Always allow {req.toolName}
					</button>
				</div>
			)}
		</div>
	);
}
