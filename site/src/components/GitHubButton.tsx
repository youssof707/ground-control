import { cx } from "../lib/cx";

export const GITHUB_URL = "https://github.com/youssof707/ground-control";

export function GitHubMark({ size = 18 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	);
}

export const DOWNLOAD_URL = `${GITHUB_URL}/releases/latest/download/ground-control-arm64.dmg`;

export function DownloadButton() {
	return (
		<a
			href={DOWNLOAD_URL}
			className="group inline-flex h-12 items-center gap-2 rounded-[14px] bg-gc-text px-5 text-[15px] font-semibold text-gc-accent-ink transition-colors hover:bg-gc-accent"
		>
			<svg width={18} height={18} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
				<path d="M11.18 8.5c-.02-1.6 1.31-2.37 1.37-2.41-.75-1.09-1.91-1.24-2.32-1.26-.99-.1-1.93.58-2.43.58-.5 0-1.27-.57-2.09-.55-1.08.02-2.07.62-2.62 1.59-1.12 1.94-.29 4.81.8 6.38.53.77 1.17 1.63 2 1.6.8-.03 1.11-.52 2.08-.52.97 0 1.24.52 2.09.5.86-.01 1.41-.78 1.94-1.55.61-.89.86-1.75.88-1.8-.02-.01-1.68-.65-1.7-2.56ZM9.58 3.79c.44-.54.74-1.28.66-2.03-.64.03-1.41.43-1.87.96-.41.47-.77 1.23-.67 1.96.71.05 1.44-.36 1.88-.89Z" />
			</svg>
			Download for Mac
		</a>
	);
}

export function GitHubButton({ size = "lg", variant = "primary" }: { size?: "lg" | "sm"; variant?: "primary" | "secondary" }) {
	return (
		<a
			href={GITHUB_URL}
			className={cx(
				"group inline-flex items-center gap-2 font-semibold transition-colors",
				variant === "primary"
					? "bg-gc-text text-gc-accent-ink hover:bg-gc-accent"
					: "border border-white/15 text-gc-text hover:bg-white/5",
				size === "lg" ? "h-12 rounded-[14px] px-5 text-[15px]" : "rounded-xl px-4 py-2 text-[14px]",
			)}
		>
			<GitHubMark size={size === "lg" ? 18 : 15} />
			View on GitHub
			<span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
		</a>
	);
}
