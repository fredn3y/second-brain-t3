import { readDesktopPrimaryBearerToken } from "../../environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";

/**
 * Second Brain fork: client side of Settings → Control Center Settings. The
 * server relays `/api/control-center/models` to the Second Brain gateway's
 * model registry (`scripts/tasks/cc/models.py`), whose payload shape is mirrored
 * in the types below. Pure helpers are kept here so the panel stays dumb.
 */
export const CONTROL_CENTER_MODELS_PATH = "/api/control-center/models";

export interface ControlCenterEngineCatalog {
  readonly label: string;
  readonly models: ReadonlyArray<string>;
  readonly efforts: ReadonlyArray<string>;
  readonly model_efforts: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly labels: Readonly<Record<string, string>>;
}

export interface ControlCenterRoute {
  readonly consumer: string;
  readonly label: string;
  readonly description: string;
  readonly engine: string;
  readonly engine_label: string;
  readonly default_engine: string;
  readonly engines_allowed: ReadonlyArray<string>;
  readonly model: string;
  readonly effort: string;
  readonly source: "default" | "override";
  readonly updated_at: string;
  readonly updated_by: string;
  readonly default_model: string;
  readonly default_effort: string;
  readonly effort_required: boolean;
}

export interface ControlCenterModelsState {
  readonly ok: boolean;
  readonly catalog: Readonly<Record<string, ControlCenterEngineCatalog>>;
  readonly consumers: ReadonlyArray<ControlCenterRoute>;
}

export interface ControlCenterRouteDraft {
  readonly engine: string;
  readonly model: string;
  readonly effort: string;
}

export interface ControlCenterChoice {
  readonly value: string;
  readonly label: string;
}

export const AUTOMATIC_EFFORT_LABEL = "Automatic";

export function routeDraftFromLive(route: ControlCenterRoute): ControlCenterRouteDraft {
  return { engine: route.engine, model: route.model, effort: route.effort };
}

export function routeDraftEquals(left: ControlCenterRouteDraft, right: ControlCenterRouteDraft) {
  return left.engine === right.engine && left.model === right.model && left.effort === right.effort;
}

export function engineChoices(
  catalog: ControlCenterModelsState["catalog"],
  route: ControlCenterRoute,
): ReadonlyArray<ControlCenterChoice> {
  return route.engines_allowed.map((engine) => ({
    value: engine,
    label: catalog[engine]?.label ?? engine,
  }));
}

export function modelChoices(
  catalog: ControlCenterModelsState["catalog"],
  engine: string,
): ReadonlyArray<ControlCenterChoice> {
  const spec = catalog[engine];
  if (!spec) return [];
  return spec.models.map((model) => ({ value: model, label: spec.labels[model] ?? model }));
}

const EFFORT_LABELS: Readonly<Record<string, string>> = {
  "": AUTOMATIC_EFFORT_LABEL,
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

/** Human label for an effort id; unknown future levels show their id. */
export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort;
}

/** Effort levels a model supports; a blank "Automatic" entry leads when the runner may omit the flag. */
export function effortChoices(
  catalog: ControlCenterModelsState["catalog"],
  draft: Pick<ControlCenterRouteDraft, "engine" | "model">,
  effortRequired: boolean,
): ReadonlyArray<ControlCenterChoice> {
  const efforts = catalog[draft.engine]?.model_efforts[draft.model] ?? [];
  const levels = efforts.map((effort) => ({ value: effort, label: effortLabel(effort) }));
  return effortRequired ? levels : [{ value: "", label: AUTOMATIC_EFFORT_LABEL }, ...levels];
}

/** One-line answer to "what does this run?", e.g. "GPT-6 Sol · High". */
export function routeChoiceSummary(
  catalog: ControlCenterModelsState["catalog"],
  choice: ControlCenterRouteDraft,
): string {
  const model = catalog[choice.engine]?.labels[choice.model] ?? choice.model;
  return `${model} · ${choice.effort ? effortLabel(choice.effort) : "Auto"}`;
}

/** Keep the current model/effort when the new engine offers them; otherwise fall back to its first entries. */
export function draftForEngine(
  catalog: ControlCenterModelsState["catalog"],
  draft: ControlCenterRouteDraft,
  engine: string,
  effortRequired: boolean,
): ControlCenterRouteDraft {
  const models = catalog[engine]?.models ?? [];
  const model = models.includes(draft.model) ? draft.model : (models[0] ?? "");
  return draftForModel(catalog, { ...draft, engine }, model, effortRequired);
}

export function draftForModel(
  catalog: ControlCenterModelsState["catalog"],
  draft: ControlCenterRouteDraft,
  model: string,
  effortRequired: boolean,
): ControlCenterRouteDraft {
  const allowed = catalog[draft.engine]?.model_efforts[model] ?? [];
  const effort = allowed.includes(draft.effort)
    ? draft.effort
    : effortRequired
      ? (allowed[0] ?? "")
      : "";
  return { engine: draft.engine, model, effort };
}

export function choiceLabel(choices: ReadonlyArray<ControlCenterChoice>, value: string): string {
  return choices.find((choice) => choice.value === value)?.label ?? value;
}

const PROVENANCE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** "Repo default" or "Live override · 18 Aug 2026, 14:20 UTC". */
export function routeProvenanceLabel(route: ControlCenterRoute): string {
  if (route.source !== "override") return "Repo default";
  const stamp = Date.parse(route.updated_at);
  if (Number.isNaN(stamp)) return "Live override";
  return `Live override · ${PROVENANCE_TIME_FORMAT.format(stamp)} UTC`;
}

export function overrideCount(state: ControlCenterModelsState): number {
  return state.consumers.filter((route) => route.source === "override").length;
}

export class ControlCenterModelsError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ControlCenterModelsError";
    this.status = status;
  }
}

export async function controlCenterRequest<T = ControlCenterModelsState>(
  init: RequestInit,
  path: string = CONTROL_CENTER_MODELS_PATH,
): Promise<T> {
  const bearerToken = await readDesktopPrimaryBearerToken();
  const headers = new Headers(init.headers);
  if (bearerToken) headers.set("authorization", `Bearer ${bearerToken}`);
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl(path), {
    ...init,
    headers,
    credentials: bearerToken ? "omit" : "include",
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const record = payload as { readonly ok?: unknown; readonly error?: unknown } | null;
  if (!response.ok || !record || record.ok !== true) {
    const message =
      typeof record?.error === "string" && record.error.length > 0
        ? record.error
        : response.status === 401 || response.status === 403
          ? "This session is not allowed to change Control Center settings."
          : `The Control Center gateway request failed (HTTP ${response.status}).`;
    throw new ControlCenterModelsError(message, response.status);
  }
  return record as unknown as T;
}

export function fetchControlCenterModels(): Promise<ControlCenterModelsState> {
  return controlCenterRequest({ method: "GET" });
}

export function saveControlCenterRoute(
  consumer: string,
  draft: ControlCenterRouteDraft,
): Promise<ControlCenterModelsState> {
  return controlCenterRequest({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consumer, ...draft }),
  });
}

export function resetControlCenterRoute(consumer: string): Promise<ControlCenterModelsState> {
  return controlCenterRequest({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consumer, reset: true }),
  });
}
