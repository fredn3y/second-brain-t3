import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { APP_VERSION } from "../../branding";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { AutomationSettings, RUN_LINE_GRID } from "./AutomationSettings";
import {
  fetchControlCenterModels,
  resetControlCenterRoute,
  routeChoiceSummary,
  routeDraftFromLive,
  saveControlCenterRoute,
  type ControlCenterModelsState,
  type ControlCenterRoute,
  type ControlCenterRouteDraft,
} from "./controlCenterModels";
import { ModelChip } from "./ModelChip";
import { SettingsPageContainer, SettingsSearchTarget, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const UPSTREAM_REPOSITORY_URL = "https://github.com/pingdotgg/t3code";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly state: ControlCenterModelsState };

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "The Control Center gateway could not be reached.";
}

/** A model route with no schedule of its own (e.g. Titles), on the same run line. */
function HelperRow({ route, chip }: { route: ControlCenterRoute; chip: ReactNode }) {
  return (
    <div className="px-3 py-2.5 sm:px-4" data-slot="automation-row">
      <div className={RUN_LINE_GRID}>
        <div className="min-w-0 [grid-area:name]">
          <p className="truncate text-sm font-medium">{route.label}</p>
          <p className="truncate text-xs text-muted-foreground">{route.description}</p>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3 md:contents">
          <div className="min-w-0 [grid-area:model]">{chip}</div>
          <div className="text-xs text-muted-foreground/70 [grid-area:status]">On demand</div>
        </div>
      </div>
    </div>
  );
}

export function ControlCenterSettingsPanel() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [automationConsumers, setAutomationConsumers] = useState<string[]>([]);
  const requestGeneration = useRef(0);

  const refresh = () => {
    const generation = ++requestGeneration.current;
    return fetchControlCenterModels().then(
      (state) => {
        if (generation === requestGeneration.current) setLoad({ status: "ready", state });
      },
      (error: unknown) => {
        if (generation === requestGeneration.current)
          setLoad({ status: "error", message: errorMessage(error) });
      },
    );
  };
  const refreshOnMount = useEffectEvent(() => {
    void refresh();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load the model registry from the Second Brain gateway once on mount; later reloads are explicit.
  useEffect(() => {
    refreshOnMount();
  }, []);
  const reload = () => {
    setLoad((current) => (current.status === "ready" ? current : { status: "loading" }));
    void refresh();
  };

  const run = (
    action: () => Promise<ControlCenterModelsState>,
  ): Promise<ControlCenterModelsState | null> => {
    setBusy(true);
    return action()
      .then(
        (state) => {
          requestGeneration.current += 1;
          setLoad({ status: "ready", state });
          return state;
        },
        (error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not change the model",
            description: errorMessage(error),
          });
          return null;
        },
      )
      .finally(() => setBusy(false));
  };

  // Restores exactly what the route had before: its override, or the repo default.
  const restore = (previous: ControlCenterRoute) =>
    run(() =>
      previous.source === "override"
        ? saveControlCenterRoute(previous.consumer, routeDraftFromLive(previous))
        : resetControlCenterRoute(previous.consumer),
    );

  const announce = (previous: ControlCenterRoute, state: ControlCenterModelsState) => {
    const now = state.consumers.find((route) => route.consumer === previous.consumer);
    if (!now) return;
    const toastId = toastManager.add({
      type: "success",
      title: `${now.label} now uses ${routeChoiceSummary(state.catalog, routeDraftFromLive(now))}`,
      description:
        now.source === "default"
          ? "Back to the repo default. Applies from its next run."
          : "Applies from its next run.",
      timeout: 10_000,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(toastId);
          void restore(previous).then((restored) => {
            if (!restored) return;
            toastManager.add({
              type: "success",
              title: `${previous.label} back to ${routeChoiceSummary(restored.catalog, routeDraftFromLive(previous))}`,
            });
          });
        },
      },
    });
  };

  const handleApply = async (route: ControlCenterRoute, draft: ControlCenterRouteDraft) => {
    const state = await run(() => saveControlCenterRoute(route.consumer, draft));
    if (state) announce(route, state);
  };
  const handleReset = async (route: ControlCenterRoute) => {
    const state = await run(() => resetControlCenterRoute(route.consumer));
    if (state) announce(route, state);
  };

  const chipFor = (route: ControlCenterRoute) =>
    load.status === "ready" ? (
      <ModelChip
        route={route}
        catalog={load.state.catalog}
        busy={busy}
        onApply={handleApply}
        onReset={handleReset}
      />
    ) : null;

  const renderModel = (consumer: string) => {
    // oxlint-disable-next-line shadcn/no-restyle -- Second Brain fork: keeps the shipped Control Center look until a design pass.
    if (load.status === "loading") return <Skeleton className="h-7 w-40 rounded-lg" />;
    if (load.status === "error")
      return <span className="text-xs text-destructive">Model unavailable</span>;
    const route = load.state.consumers.find((candidate) => candidate.consumer === consumer);
    return route ? chipFor(route) : null;
  };

  const helperRows =
    load.status === "ready"
      ? load.state.consumers
          .filter((route) => !automationConsumers.includes(route.consumer))
          .map((route) => <HelperRow key={route.consumer} route={route} chip={chipFor(route)} />)
      : null;

  return (
    <SettingsPageContainer>
      <AutomationSettings
        onConsumersChange={setAutomationConsumers}
        renderModel={renderModel}
        helperRows={helperRows}
        onRefreshModels={reload}
      />
      <SettingsSearchTarget id={searchableSetting("model-routing").id}>
        <p
          className={cn(
            "px-3 text-xs text-muted-foreground/80 sm:px-4",
            load.status === "error" && "text-destructive",
          )}
        >
          {load.status === "error"
            ? `Model routing is unavailable: ${load.message}`
            : "Tap a model to change it; it applies from the next run and can be undone. A dot marks a change from the repo default."}
        </p>
      </SettingsSearchTarget>

      <SettingsSection {...searchableSetting("about-second-brain")}>
        {/* oxlint-disable-next-line shadcn/no-arbitrary-values -- Second Brain fork: keeps the shipped Control Center look until a design pass. */}
        <p className="px-3 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
          Second Brain is a thin fork of{" "}
          <a
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
            href={UPSTREAM_REPOSITORY_URL}
            rel="noreferrer"
            target="_blank"
          >
            T3 Code
          </a>{" "}
          (pingdotgg/t3code) {APP_VERSION}: the chat surface, agents and settings above are upstream
          T3 Code; Control Center automation settings and branding are local.
        </p>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
