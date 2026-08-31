# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **reverse-engineered / decompiled** version of Anthropic's official Claude Code CLI tool. The goal is to restore core functionality while trimming secondary capabilities. Many modules are stubbed or feature-flagged off. The codebase has ~1341 tsc errors from decompilation (mostly `unknown`/`never`/`{}` types) — these do **not** block Bun runtime execution.

## Commands

```bash
# Install dependencies
pnpm install

# Dev mode — runs the live source under tsx, no build step
pnpm dev
# equivalent to: node --conditions=import --import ./src/loaders/register.mjs --import tsx src/entrypoints/cli.tsx
# run the bundled build instead: pnpm dev:bundle

# Pipe mode (needs API credentials/network — without them it waits on the API call)
echo "say hello" | node --conditions=import --import ./src/loaders/register.mjs --import tsx src/entrypoints/cli.tsx -p

# Test (Vitest)
pnpm test          # once
pnpm test:watch    # watch mode

# Build (outputs dist/cli.js, ~30MB, via esbuild)
pnpm build
```

No linter is configured.

## Architecture

### Runtime & Build

- **Runtime**: Node.js (20+). The source uses `typeof Bun !== 'undefined'` guards
  everywhere, so every Bun-only path falls back to the Node branch — under Node
  those branches are never taken.
- **Build**: `tsx build.ts` → esbuild bundles `src/entrypoints/cli.tsx` to a
  single `dist/cli.js` (ESM). A `src/*` path alias and `bun:*` module shims are
  wired so the codebase compiles without Bun.
- **Module system**: ESM (`"type": "module"`), TSX with `react-jsx` transform.
- **Monorepo**: pnpm workspaces — internal packages live in `packages/`
  (globs in `pnpm-workspace.yaml`) resolved via `workspace:*`.
- **Bun shims**: `src/polyfills/bunBundle.ts` (`feature()` → `false`, `MACRO`),
  `bunFFI.ts` (throws on dlopen), `bunShell.ts` (`$` throws). `feature('...')`
  string-literal calls are rewritten to `false` at build time so dead branches
  (e.g. `require('./commands/proactive.js')`) are tree-shaken like Bun's macro
  did.
- **Dev-only loaders** (`src/loaders/`, wired by `pnpm dev`): they make the
  source run under Node the way it ran under Bun.
  - `register.mjs` (main thread): `.md` ESM text loader; a global `require`
    (via `createRequire`) for bare CJS-style calls (`require('semver')`);
    `.txt`/`.md` CJS text loaders (`module.exports = "..."`, matching
    esbuild's text loader in dist).
  - `requireShim.mjs` (hooks thread): injects
    `const require = createRequire(import.meta.url)` into every `src/**` file
    so the 85+ lazy RELATIVE `require('./tools/...')` calls resolve like Bun's
    per-module require — a single global can't know its caller, and without
    this the interactive TUI hangs silently. tsx then remaps the `.js`
    specifiers to the real `.ts`/`.tsx` files.
  - `--conditions=import` (in the `dev` script) lets those CJS requires
    resolve ESM-only packages, which Node 22+ loads natively (require(esm)).
  The esbuild build needs none of this: it inlines requires at bundle time.

### Entry & Bootstrap

1. **`src/entrypoints/cli.tsx`** — True entrypoint. Injects runtime polyfills at the top:
   - `feature()` always returns `false` (all feature flags disabled, skipping unimplemented branches).
   - `globalThis.MACRO` — simulates build-time macro injection (VERSION, BUILD_TIME, etc.).
   - `BUILD_TARGET`, `BUILD_ENV`, `INTERFACE_TYPE` globals.
2. **`src/main.tsx`** — Commander.js CLI definition. Parses args, initializes services (auth, analytics, policy), then launches the REPL or runs in pipe mode.
3. **`src/entrypoints/init.ts`** — One-time initialization (telemetry, config, trust dialog).

### Core Loop

- **`src/query.ts`** — The main API query function. Sends messages to Claude API, handles streaming responses, processes tool calls, and manages the conversation turn loop.
- **`src/QueryEngine.ts`** — Higher-level orchestrator wrapping `query()`. Manages conversation state, compaction, file history snapshots, attribution, and turn-level bookkeeping. Used by the REPL screen.
- **`src/screens/REPL.tsx`** — The interactive REPL screen (React/Ink component). Handles user input, message display, tool permission prompts, and keyboard shortcuts.

### API Layer

- **`src/services/api/claude.ts`** — Core API client. Builds request params (system prompt, messages, tools, betas), calls the Anthropic SDK streaming endpoint, and processes `BetaRawMessageStreamEvent` events.
- Supports multiple providers: Anthropic direct, AWS Bedrock, Google Vertex, Azure.
- Provider selection in `src/utils/model/providers.ts`.

### Provider Hub (`src/provider/`)

Multi-provider model layer on top of the Anthropic pipeline. Model refs are
`<provider-name>::<model-id>` (e.g. `DeepSeek::deepseek-chat`) — the prefix is
the **user's instance name**, not the protocol. Namespaced refs never collide
with native Anthropic ids (`claude-*` / `us.anthropic.*` contain no `::`).

- **Config**: `~/.claude/providers/providers.json`. Preferred shape is the flat
  4-field form (parsed by `flatToInstance` in `configStore.ts`, which falls
  back to full `ProviderInstanceSchema`):
  ```json
  [{ "name": "DeepSeek", "protocol": "OpenAI", "baseURL": "https://api.deepseek.com", "apiKey": "sk-..." }]
  ```
  `protocol` is case-insensitive `"Anthropic" | "OpenAI"` → providerId
  `anthropic`/`openai`. `name` doubles as instance id and the model-ref prefix.
- **Routing seam**: active selection lives in `provider/modelSeam.ts`
  (`setActiveModelSelection`), set by `/model` (`src/components/ProviderModelPicker.tsx`)
  or `/providers config|route <name>::<model>`. `normalizeModelStringForAPI()`
  (`src/utils/model/model.ts`) strips the `::` prefix before the API call.
- **Gateway**: `getAnthropicClient()` (`src/services/api/client.ts`) — when the
  model has a `::` prefix, `ensureGatewayStarted(prefix)`
  (`provider/gateway/manager.ts`) resolves the instance by name/id and returns
  true only for non-Anthropic protocols; then baseURL is rewritten to the
  in-process gateway (`provider/gateway/server.ts`, `127.0.0.1:3456`), which
  translates Anthropic `/v1/messages` → OpenAI `chat/completions` and re-encodes
  the SSE stream back (`transform.ts`, `AnthropicStreamEncoder`). Anthropic
  protocol instances go native (no gateway).
- **Plugins**: only `anthropic` + `openai` are built-in
  (`provider/plugins/registry.ts`); other plugin files stay on disk
  unregistered. Registry is lazily ensured at runtime (`provider/defaults.ts`).
- **Commands**: `/providers` (`src/commands/providers/providers.tsx`) — bare →
  `ManageProvidersPage`, `add` → `AddProviderWizard`, plus `list`,
  `enable|disable|remove <name>`, `scan`, `config|route <name>::<model>`.

### Tool System

- **`src/Tool.ts`** — Tool interface definition (`Tool` type) and utilities (`findToolByName`, `toolMatchesName`).
- **`src/tools.ts`** — Tool registry. Assembles the tool list; some tools are conditionally loaded via `feature()` flags or `process.env.USER_TYPE`.
- **`src/tools/<ToolName>/`** — Each tool in its own directory (e.g., `BashTool`, `FileEditTool`, `GrepTool`, `AgentTool`).
- Tools define: `name`, `description`, `inputSchema` (JSON Schema), `call()` (execution), and optionally a React component for rendering results.

### UI Layer (Ink)

- **`src/ink.ts`** — Ink render wrapper with ThemeProvider injection.
- **`src/ink/`** — Custom Ink framework (forked/internal): custom reconciler, hooks (`useInput`, `useTerminalSize`, `useSearchHighlight`), virtual list rendering.
- **`src/components/`** — React components rendered in terminal via Ink. Key ones:
  - `App.tsx` — Root provider (AppState, Stats, FpsMetrics).
  - `Messages.tsx` / `MessageRow.tsx` — Conversation message rendering.
  - `PromptInput/` — User input handling.
  - `permissions/` — Tool permission approval UI.
- Components use React Compiler runtime (`react/compiler-runtime`) — decompiled output has `_c()` memoization calls throughout.

### State Management

- **`src/state/AppState.tsx`** — Central app state type and context provider. Contains messages, tools, permissions, MCP connections, etc.
- **`src/state/store.ts`** — Zustand-style store for AppState.
- **`src/bootstrap/state.ts`** — Module-level singletons for session-global state (session ID, CWD, project root, token counts).

### Context & System Prompt

- **`src/context.ts`** — Builds system/user context for the API call (git status, date, CLAUDE.md contents, memory files).
- **`src/utils/claudemd.ts`** — Discovers and loads CLAUDE.md files from project hierarchy.

### Feature Flag System

All `feature('FLAG_NAME')` calls come from `bun:bundle` (a build-time API). A shim (`src/polyfills/bunBundle.ts`) returns `false`, and the build rewrites string-literal `feature('...')` calls to `false`, so all Anthropic-internal features (COORDINATOR_MODE, KAIROS, PROACTIVE, etc.) are disabled and their dead branches are tree-shaken.

### Stubbed/Deleted Modules

| Module | Status |
|--------|--------|
| Computer Use (`@ant/*`) | Stub packages in `packages/@ant/` |
| `*-napi` packages (audio, image, url, modifiers) | Stubs in `packages/` (except `color-diff-napi` which is fully implemented) |
| Analytics / GrowthBook / Sentry | Empty implementations |
| Magic Docs / Voice Mode / LSP Server | Removed |
| Plugins / Marketplace | Removed |
| MCP OAuth | Simplified |

### Key Type Files

- **`src/types/global.d.ts`** — Declares `MACRO`, `BUILD_TARGET`, `BUILD_ENV` and internal Anthropic-only identifiers.
- **`src/types/internal-modules.d.ts`** — Type declarations for `bun:bundle`, `bun:ffi`, `@anthropic-ai/mcpb`.
- **`src/types/message.ts`** — Message type hierarchy (UserMessage, AssistantMessage, SystemMessage, etc.).
- **`src/types/permissions.ts`** — Permission mode and result types.

## Working with This Codebase

- **Don't try to fix all tsc errors** — they're from decompilation and don't affect runtime.
- **`feature()` is always `false`** — any code behind a feature flag is dead code in this build.
- **React Compiler output** — Components have decompiled memoization boilerplate (`const $ = _c(N)`). This is normal.
- **`bun:bundle` import** — `import { feature } from 'bun:bundle'` resolves to `src/polyfills/bunBundle.ts` via tsconfig `paths`/the esbuild alias, so it works in dev (tsx) and at build time.
- **`src/` path alias** — tsconfig maps `src/*` to `./src/*`. Imports like `import { ... } from 'src/utils/...'` are valid.
