import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type {
	UserContentBlock,
	UserImageMediaType,
} from "@shared/claude-sessions/types";
import { useSessionsStore } from "../stores/useSessionsStore";
import { T } from "../../../design/tokens";
import { Kbd } from "../../../design/Atoms";

interface Props {
	sessionId: string;
	disabled?: boolean;
}

interface PendingImage {
	media_type: UserImageMediaType;
	data: string;
	previewUrl: string;
}

const SUPPORTED_IMAGE_TYPES: readonly UserImageMediaType[] = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
];

function toSupportedMediaType(t: string): UserImageMediaType | null {
	return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(t)
		? (t as UserImageMediaType)
		: null;
}

export function ImagePasteTextarea({ sessionId, disabled }: Props) {
	const [text, setText] = useState("");
	const [images, setImages] = useState<PendingImage[]>([]);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const items = Array.from(e.clipboardData.items);
		const imageItems = items.filter((it) => it.type.startsWith("image/"));
		if (imageItems.length === 0) return;
		e.preventDefault();
		for (const item of imageItems) {
			const file = item.getAsFile();
			if (!file) continue;
			const mediaType = toSupportedMediaType(file.type);
			if (!mediaType) {
				setError(`Unsupported image type: ${file.type}`);
				continue;
			}
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = reader.result as string;
				const data = dataUrl.split(",")[1] ?? "";
				setImages((prev) => [
					...prev,
					{ media_type: mediaType, data, previewUrl: dataUrl },
				]);
			};
			reader.readAsDataURL(file);
		}
	};

	const removeImage = (idx: number) =>
		setImages((prev) => prev.filter((_, i) => i !== idx));

	const send = async () => {
		if (sending) return;
		if (!text.trim() && images.length === 0) return;
		const blocks: UserContentBlock[] = [];
		for (const img of images) {
			blocks.push({
				type: "image",
				source: {
					type: "base64",
					media_type: img.media_type,
					data: img.data,
				},
			});
		}
		if (text.trim()) blocks.push({ type: "text", text: text.trim() });

		setSending(true);
		setError(null);
		try {
			await window.claude.sendUserMessage({ sessionId, blocks });
			useSessionsStore.getState().appendMessage(sessionId, {
				id: crypto.randomUUID(),
				role: "user",
				content: {
					type: "user",
					message: { role: "user", content: blocks },
				},
				ts: Date.now(),
			});
			setText("");
			setImages([]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSending(false);
		}
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void send();
		}
	};

	const canSend = !!(text.trim() || images.length > 0);

	return (
		<div
			style={{
				flexShrink: 0,
				padding: "14px 32px 18px",
				borderTop: `0.5px solid ${T.border}`,
				background: T.win,
			}}
		>
			<div
				style={{
					maxWidth: 760,
					margin: "0 auto",
					borderRadius: 12,
					border: `0.5px solid ${T.border}`,
					background: T.surface,
					padding: 12,
					boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
				}}
			>
				{images.length > 0 ? (
					<div
						style={{
							display: "flex",
							gap: 6,
							flexWrap: "wrap",
							marginBottom: 10,
						}}
					>
						{images.map((img, i) => (
							<div key={i} style={{ position: "relative" }}>
								<img
									src={img.previewUrl}
									alt=""
									style={{
										height: 64,
										width: 64,
										objectFit: "cover",
										borderRadius: 6,
										border: `0.5px solid ${T.border}`,
									}}
								/>
								<button
									onClick={() => removeImage(i)}
									title="Remove"
									style={{
										position: "absolute",
										top: -6,
										right: -6,
										width: 20,
										height: 20,
										borderRadius: "50%",
										border: "none",
										background: T.text,
										color: T.bg,
										fontSize: 12,
										cursor: "pointer",
										lineHeight: 1,
									}}
								>
									×
								</button>
							</div>
						))}
					</div>
				) : null}

				{error ? (
					<div
						className="message message-error"
						style={{
							padding: 8,
							fontSize: 12,
							marginBottom: 10,
							textAlign: "left",
						}}
					>
						{error}
					</div>
				) : null}

				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					onPaste={onPaste}
					onKeyDown={onKeyDown}
					disabled={disabled || sending}
					placeholder="Reply to Claude…"
					style={{
						width: "100%",
						minHeight: 44,
						resize: "vertical",
						background: "transparent",
						border: "none",
						outline: "none",
						color: T.text,
						fontFamily: T.sans,
						fontSize: 14,
						lineHeight: 1.5,
						padding: 0,
					}}
				/>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						marginTop: 10,
						paddingTop: 10,
						borderTop: `0.5px solid ${T.borderSoft}`,
					}}
				>
					<span
						style={{
							fontSize: 11.5,
							color: T.textFaint,
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						<Kbd>⌘</Kbd>
						<Kbd>↵</Kbd>
						<span>to send · paste images directly</span>
					</span>
					<div style={{ flex: 1 }} />
					<button
						onClick={send}
						disabled={disabled || sending || !canSend}
						className="btn btn-primary"
					>
						{sending ? "…" : "Send"}
						{!sending ? (
							<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
								<path
									d="M2 6h8M7 3l3 3-3 3"
									stroke="currentColor"
									strokeWidth="1.6"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
						) : null}
					</button>
				</div>
			</div>
		</div>
	);
}
