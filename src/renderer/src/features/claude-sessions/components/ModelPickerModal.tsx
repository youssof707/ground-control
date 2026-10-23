import { useEffect, useMemo, useRef } from "react";
import { useBackdropDismiss } from "../../../components/useBackdropDismiss";
import { T } from "../../../design/tokens";
import {
	identityMatches,
	parseModelIdentity,
	parseOptionIdentity,
} from "@shared/claude-sessions/sessionModel";
import { focusComposer } from "../lib/composerActions";
import {
	assignModelHotkeys,
	refreshModelOptions,
	useModelOptionsStore,
	type ModelOption,
} from "../lib/modelOptionsCache";

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

const SYNTHETIC_DEFAULT: ModelOption = {
	value: undefined,
	displayName: "Default",
};

const isDefaultRow = (o: ModelOption) =>
	o.value === undefined || o.value === "default";

interface Row {
	key: string;
	dispatchValue: string | undefined;
	title: string;
	subtitle: string | undefined;
	hotkey: string | null;
	selected: boolean;
}

function buildRows(
	options: ModelOption[],
	effectiveModel: string | undefined,
): Row[] {
	const cliHasDefault = options.some((o) => o.value === "default");
	const rowsToRender = cliHasDefault ? options : [SYNTHETIC_DEFAULT, ...options];

	const effectiveIdentity = parseModelIdentity(effectiveModel);
	const rowIdentities = rowsToRender.map((o) =>
		isDefaultRow(o)
			? null
			: parseOptionIdentity(o.value, o.description, o.displayName),
	);

	let selectedIndex = -1;
	if (effectiveIdentity === null) {
		selectedIndex = rowsToRender.findIndex(isDefaultRow);
	} else {
		const matches = rowIdentities.flatMap((id, i) =>
			identityMatches(effectiveIdentity, id) ? [i] : [],
		);
		const versioned = matches.filter(
			(i) => rowIdentities[i]?.major !== undefined,
		);
		selectedIndex = (versioned.length > 0 ? versioned : matches)[0] ?? -1;
	}

	const titled = rowsToRender.map((o, i) => {
		const identity = rowIdentities[i];
		const versioned = !isDefaultRow(o) && identity?.major !== undefined;
		return {
			option: o,
			title: versioned && identity ? cap(identity.family) : o.displayName,
			subtitle: versioned
				? o.displayName
				: isDefaultRow(o)
					? o.description
					: undefined,
		};
	});
	const hotkeys = assignModelHotkeys(titled.map((t) => t.title));

	return titled.map((t, i) => ({
		key: t.option.value ?? "__default__",
		dispatchValue: isDefaultRow(t.option) ? undefined : t.option.value,
		title: t.title,
		subtitle: t.subtitle,
		hotkey: hotkeys[i],
		selected: i === selectedIndex,
	}));
}

export function ModelPickerModal({
	open,
	sessionId,
	effectiveModel,
	subtitle = "Applies to this session only.",
	focusComposerAfterSelect = true,
	onSelect,
	onSwitchAndResume,
	isRunning,
	onClose,
}: {
	open: boolean;
	sessionId?: string;
	effectiveModel: string | undefined;
	subtitle?: string;
	focusComposerAfterSelect?: boolean;
	onSelect: (value: string | undefined) => Promise<void> | void;
	onSwitchAndResume?: (value: string | undefined) => Promise<void> | void;
	isRunning?: boolean;
	onClose: () => void;
}) {
	const options = useModelOptionsStore((s) => s.options);
	const error = useModelOptionsStore((s) => s.error);

	useEffect(() => {
		if (open) void refreshModelOptions(sessionId);
	}, [open, sessionId]);

	const rows = useMemo(
		() => (options ? buildRows(options, effectiveModel) : []),
		[options, effectiveModel],
	);

	const pick = (value: string | undefined) => {
		onClose();
		if (focusComposerAfterSelect) focusComposer();
		const apply = isRunning && onSwitchAndResume ? onSwitchAndResume : onSelect;
		void Promise.resolve()
			.then(() => apply(value))
			.catch((err) => console.error("[ccw] model pick failed:", err));
	};

	const pickRef = useRef(pick);
	pickRef.current = pick;
	const rowsRef = useRef(rows);
	rowsRef.current = rows;

	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const key = e.key.toLowerCase();
			const row = rowsRef.current.find((r) => r.hotkey === key);
			if (!row) return;
			e.preventDefault();
			e.stopPropagation();
			pickRef.current(row.dispatchValue);
		};
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, [open, onClose]);

	const backdropProps = useBackdropDismiss(onClose);

	if (!open) return null;

	const loading = options === null && !error;

	return (
		<div className="modal-backdrop" {...backdropProps}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="model-picker-title"
			>
				<h2 id="model-picker-title" className="modal-title">
					Model
				</h2>
				<div className="modal-message">
					{subtitle}
					{isRunning && onSwitchAndResume
						? " Picking a model stops the current response and continues with it automatically."
						: ""}
				</div>

				{loading ? (
					<div
						role="status"
						aria-live="polite"
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: 10,
							minHeight: 120,
							margin: "12px 0 4px",
							color: T.textMute,
							fontSize: 12,
						}}
					>
						<span className="asyncy-btn-spinner" aria-hidden />
						<span>Loading models…</span>
					</div>
				) : options ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 6,
							margin: "12px 0 4px",
						}}
					>
						{rows.map((row) => (
							<button
								key={row.key}
								onClick={() => pick(row.dispatchValue)}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 12,
									padding: "8px 12px",
									borderRadius: 8,
									border: `1px solid ${row.selected ? T.accentBorder : T.borderSoft}`,
									background: row.selected ? T.accentSoft : T.surfaceLow,
									color: T.text,
									cursor: "pointer",
									textAlign: "left",
									font: "inherit",
								}}
							>
								<span
									style={{
										display: "flex",
										flexDirection: "column",
										alignItems: "flex-start",
										gap: 2,
										minWidth: 0,
									}}
								>
									<span
										style={{
											display: "flex",
											alignItems: "center",
											gap: 8,
										}}
									>
										<span style={{ fontSize: 13, fontWeight: 600 }}>
											{row.title}
										</span>
										{row.selected ? (
											<span
												style={{
													fontSize: 11,
													fontWeight: 400,
													color: T.accent,
												}}
											>
												current
											</span>
										) : null}
									</span>
									{row.subtitle ? (
										<span
											style={{
												fontSize: 11,
												fontWeight: 400,
												color: T.textMute,
												lineHeight: 1.35,
											}}
										>
											{row.subtitle}
										</span>
									) : null}
								</span>
								{row.hotkey ? (
									<span
										aria-hidden
										style={{
											marginLeft: "auto",
											flexShrink: 0,
											minWidth: 18,
											padding: "1px 5px",
											borderRadius: 4,
											border: `1px solid ${T.borderSoft}`,
											fontFamily: T.mono,
											fontSize: 11,
											lineHeight: "16px",
											textAlign: "center",
											color: T.textMute,
										}}
									>
										{row.hotkey.toUpperCase()}
									</span>
								) : null}
							</button>
						))}
					</div>
				) : null}

				{options !== null && options.length === 0 ? (
					<div
						style={{
							fontSize: 12,
							color: T.textMute,
							margin: "8px 0 4px",
							fontStyle: "italic",
						}}
					>
						No models reported by the CLI.
					</div>
				) : null}

				{error && options === null ? (
					<div className="modal-error">{error}</div>
				) : null}

				<div className="modal-actions">
					<button className="btn" onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
