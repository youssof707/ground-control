import { AppNavMock } from "./AppNavMock";
import { AssistantMessage, BoltIcon, Btn, IconBtn, PlusIcon, ToolRunGroup, UserBubble } from "./atoms";
import { Composer } from "./Composer";
import { SectionHeader, SessionRow, Well } from "./SessionRow";

export function AppShellMock() {
	return (
		<div className="flex h-[660px] w-[1120px] flex-col overflow-hidden rounded-xl border-[0.5px] border-gc-border bg-gc-win">
			<AppNavMock running={2} editing={1} waiting={1} inbox={1} />
			<div className="flex min-h-0 flex-1">
				<aside className="flex w-[330px] flex-none flex-col border-r-[0.5px] border-gc-border-soft">
					<div className="flex gap-1.5 border-b-[0.5px] border-gc-border-soft px-3 pt-3 pb-2.5">
						<Btn tone="primary" className="flex-1"><PlusIcon /> New Session</Btn>
						<IconBtn className="h-8 w-8 rounded-lg"><BoltIcon /></IconBtn>
					</div>
					<div className="min-h-0 flex-1 overflow-hidden">
						<SessionRow
							title="Fix flaky upload test"
							summary="Found a race in the retry queue."
							status="running"
							unread
						/>
						<SessionRow
							title="Settings page redesign"
							summary="Plan is ready for review."
							status="planning complete"
							active
						/>
						<SessionRow
							title="Migrate auth to sessions"
							summary="Wants to run the migration script."
							status="waiting for input"
						/>
						<Well>
							<SectionHeader name="payments" tone="info" badges={{ running: 1 }} />
						</Well>
						<SessionRow title="Docs cleanup" summary="Rewrote the install section." status="done" last />
					</div>
				</aside>
				<main className="flex min-w-0 flex-1 flex-col">
					<div className="flex items-center gap-2.5 border-b-[0.5px] border-gc-border-soft px-8 py-3.5">
						<span className="text-[14px] font-semibold text-gc-text">Settings page redesign</span>
						<span className="font-mono text-[11px] text-gc-text-faint">feat/settings</span>
					</div>
					<div className="flex min-h-0 flex-1 flex-col gap-7 overflow-hidden px-12 pt-10">
						<UserBubble>Move the settings page to a two-column layout.</UserBubble>
						<div>
							<AssistantMessage>
								<p>I'll read the current page first, then put a plan together.</p>
							</AssistantMessage>
							<div className="mt-4">
								<ToolRunGroup count={3} names={["Read", "Grep", "Glob"]} />
							</div>
						</div>
						<AssistantMessage>
							<p>The page is one long form. I'd split it into a section list on the left and a scrolling panel on the right. The plan is ready for review.</p>
						</AssistantMessage>
					</div>
					<div className="px-12 pt-2 pb-6">
						<Composer mode="Plan" />
					</div>
				</main>
			</div>
		</div>
	);
}
