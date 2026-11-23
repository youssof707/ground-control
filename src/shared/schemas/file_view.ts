export type FileViewContent =
	| { kind: "text"; text: string; lossy: boolean }
	| { kind: "binary" }
	| { kind: "directory" }
	| { kind: "too-large"; bytes: number }
	| { kind: "gone" }
	| { kind: "error"; message: string };

export type FileViewResult = FileViewContent & { path: string };

export interface FileViewRequest {
	path: string;
	cwd?: string;
}
