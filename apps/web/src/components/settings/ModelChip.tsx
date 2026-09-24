import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  draftForModel,
  effortChoices,
  engineChoices,
  modelChoices,
  routeChoiceSummary,
  routeDraftFromLive,
  type ControlCenterModelsState,
  type ControlCenterRoute,
  type ControlCenterRouteDraft,
} from "./controlCenterModels";

/**
 * Second Brain fork: the model + effort a route runs, shown as one chip and
 * changed in place. Each pick applies immediately (the parent toast offers
 * Undo), so a change is two taps instead of expand → three selects → Save.
 */
export function ModelChip({
  route,
  catalog,
  busy,
  onApply,
  onReset,
}: {
  readonly route: ControlCenterRoute;
  readonly catalog: ControlCenterModelsState["catalog"];
  readonly busy: boolean;
  readonly onApply: (route: ControlCenterRoute, draft: ControlCenterRouteDraft) => Promise<void>;
  readonly onReset: (route: ControlCenterRoute) => Promise<void>;
}) {
  const live = useMemo(() => routeDraftFromLive(route), [route]);
  const [open, setOpen] = useState(false);
  const selectedRef = useRef<HTMLButtonElement>(null);
  // Browsing another engine is local until a model is picked there.
  const [engine, setEngine] = useState(live.engine);
  const engines = engineChoices(catalog, route);
  const models = modelChoices(catalog, engine);
  const onLiveEngine = engine === live.engine;
  const efforts = onLiveEngine ? effortChoices(catalog, live, route.effort_required) : [];
  const isOverride = route.source === "override";
  const summary = routeChoiceSummary(catalog, live);
  const defaultSummary = routeChoiceSummary(catalog, {
    engine: route.default_engine,
    model: route.default_model,
    effort: route.default_effort,
  });

  const pickModel = (model: string) => {
    if (onLiveEngine && model === live.model) return;
    void onApply(route, draftForModel(catalog, { ...live, engine }, model, route.effort_required));
  };
  const pickEffort = (effort: string) => {
    if (effort === live.effort) return;
    setOpen(false);
    void onApply(route, { ...live, effort });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setEngine(live.engine);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            aria-label={`${route.label} model: ${summary}${isOverride ? " (changed from default)" : ""}`}
            className="h-8 max-w-full min-w-0 justify-between gap-1.5 px-2.5 text-xs font-normal sm:h-7"
          />
        }
      >
        {isOverride ? (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        ) : null}
        <span className="truncate">{summary}</span>
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        initialFocus={selectedRef}
        className="w-[min(20rem,calc(100vw-2rem))]"
        viewportClassName="py-3 [--viewport-inline-padding:--spacing(3)]"
      >
        <div className="space-y-2.5 text-sm">
          {engines.length > 1 ? (
            <ToggleGroup
              aria-label={`${route.label} engine`}
              className="w-full"
              value={[engine]}
              onValueChange={(value) => {
                const next = value[0];
                if (typeof next === "string") setEngine(next);
              }}
            >
              {engines.map((choice) => (
                <Toggle key={choice.value} value={choice.value} className="flex-1 text-xs">
                  {choice.label}
                </Toggle>
              ))}
            </ToggleGroup>
          ) : null}

          <div role="radiogroup" aria-label={`${route.label} model`} className="-mx-1 space-y-0.5">
            {models.map((choice) => {
              const selected = onLiveEngine && choice.value === live.model;
              return (
                <button
                  key={choice.value}
                  ref={selected ? selectedRef : undefined}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={busy}
                  onClick={() => pickModel(choice.value)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[13px] outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                    selected && "bg-accent/50 font-medium",
                  )}
                >
                  <span className="truncate">{choice.label}</span>
                  {selected ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
                </button>
              );
            })}
          </div>

          {efforts.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Effort</p>
              <div
                role="radiogroup"
                aria-label={`${route.label} effort`}
                className="flex flex-wrap gap-1"
              >
                {efforts.map((choice) => {
                  const selected = choice.value === live.effort;
                  return (
                    <button
                      key={choice.value || "automatic"}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy}
                      onClick={() => pickEffort(choice.value)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                        selected
                          ? "border-primary/60 bg-primary/15 text-foreground"
                          : "border-border/70 text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : !onLiveEngine ? (
            <p className="text-xs text-muted-foreground">Pick a model to switch engine.</p>
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">Default: {defaultSummary}</span>
            {isOverride ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  void onReset(route);
                }}
              >
                Use default
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
