import { describe, expect, it } from "vite-plus/test";

import {
  draftForEngine,
  draftForModel,
  effortChoices,
  engineChoices,
  modelChoices,
  overrideCount,
  routeChoiceSummary,
  routeDraftEquals,
  routeDraftFromLive,
  routeProvenanceLabel,
  type ControlCenterModelsState,
  type ControlCenterRoute,
} from "./controlCenterModels";

const CATALOG: ControlCenterModelsState["catalog"] = {
  codex: {
    label: "Codex",
    models: ["gpt-5.6-sol", "gpt-5.5"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    model_efforts: {
      "gpt-5.6-sol": ["low", "medium", "high", "xhigh", "max"],
      "gpt-5.5": ["low", "medium", "high", "xhigh"],
    },
    labels: { "gpt-5.6-sol": "GPT-5.6 Sol", "gpt-5.5": "GPT-5.5" },
  },
  claude: {
    label: "Claude Code",
    models: ["opus", "haiku"],
    efforts: ["low", "medium", "high", "max"],
    model_efforts: { opus: ["low", "medium", "high", "max"], haiku: ["low", "medium", "high"] },
    labels: { opus: "Opus 5", haiku: "Haiku 4.5" },
  },
};

const daybrief: ControlCenterRoute = {
  consumer: "daybrief",
  label: "Daybrief",
  description: "Morning ranked-brief T3 thread.",
  engine: "claude",
  engine_label: "Claude Code",
  default_engine: "claude",
  engines_allowed: ["claude", "codex"],
  model: "opus",
  effort: "max",
  source: "default",
  updated_at: "",
  updated_by: "",
  default_model: "opus",
  default_effort: "max",
  effort_required: true,
};

const titles: ControlCenterRoute = {
  ...daybrief,
  consumer: "titles",
  label: "Titles",
  model: "haiku",
  effort: "",
  source: "override",
  updated_at: "2026-08-18T14:20:00Z",
  updated_by: "fred (settings)",
  default_model: "haiku",
  default_effort: "",
  effort_required: false,
};

describe("controlCenterModels", () => {
  it("labels engine and model choices from the catalog", () => {
    expect(engineChoices(CATALOG, daybrief)).toEqual([
      { value: "claude", label: "Claude Code" },
      { value: "codex", label: "Codex" },
    ]);
    expect(modelChoices(CATALOG, "codex")).toEqual([
      { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { value: "gpt-5.5", label: "GPT-5.5" },
    ]);
    expect(modelChoices(CATALOG, "missing")).toEqual([]);
  });

  it("offers Automatic only when the runner may omit the effort flag", () => {
    expect(
      effortChoices(CATALOG, { engine: "claude", model: "haiku" }, true).map((c) => c.value),
    ).toEqual(["low", "medium", "high"]);
    expect(effortChoices(CATALOG, { engine: "claude", model: "haiku" }, false)[0]).toEqual({
      value: "",
      label: "Automatic",
    });
  });

  it("switching engine keeps a shared model/effort or falls back to the first valid pair", () => {
    const live = routeDraftFromLive(daybrief);
    const codex = draftForEngine(CATALOG, live, "codex", true);
    expect(codex).toEqual({ engine: "codex", model: "gpt-5.6-sol", effort: "max" });
    const capped = draftForModel(CATALOG, codex, "gpt-5.5", true);
    expect(capped).toEqual({ engine: "codex", model: "gpt-5.5", effort: "low" });
    const optional = draftForModel(
      CATALOG,
      { engine: "claude", model: "opus", effort: "max" },
      "haiku",
      false,
    );
    expect(optional.effort).toBe("");
  });

  it("detects dirty drafts", () => {
    const live = routeDraftFromLive(daybrief);
    expect(routeDraftEquals(live, { ...live })).toBe(true);
    expect(routeDraftEquals(live, { ...live, effort: "high" })).toBe(false);
  });

  it("describes provenance and counts overrides", () => {
    expect(routeProvenanceLabel(daybrief)).toBe("Repo default");
    expect(routeProvenanceLabel(titles)).toMatch(/^Live override · .*2026.* UTC$/);
    expect(routeProvenanceLabel({ ...titles, updated_at: "garbage" })).toBe("Live override");
    expect(overrideCount({ ok: true, catalog: CATALOG, consumers: [daybrief, titles] })).toBe(1);
  });
  it("summarises a route as model label and readable effort", () => {
    expect(
      routeChoiceSummary(CATALOG, { engine: "codex", model: "gpt-5.6-sol", effort: "xhigh" }),
    ).toBe("GPT-5.6 Sol · Extra high");
    expect(routeChoiceSummary(CATALOG, { engine: "claude", model: "haiku", effort: "" })).toBe(
      "Haiku 4.5 · Auto",
    );
  });
});
