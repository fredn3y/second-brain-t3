import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  HttpBody,
  HttpClient,
  type HttpClientResponse,
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import { authenticateRawRouteWithScope } from "../http.ts";

/**
 * Second Brain fork: the "Control Center Settings" page reads and writes the
 * model-routing registry that lives in the Second Brain gateway
 * (`scripts/tasks/render.py`, loopback `:8765`, `/api/models`).
 *
 * T3 fronts that API here so the browser only ever talks to its own origin with
 * its own paired session: GET requires `orchestration:read`, POST requires
 * `orchestration:operate`. The upstream call is a fresh loopback request with no
 * browser cookies/Origin, which is exactly the loopback-client path the gateway
 * already allows, so its same-origin/CSRF rules for everyone else stay intact.
 */
export const CONTROL_CENTER_MODELS_PATH = "/api/control-center/models";
export const DEFAULT_CONTROL_CENTER_GATEWAY_URL = "http://127.0.0.1:8765";
const GATEWAY_TIMEOUT = "15 seconds";
const MAX_WRITE_BODY_BYTES = 16 * 1024;

export function resolveControlCenterGatewayUrl(configured: string | undefined): string {
  const trimmed = configured?.trim() ?? "";
  return (trimmed.length > 0 ? trimmed : DEFAULT_CONTROL_CENTER_GATEWAY_URL).replace(/\/+$/, "");
}

/** Accept only a small JSON object body; anything else is a 400 before we touch the gateway. */
export function parseControlCenterWriteBody(
  text: string,
):
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly error: string } {
  if (text.length === 0 || new TextEncoder().encode(text).byteLength > MAX_WRITE_BODY_BYTES) {
    return { ok: false, error: "request body must be between 1 byte and 16 KiB" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "request body must be valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "request body must be a JSON object" };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

class ControlCenterGatewayError extends Data.TaggedError("ControlCenterGatewayError")<{
  readonly cause: unknown;
}> {}

/** The gateway answers JSON objects only (`{"ok": …}`); anything else is treated as a gateway fault. */
const GatewayJsonObject = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const decodeGatewayJsonObject = Schema.decodeUnknownEffect(GatewayJsonObject);

const jsonResponse = (status: number, payload: unknown) =>
  HttpServerResponse.jsonUnsafe(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });

const gatewayUnavailable = jsonResponse(502, {
  ok: false,
  error: "The Second Brain gateway did not answer. Check control-center.service and retry.",
});

/** Pass the gateway's status and JSON body through unchanged; a non-JSON reply is a gateway fault. */
const relayGatewayResponse = <E>(
  request: Effect.Effect<HttpClientResponse.HttpClientResponse, E>,
) =>
  Effect.gen(function* () {
    const response = yield* request.pipe(Effect.timeout(GATEWAY_TIMEOUT));
    const text = yield* response.text;
    const payload = yield* decodeGatewayJsonObject(text);
    return jsonResponse(response.status, payload);
  }).pipe(
    Effect.mapError((cause) => new ControlCenterGatewayError({ cause })),
    Effect.tapError((cause) =>
      Effect.logWarning("Control Center gateway request failed", { cause }),
    ),
    Effect.orElseSucceed(() => gatewayUnavailable),
  );

const withAuthErrorResponses = <R>(
  effect: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    Effect.Error<ReturnType<typeof authenticateRawRouteWithScope>>,
    R
  >,
) =>
  effect.pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  );

const readRoute = (path: string, gatewayPath: string) =>
  HttpRouter.add(
    "GET",
    path,
    withAuthErrorResponses(
      Effect.gen(function* () {
        yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
        const config = yield* ServerConfig.ServerConfig;
        const httpClient = yield* HttpClient.HttpClient;
        const gatewayUrl = resolveControlCenterGatewayUrl(config.controlCenterGatewayUrl);
        return yield* relayGatewayResponse(httpClient.get(`${gatewayUrl}${gatewayPath}`));
      }),
    ),
  );

const writeRoute = (path: string, gatewayPath: string) =>
  HttpRouter.add(
    "POST",
    path,
    withAuthErrorResponses(
      Effect.gen(function* () {
        yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
        const request = yield* HttpServerRequest.HttpServerRequest;
        const declaredLength = Number(request.headers["content-length"] ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > MAX_WRITE_BODY_BYTES) {
          return jsonResponse(413, { ok: false, error: "request body must be at most 16 KiB" });
        }
        const parsed = parseControlCenterWriteBody(
          yield* request.text.pipe(Effect.orElseSucceed(() => "")),
        );
        if (!parsed.ok) {
          return jsonResponse(400, { ok: false, error: parsed.error });
        }
        const config = yield* ServerConfig.ServerConfig;
        const httpClient = yield* HttpClient.HttpClient;
        const gatewayUrl = resolveControlCenterGatewayUrl(config.controlCenterGatewayUrl);
        return yield* relayGatewayResponse(
          httpClient.post(`${gatewayUrl}${gatewayPath}`, {
            body: HttpBody.jsonUnsafe(parsed.body),
          }),
        );
      }),
    ),
  );

export const controlCenterModelsRouteLayer = Layer.mergeAll(
  readRoute(CONTROL_CENTER_MODELS_PATH, "/api/models"),
  writeRoute(CONTROL_CENTER_MODELS_PATH, "/api/models"),
  readRoute("/api/control-center/automations", "/api/automations"),
  writeRoute("/api/control-center/automations", "/api/automations"),
);
