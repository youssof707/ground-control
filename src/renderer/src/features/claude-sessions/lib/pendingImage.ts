import type { UserImageMediaType } from "@shared/claude-sessions/types";

/**
 * An image pasted into the message input but not yet sent. `data` is the
 * base64 payload sent to the SDK; `previewUrl` is the full `data:` URL used
 * to render the thumbnail. Both come from a single FileReader.readAsDataURL
 * call in ImagePasteTextarea.onPaste.
 */
export interface PendingImage {
	media_type: UserImageMediaType;
	data: string;
	previewUrl: string;
}
