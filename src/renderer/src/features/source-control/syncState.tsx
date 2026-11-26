import type { ScmSummary } from "@shared/schemas/source_control";

export type SyncState = {
	upstream: string | null;
	ahead: number;
	behind: number;
	showPull: boolean;
	showPush: boolean;
};

export function syncState(summary: ScmSummary | undefined, branch: string | null): SyncState {
	const upstream = summary?.upstream ?? null;
	const unpublished = summary && branch && !upstream ? summary.unpublished : null;
	const ahead = upstream ? summary?.ahead ?? 0 : unpublished ?? 0;
	const behind = upstream ? summary?.behind ?? 0 : 0;
	return {
		upstream,
		ahead,
		behind,
		showPull: behind > 0,
		showPush: upstream ? ahead > 0 : unpublished !== null,
	};
}

export function SyncArrow({ up }: { up: boolean }) {
	return (
		<svg width={10} height={10} viewBox="0 0 10 10" fill="none" aria-hidden="true">
			<path
				d={up ? "M5 8.5V1.8M2 4.6 5 1.6l3 3" : "M5 1.5v6.7M2 5.4l3 3 3-3"}
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
