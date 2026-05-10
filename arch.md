# Andrea — Architecture Reference for Scaffolding

This document describes the structure of the **Andrea** Electron+React app in enough detail to scaffold a clone with different domain logic. It documents the **current state** of the codebase as it stands today, and tags each piece as either:

- **[STRUCTURAL]** — keep verbatim (or nearly so) when scaffolding a new app
- **[DOMAIN]** — Andrea-specific (Slack ingestion, work items, Claude Code integration); delete and replace
- **[MIXED]** — file/folder contains both kinds; edit selectively

A flat “delete / edit / keep” checklist for swapping out the domain lives in [§11](#11-what-to-remove--swap-when-starting-fresh).

> **Indentation:** every file in this codebase uses **tabs**, enforced by ESLint (`@stylistic/indent: ['error', 'tab']`). All embedded code blocks below use tabs. Match it when scaffolding.

---

## Table of contents

1. [Overview](#1-overview)
2. [Project layout](#2-project-layout)
3. [Naming conventions](#3-naming-conventions)
4. [Build & tooling](#4-build--tooling)
5. [Main process](#5-main-process)
   - 5a. [Entry & lifecycle — `src/main/index.ts`](#5a-entry--lifecycle)
   - 5b. [HTTP server — `src/main/server.ts`](#5b-http-server)
   - 5c. [API layer — `src/main/api/*.ts`](#5c-api-layer)
   - 5d. [Controllers — `src/main/controller/*.ts`](#5d-controllers)
   - 5e. [Connectors — `src/main/connectors/*.ts`](#5e-connectors)
   - 5f. [Store / persistence — `src/main/core/store/`](#5f-store--persistence)
6. [Preload](#6-preload)
7. [Renderer](#7-renderer)
8. [Shared schemas](#8-shared-schemas)
9. [Data on disk](#9-data-on-disk)
10. [Adding a new model — checklist](#10-adding-a-new-model--checklist)
11. [What to remove / swap when starting fresh](#11-what-to-remove--swap-when-starting-fresh)
12. [Verification](#12-verification)

---

## 1. Overview

Andrea is a single-window Electron desktop app. The **main process** is a Node.js host that:

- runs a localhost-only **Fastify HTTP server** (port `41739`),
- owns all **state**, persisted as JSON files under `app.getPath('userData')/data/`,
- talks to **external services** (Claude Agent SDK, Slack via Claude’s MCP tools) via **connectors**.

The **renderer** is a React 19 app that reaches the main process by **plain `fetch` to `http://127.0.0.1:41739`** — there is no `ipcRenderer`/`contextBridge` IPC traffic. The preload script exists but currently exposes only an empty `window.api`.

Why HTTP-not-IPC: the main process already has typed Fastify route handlers, so the renderer treats it like any backend. Nothing flows over IPC; the preload remains tiny.

```
┌────────────────────────────┐         ┌──────────────────────────────────────────┐
│ Renderer (React 19)        │         │ Main process (Node)                      │
│ src/renderer/src           │         │ src/main                                 │
│                            │  HTTP   │                                          │
│  pages/  ──► useXxx hook ──┼────────►│  server.ts (Fastify)                     │
│                            │  fetch  │     │                                    │
│  components/               │         │     ▼                                    │
│  index.css (plain CSS)     │         │  api/*.ts          ── HTTP routes        │
│                            │         │     │                                    │
│                            │         │     ▼                                    │
│                            │         │  controller/*.ts   ── business logic     │
│                            │         │     │       │                            │
│                            │         │     │       ▼                            │
│                            │         │     │    connectors/*.ts ── external svc │
│                            │         │     ▼                                    │
│                            │         │  core/store/*.ts   ── CRUD + JSON files  │
│                            │         │       └─► write_queue.ts (global serial) │
└────────────────────────────┘         └──────────────────────────────────────────┘
                                                  │
                                                  ▼
                                       ~/Library/Application Support/<app>/data/*.json
```

All writes — for every model — go through **one global p-queue with concurrency 1** (`src/main/core/store/write_queue.ts`). Reads are synchronous against an in-memory cache. Both reads and writes return `structuredClone`s so callers can’t mutate the cache and bypass the queue.

Schemas (Zod + inferred TS types) live in `src/shared/schemas/` and are imported by both processes. The renderer pulls types via `import type` over a relative path; no `@shared` alias is configured.

---

## 2. Project layout

```
andrea/
├── electron-builder.yml            [STRUCTURAL] — change appId, productName
├── electron.vite.config.ts         [STRUCTURAL]
├── eslint.config.js                [STRUCTURAL]
├── package.json                    [STRUCTURAL] — change name, drop domain deps
├── package-lock.json
├── tsconfig.json                   [STRUCTURAL]
├── tsconfig.node.json              [STRUCTURAL]
├── tsconfig.web.json               [STRUCTURAL]
├── CLAUDE.md                       [MIXED] — keep persistence guide; rewrite app refs
└── src/
	├── main/                       Electron main process (Node)
	│   ├── index.ts                [STRUCTURAL] — lifecycle, store init, server start
	│   ├── server.ts               [STRUCTURAL] — Fastify, CORS, /ping, route registration
	│   ├── api/
	│   │   ├── chat_api.ts         [DOMAIN]  — POST /chat (Claude proxy)
	│   │   └── work_item_api.ts    [DOMAIN]  — work-items CRUD + sync route
	│   ├── controller/
	│   │   ├── work_item_controller.ts  [DOMAIN]  — trivial list-and-sort
	│   │   └── slack_controller.ts       [DOMAIN]  — Slack→WorkItem sync orchestration
	│   ├── connectors/
	│   │   └── claude_code.ts      [DOMAIN]  — Claude Agent SDK adapter
	│   └── core/
	│       └── store/
	│           ├── write_queue.ts  [STRUCTURAL] — global p-queue
	│           ├── work_item.ts    [DOMAIN]  — canonical store shape (template)
	│           └── slack_channel.ts [DOMAIN] — single-file store with seed defaults (template)
	├── preload/
	│   ├── index.ts                [STRUCTURAL] — minimal contextBridge shim
	│   └── index.d.ts              [STRUCTURAL] — `export {}`
	├── renderer/
	│   ├── index.html              [STRUCTURAL] — root div + module script
	│   └── src/
	│       ├── env.d.ts            [STRUCTURAL] — `/// <reference types="vite/client" />`
	│       ├── main.tsx            [STRUCTURAL] — ReactDOM root + HashRouter
	│       ├── MainApp.tsx         [MIXED]    — top-level <Routes>; replace per-page routes
	│       ├── index.css           [MIXED]    — keep page/btn/table/message; replace pills/icons
	│       ├── components/
	│       │   └── AsyncyButton.tsx [STRUCTURAL] — generic async button primitive
	│       ├── pages/
	│       │   └── WorkItemsPage.tsx [DOMAIN] — replace with new pages
	│       └── useWorkItems.ts     [DOMAIN]  — hook template; replace per resource
	└── shared/
		├── schemas/
		│   ├── work_item.ts        [DOMAIN]  — Zod template for a domain model
		│   └── slack_channel.ts    [DOMAIN]
		└── schema_examples/        [DOMAIN]  — sample JSON fixtures
```

The repo also has a top-level `build/` (Electron Builder resources) and runtime-generated `out/` and `dist/`; those are gitignored.

---

## 3. Naming conventions

### Files

| Kind                     | Convention       | Examples                                                               |
| ------------------------ | ---------------- | ---------------------------------------------------------------------- |
| Non-React TS modules     | `snake_case.ts`  | `work_item.ts`, `write_queue.ts`, `chat_api.ts`, `claude_code.ts`      |
| React components & pages | `PascalCase.tsx` | `MainApp.tsx`, `AsyncyButton.tsx`, `WorkItemsPage.tsx`                 |
| React hooks              | `useXxxYyy.ts`   | `useWorkItems.ts`                                                      |
| Type-only declaration    | `index.d.ts`     | `src/preload/index.d.ts`                                               |
| Configs                  | varies           | `electron.vite.config.ts`, `tsconfig.web.json`, `electron-builder.yml` |

### Directories

`snake_case/` for everything (`api/`, `controller/`, `core/store/`, `schemas/`, `schema_examples/`). React-specific sub-trees still use snake_case directories: `src/renderer/src/components/`, `src/renderer/src/pages/`.

### Code identifiers

| Kind             | Convention                                                                 |
| ---------------- | -------------------------------------------------------------------------- |
| Function exports | `camelCase`                                                                |
| Constants        | `SCREAMING_SNAKE_CASE`                                                     |
| Types            | `PascalCase`                                                               |
| Zod schemas      | `PascalCase` ending in `Schema` (e.g. `WorkItemSchema`, `ItemsFileSchema`) |
| Interfaces       | `PascalCase`                                                               |
| React components | `PascalCase` (default-exported page is the file’s namesake)                |

### Indentation

**Tabs.** Enforced by ESLint:

```js
'@stylistic/indent': ['error', 'tab'],
```

No `.editorconfig`, no Prettier. ESLint is the only style enforcer.

---

## 4. Build & tooling

### `package.json` [STRUCTURAL — change `name`, drop domain-only deps]

```json
{
  "name": "andrea",
  "version": "0.1.0",
  "description": "Mac menu bar task & comms manager",
  "main": "./out/main/index.js",
  "author": "Affirm",
  "license": "UNLICENSED",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build && electron-builder",
    "build:unpack": "electron-vite build && electron-builder --dir",
    "start": "electron-vite preview",
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json --composite false",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json --composite false",
    "typecheck": "npm run typecheck:node && npm run typecheck:web",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.137", // [DOMAIN] drop unless reusing Claude SDK
    "@electron-toolkit/preload": "^3.0.2",
    "@electron-toolkit/utils": "^4.0.0",
    "@fastify/cors": "^11.2.0",
    "fastify": "^5.8.5",
    "p-queue": "^9.2.0",
    "react-router-dom": "^7.15.0",
    "ulid": "^3.0.2",
    "write-file-atomic": "^7.0.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@electron-toolkit/tsconfig": "^2.0.0",
    "@stylistic/eslint-plugin": "^5.10.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/write-file-atomic": "^4.0.3",
    "@vitejs/plugin-react": "^5.2.0",
    "electron": "^42.0.0",
    "electron-builder": "^26.0.0",
    "electron-vite": "^5.0.0",
    "eslint": "^10.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "^6.0.0",
    "typescript-eslint": "^8.59.2",
    "vite": "^7.0.0"
  }
}
```

**Dependencies grouped by purpose:**

- **Electron core**: `electron`, `@electron-toolkit/preload`, `@electron-toolkit/utils`, `@electron-toolkit/tsconfig`
- **HTTP server (main)**: `fastify`, `@fastify/cors`
- **React (renderer)**: `react`, `react-dom`, `react-router-dom`
- **Validation/IDs/persistence**: `zod`, `ulid`, `write-file-atomic`, `p-queue`
- **Build**: `electron-vite`, `vite`, `@vitejs/plugin-react`, `electron-builder`
- **TypeScript**: `typescript`, `@types/*`
- **Lint**: `eslint`, `typescript-eslint`, `@stylistic/eslint-plugin`
- **Domain-only**: `@anthropic-ai/claude-agent-sdk` — delete unless reusing

**Notes:**

- `"type": "module"` (ESM throughout).
- `"main": "./out/main/index.js"` — the post-build bundle that Electron actually runs.
- No test runner is configured. Add Vitest or similar yourself if needed.

### `electron.vite.config.ts` [STRUCTURAL — verbatim]

```ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer/src"),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
    plugins: [react()],
  },
});
```

- Three independent build targets: `main`, `preload`, `renderer`.
- `externalizeDepsPlugin()` keeps `node_modules` packages out of the main/preload bundles — they’re loaded at runtime by Node, not bundled.
- Renderer alias `@renderer → src/renderer/src` is configured here. It is **not** mirrored in `tsconfig.web.json`’s paths; relative imports are still used everywhere in practice. If you rely on the alias, also add a `paths` entry in `tsconfig.web.json`.
- No `@shared` alias. Renderer files import shared schemas via relative paths like `../../shared/schemas/foo`.

### TypeScript

Three configs, with project references at the root:

**`tsconfig.json`** [STRUCTURAL]

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

**`tsconfig.node.json`** [STRUCTURAL] — main, preload, shared

```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": [
    "electron.vite.config.*",
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*"
  ],
  "compilerOptions": {
    "composite": true,
    "outDir": "out/types/node",
    "tsBuildInfoFile": "out/types/node.tsbuildinfo",
    "emitDeclarationOnly": true,
    "types": ["electron-vite/node"]
  }
}
```

**`tsconfig.web.json`** [STRUCTURAL] — renderer, shared

```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.web.json",
  "include": [
    "src/renderer/src/**/*",
    "src/renderer/src/**/*.tsx",
    "src/preload/*.d.ts",
    "src/shared/**/*"
  ],
  "compilerOptions": {
    "composite": true,
    "outDir": "out/types/web",
    "tsBuildInfoFile": "out/types/web.tsbuildinfo",
    "emitDeclarationOnly": true,
    "jsx": "react-jsx"
  }
}
```

Notes:

- Both contexts include `src/shared/**/*` — the schemas live in both type universes.
- `emitDeclarationOnly: true` is fine because the actual compilation is done by Vite/electron-vite. `tsc` is here for type-checking only (`npm run typecheck`).
- `react-jsx` on the web side means components don’t need `import React`.

### `eslint.config.js` [STRUCTURAL]

```js
import stylistic from "@stylistic/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["out/**", "dist/**", "build/**", "node_modules/**"],
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "@stylistic": stylistic,
    },
    rules: {
      "@stylistic/indent": ["error", "tab"],
    },
  },
);
```

The only rule is **tabs for indentation**. There is intentionally no broader rule set — this project doesn’t use the typescript-eslint recommended preset. Add more rules yourself if desired.

### `electron-builder.yml` [STRUCTURAL — change appId & productName]

```yaml
appId: com.affirm.andrea
productName: Andrea
asar: true
directories:
  buildResources: build
files:
  - "!**/.vscode/*"
  - "!src/*"
  - "!electron.vite.config.{js,ts,mjs,cjs}"
  - "!{tsconfig,tsconfig.node,tsconfig.web}.json"
  - "!{.eslintignore,.eslintrc.cjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}"
mac:
  target:
    - target: dmg
      arch:
        - arm64
        - x64
  category: public.app-category.productivity
  identity: null
dmg:
  artifactName: ${name}-${version}-${arch}.${ext}
```

For a new app:

- Change `appId` (used as the macOS bundle identifier and `setAppUserModelId` value).
- Change `productName`.
- `identity: null` disables code signing — set to your cert name for distribution.
- Add `win:` / `linux:` blocks if you need cross-platform builds.

### `.gitignore` [STRUCTURAL]

```
node_modules
dist
out
.DS_Store
*.log
*.tsbuildinfo
```

There is **no Prettier config and no `.editorconfig`**. Indentation is governed exclusively by ESLint. There is also a top-level `.vscode/` directory in this repo (intentionally not committed under `src/*` exclusion in electron-builder, but checked in via `git`), so VS Code workspace settings travel with the project.

---

## 5. Main process

### 5a. Entry & lifecycle

**File:** `src/main/index.ts` [STRUCTURAL]

```ts
import { app, BrowserWindow } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { FastifyInstance } from "fastify";
import { startServer, FASTIFY_PORT } from "./server";
import { initialize as initializeWorkItemStore } from "./core/store/work_item";
import { initialize as initializeSlackChannelStore } from "./core/store/slack_channel";
import { flush as flushStore } from "./core/store/write_queue";

let mainWindow: BrowserWindow | null = null;
let server: FastifyInstance | null = null;
let isQuitting = false;

const preloadPath = join(__dirname, "../preload/index.js");

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: "Andrea",
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
    },
  });

  win.on("ready-to-show", () => win.show());

  win.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.affirm.andrea");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const dataDir = join(app.getPath("userData"), "data");
  try {
    await initializeWorkItemStore(dataDir);
    await initializeSlackChannelStore(dataDir);
  } catch (err) {
    console.error(`[andrea] failed to initialize store at ${dataDir}:`, err);
    app.exit(1);
    return;
  }

  try {
    server = await startServer();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      console.error(`[andrea] Port ${FASTIFY_PORT} already in use — exiting`);
    } else {
      console.error("[andrea] failed to start fastify server:", err);
    }
    app.exit(1);
    return;
  }

  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (mainWindow) {
      mainWindow.show();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", async (event) => {
  if (server) {
    event.preventDefault();
    try {
      await server.close();
    } catch (err) {
      console.error("[andrea] error closing fastify:", err);
    }
    server = null;
    try {
      await flushStore();
    } catch (err) {
      console.error("[andrea] error flushing store:", err);
    }
    app.quit();
  }
});

app.on("window-all-closed", () => {
  // No-op on macOS — keep app alive so dock icon click can reopen the window.
});
```

**Required boot order** (matters):

1. `electronApp.setAppUserModelId(...)` — must match `electron-builder.yml`’s `appId`.
2. Compute `dataDir = join(app.getPath('userData'), 'data')`.
3. `await initializeXxxStore(dataDir)` for **every** model. Stores load JSON from disk into in-memory caches and create empty files on first run. Do this **before** the server can accept requests.
4. `server = await startServer()`. Catches `EADDRINUSE` specifically — the renderer hardcodes the same port, so a port collision is fatal.
5. `mainWindow = createMainWindow()`.

**Shutdown order** (matters):

1. `before-quit` flips `isQuitting = true` so the window’s `close` handler stops hiding-instead-of-quitting.
2. `will-quit` `event.preventDefault()`s, then `await server.close()` → `await flushStore()` → `app.quit()`. This guarantees pending writes drain before the process exits.

**Window behavior:** clicking the close button **hides** the window instead of quitting (macOS-style). Quit is only triggered via menu/Cmd-Q (or `before-quit` from elsewhere), which sets `isQuitting`. The `window-all-closed` handler is a no-op for the same reason.

**For a new app:**

- Replace the imported store-init functions and the registered routes (in `server.ts`).
- Change `setAppUserModelId('com.affirm.andrea')` and the window `title: 'Andrea'`.
- The rest is mechanical and should not change.

### 5b. HTTP server

**File:** `src/main/server.ts` [STRUCTURAL — change log prefix and route imports]

```ts
import Fastify, { FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import { registerChatRoutes } from "./api/chat_api";
import { registerWorkItemRoutes } from "./api/work_item_api";

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
    console.log(`[andrea] ${ts} ${request.method} ${request.url}${body}`);
  });

  app.get("/ping", async () => ({ ok: true }));
  await registerChatRoutes(app);
  await registerWorkItemRoutes(app);

  await app.listen({ port: FASTIFY_PORT, host: HOST });
  console.log(`[andrea] fastify listening on http://${HOST}:${FASTIFY_PORT}`);
  return app;
}
```

**Notes:**

- **Fastify**, not Express. Async/await idiomatically.
- **Hardcoded port 41739, host 127.0.0.1.** Renderer hardcodes the same string. If you change the port, change `useXxx.ts` too. (If scaffolding fresh, factor this into `src/shared/config.ts` and import it from both sides.)
- **CORS** allows the dev renderer URL (`http://localhost:5173` or whatever electron-vite injects via `ELECTRON_RENDERER_URL`) plus the literal string `'null'`, which is what `file://` origins send.
- **Global `preHandler` hook** logs every request as `[andrea] <iso> <method> <url> body=<json>`. The body is dumped raw — fine for a local app, do not enable in a public-facing service.
- **Routes** are registered by calling `await registerXxxRoutes(app)` per resource. There is a built-in `/ping` health check.
- **No global error handler.** Each route handler `try`s its own work and replies `500 { error }`.

For a new app: change `[andrea]` log prefix to your app’s name, replace the `registerXxxRoutes` imports and calls.

### 5c. API layer

**Folder:** `src/main/api/` [DOMAIN — template]

**Convention:** one file per **resource**. Each file exports a single function `registerXxxRoutes(app: FastifyInstance): Promise<void>` that registers all routes for that resource. The API layer is **thin** — it owns:

- HTTP method/URL mapping
- Input shape validation (type-guard the body, 400 on bad input)
- Response shape (`{ items: [...] }`, etc.)
- Catching exceptions and replying 500 with the message

It does **not** own business logic. That belongs in controllers.

**`src/main/api/work_item_api.ts`** (the canonical example):

```ts
import type { FastifyInstance } from "fastify";
import { listWorkItems } from "../controller/work_item_controller";
import { syncWorkItemsFromAllSlackChannels } from "../controller/slack_controller";

export async function registerWorkItemRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/work-items", async (_request, reply) => {
    try {
      return { items: listWorkItems() };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post("/work-items/sync", async (_request, reply) => {
    try {
      return await syncWorkItemsFromAllSlackChannels();
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}
```

**`src/main/api/chat_api.ts`** (input-validation example):

```ts
import type { FastifyInstance } from "fastify";
import { runClaudeCode } from "../connectors/claude_code";

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/chat", async (request, reply) => {
    const body = request.body as { prompt?: unknown } | null;
    const prompt = body?.prompt;
    if (typeof prompt !== "string" || prompt.length === 0) {
      return reply
        .code(400)
        .send({ error: "prompt must be a non-empty string" });
    }
    const response = await runClaudeCode(prompt);
    return { response };
  });
}
```

**Paste-ready template** for a new resource (`Foo`):

```ts
import type { FastifyInstance } from "fastify";
import { listFoos, createFoo } from "../controller/foo_controller";

export async function registerFooRoutes(app: FastifyInstance): Promise<void> {
  app.get("/foos", async (_request, reply) => {
    try {
      return { items: listFoos() };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post("/foos", async (request, reply) => {
    const body = request.body as { name?: unknown } | null;
    const name = body?.name;
    if (typeof name !== "string" || name.length === 0) {
      return reply.code(400).send({ error: "name must be a non-empty string" });
    }
    try {
      return await createFoo({ name });
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}
```

Then register it in `server.ts`:

```ts
import { registerFooRoutes } from "./api/foo_api";
// ...
await registerFooRoutes(app);
```

**For a new app:** delete `chat_api.ts` and `work_item_api.ts`. Create `foo_api.ts` for each resource you need.

### 5d. Controllers

**Folder:** `src/main/controller/` [DOMAIN — template]

**Convention:** one file per resource (or per cross-cutting workflow), `<resource>_controller.ts`. Controllers contain **business logic**: orchestration of store calls, connector calls, dedup/transformation, multi-step operations. They throw on errors; the API layer translates those into 500s.

Two flavors are exemplified in this codebase:

#### Trivial controller

When the operation is just “read from the store and shape the result a bit,” keep it tiny:

**`src/main/controller/work_item_controller.ts`**

```ts
import { listItems } from "../core/store/work_item";
import type { WorkItem } from "../../shared/schemas/work_item";

/**
 * Return all active work items, newest first. ISO-8601 timestamps sort
 * correctly with localeCompare, so no Date conversion is needed.
 */
export function listWorkItems(): WorkItem[] {
  return listItems().sort((a, b) => b.created_at.localeCompare(a.created_at));
}
```

That’s the entire file. If your controller is going to stay this small, you can even skip it and call the store directly from the API handler — but having the controller layer there from day one means you don’t have to refactor when complexity grows.

#### Orchestration controller

Realistic controllers tie multiple stores and connectors together. **`src/main/controller/slack_controller.ts`** (truncated to show the patterns; full file lives in the repo):

```ts
import { runClaudeCode } from "../connectors/claude_code";
import {
  getSlackChannel,
  listSlackChannels,
  updateSlackChannel,
} from "../core/store/slack_channel";
import {
  createItem,
  listItems,
  listArchivedItems,
} from "../core/store/work_item";
import type { WorkItem } from "../../shared/schemas/work_item";

const SLACK_WORKSPACE = "affirm";
const TITLE_MAX_LENGTH = 80;
const STUB_STATUS_REASON =
  "Stub work item — pulled from Slack but not yet triaged.";

const FETCH_RECENT_MESSAGES_PROMPT = `You have access to the Slack MCP. Fetch all messages posted in the channel {{channel_name}} ...`;

export interface SlackMessage {
  ts: string;
  user_id: string;
  user_name: string;
  text: string;
  thread_ts?: string;
}

export async function fetchRecentMessages(
  channelId: string,
  since: Date,
): Promise<SlackChannelFetchResult> {
  const channel = getSlackChannel(channelId);
  if (!channel) {
    throw new Error(`Unknown Slack channel id: ${channelId}`);
  }
  // ... template-substitute the prompt, call runClaudeCode, JSON.parse, return.
}

/**
 * Pull new messages from every Slack channel and turn them into stub
 * WorkItems. On a successful run for a channel, advance its
 * `last_synced_at` cursor; on failure, log and move on to the next.
 */
export async function syncWorkItemsFromAllSlackChannels(): Promise<{
  created: number;
}> {
  let created = 0;
  for (const channel of listSlackChannels()) {
    // Capture cursor BEFORE the fetch — duplicates beat gaps.
    const startedAt = new Date().toISOString();
    try {
      const items = await createWorkItemsFromSlackChannel(
        channel.id,
        new Date(channel.last_synced_at),
      );
      created += items.length;
      await updateSlackChannel(channel.id, { last_synced_at: startedAt });
    } catch (err) {
      console.error(
        `[andrea][slack] sync failed for #${channel.name} (${channel.id}):`,
        err,
      );
    }
  }
  return { created };
}

export async function createWorkItemsFromSlackChannel(
  channelId: string,
  since: Date,
): Promise<WorkItem[]> {
  const channel = getSlackChannel(channelId);
  if (!channel) throw new Error(`Unknown Slack channel id: ${channelId}`);

  const fetchResult = await fetchRecentMessages(channelId, since);
  const seenMessageTs = collectSeenSlackMessageTs(channelId);

  const created: WorkItem[] = [];
  for (const msg of fetchResult.messages) {
    if (seenMessageTs.has(msg.ts)) continue;
    const item = await createItem({
      /* ... */
    });
    created.push(item);
    seenMessageTs.add(msg.ts); // guard against duplicate ts within one batch
  }
  return created;
}

function collectSeenSlackMessageTs(channelId: string): Set<string> {
  const isFromChannel = (item: WorkItem): boolean =>
    item.source.kind === "slack_question" &&
    item.source.channel_id === channelId;
  const seen = new Set<string>();
  for (const item of listItems(isFromChannel)) {
    if (item.source.kind === "slack_question") seen.add(item.source.message_ts);
  }
  for (const item of listArchivedItems(isFromChannel)) {
    if (item.source.kind === "slack_question") seen.add(item.source.message_ts);
  }
  return seen;
}
```

**Patterns to copy:**

- **Resource-scoped helpers** as private functions (`collectSeenSlackMessageTs`, `deriveTitle`, `buildPermalink`, `stripJsonFences`).
- **Dedup via a pre-computed `Set<string>`** rather than hitting the store inside the loop. Build the set once, mutate it as you go to handle dupes inside a single batch.
- **Per-iteration `try/catch` that logs and continues** in batch jobs (`syncWorkItemsFromAllSlackChannels`). One failed channel doesn’t kill the whole sync.
- **Capture the cursor _before_ the fetch starts.** Comment in the source: “duplicates beat gaps.” On retry, the worst case is reprocessing the overlap window, not silently skipping data.
- **Prompt templating** with `{{name}}` placeholders and `replaceAll`.
- **Connector outputs are untrusted strings** — strip markdown fences, `JSON.parse` defensively, include a 500-char preview in error messages.
- **Constants at top of file** in `SCREAMING_SNAKE_CASE`.

**For a new app:** delete both controllers. Replace with whatever your domain needs — usually one controller per resource plus one or more orchestration controllers for cross-resource workflows.

### 5e. Connectors

**Folder:** `src/main/connectors/` [DOMAIN — template]

**Convention:** one file per **external integration**. A connector is the only place that talks to outside-the-app systems (third-party APIs, SDKs, CLI subprocesses, databases). It’s a thin adapter — translate the call, log it, throw if it fails.

**`src/main/connectors/claude_code.ts`** (the only example):

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const CLAUDE_CWD = "/Users/youssof.fahmy/workspace/all-the-things";

let requestCounter = 0;

export async function runClaudeCode(prompt: string): Promise<string> {
  const id = ++requestCounter;
  const started = Date.now();
  console.log(
    `[andrea][claude #${id}] prompt (${prompt.length} chars):\n${prompt}`,
  );

  try {
    for await (const message of query({
      prompt,
      options: { cwd: CLAUDE_CWD },
    })) {
      if (message.type === "result") {
        if (message.subtype !== "success") {
          console.error(
            `[andrea][claude #${id}] failed after ${Date.now() - started}ms: subtype=${message.subtype}`,
          );
          throw new Error(`Claude Code failed: ${message.subtype}`);
        }
        const result = message.result;
        console.log(
          `[andrea][claude #${id}] response (${result.length} chars, ${Date.now() - started}ms):\n${result}`,
        );
        return result;
      }
    }
    console.error(
      `[andrea][claude #${id}] failed after ${Date.now() - started}ms: no result message`,
    );
    throw new Error("Claude Code finished without a result message");
  } catch (err) {
    console.error(
      `[andrea][claude #${id}] threw after ${Date.now() - started}ms:`,
      err,
    );
    throw err;
  }
}
```

**Patterns to copy:**

- **Per-request id counter + start time** so logs can be correlated and timing is visible.
- **Log prompt and response with sizes** at info level. Logs are how you debug the integration.
- **Always rethrow** — the controller decides whether to bail or continue.
- **Error messages preserve subtype/reason from the SDK.**

**Smell to fix when scaffolding:** `CLAUDE_CWD` is hardcoded to a personal absolute path. Parameterize it (env var, store-backed config, or function argument) when you copy this pattern.

**For a new app:** delete `claude_code.ts` unless you’re reusing the Claude Agent SDK. Replace with one connector per integration — e.g. `github.ts`, `slack.ts`, `postgres.ts`, `stripe.ts`. Same shape: small file, single purpose, logs and rethrows.

### 5f. Store / persistence

This is the **heart of the structural pattern.** Spend time on it.

**Folder:** `src/main/core/store/` [MIXED]

- `write_queue.ts` — STRUCTURAL, one file
- `<model>.ts` — DOMAIN, one file per model (`work_item.ts`, `slack_channel.ts`)

#### The global write queue

**`src/main/core/store/write_queue.ts`** [STRUCTURAL — copy verbatim]

```ts
import PQueue from "p-queue";

// Single global write queue (concurrency 1) shared by every model's store.
// Read-modify-write tasks put their entire critical section inside one
// queue task so concurrent operations across any models can't race on
// shared state or interleave partial writes.
const writeQueue = new PQueue({ concurrency: 1 });

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return writeQueue.add(task);
}

/**
 * Wait for all pending writes (across every model) to drain. Call before
 * app quit so nothing is lost mid-flush.
 */
export async function flush(): Promise<void> {
  await writeQueue.onIdle();
}
```

**Why a single global queue, not one per model:** JS is single-threaded, but `await` lets other tasks interleave between suspension points. Two concurrent updates to the same record — even on the same model — could both read the same `current`, both compute a merged value, and the second write clobbers the first (lost update). Worse, a future cross-model write (e.g. delete a `WorkItem` and update a related `SlackChannel` atomically) needs a single ordering. One queue, concurrency 1, FIFO order, gets you that for free.

**Lifecycle:** `flush()` is called once during `will-quit` in `index.ts`. You do **not** need a per-model flush; the queue covers everything.

#### Canonical store shape

Every model’s store follows the same skeleton. Key files: `work_item.ts` (multi-file, with archive), `slack_channel.ts` (single-file, with seed defaults).

**Module-scope state:**

```ts
let initialized = false;
let filePaths: FilePaths | null = null;
let db: SomeFile = { items: {} };

function assertInitialized(): void {
  if (!initialized) {
    throw new Error("Store not initialized. Call initialize(dataDir) first.");
  }
}
```

Every public function (read or write) starts with `assertInitialized()`. This catches “you forgot to wire up the store in `index.ts`” loudly instead of returning empty data.

**`initialize(dataDir)`** — load files into the in-memory cache:

```ts
export async function initialize(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });

  filePaths = {
    items: path.join(dataDir, "items.json"),
    archive: path.join(dataDir, "archive.json"),
  };

  activeDb = await loadItemsFile(filePaths.items);
  archiveDb = await loadItemsFile(filePaths.archive);

  initialized = true;
}

async function loadItemsFile(filePath: string): Promise<ItemsFile> {
  const raw = await readJsonOrNull(filePath);
  if (raw === null) {
    const empty: ItemsFile = { items: {} };
    await writeFileAtomic(filePath, JSON.stringify(empty, null, 2));
    return empty;
  }
  return ItemsFileSchema.parse(raw);
}

async function readJsonOrNull(filePath: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
```

Important rules:

- **Create `dataDir` if missing** — `fs.mkdir(..., { recursive: true })`.
- **Create empty file on first run** with `writeFileAtomic`.
- **Validate existing files with the file-shape Zod schema** (`ItemsFileSchema.parse`). **No silent recovery** — surface corruption loudly. Better to crash on startup than to silently zero out user data.

**Reads — synchronous, no queue, return clones:**

```ts
export function getItem(id: string): WorkItem | null {
  assertInitialized();
  const item = activeDb.items[id];
  return item ? structuredClone(item) : null;
}

export function listItems(filter?: (item: WorkItem) => boolean): WorkItem[] {
  assertInitialized();
  const all = Object.values(activeDb.items);
  const selected = filter ? all.filter(filter) : all;
  return selected.map((item) => structuredClone(item));
}
```

Why this is safe:

- JS is single-threaded; a synchronous read can’t be preempted by a queued write.
- Queued writes only mutate the in-memory cache _after_ `await persistX()` resolves, so the cache is always in a consistent post-write state when control returns to the event loop.
- Callers receive a deep clone, so they can’t accidentally mutate the cache and bypass the queue.

**Writes — wrap the entire RMW cycle in one `enqueue(...)` call:**

`createItem` (no need to read first; just generate):

```ts
export async function createItem(input: CreateItemInput): Promise<WorkItem> {
  assertInitialized();

  const validatedInput = CreateItemInputSchema.parse(input);
  const now = new Date().toISOString();

  const item: WorkItem = WorkItemSchema.parse({
    id: ulid(),
    title: validatedInput.title,
    summary: validatedInput.summary ?? "",
    workflow: validatedInput.workflow,
    status: validatedInput.status ?? "red",
    status_reason:
      validatedInput.status_reason ??
      "Just received — agent hasn't analyzed this yet.",
    required_actions: [],
    blockers: [],
    agent_state: validatedInput.agent_state ?? "queued",
    runs: [],
    deliverable: null,
    source: validatedInput.source,
    links: validatedInput.links ?? [],
    created_at: now,
    updated_at: now,
  });

  return enqueue(async () => {
    activeDb.items[item.id] = item;
    await persistActive();
    return structuredClone(item);
  });
}
```

`updateItem` (full RMW inside `enqueue`):

```ts
export async function updateItem(
  id: string,
  patch: UpdateItemInput,
): Promise<WorkItem> {
  assertInitialized();
  const validatedPatch = UpdateItemInputSchema.parse(patch);

  return enqueue(async () => {
    const current = activeDb.items[id];
    if (!current) {
      throw new Error(`Item not found: ${id}`);
    }

    const merged = {
      ...current,
      ...validatedPatch,
      updated_at: new Date().toISOString(),
    };

    if (merged.runs.length > MAX_RUNS) {
      merged.runs = merged.runs.slice(-MAX_RUNS);
    }

    const validated = WorkItemSchema.parse(merged);
    activeDb.items[id] = validated;
    await persistActive();
    return structuredClone(validated);
  });
}
```

**Multi-file writes** (`deleteItem` moves between two files): order them additive-first so a mid-flight crash leaves the data **duplicated** rather than **lost**.

```ts
/**
 * Move an active item to the archive. Both file writes happen inside one
 * queue task, so concurrent callers never observe a half-applied move.
 *
 * Write order: archive first, then active. If the process crashes between
 * the two writes, the item is present in both files rather than absent
 * from both — recoverable on next startup, vs. data loss.
 */
export async function deleteItem(id: string): Promise<WorkItem> {
  assertInitialized();
  return enqueue(async () => {
    const item = activeDb.items[id];
    if (!item) throw new Error(`Item not found: ${id}`);
    archiveDb.items[id] = item;
    delete activeDb.items[id];
    await persistArchive(); // additive (gains data) — write first
    await persistActive(); // subtractive — write second
    return structuredClone(item);
  });
}

export async function restoreItem(id: string): Promise<WorkItem> {
  assertInitialized();
  return enqueue(async () => {
    const item = archiveDb.items[id];
    if (!item) throw new Error(`Archived item not found: ${id}`);
    activeDb.items[id] = item;
    delete archiveDb.items[id];
    await persistActive(); // additive — write first
    await persistArchive(); // subtractive — write second
    return structuredClone(item);
  });
}
```

`purgeArchivedItem` deletes permanently with no recovery — single write, no ordering rule.

#### Rules for writers

1. **Wrap the entire RMW cycle in one `enqueue(...)` call.** Don’t read state outside the task and then enqueue only the write — by the time your task runs, the state you read may be stale.
2. **Validate input _before_ `enqueue`** (cheap, fail fast), and **validate the merged result _inside_ `enqueue`** (the queued task is the source of truth for what hits disk).
3. **Persist atomically** with `writeFileAtomic`. Never raw `fs.writeFile` to a JSON state file.
4. **`structuredClone` on the way out.** Return a deep copy from the store so callers can’t mutate the in-memory cache and bypass the queue.
5. **Multi-file writes ordered additive-first.** Write the file that gains data first; write the file that loses data second. A mid-flight crash leaves duplicates (recoverable) instead of nothing (lost).

#### Rules for readers

- Reads do **not** enqueue. They synchronously read from the in-memory cache and `structuredClone` the result.
- This is safe because JS is single-threaded; a synchronous read can’t be preempted by a queued write.
- Always return clones so callers can’t accidentally mutate the cache.

#### Optional patterns

- **Per-model trim** (e.g. `MAX_RUNS = 10` in `work_item.ts`) — bound array growth at update time. Domain detail, not structural.
- **Seed defaults on empty db** (`slack_channel.ts`’s `DEFAULT_SLACK_CHANNELS`):

```ts
const DEFAULT_LAST_SYNCED_DAYS_AGO = 2;
const DEFAULT_SLACK_CHANNELS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "C08PH650FJP", name: "team-pba-wall-e" },
  { id: "C086NGKSXPH", name: "ask-pba" },
];

export async function initialize(dataDir: string): Promise<void> {
  // ... load file ...
  if (Object.keys(db.items).length === 0) {
    await seedDefaults();
  }
}

async function seedDefaults(): Promise<void> {
  const seedSince = daysAgo(DEFAULT_LAST_SYNCED_DAYS_AGO).toISOString();
  for (const channel of DEFAULT_SLACK_CHANNELS) {
    await createSlackChannel({
      id: channel.id,
      name: channel.name,
      last_synced_at: seedSince,
    });
  }
}
```

Useful when a fresh install needs starter rows. Only seeds when the file is empty; subsequent edits don’t retroactively re-apply defaults.

---

## 6. Preload

**Files:** `src/preload/index.ts` + `src/preload/index.d.ts` [STRUCTURAL — currently empty]

```ts
// src/preload/index.ts
import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

const api = {};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error global window typing
  window.electron = electronAPI;
  // @ts-expect-error global window typing
  window.api = api;
}
```

```ts
// src/preload/index.d.ts
export {};
```

**Design choice: no IPC.** The renderer talks to the main process via plain `fetch` to `http://127.0.0.1:41739`. The preload exists only because Electron needs one when `contextIsolation: true`, and it exposes:

- `window.electron` — `@electron-toolkit/preload`’s utilities (process info, etc.) — currently unused but available.
- `window.api` — empty object, ready to be extended.

**To extend** (only if you genuinely need IPC for something HTTP can’t do — e.g. native file dialogs, OS notifications):

```ts
// src/preload/index.ts
const api = {
  openFile: (): Promise<string | null> => ipcRenderer.invoke("open-file"),
};

contextBridge.exposeInMainWorld("api", api);
```

```ts
// src/preload/index.d.ts
declare global {
  interface Window {
    api: {
      openFile: () => Promise<string | null>;
    };
  }
}
export {};
```

For most scaffolds you won’t need any of this — leave the preload as-is.

---

## 7. Renderer

### 7a. Entry [STRUCTURAL]

**`src/renderer/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Andrea</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Single root div, module script. Change the `<title>` for a new app.

**`src/renderer/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import MainApp from "./MainApp";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <MainApp />
    </HashRouter>
  </React.StrictMode>,
);
```

- React 19, `createRoot` API.
- **`HashRouter`** (not `BrowserRouter`) so routing works under `file://` in production builds.
- Global CSS imported synchronously.

**`src/renderer/src/MainApp.tsx`** [MIXED — replace per-page routes]

```tsx
import { Navigate, Route, Routes } from "react-router-dom";
import WorkItemsPage from "./pages/WorkItemsPage";

export default function MainApp() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/work-items" replace />} />
      <Route path="/work-items" element={<WorkItemsPage />} />
    </Routes>
  );
}
```

The top-level component owns routing only — no layout chrome (no header bar, no sidebar). Each route maps directly to a page component. To add a new app:

1. Replace `WorkItemsPage` with whatever your default page is.
2. Update the redirect target.
3. Add more `<Route>` entries as you add pages.

**`src/renderer/src/env.d.ts`** [STRUCTURAL]

```ts
/// <reference types="vite/client" />
```

Pulls in `import.meta.env` types, etc.

### 7b. Pages [DOMAIN — template]

**Folder:** `src/renderer/src/pages/`

**Convention:** one default-exported component per page, file named `XxxPage.tsx`. Co-locate small sub-components (table rows, pills, helper formatters) in the same file rather than splitting them out — `WorkItemsPage.tsx` is a complete example:

```tsx
import AsyncyButton from "../components/AsyncyButton";
import { useWorkItems } from "../useWorkItems";
import type { Status, WorkItem } from "../../../shared/schemas/work_item";

export default function WorkItemsPage() {
  const { state, sync } = useWorkItems();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Work items</h1>
          {state.status === "ok" && (
            <div className="page-subtitle">{state.items.length} active</div>
          )}
        </div>
        <AsyncyButton onClick={sync}>Refresh</AsyncyButton>
      </header>

      {state.status === "loading" && <div className="message">Loading…</div>}
      {state.status === "error" && (
        <div className="message message-error">
          Failed to load: {state.message}
        </div>
      )}
      {state.status === "ok" &&
        (state.items.length === 0 ? (
          <div className="message">No work items yet.</div>
        ) : (
          <WorkItemsTable items={state.items} />
        ))}
    </div>
  );
}

function WorkItemsTable({ items }: { items: WorkItem[] }) {
  /* ... */
}
function WorkItemRow({ item }: { item: WorkItem }) {
  /* ... */
}
function StatusPill({ status }: { status: Status }) {
  /* ... */
}

function workflowGlyph(workflow: WorkItem["workflow"]): string {
  /* ... */
}
function subtitleFor(item: WorkItem): string {
  /* ... */
}
function statusLabel(status: Status): string {
  /* ... */
}
```

**Patterns:**

- **Default-export the page** so `MainApp.tsx` can import without braces.
- **Discriminated-union state from the hook**, then render branch per status (`loading`, `error`, `ok`).
- **Loading/error/empty/non-empty rendered as `.message` divs** (styled in `index.css`) so the page chrome stays consistent across states.
- **Class names match `.page`, `.page-header`, `.btn`, etc. from `index.css`** — see [§7e](#7e-styling).

**For a new app:** delete `WorkItemsPage.tsx`. Add one `XxxPage.tsx` per page.

### 7c. Hooks [DOMAIN — template]

**Folder:** `src/renderer/src/` (top-level)

**Convention:** `useXxx.ts` files at the root of `src/renderer/src/`. **Plain React hooks** (`useState` + `useCallback` + `useEffect`) — no React Query, no SWR, no global store. This keeps deps minimal at the cost of cache reuse across pages.

**`src/renderer/src/useWorkItems.ts`** (the canonical example):

```ts
import { useCallback, useEffect, useState } from "react";
import type { WorkItem } from "../../shared/schemas/work_item";

const API_BASE = "http://127.0.0.1:41739";
const WORK_ITEMS_URL = `${API_BASE}/work-items`;
const SYNC_URL = `${API_BASE}/work-items/sync`;

export type WorkItemsState =
  | { status: "loading" }
  | { status: "ok"; items: WorkItem[] }
  | { status: "error"; message: string };

export interface UseWorkItemsResult {
  state: WorkItemsState;
  sync: () => Promise<void>;
  busy: boolean;
}

async function fetchList(): Promise<WorkItem[]> {
  const res = await fetch(WORK_ITEMS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { items: WorkItem[] };
  return data.items;
}

export function useWorkItems(): UseWorkItemsResult {
  const [state, setState] = useState<WorkItemsState>({ status: "loading" });
  const [busy, setBusy] = useState(false);

  const initialLoad = useCallback(async () => {
    setBusy(true);
    try {
      const items = await fetchList();
      setState({ status: "ok", items });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const sync = useCallback(async () => {
    setBusy(true);
    try {
      const syncRes = await fetch(SYNC_URL, { method: "POST" });
      if (!syncRes.ok) throw new Error(`Sync failed: HTTP ${syncRes.status}`);
      const items = await fetchList();
      setState({ status: "ok", items });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void initialLoad();
  }, [initialLoad]);

  return { state, sync, busy };
}
```

**Patterns to copy:**

- **Discriminated-union state** for async data: `{ status: 'loading' | 'ok' | 'error' }` with a payload only on the success branch and a `message` on the error branch. The page renders a different branch per status — no nullable fields, no `if (loading && error)` confusion.
- **Hook returns a typed result interface** (`UseWorkItemsResult`).
- **Module-scope `API_BASE`** — hardcoded `http://127.0.0.1:41739` matching `server.ts`. Factor into `src/shared/config.ts` if you want.
- **`useCallback` for the action functions** so they’re stable across renders.
- **`busy` flag** prevents UI double-clicks during fetches.
- **`initialLoad` runs once via `useEffect`** with the callback in the deps array.
- **Mutating actions (`sync`)** also re-throw so the caller (`AsyncyButton`) can show an error state on top of the hook’s own error handling.

**Paste-ready template** for a new resource:

```ts
import { useCallback, useEffect, useState } from "react";
import type { Foo } from "../../shared/schemas/foo";

const API_BASE = "http://127.0.0.1:41739";

export type FoosState =
  | { status: "loading" }
  | { status: "ok"; items: Foo[] }
  | { status: "error"; message: string };

export function useFoos() {
  const [state, setState] = useState<FoosState>({ status: "loading" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/foos`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: Foo[] };
      setState({ status: "ok", items: data.items });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, refresh: load, busy };
}
```

**For a new app:** delete `useWorkItems.ts`. Add one `useXxx.ts` per resource.

### 7d. Components [STRUCTURAL]

**Folder:** `src/renderer/src/components/`

For now there’s exactly one shared component, and it’s domain-agnostic — keep it.

**`src/renderer/src/components/AsyncyButton.tsx`** — async-safe button primitive:

```tsx
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

type AsyncyButtonState = "idle" | "pending" | "error";

type AsyncyButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "disabled"
> & {
  onClick: () => Promise<unknown>;
  children: ReactNode;
};

export default function AsyncyButton({
  onClick,
  children,
  className,
  ...rest
}: AsyncyButtonProps) {
  const [state, setState] = useState<AsyncyButtonState>("idle");
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleClick() {
    if (state === "pending") return;
    setState("pending");
    try {
      await onClick();
      if (mounted.current) setState("idle");
    } catch {
      if (mounted.current) setState("error");
    }
  }

  const classes = ["btn"];
  if (state === "error") classes.push("asyncy-btn-error");
  if (className) classes.push(className);

  return (
    <button
      {...rest}
      className={classes.join(" ")}
      onClick={handleClick}
      disabled={state === "pending"}
      aria-busy={state === "pending"}
    >
      {state === "pending" ? (
        <span className="asyncy-btn-spinner" aria-hidden />
      ) : (
        children
      )}
    </button>
  );
}
```

**Patterns to copy:**

- **Local state machine** (`idle | pending | error`) instead of multiple booleans.
- **Mounted-ref guard** — don’t set state on an unmounted component.
- **`onClick` is constrained to return a `Promise`** so you can’t use it with sync handlers by mistake.
- **Error state surfaces as a CSS class** (`.asyncy-btn-error`); the underlying handler may also rethrow if the caller wants to react.
- **Pending state shows a CSS spinner** (`<span class="asyncy-btn-spinner" />` styled in `index.css`).

### 7e. Styling [MIXED]

**File:** `src/renderer/src/index.css`

**Approach:** plain CSS. **No Tailwind, no PostCSS, no CSS-in-JS, no CSS Modules.** Class names are BEM-ish (`.page-header`, `.row-icon-slack_question`, `.pill-red`).

**Structural rules to keep** (rename app-themed bits but keep the structure):

- Reset + system font stack
- `.page`, `.page-header`, `.page-subtitle`
- `.btn` + `.btn:hover:not(:disabled)` + `.btn:disabled`
- `.table`, `.table-row`, `.table-header-row`
- `.message`, `.message-error`
- `.asyncy-btn-error`, `.asyncy-btn-spinner`, `@keyframes asyncy-spin`

**Domain rules to delete or replace:**

- `.row-icon-slack_question`, `.row-icon-pr_review` (workflow-specific colors)
- `.pill`, `.pill-dot`, `.pill-red`, `.pill-yellow`, `.pill-green`, `.pill-gray` (status pills — keep if you need a pill primitive, restyle if not)

**Palette in use** (Apple-ish light mode):

- text: `#1d1d1f`, muted: `#86868b`
- bg: `#f5f5f7`, surface: `#fff`
- border: `#e5e5ea`, divider: `#f0f0f2`, hover: `#fafafa`
- danger: `#c92a2a` on `#fdecec`
- warn: `#946800` on `#fff4d6`
- success: `#0f7a3e` on `#e6f5ec`
- gray status: `#6e6e73` on `#f0f0f2`

The CSS file uses ASCII section comments (`/* ─── Page shell ──── */`). Keep that style — it makes the file scannable.

---

## 8. Shared schemas

**Folder:** `src/shared/`

```
src/shared/
├── schemas/
│   ├── work_item.ts        [DOMAIN — template]
│   └── slack_channel.ts    [DOMAIN — template]
└── schema_examples/
    └── *.json              [DOMAIN — fixtures, optional]
```

**Convention:** Zod schemas + inferred TS types in one file per model. Both the main process and the renderer import from here. Renderer imports use relative paths (`../../shared/schemas/foo` from a hook, `../../../shared/schemas/foo` from a page); no `@shared` alias is configured.

**Anatomy of a schema file** (modeled on `work_item.ts`):

```ts
import { z } from "zod";

// ─── Primitives ──────────────────────────────────────────────────────────────

export const StatusSchema = z.enum(["red", "yellow", "green", "gray"]);
export type Status = z.infer<typeof StatusSchema>;

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

export const RequiredActionSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  created_at: z.iso.datetime(),
});
export type RequiredAction = z.infer<typeof RequiredActionSchema>;

// ─── Discriminated unions for variants ───────────────────────────────────────

export const SlackQuestionSourceSchema = z.object({
  kind: z.literal("slack_question"),
  // ...
});

export const PRReviewSourceSchema = z.object({
  kind: z.literal("pr_review"),
  // ...
});

export const WorkItemSourceSchema = z.discriminatedUnion("kind", [
  SlackQuestionSourceSchema,
  PRReviewSourceSchema,
]);
export type WorkItemSource = z.infer<typeof WorkItemSourceSchema>;

// ─── Top-level model ─────────────────────────────────────────────────────────

export const WorkItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    // ...
    workflow: WorkflowKindSchema,
    source: WorkItemSourceSchema,
    // ...
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  // Cross-field invariants enforced by `.refine`
  .refine((item) => item.source.kind === item.workflow, {
    message: "source.kind must match workflow",
    path: ["source", "kind"],
  });
export type WorkItem = z.infer<typeof WorkItemSchema>;

// ─── File schema ─────────────────────────────────────────────────────────────

export const ItemsFileSchema = z.object({
  items: z.record(z.string(), WorkItemSchema),
});
export type ItemsFile = z.infer<typeof ItemsFileSchema>;

// ─── Create input ────────────────────────────────────────────────────────────

// Narrower than WorkItemSchema — store generates id and timestamps,
// applies defaults for the rest.
export const CreateItemInputSchema = z.object({
  workflow: WorkflowKindSchema,
  title: z.string(),
  source: WorkItemSourceSchema,
  // Optional overrides
  summary: z.string().optional(),
  status: StatusSchema.optional(),
  // ...
});
export type CreateItemInput = z.infer<typeof CreateItemInputSchema>;

// ─── Update input ────────────────────────────────────────────────────────────

// Patch shape — id and created_at are immutable; updated_at is set by the store.
export const UpdateItemInputSchema = z.object({
  title: z.string().optional(),
  // ... every other patch-able field as `.optional()`
});
export type UpdateItemInput = z.infer<typeof UpdateItemInputSchema>;
```

**Conventions:**

- **Section dividers** with `/* ─── Name ─── */` (or `// ─── Name ───`) ASCII rules. Sections in order: primitives → sub-schemas → discriminated unions → top-level model → file schema → create input → update input.
- **Always export both the schema and the inferred type.** Schemas are `PascalCaseSchema`; types are `PascalCase`.
- **Top-level model schema** is named for the model (`WorkItemSchema`, `SlackChannelSchema`).
- **File schema** is `XxxsFileSchema` and its shape is always `{ items: z.record(z.string(), XxxSchema) }`.
- **Create/update inputs** are _narrower_ than the full schema — the store fills in id/timestamps/defaults. Use `.optional()` extensively in update inputs.
- **Cross-field invariants** go on `.refine(...)` with a clear `message` and `path`.
- **Discriminated unions** for variant types (`z.discriminatedUnion("kind", [...])`).
- **ISO timestamps** use `z.iso.datetime()` (Zod 4 syntax).

**`schema_examples/`** — optional. Hand-written or copied JSON that conforms to the schema; useful for tests, docs, or pasting into a fresh database. Andrea ships fixtures for `work_items` and `slack_channels`.

**For a new app:** delete the existing schemas; create one file per model under `src/shared/schemas/`.

---

## 9. Data on disk

### Path

State lives under `app.getPath('userData')/data/`, computed in `src/main/index.ts`:

```ts
const dataDir = join(app.getPath("userData"), "data");
```

For an app with `appId: com.affirm.andrea` and `productName: Andrea`:

| OS      | Path                                         |
| ------- | -------------------------------------------- |
| macOS   | `~/Library/Application Support/Andrea/data/` |
| Linux   | `~/.config/Andrea/data/`                     |
| Windows | `%APPDATA%\Andrea\data\`                     |

(`app.getPath('userData')` is derived from `productName` on Mac/Windows, and `appId` on Linux. For a new app, change `electron-builder.yml` and the path follows.)

### File-per-model

Each model owns its own JSON files. Don’t share files across models. Today:

- `items.json` — active `WorkItem` records, `{ items: { [id]: WorkItem } }`
- `archive.json` — archived `WorkItem` records, same shape
- `slack_channels.json` — `SlackChannel` records, same shape

When you add a model, register its filenames in the store’s `initialize(dataDir)`:

```ts
filePaths = {
  items: path.join(dataDir, "foos.json"),
};
```

### File shape

Every file is `{ items: { [id]: T } }`. Always validate on load with the matching `Zod` `XxxFileSchema`.

### Reset

Delete the JSON file (or the entire `data/` directory) to reset state. The store recreates an empty file on next startup. Useful for `npm run dev` debugging.

---

## 10. Adding a new model — checklist

To add a `Foo` model:

1. **Schema** — `src/shared/schemas/foo.ts`
   - Primitives → sub-schemas → top-level → file-shape → create input → update input
   - Export both the Zod schema and the inferred type for everything

2. **Store** — `src/main/core/store/foo.ts`
   - Module-scope `initialized`, `filePaths`, `db`
   - `assertInitialized()`
   - `initialize(dataDir)` — mkdir, set paths, load + Zod-validate, set `initialized = true`
   - Sync reads (`getFoo`, `listFoos`) — return `structuredClone()`, no `enqueue`
   - Async writes (`createFoo`, `updateFoo`, `deleteFoo`, …) — full RMW inside one `enqueue(...)`, validate input outside, validate merged result inside, `writeFileAtomic`, additive-first ordering for multi-file writes

3. **Controller** — `src/main/controller/foo_controller.ts`
   - Skip if the operation is just “read from store and shape” — call the store directly from the API
   - Add when there’s real orchestration (multiple stores, connectors, dedup, etc.)

4. **API** — `src/main/api/foo_api.ts`
   - Export `registerFooRoutes(app: FastifyInstance): Promise<void>`
   - One Fastify handler per route, type-guard request bodies, return `{ items }` / `{ ... }` / 500 on error

5. **Wire-up**
   - `src/main/index.ts`: `import { initialize as initializeFooStore } from './core/store/foo'`, then `await initializeFooStore(dataDir)` inside the existing init block
   - `src/main/server.ts`: `import { registerFooRoutes } from './api/foo_api'`, then `await registerFooRoutes(app)` in `startServer`

6. **Renderer**
   - `src/renderer/src/useFoos.ts` — discriminated-union state + `fetch` to `${API_BASE}/foos`
   - `src/renderer/src/pages/FoosPage.tsx` — page + co-located sub-components
   - `src/renderer/src/MainApp.tsx` — add `<Route path="/foos" element={<FoosPage />} />`

**Checklist (mirroring CLAUDE.md):**

- [ ] Schema module under `src/shared/schemas/`
- [ ] Store module under `src/main/core/store/` that imports `enqueue` from `./write_queue`
- [ ] Every write wrapped in a single `enqueue(...)` covering the full RMW cycle
- [ ] Inputs validated before `enqueue`; merged result validated inside `enqueue`
- [ ] All persistence uses `writeFileAtomic`
- [ ] All read/write return values pass through `structuredClone`
- [ ] Multi-file writes ordered additive-first
- [ ] `initialize` registered in `src/main/index.ts`
- [ ] API registered in `src/main/server.ts`

---

## 11. What to remove / swap when starting fresh

A flat list, file by file. Use this as a checklist when you copy this repo to bootstrap a new app.

### Delete

```
src/main/api/chat_api.ts
src/main/api/work_item_api.ts
src/main/controller/work_item_controller.ts
src/main/controller/slack_controller.ts
src/main/connectors/claude_code.ts            (unless reusing Claude SDK)
src/main/core/store/work_item.ts
src/main/core/store/slack_channel.ts
src/shared/schemas/work_item.ts
src/shared/schemas/slack_channel.ts
src/shared/schema_examples/*.json
src/renderer/src/pages/WorkItemsPage.tsx
src/renderer/src/useWorkItems.ts
```

### Edit

- **`src/main/index.ts`** — remove the `initializeWorkItemStore` and `initializeSlackChannelStore` imports + calls; replace with your store inits. Change `setAppUserModelId('com.affirm.andrea')` and the window `title: 'Andrea'`.
- **`src/main/server.ts`** — remove the `registerChatRoutes`/`registerWorkItemRoutes` imports + calls; replace. Change the `[andrea]` log prefix. Keep `/ping`, CORS, the preHandler hook.
- **`src/renderer/src/MainApp.tsx`** — replace the `/work-items` route + redirect with your routes.
- **`src/renderer/src/index.css`** — delete `.row-icon-*` and `.pill-*` rules; keep page/header/btn/table/message/spinner.
- **`src/renderer/index.html`** — change `<title>`.
- **`package.json`** — change `name`, `description`, `author`. Drop `@anthropic-ai/claude-agent-sdk` if not reusing.
- **`electron-builder.yml`** — change `appId`, `productName`, `dmg.artifactName`.
- **`CLAUDE.md`** — keep the persistence section verbatim; update the app-name references and the per-OS data path table to match the new `productName`/`appId`.

### Keep verbatim (or near-verbatim)

```
src/main/core/store/write_queue.ts
src/main/server.ts                            (skeleton only — port, CORS, preHandler, /ping)
src/preload/index.ts
src/preload/index.d.ts
src/renderer/index.html                       (modulo <title>)
src/renderer/src/main.tsx
src/renderer/src/env.d.ts
src/renderer/src/components/AsyncyButton.tsx
electron.vite.config.ts
tsconfig.json
tsconfig.node.json
tsconfig.web.json
eslint.config.js
.gitignore
```

After this pass you have a clean Electron+React shell with:

- Fastify on `127.0.0.1:41739` with `/ping`
- A working preload bridge (empty)
- A renderer bootstrap with React Router but no pages
- The write-queue and the patterns to drop new stores in
- All build, lint, and typecheck tooling intact

…and zero domain code.

---

## 12. Verification

After scaffolding, you should be able to:

1. **Install and run dev**

   ```sh
   npm install
   npm run dev
   ```

   The Electron window opens. Console shows `[<app>] fastify listening on http://127.0.0.1:41739`.

2. **Hit the health endpoint**

   ```sh
   curl http://127.0.0.1:41739/ping
   # → {"ok":true}
   ```

3. **Static checks pass**

   ```sh
   npm run typecheck
   npm run lint
   ```

4. **State persists**
   - Trigger a write (e.g. through your UI or `curl -X POST` to a route).
   - Inspect the file under `app.getPath('userData')/data/`. On macOS:
     ```sh
     ls "~/Library/Application Support/<productName>/data/"
     cat "~/Library/Application Support/<productName>/data/<file>.json"
     ```
   - The record should be there, with all fields the schema requires.

5. **Clean shutdown**
   - Quit the app via Cmd-Q.
   - Re-launch — the data should still be present (no loss).
   - Inspect the JSON file before and after — it should be a single complete object, never half-written (proof that `writeFileAtomic` and the will-quit `flush()` are doing their job).

6. **Reset works**
   - Quit the app.
   - Delete `data/<file>.json`.
   - Re-launch. The store recreates an empty file. If you have a seed-defaults pattern (like `slack_channel.ts`’s `seedDefaults`), it should re-apply on this fresh init.

If all six pass, the scaffolding is wired up correctly and you can start building domain logic on top.
