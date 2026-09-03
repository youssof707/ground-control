import type { PermissionRequest } from "@shared/claude-sessions/types";
import { usePermissionsStore } from "../stores/usePermissionsStore";
import { stopSession } from "../lib/sessionControlActions";
import { MarkdownText } from "./MarkdownText";
import { T } from "../../../design/tokens";

interface AllowedPrompt {
	tool?: string;
	prompt?: string;
}

// Permission card specifically for the SDK's `ExitPlanMode` tool. Unlike the
// generic DefaultPermissionCard, this one:
//   - renders `input.plan` as readable markdown,
//   - never offers an "Always allow" path (plan approval must always be
//     explicit; the broker also enforces this defensively),
//   - and uses prominent, distinct CTAs so the user can't mistake it for an
//     ordinary tool-permission card.
export function PlanApprovalCard({
	req,
	naked = false,
}: {
	req: PermissionRequest;
	naked?: boolean;
}) {
	const remove = usePermissionsStore((s) => s.remove);

	const input = req.input as { plan?: unknown; allowedPrompts?: unknown };
	const planText = typeof input.plan === "string" ? input.plan.trim() : "";
	const allowedPrompts: AllowedPrompt[] = Array.isArray(input.allowedPrompts)
		? (input.allowedPrompts as AllowedPrompt[])
		: [];

	const approve = () => {
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "allow",
		});
		remove(req.requestId);
	};
	const keepPlanning = () => {
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "deny",
			message: "Keep planning — don't exit plan mode yet.",
		});
		remove(req.requestId);
	};
	const stopAndDeny = () => {
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "deny",
			message: "Stopped by user.",
		});
		remove(req.requestId);
		void stopSession(req.sessionId);
	};

	return (
		<div
			style={{
				borderRadius: 12,
				background: T.surface,
				// Thicker, brighter border so this card visually outranks a
				// normal permission card. It's the most important UI in the
				// transcript at this moment. Suppressed in `naked` mode (e.g.
				// inside the InboxSidebar, which already provides chrome).
				border: naked ? "none" : `1.5px solid ${T.warn}`,
				boxShadow: naked ? undefined : `0 0 0 3px ${T.warnSoft}`,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					padding: "12px 16px",
					borderBottom: `0.5px solid ${T.borderSoft}`,
					display: "flex",
					flexDirection: "column",
					gap: 4,
				}}
			>
				<div
					style={{
						fontSize: 11,
						fontWeight: 600,
						letterSpacing: 1,
						textTransform: "uppercase",
						color: T.warn,
					}}
				>
					Plan ready for review
				</div>
				<div style={{ fontSize: 12, color: T.textDim }}>
					Approving will switch this session to{" "}
					<strong style={{ color: T.text }}>Auto-edit</strong> mode so Claude
					can apply the plan.
				</div>
			</div>

			<div style={{ padding: "14px 18px" }}>
				{planText ? (
					<MarkdownText text={planText} />
				) : (
					<div
						style={{
							fontSize: 12.5,
							color: T.textFaint,
							fontStyle: "italic",
						}}
					>
						(No plan text provided.)
					</div>
				)}

				{allowedPrompts.length > 0 ? (
					<div
						style={{
							marginTop: 14,
							paddingTop: 12,
							borderTop: `0.5px solid ${T.borderSoft}`,
							display: "flex",
							flexDirection: "column",
							gap: 6,
						}}
					>
						<div
							style={{
								fontSize: 11,
								fontWeight: 600,
								letterSpacing: 0.5,
								color: T.textMute,
								textTransform: "uppercase",
							}}
						>
							Permissions the plan will need
						</div>
						{allowedPrompts.map((p, i) => (
							<div
								key={i}
								style={{
									fontSize: 12,
									color: T.textDim,
									fontFamily: T.mono,
								}}
							>
								<span style={{ color: T.text }}>{p.tool ?? "?"}</span>
								{p.prompt ? (
									<span style={{ color: T.textMute }}> · {p.prompt}</span>
								) : null}
							</div>
						))}
					</div>
				) : null}
			</div>

			<div
				style={{
					padding: "12px 16px",
					display: "flex",
					justifyContent: "flex-end",
					gap: 8,
					borderTop: `0.5px solid ${T.borderSoft}`,
				}}
			>
				<button className="btn" onClick={stopAndDeny}>
					Stop
				</button>
				<button className="btn" onClick={keepPlanning}>
					Keep planning
				</button>
				<button className="btn btn-warn" onClick={approve}>
					Approve & start editing
				</button>
			</div>
		</div>
	);
}
