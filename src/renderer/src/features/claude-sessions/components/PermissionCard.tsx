import { useState } from "react";
import type { PermissionRequest } from "@shared/claude-sessions/types";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { ToolPreview } from "./ToolPreview";

export function PermissionCard({ req }: { req: PermissionRequest }) {
	if (req.toolName === "AskUserQuestion") {
		return <AskUserQuestionCard req={req} />;
	}
	return <DefaultPermissionCard req={req} />;
}

function DefaultPermissionCard({ req }: { req: PermissionRequest }) {
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
				border: "1px solid #e5e5ea",
				borderLeft: "3px solid #f5a623",
				borderRadius: 8,
				padding: 12,
				margin: "8px 0",
				background: "#fff",
				display: "flex",
				flexDirection: "column",
				gap: 10,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					fontSize: 13,
				}}
			>
				<span>🔧</span>
				<strong>{req.toolName}</strong>
				<span style={{ fontSize: 12, color: "#86868b" }}>wants to run</span>
			</div>

			<ToolPreview
				toolName={req.toolName}
				input={req.input as Record<string, unknown>}
			/>

			{showDenyReason ? (
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
							padding: "6px 10px",
							border: "1px solid #d2d2d7",
							borderRadius: 6,
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
							style={{ fontSize: 12 }}
						>
							Cancel
						</button>
						<button
							className="btn"
							onClick={() => denyReason.trim() && deny(denyReason.trim())}
							disabled={!denyReason.trim()}
							style={{ fontSize: 12 }}
						>
							Send denial
						</button>
					</div>
				</div>
			) : (
				<div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
					<button
						className="btn"
						onClick={() => setShowDenyReason(true)}
						style={{ fontSize: 12 }}
						title="Deny with a reason that gets sent back to Claude"
					>
						Deny…
					</button>
					<button
						className="btn"
						onClick={() => deny("Denied by user")}
						style={{ fontSize: 12 }}
					>
						Deny
					</button>
					<button
						className="btn"
						onClick={allow}
						style={{
							fontSize: 12,
							background: "#1d1d1f",
							color: "#fff",
							borderColor: "#1d1d1f",
						}}
					>
						Allow
					</button>
				</div>
			)}
		</div>
	);
}
