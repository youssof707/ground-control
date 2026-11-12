import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../activityLog", () => ({
	logActivity: vi.fn(),
	describeError: (err: unknown) => String(err),
}));

import { KeepAwake } from "./KeepAwake";

function fakeChild() {
	const child = Object.assign(new EventEmitter(), { pid: 4242, kill: vi.fn() });
	return child;
}

const platform = process.platform;

beforeEach(() => {
	vi.useFakeTimers();
	Object.defineProperty(process, "platform", { value: "darwin" });
	mocks.spawn.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	Object.defineProperty(process, "platform", { value: platform });
});

describe("KeepAwake hold and linger", () => {
	it("stops 60s after a hold ends, even when the timer fires early", async () => {
		const child = fakeChild();
		mocks.spawn.mockReturnValue(child);
		let now = 1_000_000;
		const keepAwake = new KeepAwake(() => false, () => now);
		keepAwake.holdFor(90_000);
		expect(mocks.spawn).toHaveBeenCalledWith("/usr/bin/caffeinate", expect.any(Array), expect.any(Object));
		now += 89_999;
		await vi.advanceTimersByTimeAsync(90_000);
		expect(child.kill).not.toHaveBeenCalled();
		now += 59_000;
		await vi.advanceTimersByTimeAsync(59_000);
		expect(child.kill).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(child.kill).toHaveBeenCalledTimes(1);
	});

	it("cancels the linger when a session wants caffeinate again", async () => {
		const child = fakeChild();
		mocks.spawn.mockReturnValue(child);
		const keepAwake = new KeepAwake(() => true);
		keepAwake.setBusy("s1", true);
		keepAwake.setBusy("s1", false);
		await vi.advanceTimersByTimeAsync(30_000);
		keepAwake.setBusy("s1", true);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(child.kill).not.toHaveBeenCalled();
		expect(mocks.spawn).toHaveBeenCalledTimes(1);
	});

	it("dispose stops immediately", () => {
		const child = fakeChild();
		mocks.spawn.mockReturnValue(child);
		const keepAwake = new KeepAwake(() => true);
		keepAwake.setBusy("s1", true);
		keepAwake.dispose();
		expect(child.kill).toHaveBeenCalledTimes(1);
	});
});
