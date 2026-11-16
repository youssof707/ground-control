import type { MessagePortMain } from "electron";
import { createScmServer } from "./scmServer";

const server = createScmServer();

function attach(port: MessagePortMain): void {
	const connection = server.connect((reply) => port.postMessage(reply));
	port.on("message", (e) => connection.handle(e.data));
	port.on("close", () => connection.close());
	port.start();
}

const parent = process.parentPort;
if (parent) {
	parent.on("message", (e) => {
		for (const port of e.ports) attach(port);
	});
}
