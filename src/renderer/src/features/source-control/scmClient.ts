import {
	SCM_PORT_MESSAGE,
	type ScmCallFor,
	type ScmCallKind,
	type ScmFailure,
	type ScmReply,
	type ScmReplyFor,
	type ScmRequest,
} from "@shared/schemas/source_control";

export type ScmConnection = "connecting" | "ready" | "down";

export interface ScmCall<K extends ScmCallKind> {
	id: number;
	promise: Promise<ScmReplyFor<K>>;
}

interface Pending {
	kind: ScmCallKind;
	resolve: (reply: ScmReply) => void;
}

const CONNECT_TIMEOUT_MS = 10_000;
const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS = 3;

let port: MessagePort | null = null;
let connection: ScmConnection = "connecting";
let started = false;
let connectTimer: number | null = null;
let restarts: number[] = [];
let nextId = 1;
const outbox: ScmRequest[] = [];
const pending = new Map<number, Pending>();
const listeners = new Set<(state: ScmConnection) => void>();

function failure(kind: ScmCallKind, id: number, reason: ScmFailure): ScmReply {
	return { t: kind, id, ok: false, reason } as ScmReply;
}

function setConnection(next: ScmConnection): void {
	if (connection === next) return;
	connection = next;
	for (const fn of listeners) fn(next);
}

function receive(reply: unknown): void {
	if (!reply || typeof reply !== "object") return;
	const id = (reply as { id?: unknown }).id;
	if (typeof id !== "number") return;
	const entry = pending.get(id);
	if (!entry) return;
	pending.delete(id);
	entry.resolve(reply as ScmReply);
}

function failAll(): void {
	const entries = [...pending.entries()];
	pending.clear();
	outbox.length = 0;
	for (const [id, entry] of entries) entry.resolve(failure(entry.kind, id, "failed"));
}

function clearConnectTimer(): void {
	if (connectTimer !== null) window.clearTimeout(connectTimer);
	connectTimer = null;
}

function onPort(event: MessageEvent): void {
	if (event.source !== window) return;
	const data = event.data as { type?: unknown } | null;
	if (!data || data.type !== SCM_PORT_MESSAGE) return;
	const next = event.ports[0];
	if (!next) return;
	clearConnectTimer();
	port?.close();
	port = next;
	port.onmessage = (e) => receive(e.data);
	setConnection("ready");
	for (const request of outbox.splice(0)) port.postMessage(request);
}

function connect(): void {
	setConnection("connecting");
	clearConnectTimer();
	connectTimer = window.setTimeout(onWorkerExit, CONNECT_TIMEOUT_MS);
	try {
		window.claude?.connectSourceControl();
	} catch {
		onWorkerExit();
	}
}

function onWorkerExit(): void {
	clearConnectTimer();
	port?.close();
	port = null;
	failAll();
	const now = Date.now();
	restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS);
	if (restarts.length >= MAX_RESTARTS) {
		setConnection("down");
		return;
	}
	restarts.push(now);
	setConnection("connecting");
	connectTimer = window.setTimeout(connect, 400 * restarts.length);
}

function ensureStarted(): void {
	if (started) return;
	started = true;
	window.addEventListener("message", onPort);
	window.claude?.on("scm:workerExit", onWorkerExit);
	connect();
}

export function retryConnection(): void {
	ensureStarted();
	restarts = [];
	connect();
}

export function getConnection(): ScmConnection {
	return connection;
}

export function onConnectionChange(fn: (state: ScmConnection) => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

export function call<K extends ScmCallKind>(message: ScmCallFor<K>): ScmCall<K> {
	ensureStarted();
	const id = nextId++;
	const kind = message.t as K;
	const promise = new Promise<ScmReplyFor<K>>((resolve) => {
		pending.set(id, { kind, resolve: resolve as (reply: ScmReply) => void });
	});
	if (connection === "down") {
		receive(failure(kind, id, "failed"));
		return { id, promise };
	}
	const request = { ...message, id } as ScmRequest;
	if (port) port.postMessage(request);
	else outbox.push(request);
	return { id, promise };
}

export function cancel(id: number): void {
	const entry = pending.get(id);
	if (!entry) return;
	pending.delete(id);
	entry.resolve(failure(entry.kind, id, "cancelled"));
	const queued = outbox.findIndex((r) => r.id === id);
	if (queued !== -1) {
		outbox.splice(queued, 1);
		return;
	}
	port?.postMessage({ t: "cancel", id } satisfies ScmRequest);
}
