import { create } from "zustand";
import type { FileViewResult } from "@shared/schemas/file_view";
import type { FileRef } from "./fileRef";

export interface OpenFile {
	ref: FileRef;
	result: FileViewResult;
}

interface FileViewerState {
	file: OpenFile | null;
	open: (file: OpenFile) => void;
	close: () => void;
}

export const useFileViewerStore = create<FileViewerState>((set) => ({
	file: null,
	open: (file) => set({ file }),
	close: () => set({ file: null }),
}));
