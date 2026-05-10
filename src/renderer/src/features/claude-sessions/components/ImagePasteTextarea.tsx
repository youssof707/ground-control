import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type {
	UserContentBlock,
	UserImageMediaType,
} from "@shared/claude-sessions/types";
import { useSessionsStore } from "../stores/useSessionsStore";

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
			// Optimistic append — main process also persists this same shape so
			// it survives restart. The message id we use here is renderer-only;
			// after restart, main's persisted copy will have its own id.
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

	return (
		<div
			style={{
				borderTop: "1px solid #e5e5ea",
				background: "#fff",
				padding: 12,
				display: "flex",
				flexDirection: "column",
				gap: 8,
			}}
		>
			{images.length > 0 ? (
				<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
									border: "1px solid #e5e5ea",
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
									background: "#1d1d1f",
									color: "#fff",
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
					style={{ padding: 8, fontSize: 12 }}
				>
					{error}
				</div>
			) : null}

			<div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					onPaste={onPaste}
					onKeyDown={onKeyDown}
					disabled={disabled || sending}
					placeholder="Type or paste an image…"
					style={{
						flex: 1,
						minHeight: 60,
						padding: 8,
						border: "1px solid #e5e5ea",
						borderRadius: 6,
						resize: "vertical",
						fontFamily: "inherit",
						fontSize: 13,
					}}
				/>
				<button
					onClick={send}
					disabled={disabled || sending || (!text.trim() && images.length === 0)}
					className="btn"
					style={{
						background: "#1d1d1f",
						color: "#fff",
						borderColor: "#1d1d1f",
						alignSelf: "stretch",
						minWidth: 72,
					}}
				>
					{sending ? "…" : "Send"}
				</button>
			</div>

			<div style={{ fontSize: 11, color: "#86868b" }}>
				⌘/Ctrl+Enter to send · paste images directly
			</div>
		</div>
	);
}
