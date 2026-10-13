import { AppNavMock } from "./AppNavMock";
import { AssistantMessage, BoltIcon, Btn, IconBtn, PlusIcon, ToolPill, ToolRunGroup, UserBubble } from "./atoms";
import { Composer } from "./Composer";
import { SectionHeader, SessionRow, Well } from "./SessionRow";

export function AppShellMock() {
	return (
		<div className="flex h-[600px] w-[960px] flex-col overflow-hidden rounded-xl border-[0.5px] border-gc-border bg-gc-win">
			<AppNavMock running={3} editing={1} waiting={2} inbox={2} />
			<div className="flex min-h-0 flex-1">
				<aside className="flex w-[300px] flex-none flex-col border-r-[0.5px] border-gc-border-soft">
					<div className="flex gap-1.5 border-b-[0.5px] border-gc-border-soft px-3 pt-3 pb-2.5">
						<Btn tone="primary" className="flex-1"><PlusIcon /> New Session</Btn>
						<IconBtn className="h-8 w-8 rounded-lg"><BoltIcon /></IconBtn>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden">
						<SessionRow
							title="Fix flaky upload test"
							summary="Narrowed it to a race in the retry queue. Writing the fix now."
							status="running"
							branch="fix/upload-retry"
							unread
						/>
						<SessionRow
							title="Settings page redesign"
							summary="Plan is ready. Four files change, one new component."
							status="planning complete"
							branch="feat/settings"
							active
						/>
						<SessionRow
							title="Migrate auth to sessions"
							summary="Needs permission to run the migration script."
							status="waiting for input"
							detail="Bash"
							babysit
						/>
						<Well>
							<SectionHeader name="payments" tone="info" open />
							<SessionRow title="Stripe webhook retries" summary="Added idempotency keys. Tests pass." status="done" branch="main" />
							<SessionRow title="Refund flow" summary="Reading the existing handler." status="running" last />
						</Well>
						<SessionRow title="Docs cleanup" summary="Rewrote the README install section." status="idle" folder="ground-control" last />
					</div>
				</aside>
				<main className="flex min-w-0 flex-1 flex-col">
					<div className="flex items-center gap-2.5 border-b-[0.5px] border-gc-border-soft px-6 py-3">
						<span className="text-[14px] font-semibold text-gc-text">Settings page redesign</span>
						<span className="font-mono text-[11px] text-gc-text-faint">feat/settings · ground-control</span>
					</div>
					<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-8 pt-6">
						<UserBubble>Move the settings page to a two-column layout and keep every existing option.</UserBubble>
						<AssistantMessage>
							<p>I'll look at the current page first, then put a plan together.</p>
						</AssistantMessage>
						<ToolRunGroup count={4} names={["Read", "Grep", "Read", "Glob"]} thinking />
						<ToolPill tag="read" summary="src/renderer/src/features/settings/SettingsPage.tsx" />
						<AssistantMessage>
							<p>The page is one long form. A two-column split needs a sidebar list of sections and a scroll container on the right. Plan is ready for review.</p>
						</AssistantMessage>
					</div>
					<div className="px-8 pt-2 pb-4">
						<Composer mode="Plan" />
					</div>
				</main>
			</div>
		</div>
	);
}
