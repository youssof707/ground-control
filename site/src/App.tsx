import { FeaturePanel } from "./components/FeaturePanel";
import { Footer } from "./components/Footer";
import { glows } from "./components/Glow";
import { Hero } from "./components/Hero";
import { Nav } from "./components/Nav";
import { Kbd } from "./mocks/atoms";
import { AppShellMock } from "./mocks/AppShellMock";
import { BabysitMock } from "./mocks/BabysitMock";
import { GroupsMock } from "./mocks/GroupsMock";
import { InboxMock } from "./mocks/InboxMock";
import { ModelMock } from "./mocks/ModelMock";
import { SidequestMock } from "./mocks/SidequestMock";
import { SkillsMock } from "./mocks/SkillsMock";
import { StatusesMock } from "./mocks/StatusesMock";
import { TasksMock } from "./mocks/TasksMock";
import { TokensMock } from "./mocks/TokensMock";
import { WorktreesMock } from "./mocks/WorktreesMock";

function Shortcut({ keys, label }: { keys: string; label: string }) {
	return (
		<div className="flex items-center gap-2.5 text-[13px] text-gc-text-mute">
			<Kbd className="h-6 px-2 text-[12px]">{keys}</Kbd>
			<span>{label}</span>
		</div>
	);
}

export function App() {
	return (
		<>
			<Nav />
			<main>
				<Hero />
				<div className="mx-auto flex max-w-[80rem] flex-col gap-14 px-6 py-16 lg:gap-16 lg:px-8 lg:py-24">
					<FeaturePanel
						id="overview"
						lead="All your sessions in one window."
						body="Sessions on the left, the conversation on the right. Unread replies get a dot so you can see which ones need you."
						bullets={["Each session is its own Claude Code process.", "Counts at the top show how many are running, editing, or waiting."]}
						glow={[glows.accent, glows.info, glows.neutral]}
						canvas={{ width: 960, height: 600 }}
					>
						<AppShellMock />
					</FeaturePanel>

					<FeaturePanel
						id="sidequest"
						flip
						lead="Ask a side question without touching the main thread."
						body="Select some text and press ⌘S. A temporary fork opens on the right with the same context up to that point."
						bullets={[
							"Runs in parallel with the main session.",
							"Nothing it says goes back into the session.",
							"Keep it, and it becomes a real session. Close it, and it's gone.",
						]}
						hint={<Shortcut keys="⌘S" label="Open a sidequest from the selection" />}
						glow={[glows.babysit, glows.accent, glows.info]}
						canvas={{ width: 760, height: 540 }}
					>
						<SidequestMock />
					</FeaturePanel>

					<FeaturePanel
						id="statuses"
						lead="See what every session is doing."
						body="Running, planning, planning complete, waiting for input, done, errored. The pill on each row tells you without opening it."
						glow={[glows.ok, glows.warn, glows.info]}
						canvas={{ width: 600, height: 520 }}
					>
						<StatusesMock />
					</FeaturePanel>

					<FeaturePanel
						id="inbox"
						flip
						lead="Everything waiting on you, in one list."
						body="Plan approvals, permission requests, and questions from every session. Answer them here instead of switching sessions to find them."
						glow={[glows.warn, glows.accent, glows.neutral]}
						canvas={{ width: 640, height: 560 }}
					>
						<InboxMock />
					</FeaturePanel>

					<FeaturePanel
						id="babysitter"
						lead="Let it answer for you."
						body="Per session, pick what happens to plan approvals, permission requests, and questions while you're away."
						bullets={["Approve, deny, or answer with a message you wrote.", "Prompts already waiting get answered when you save."]}
						hint={<Shortcut keys="⌘⇧B" label="Open the babysitter for the active session" />}
						glow={[glows.babysit, glows.accent, glows.neutral]}
						canvas={{ width: 620, height: 520 }}
					>
						<BabysitMock />
					</FeaturePanel>

					<FeaturePanel
						id="tasks"
						flip
						lead="Background work, listed."
						body="Shell commands, agents, and workflows that are still running, with how long they've been going. Stop any of them from the list."
						glow={[glows.ok, glows.info, glows.accent]}
						canvas={{ width: 640, height: 460 }}
					>
						<TasksMock />
					</FeaturePanel>

					<FeaturePanel
						id="worktrees"
						lead="One session, one checkout."
						body="Give a session its own git worktree and branch so parallel sessions don't edit the same files."
						bullets={["See which sessions use each worktree.", "Remove the ones nothing is using."]}
						glow={[glows.info, glows.accent, glows.danger]}
						canvas={{ width: 620, height: 480 }}
					>
						<WorktreesMock />
					</FeaturePanel>

					<FeaturePanel
						id="groups"
						flip
						lead="Group related sessions."
						body="Put sessions in named, colored groups. Collapse a group and its header still shows how many are running or waiting."
						glow={[glows.neutral, glows.accent, glows.info]}
						canvas={{ width: 600, height: 500 }}
					>
						<GroupsMock />
					</FeaturePanel>

					<FeaturePanel
						id="tokens"
						lead="Know how much context is left."
						body="Input, output, and context tokens for every session, next to the model it's using. Rate-limit reset time sits in the sidebar."
						glow={[glows.warn, glows.ok, glows.info]}
						canvas={{ width: 640, height: 380 }}
					>
						<TokensMock />
					</FeaturePanel>

					<FeaturePanel
						id="model"
						flip
						lead="Switch models mid-session."
						body="Changing model while Claude is working stops the turn, switches, and continues on its own."
						hint={<Shortcut keys="⌘⇧M" label="Open the model picker" />}
						glow={[glows.accent, glows.info, glows.babysit]}
						canvas={{ width: 560, height: 500 }}
					>
						<ModelMock />
					</FeaturePanel>

					<FeaturePanel
						id="skills"
						lead="Skills and your own shortcuts, one menu."
						body="Lists the skills in ~/.claude/skills and the prompts you've saved. Pick one and it goes into the composer."
						bullets={["A shortcut is a name, a prompt, and a mode.", "Skills come straight from your Claude Code setup."]}
						hint={<Shortcut keys="⌘K" label="Open the shortcut menu" />}
						glow={[glows.info, glows.babysit, glows.accent]}
						canvas={{ width: 680, height: 480 }}
					>
						<SkillsMock />
					</FeaturePanel>
				</div>

				<section className="mx-auto max-w-[80rem] px-6 pb-24 lg:px-8">
					<div className="flex flex-col items-center gap-6 text-center">
						<h2 className="text-[26px] font-semibold tracking-tight text-balance text-gc-text md:text-3xl lg:text-[34px]">
							That's the app.
						</h2>
						<p className="max-w-md text-[16px] leading-relaxed text-gc-text-dim">Free, runs on your Mac, uses your own Claude Code login.</p>
						<div className="flex flex-wrap items-center justify-center gap-3">
							<a
								href="#"
								className="group inline-flex h-12 items-center gap-1.5 rounded-[14px] bg-gc-text px-5 text-[15px] font-semibold text-gc-accent-ink transition-colors hover:bg-gc-accent"
							>
								Download for macOS
								<span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
							</a>
							<a href="#" className="inline-flex h-12 items-center rounded-[14px] px-4 text-[15px] font-medium text-gc-text-dim transition-colors hover:text-gc-text">
								GitHub →
							</a>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</>
	);
}
