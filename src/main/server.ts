import Fastify, { FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";

export const FASTIFY_PORT = 41739;
const HOST = "127.0.0.1";

const RENDERER_ORIGINS: ReadonlyArray<string> = [
	process.env.ELECTRON_RENDERER_URL ?? "http://localhost:5173",
	"null",
];

export async function startServer(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });

	// @ts-ignore
	await app.register(fastifyCors, {
		origin: RENDERER_ORIGINS,
		methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
	});

	app.addHook("preHandler", async (request) => {
		const ts = new Date().toISOString();
		const body = request.body ? ` body=${JSON.stringify(request.body)}` : "";
		console.log(`[ccw] ${ts} ${request.method} ${request.url}${body}`);
	});

	app.get("/ping", async () => ({ ok: true }));

	// Register resource routes here as you add them:
	// await registerFooRoutes(app);

	await app.listen({ port: FASTIFY_PORT, host: HOST });
	console.log(`[ccw] fastify listening on http://${HOST}:${FASTIFY_PORT}`);
	return app;
}
