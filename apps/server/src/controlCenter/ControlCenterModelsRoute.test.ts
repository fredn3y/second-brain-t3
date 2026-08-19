// @effect-diagnostics nodeBuiltinImport:off - the gateway stub is a real loopback HTTP server.
import * as NodeHttp from "node:http";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { afterEach, describe, expect, it } from "vite-plus/test";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { controlCenterModelsRouteLayer } from "./ControlCenterModelsRoute.ts";

// Second Brain fork: Settings → Control Center Settings talks to the loopback
// model-routing gateway only through this authenticated, same-origin relay.

interface GatewayRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: NodeHttp.IncomingHttpHeaders;
  readonly body: string;
}

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

const startGatewayStub = (
  respond: (input: GatewayRequest) => { readonly status: number; readonly body: string },
) =>
  new Promise<{ readonly url: string; readonly requests: GatewayRequest[] }>((resolve, reject) => {
    const requests: GatewayRequest[] = [];
    const server = NodeHttp.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const input = {
          method: request.method ?? "",
          url: request.url ?? "",
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        };
        requests.push(input);
        const reply = respond(input);
        response.statusCode = reply.status;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(reply.body);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP gateway stub address"));
        return;
      }
      disposers.push(
        () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()));
          }),
      );
      resolve({ url: `http://127.0.0.1:${address.port}`, requests });
    });
  });

/** A paired session presents `cookie: session=<scope list>`; no cookie is unauthenticated. */
const fixture = (gatewayUrl: string) => {
  const { handler, dispose } = HttpRouter.toWebHandler(
    controlCenterModelsRouteLayer.pipe(
      Layer.provideMerge(
        Layer.succeed(EnvironmentAuth.EnvironmentAuth, {
          authenticateHttpRequest: (request: { readonly headers: Record<string, string> }) => {
            const cookie = request.headers.cookie;
            if (!cookie?.startsWith("session=")) {
              return Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError());
            }
            return Effect.succeed({
              sessionId: AuthSessionId.make("test"),
              subject: "test",
              method: "browser-session-cookie",
              scopes: cookie.slice("session=".length).split(",") as AuthEnvironmentScope[],
            });
          },
        } as unknown as EnvironmentAuth.EnvironmentAuth["Service"]),
      ),
      Layer.provideMerge(
        Layer.succeed(ServerConfig.ServerConfig, {
          controlCenterGatewayUrl: gatewayUrl,
        } as unknown as ServerConfig.ServerConfig["Service"]),
      ),
      Layer.provideMerge(FetchHttpClient.layer),
    ),
    { disableLogger: true },
  );
  disposers.push(dispose);
  return (path: string, init?: RequestInit) => handler(new Request(`http://t3.test${path}`, init));
};

const paired = `session=${AuthOrchestrationReadScope},${AuthOrchestrationOperateScope}`;

const post = (body: string, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body,
});

describe("control center gateway relay", () => {
  it("rejects unauthenticated Control Center model reads and writes", async () => {
    const gateway = await startGatewayStub(() => ({
      status: 200,
      body: JSON.stringify({ ok: true, consumers: [] }),
    }));
    const request = fixture(gateway.url);

    expect((await request("/api/control-center/models")).status).toBe(401);
    const write = await request(
      "/api/control-center/models",
      post(JSON.stringify({ consumer: "daybrief", reset: true }), {
        origin: "http://localhost:5733",
      }),
    );
    expect(write.status).toBe(401);
    expect(gateway.requests).toEqual([]);
  });

  it("requires operate scope for writes", async () => {
    const gateway = await startGatewayStub(() => ({ status: 200, body: '{"ok":true}' }));
    const request = fixture(gateway.url);
    const readOnly = `session=${AuthOrchestrationReadScope}`;

    expect(
      (await request("/api/control-center/models", { headers: { cookie: readOnly } })).status,
    ).toBe(200);
    const write = await request(
      "/api/control-center/models",
      post(JSON.stringify({ consumer: "daybrief", reset: true }), { cookie: readOnly }),
    );
    expect(write.status).toBe(403);
    expect(gateway.requests.map((entry) => entry.method)).toEqual(["GET"]);
  });

  it("relays Control Center model reads and writes for a paired session", async () => {
    const gateway = await startGatewayStub((input) =>
      input.method === "POST" && input.body.includes("bogus")
        ? { status: 400, body: JSON.stringify({ ok: false, error: "unknown consumer: bogus" }) }
        : {
            status: 200,
            body: JSON.stringify({ ok: true, consumers: [{ consumer: "daybrief" }] }),
          },
    );
    const request = fixture(gateway.url);

    const read = await request("/api/control-center/models", { headers: { cookie: paired } });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ ok: true, consumers: [{ consumer: "daybrief" }] });

    const write = await request(
      "/api/control-center/models",
      post(JSON.stringify({ consumer: "daybrief", reset: true }), {
        cookie: paired,
        origin: "http://localhost:5733",
      }),
    );
    expect(write.status).toBe(200);
    await write.text();

    const rejected = await request(
      "/api/control-center/models",
      post(JSON.stringify({ consumer: "bogus" }), { cookie: paired }),
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ ok: false, error: "unknown consumer: bogus" });

    const malformed = await request(
      "/api/control-center/models",
      post("[1, 2, 3]", { cookie: paired }),
    );
    expect(malformed.status).toBe(400);
    await malformed.text();

    expect(gateway.requests.map((entry) => [entry.method, entry.url, entry.body])).toEqual([
      ["GET", "/api/models", ""],
      ["POST", "/api/models", JSON.stringify({ consumer: "daybrief", reset: true })],
      ["POST", "/api/models", JSON.stringify({ consumer: "bogus" })],
    ]);
    // The browser's session cookie and Origin never reach the gateway: the
    // relay speaks to it as a plain loopback client.
    expect(
      gateway.requests.every(
        (entry) => entry.headers.cookie === undefined && entry.headers.origin === undefined,
      ),
    ).toBe(true);
  });

  it("authenticates and relays Control Center automation reads and actions", async () => {
    const gateway = await startGatewayStub((input) => ({
      status: input.body.includes("unknown") ? 400 : 200,
      body: '{"ok":true,"jobs":[]}',
    }));
    const request = fixture(gateway.url);
    const path = "/api/control-center/automations";

    expect((await request(path)).status).toBe(401);
    expect((await request(path, post("{}"))).status).toBe(401);
    expect(gateway.requests).toEqual([]);

    const read = await request(path, { headers: { cookie: paired } });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ ok: true, jobs: [] });
    expect(read.headers.get("cache-control")).toBe("no-store");
    const action = async (body: string) => {
      const response = await request(path, post(body, { cookie: paired }));
      await response.text();
      return response.status;
    };
    expect(await action('{"id":"drift-scan","action":"pause"}')).toBe(200);
    expect(await action('{"id":"unknown","action":"run"}')).toBe(400);
    expect(await action("[]")).toBe(400);
    expect(gateway.requests.map((entry) => `${entry.method} ${entry.url} ${entry.body}`)).toEqual([
      "GET /api/automations ",
      'POST /api/automations {"id":"drift-scan","action":"pause"}',
      'POST /api/automations {"id":"unknown","action":"run"}',
    ]);
    expect(
      gateway.requests.every(
        (entry) => entry.headers.cookie === undefined && entry.headers.origin === undefined,
      ),
    ).toBe(true);
  });

  it("reports an unreachable Control Center gateway as 502 without leaking details", async () => {
    const request = fixture("http://127.0.0.1:9");
    const response = await request("/api/control-center/models", { headers: { cookie: paired } });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { readonly ok: boolean; readonly error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("gateway");
  });
});
