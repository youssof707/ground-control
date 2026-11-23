import { createContext, useContext, type ReactNode } from "react";
import { useSessionCheckout } from "../source-control/useSessionCheckout";

const FileLinkCwd = createContext<string | undefined>(undefined);

export function FileLinkProvider({ sessionId, children }: { sessionId: string; children: ReactNode }) {
	const cwd = useSessionCheckout(sessionId);
	return <FileLinkCwd.Provider value={cwd}>{children}</FileLinkCwd.Provider>;
}

export function useFileLinkCwd(): string | undefined {
	return useContext(FileLinkCwd);
}
