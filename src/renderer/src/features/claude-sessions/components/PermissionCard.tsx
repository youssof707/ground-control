import type { PermissionRequest } from "@shared/claude-sessions/types";
import { usePermissionsStore } from "../stores/usePermissionsStore";

export function PermissionCard({ req }: { req: PermissionRequest }) {
	const remove = usePermissionsStore((s) => s.remove);

	const allow = () => {
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "allow",
		});
		remove(req.requestId);
	};
	const deny = () => {
		window.claude.respondPermission({
			requestId: req.requestId,
			behavior: "deny",
			message: "Denied by user",
		});
		remove(req.requestId);
	};

	return (
		<div
			style={{
				border: "2px solid #f5a623",
				borderRadius: 8,
				padding: 12,
				margin: "8px 0",
				background: "#fff8e6",
			}}
		>
			<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
				Tool request: <code>{req.toolName}</code>
			</div>
			<pre
				style={{
					fontSize: 12,
					background: "#fff",
					padding: 8,
					borderRadius: 4,
					margin: "6px 0",
					overflow: "auto",
					maxHeight: 200,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					fontFamily:
						"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
				}}
			>
				{JSON.stringify(req.input, null, 2)}
			</pre>
			<div style={{ display: "flex", gap: 8 }}>
				<button
					onClick={allow}
					className="btn"
					style={{
						background: "#2e8b3a",
						color: "#fff",
						borderColor: "#2e8b3a",
					}}
				>
					Allow
				</button>
				<button onClick={deny} className="btn">
					Deny
				</button>
			</div>
		</div>
	);
}
