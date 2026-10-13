import { Lifted } from "../components/Lifted";
import { AppNavMock } from "./AppNavMock";
import { SessionRow } from "./SessionRow";

export function StatusesMock() {
	return (
		<div className="relative h-[520px] w-[600px]">
			<div className="absolute inset-x-6 top-0 overflow-hidden rounded-xl border-[0.5px] border-gc-border opacity-70 [mask-image:linear-gradient(to_bottom,black_40%,transparent)]">
				<AppNavMock running={2} editing={1} waiting={2} inbox={2} />
			</div>
			<Lifted className="absolute top-[64px] left-1/2 w-[400px] -translate-x-1/2">
				<div className="overflow-hidden rounded-xl bg-gc-win">
					<SessionRow title="Fix flaky upload test" summary="Writing the fix in the retry queue." status="running" branch="fix/upload-retry" />
					<SessionRow title="Settings page redesign" summary="Reading the current page before proposing anything." status="planning" branch="feat/settings" />
					<SessionRow title="Rate limit middleware" summary="Plan is ready. Waiting for you to approve it." status="planning complete" unread />
					<SessionRow title="Migrate auth to sessions" summary="Asking to run the migration script." status="waiting for input" detail="Bash" babysit />
					<SessionRow title="Stripe webhook retries" summary="Added idempotency keys. Tests pass." status="done" branch="main" />
					<SessionRow title="Import legacy users" summary="Script failed on a malformed row." status="errored" last />
				</div>
			</Lifted>
		</div>
	);
}
