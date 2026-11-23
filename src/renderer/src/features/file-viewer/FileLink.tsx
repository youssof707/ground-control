import type { MouseEvent, ReactNode } from "react";
import { formatFileRef, type FileRef } from "./fileRef";
import { useFileLinkCwd } from "./FileLinkContext";
import { openFileRef } from "./openFileRef";

export function FileLink({ fileRef, children }: { fileRef: FileRef; children: ReactNode }) {
	const cwd = useFileLinkCwd();
	const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
		e.preventDefault();
		e.stopPropagation();
		void openFileRef(fileRef, cwd).catch(() => undefined);
	};
	return (
		<a href="#" className="file-link" onClick={onClick} aria-label={`Open ${formatFileRef(fileRef)}`}>
			{children}
		</a>
	);
}
