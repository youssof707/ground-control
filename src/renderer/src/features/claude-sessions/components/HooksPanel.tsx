import { useEffect, useRef, useState } from "react";
import { T } from "../../../design/tokens";
import { useSettingsStore } from "../stores/useSettingsStore";
import { MessageField } from "./BabysitRules";
import { Section } from "./SettingsSection";

const PROMPT_AUTOSAVE_DELAY_MS = 400;
const PROMPT_MAX_LENGTH = 8000;

export function HooksPanel() {
	const [prompt, setPrompt] = useState(
		() => useSettingsStore.getState().onSessionDeletePrompt ?? "",
	);
	useAutosavedDeleteHookPrompt(prompt);
	const enabled = prompt.trim().length > 0;

	return (
		<Section title="On session delete">
			<div
				style={{
					fontSize: 12.5,
					color: T.textDim,
					lineHeight: 1.5,
					marginBottom: 10,
				}}
			>
				Sent to a live session as its last message when you delete it. Once
				the reply finishes, the session and everything it started are shut
				down.
			</div>
			<MessageField
				ariaLabel="Prompt sent to a session before it is deleted"
				value={prompt}
				onChange={setPrompt}
				placeholder="Summarize what you learned in this session and save it to…"
				rows={6}
				maxLength={PROMPT_MAX_LENGTH}
			/>
			<div
				style={{
					fontSize: 12,
					color: enabled ? T.textMute : T.textFaint,
					lineHeight: 1.5,
					marginTop: 8,
				}}
			>
				{enabled
					? "Runs hidden. Prompts are answered by the Babysitter defaults, the rest are denied. Gives up after 5 minutes."
					: "Off. Deleted sessions shut down immediately."}
			</div>
		</Section>
	);
}

function useAutosavedDeleteHookPrompt(prompt: string) {
	const latest = useRef(prompt);
	latest.current = prompt;

	useEffect(() => {
		const timer = setTimeout(
			() => useSettingsStore.getState().setOnSessionDeletePrompt(latest.current),
			PROMPT_AUTOSAVE_DELAY_MS,
		);
		return () => clearTimeout(timer);
	}, [prompt]);

	useEffect(
		() => () =>
			useSettingsStore.getState().setOnSessionDeletePrompt(latest.current),
		[],
	);
}
