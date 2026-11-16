import {
	app,
	ipcMain,
	MessageChannelMain,
	utilityProcess,
	type UtilityProcess,
} from "electron";
import { join } from "node:path";
import { broadcast } from "../windows";

let worker: UtilityProcess | null = null;
let quitting = false;

function getWorker(): UtilityProcess {
	if (worker) return worker;
	const child = utilityProcess.fork(join(__dirname, "scmWorker.js"), [], {
		serviceName: "Ground Control Source Control",
	});
	child.on("exit", () => {
		if (worker !== child) return;
		worker = null;
		if (!quitting) broadcast("scm:workerExit", null);
	});
	worker = child;
	return child;
}

function killWorker(): void {
	quitting = true;
	const child = worker;
	worker = null;
	child?.kill();
}

export function registerSourceControlHost(): void {
	app.on("will-quit", killWorker);

	ipcMain.on("scm:connect", (event) => {
		try {
			const child = getWorker();
			const { port1, port2 } = new MessageChannelMain();
			child.postMessage({ type: "connect" }, [port1]);
			event.sender.postMessage("scm:port", null, [port2]);
		} catch {
			event.sender.send("scm:workerExit", null);
		}
	});
}
