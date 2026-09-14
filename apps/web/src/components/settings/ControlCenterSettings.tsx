import { BrainIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { APP_VERSION } from "../../branding";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import {
  choiceLabel,
  draftForEngine,
  draftForModel,
  effortChoices,
  engineChoices,
  fetchControlCenterModels,
  modelChoices,
  overrideCount,
  resetControlCenterRoute,
  routeDraftEquals,
  routeDraftFromLive,
  routeProvenanceLabel,
  saveControlCenterRoute,
  type ControlCenterChoice,
  type ControlCenterModelsState,
  type ControlCenterRoute,
  type ControlCenterRouteDraft,
} from "./controlCenterModels";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { AutomationSettings } from "./AutomationSettings";

const UPSTREAM_REPOSITORY_URL = "https://github.com/pingdotgg/t3code";
const SKELETON_ROWS = ["daybrief", "mail", "sweep"] as const;

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly state: ControlCenterModelsState };

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "The Control Center gateway could not be reached.";
}

function RouteChoiceSelect({
  label,
  value,
  choices,
  disabled,
  onValueChange,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly choices: ReadonlyArray<ControlCenterChoice>;
  readonly disabled: boolean;
  readonly onValueChange: (value: string) => void;
  readonly className?: string;
}) {
  return (
    <Select
      value={value}
      disabled={disabled || choices.length === 0}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn("w-full min-w-0 sm:w-auto", className)}
      >
        <SelectValue>{choiceLabel(choices, value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {choices.map((choice) => (
          <SelectItem hideIndicator key={choice.value || "automatic"} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function ModelRouteRow({
  route,
  catalog,
  busy,
  onSave,
  onReset,
}: {
  readonly route: ControlCenterRoute;
  readonly catalog: ControlCenterModelsState["catalog"];
  readonly busy: boolean;
  readonly onSave: (consumer: string, draft: ControlCenterRouteDraft) => Promise<void>;
  readonly onReset: (consumer: string) => Promise<void>;
}) {
  const live = useMemo(() => routeDraftFromLive(route), [route]);
  const [draft, setDraft] = useState<ControlCenterRouteDraft>(live);
  // A fresh gateway snapshot (save, reset, refresh) wins over an unsaved edit:
  // the row always shows what the automation will actually run next.
  useEffect(() => {
    setDraft(live);
  }, [live]);

  const engines = useMemo(() => engineChoices(catalog, route), [catalog, route]);
  const models = useMemo(() => modelChoices(catalog, draft.engine), [catalog, draft.engine]);
  const efforts = useMemo(
    () => effortChoices(catalog, draft, route.effort_required),
    [catalog, draft, route.effort_required],
  );
  const dirty = !routeDraftEquals(draft, live);
  const isOverride = route.source === "override";

  return (
    <SettingsRow
      id={`control-center-route-${route.consumer}`}
      title={route.label}
      description={route.description}
      status={
        <span className={cn(isOverride && "text-foreground/80")}>
          {routeProvenanceLabel(route)}
        </span>
      }
      resetAction={
        isOverride ? (
          <SettingResetButton
            label={`${route.label} model routing`}
            disabled={busy}
            onClick={() => void onReset(route.consumer)}
          />
        ) : null
      }
      control={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
          {engines.length > 1 ? (
            <RouteChoiceSelect
              label={`${route.label} engine`}
              value={draft.engine}
              choices={engines}
              disabled={busy}
              className="sm:w-32"
              onValueChange={(engine) =>
                setDraft((current) =>
                  draftForEngine(catalog, current, engine, route.effort_required),
                )
              }
            />
          ) : null}
          <RouteChoiceSelect
            label={`${route.label} model`}
            value={draft.model}
            choices={models}
            disabled={busy}
            className="sm:w-40"
            onValueChange={(model) =>
              setDraft((current) => draftForModel(catalog, current, model, route.effort_required))
            }
          />
          <RouteChoiceSelect
            label={`${route.label} effort`}
            value={draft.effort}
            choices={efforts}
            disabled={busy}
            className="sm:w-28"
            onValueChange={(effort) => setDraft((current) => ({ ...current, effort }))}
          />
          <Button
            size="sm"
            variant={dirty ? "default" : "outline"}
            className="h-8 w-full px-3 text-xs sm:h-7 sm:w-auto"
            disabled={busy || !dirty}
            onClick={() => void onSave(route.consumer, draft)}
          >
            Save
          </Button>
        </div>
      }
    />
  );
}

function ModelRoutingSkeleton() {
  return (
    <>
      {SKELETON_ROWS.map((key) => (
        <div key={key} className="rounded-xl px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
            <div className="space-y-2">
              <Skeleton className="h-4 w-28 rounded-full" />
              <Skeleton className="h-3 w-full max-w-sm rounded-full" />
              <Skeleton className="h-3 w-20 rounded-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-7 w-32 rounded-lg" />
              <Skeleton className="h-7 w-40 rounded-lg" />
              <Skeleton className="h-7 w-28 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export function ControlCenterSettingsPanel() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [automationConsumers, setAutomationConsumers] = useState<string[]>([]);
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoad((current) => (current.status === "ready" ? current : { status: "loading" }));
    try {
      const state = await fetchControlCenterModels();
      if (generation !== requestGeneration.current) return;
      setLoad({ status: "ready", state });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setLoad({ status: "error", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyChange = useCallback(
    async (
      consumer: string,
      action: () => Promise<ControlCenterModelsState>,
      successTitle: (route: ControlCenterRoute | undefined) => string,
    ) => {
      setBusy(true);
      try {
        const state = await action();
        requestGeneration.current += 1;
        setLoad({ status: "ready", state });
        const changed = state.consumers.find((route) => route.consumer === consumer);
        toastManager.add({
          type: "success",
          title: successTitle(changed),
          description: "Applies on that automation's next run. No restart needed.",
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not update model routing",
          description: errorMessage(error),
        });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleSave = useCallback(
    (consumer: string, draft: ControlCenterRouteDraft) =>
      applyChange(
        consumer,
        () => saveControlCenterRoute(consumer, draft),
        (route) => `${route?.label ?? consumer} route saved`,
      ),
    [applyChange],
  );
  const handleReset = useCallback(
    (consumer: string) =>
      applyChange(
        consumer,
        () => resetControlCenterRoute(consumer),
        (route) => `${route?.label ?? consumer} back to its repo default`,
      ),
    [applyChange],
  );

  const summary =
    load.status === "ready"
      ? `${load.state.consumers.length} routes · ${overrideCount(load.state)} override${overrideCount(load.state) === 1 ? "" : "s"}`
      : null;

  return (
    <SettingsPageContainer>
      <AutomationSettings
        onConsumersChange={setAutomationConsumers}
        renderModel={(consumer) => {
          if (load.status !== "ready")
            return <p>Model routing is {load.status === "error" ? "unavailable" : "loading"}.</p>;
          const route = load.state.consumers.find((candidate) => candidate.consumer === consumer);
          return route ? (
            <ModelRouteRow
              route={route}
              catalog={load.state.catalog}
              busy={busy}
              onSave={handleSave}
              onReset={handleReset}
            />
          ) : null;
        }}
      />
      <SettingsSection
        {...searchableSetting("model-routing")}
        headerAction={
          <div className="flex items-center gap-2">
            {summary ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">{summary}</span>
            ) : null}
            <Button
              size="icon-sm"
              variant="ghost-muted"
              aria-label="Refresh model routing"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCwIcon
                className={cn("size-3.5", load.status === "loading" && "animate-spin")}
              />
            </Button>
          </div>
        }
      >
        <p className="px-3 pb-1 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
          Shared helpers. Scheduled jobs have their model controls above. Every route keeps a repo
          default; saving sets a live override and the undo arrow removes it.
        </p>
        {load.status === "loading" ? <ModelRoutingSkeleton /> : null}
        {load.status === "error" ? (
          <Empty className="min-h-72">
            <EmptyMedia variant="icon">
              <BrainIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Model routing is unavailable</EmptyTitle>
              <EmptyDescription>{load.message}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={() => void refresh()}
              >
                <RefreshCwIcon className="size-3.5" />
                Retry
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
        {load.status === "ready"
          ? load.state.consumers
              .filter((route) => !automationConsumers.includes(route.consumer))
              .map((route) => (
                <ModelRouteRow
                  key={route.consumer}
                  route={route}
                  catalog={load.state.catalog}
                  busy={busy}
                  onSave={handleSave}
                  onReset={handleReset}
                />
              ))
          : null}
      </SettingsSection>

      <SettingsSection {...searchableSetting("about-second-brain")}>
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
