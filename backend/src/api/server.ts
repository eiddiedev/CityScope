import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { providerFromEnv } from "../providers/index.js";
import type { AgentAction, Intervention } from "../domain.js";
import { ApiError, RunStore } from "./run-store.js";

const provider = providerFromEnv();
const store = new RunStore(provider);
const port = Number(process.env.PORT ?? 8787);

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR", error instanceof Error ? error.message : "internal error", 500);
    send(response, apiError.status, { error: { code: apiError.code, message: apiError.message, details: apiError.details, retryable: apiError.retryable } });
  }
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  if (method === "GET" && url.pathname === "/healthz") {
    send(response, 200, { ok: true, provider: provider.id, model: provider.model, demoMode: provider.id === "stub" });
    return;
  }
  if (parts[0] !== "api" || parts[1] !== "v0") throw new ApiError("NOT_FOUND", "route not found", 404);
  if (method === "POST" && parts[2] === "runs" && parts.length === 3) {
    const body = await jsonBody(request);
    send(response, 201, store.createRun(String(body.runId ?? `run_${Date.now()}`), typeof body.seed === "number" ? body.seed : undefined));
    return;
  }
  if (parts[2] === "runs" && parts[3]) {
    const runId = parts[3];
    if (method === "GET" && parts.length === 4) return send(response, 200, store.getRun(runId));
    if (method === "POST" && parts[4] === "actions") return send(response, 200, await store.submitAction(runId, await jsonBody(request) as unknown as AgentAction, ifMatch(request)));
    if (method === "POST" && parts[4] === "advance") return send(response, 200, await store.advance(runId, ifMatch(request)));
    if (method === "GET" && parts[4] === "events") return send(response, 200, store.events(runId, Number(url.searchParams.get("afterVersion") ?? -1)));
    if (method === "POST" && parts[4] === "checkpoints") {
      const body = await jsonBody(request);
      return send(response, 201, store.createCheckpoint(runId, typeof body.checkpointId === "string" ? body.checkpointId : undefined));
    }
    if (method === "GET" && parts[4] === "trace" && parts[5]) return send(response, 200, store.trace(runId, parts[5]));
    if (method === "GET" && parts[4] === "outcome") return send(response, 200, store.outcome(runId));
    if (method === "POST" && parts[4] === "replay") {
      const body = await jsonBody(request);
      return send(response, 200, store.replayFrom(runId, String(body.checkpointId), Array.isArray(body.actions) ? body.actions as AgentAction[] : []));
    }
  }
  if (method === "POST" && parts[2] === "checkpoints" && parts[3] && parts[4] === "forks") {
    const body = await jsonBody(request);
    return send(response, 201, store.fork(parts[3], String(body.runId), body.intervention as unknown as Intervention));
  }
  throw new ApiError("NOT_FOUND", "route not found", 404);
}

function ifMatch(request: IncomingMessage): number | undefined {
  const value = request.headers["if-match"];
  if (value === undefined) return undefined;
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new ApiError("WORLD_VERSION_CONFLICT", "If-Match must be a non-negative worldVersion", 409, true);
  return parsed;
}

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new ApiError("INVALID_ACTION_SCHEMA", "request body must be valid JSON", 400);
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

server.listen(port, () => {
  console.log(JSON.stringify({ service: "cityscope-backend", port, provider: provider.id, model: provider.model, demoMode: provider.id === "stub" }));
});

