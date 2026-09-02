import { useNavigate } from "react-router-dom";
import type { Shortcut } from "@shared/schemas/shortcuts";
import type { Skill } from "@shared/schemas/skills";
import { useCommandPaletteStore } from "../stores/useCommandPaletteStore";
import { appendPromptBlock, applyShortcutMode, focusComposer } from "../lib/composerActions";
import {
	startSessionFromShortcut,
	startSessionFromSkill,
} from "../lib/sessionStartActions";
import { useSettingsStore } from "../stores/useSettingsStore";
import { ShortcutsPickerModal } from "./ShortcutsMenu";

/**
 * Singleton instance of the Skills/Shortcuts picker driven by the global
 * Cmd+K hotkey (`useCommandPaletteHotkey`). Mounted once in `MainApp`,
 * alongside `UpdateModal`.
 *
 * Branches on `target.kind` (set by the hotkey based on where focus was)
 * to reuse exactly the same two behaviors the existing bolt buttons offer:
 *
 *   - "new-session": same flow as the sidebar's ⚡ button
 *     (`SessionsList.startFromShortcut`/`startFromSkill`), via the shared
 *     `lib/sessionStartActions.ts` helpers. No local `workspaceFilter` to
 *     reconcile here — see that module's doc comment.
 *   - "insert": same flow as the composer footer's ⚡ button
 *     (`ImagePasteTextarea.runShortcut`/`runSkill`) for the target session.
 */
export function CommandPaletteModal() {
	const open = useCommandPaletteStore((s) => s.open);
	const target = useCommandPaletteStore((s) => s.target);
	const close = useCommandPaletteStore((s) => s.close);
	const navigate = useNavigate();

	const handleRun = (sc: Shortcut) => {
		if (target.kind === "insert") {
			appendPromptBlock(target.sessionId, sc.prompt);
			void applyShortcutMode(target.sessionId, sc.mode);
			focusComposer();
			return;
		}
		const targetCwd = useSettingsStore.getState().lastUsedWorkspace ?? null;
		void startSessionFromShortcut(sc, navigate, { targetCwd });
	};

	const handleRunSkill = (skill: Skill) => {
		if (target.kind === "insert") {
			appendPromptBlock(target.sessionId, `/${skill.name}`);
			focusComposer();
			return;
		}
		const targetCwd = useSettingsStore.getState().lastUsedWorkspace ?? null;
		void startSessionFromSkill(skill, navigate, { targetCwd });
	};

	return (
		<ShortcutsPickerModal
			open={open}
			onOpenChange={(v) => {
				if (!v) close();
			}}
			onRun={handleRun}
			onRunSkill={handleRunSkill}
		/>
	);
}
