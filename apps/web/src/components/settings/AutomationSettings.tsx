import {
  CircleAlertIcon,
  ExternalLinkIcon,
  EllipsisIcon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  automationTime,
  editAutomation,
  fetchAutomations,
  lastRunSummary,
  scheduleLabel,
  shortRunTime,
  type AutomationJob,
  type AutomationSchedule,
  type AutomationsState,
} from "./automationSettings";
import { SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * One line per automation: what it is and when it runs, what model it uses,
 * how the last run went, and a pause switch. Everything that used to need
 * expanding a row is visible or one tap away. Mobile stacks the same cells.
 */
export const RUN_LINE_GRID =
  "flex flex-col gap-2 md:grid md:items-center md:gap-x-3 md:[grid-template-areas:'name_model_status_ctrl'] md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.9fr)_4.5rem]";
/** Phone: two lines (name + switch, then model + last run); desktop: one grid row. */
const RUN_LINE_GROUP = "flex min-w-0 items-center justify-between gap-3 md:contents";

const TONE_CLASS = {
  failed: "text-destructive",
  running: "text-foreground",
  ok: "text-muted-foreground",
  idle: "text-muted-foreground/70",
} as const;

function ScheduleEditor({
  job,
  busy,
  onSave,
}: {
  job: AutomationJob;
  busy: boolean;
  onSave: (form: AutomationSchedule) => void;
}) {
  const [draft, setDraft] = useState(job.form);
  useEffect(() => {
    setDraft(job.form);
  }, [job.form]);
  if (!draft) return null;
  const interval = draft.cadence === "interval";
  const weekly = job.schedule_mode === "weekly";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={interval ? String(draft.minutes) : draft.cadence}
        disabled={busy || weekly}
        onValueChange={(value) => {
          if (typeof value === "string")
            setDraft(
              interval ? { ...draft, minutes: Number(value) } : { ...draft, cadence: value },
            );
        }}
      >
        <SelectTrigger size="sm" aria-label={`${job.label} frequency`} className="w-36">
          <SelectValue>
            {interval
              ? `Every ${draft.minutes} min`
              : weekly
                ? `Weekly · ${draft.day}`
                : draft.cadence === "weekdays"
                  ? "Weekdays"
                  : "Daily"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {interval ? (
            [15, 30, 60].map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                Every {minutes} min
              </SelectItem>
            ))
          ) : weekly ? (
            <SelectItem value="weekly">Weekly · {draft.day}</SelectItem>
          ) : (
            ["weekdays", "daily"].map((cadence) => (
              <SelectItem key={cadence} value={cadence}>
                {cadence === "weekdays" ? "Weekdays" : "Daily"}
              </SelectItem>
            ))
          )}
        </SelectPopup>
      </Select>
      {!interval ? (
        <Input
          type="time"
          value={draft.time ?? ""}
          aria-label={`${job.label} time`}
          disabled={busy}
          className="h-8 w-32"
          onChange={(event) => setDraft({ ...draft, time: event.target.value })}
        />
      ) : null}
      <Button
        size="sm"
        disabled={busy || JSON.stringify(draft) === JSON.stringify(job.form)}
        onClick={() => onSave(draft)}
      >
        Save schedule
      </Button>
    </div>
  );
}

/** Schedule text that opens its editor in place when the job is editable. */
function ScheduleControl({
  job,
  busy,
  onSave,
}: {
  job: AutomationJob;
  busy: boolean;
  onSave: (form: AutomationSchedule) => void;
}) {
  const label = scheduleLabel(job);
  if (!(job.managed && job.installed && job.form)) return <span>{label}</span>;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Edit ${job.label} schedule: ${label}`}
        className="cursor-pointer rounded-sm underline decoration-muted-foreground/40 decoration-dotted underline-offset-[3px] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-auto">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{job.label} runs · Europe/London</p>
          <ScheduleEditor job={job} busy={busy} onSave={onSave} />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function LastRun({ job }: { job: AutomationJob }) {
  const { text, tone } = lastRunSummary(job);
  const content = (
    <>
      {tone === "running" ? <Spinner className="size-3" /> : null}
      {tone === "failed" ? <CircleAlertIcon aria-hidden className="size-3.5" /> : null}
      <span className="truncate">{text}</span>
      {job.output ? <ExternalLinkIcon aria-hidden className="size-3 shrink-0 opacity-60" /> : null}
    </>
  );
  const className = cn("inline-flex min-w-0 items-center gap-1.5 text-xs", TONE_CLASS[tone]);
  return job.output ? (
    <a
      href={job.output.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`${text} — open ${job.output.label.toLowerCase()} from ${automationTime(job.output.created_at)}`}
      className={cn(className, "rounded-sm hover:text-foreground hover:underline")}
    >
      {content}
    </a>
  ) : (
    <span className={className}>{content}</span>
  );
}

function JobDetails({ job, jobs }: { job: AutomationJob; jobs: ReadonlyArray<AutomationJob> }) {
  return (
    <div className="mt-2.5 space-y-2 rounded-lg bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
      <p>{job.description}</p>
      {job.after.map((id) => {
        const prerequisite = jobs.find((candidate) => candidate.id === id);
        return (
          <p key={id}>
            Runs after{" "}
            <strong className="font-medium text-foreground">{prerequisite?.label ?? id}</strong>
            {job.kind === "daybrief"
              ? " and reviews its report, including failures."
              : " and uses the latest collected data."}
          </p>
        );
      })}
      {job.after.length > 0 && !job.ordering_installed ? (
        <p className="text-destructive">
          Dependency ordering needs installation before this job can be started here.
        </p>
      ) : null}
      <div className="grid gap-1 sm:grid-cols-3">
        <p>Last start: {automationTime(job.last_start)}</p>
        <p>
          {job.kind ? "Launcher finished" : "Last finish"}: {automationTime(job.last_finish)}
        </p>
        <p>Next: {job.active ? automationTime(job.next_run) : "Paused"}</p>
      </div>
      {job.status === "failed" && job.result ? (
        <p className="text-destructive">Result: {job.result}</p>
      ) : null}
      {job.kind ? (
        <p>
          One thread per {job.kind === "invoices" ? "week" : "day"}. “Thread” confirms the launch;
          open the thread to see the agent’s result.
        </p>
      ) : null}
      {job.output_error ? (
        <p className="text-destructive">The latest report or thread could not be read.</p>
      ) : null}
    </div>
  );
}

function JobRow({
  job,
  jobs,
  busy,
  model,
  onAction,
}: {
  job: AutomationJob;
  jobs: ReadonlyArray<AutomationJob>;
  busy: boolean;
  model: ReactNode;
  onAction: (job: AutomationJob, action: string, schedule?: AutomationSchedule) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const editable = job.managed && job.installed;
  const on = job.active || job.enabled;
  const canRun = editable && !job.current_thread;
  const next = !job.installed ? "" : on ? `next ${shortRunTime(job.next_run)}` : "paused";
  return (
    <div className="px-3 py-2.5 sm:px-4" data-slot="automation-row">
      <div className={RUN_LINE_GRID}>
        <div className={RUN_LINE_GROUP}>
          <div className="min-w-0 [grid-area:name]">
            <button
              type="button"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((value) => !value)}
              className={cn(
                "block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                !on && editable && "text-muted-foreground",
              )}
            >
              {job.label}
            </button>
            <p className="truncate text-xs text-muted-foreground">
              <ScheduleControl
                job={job}
                busy={busy}
                onSave={(form) => onAction(job, "schedule", form)}
              />
              {next ? <span> · {next}</span> : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1.5 [grid-area:ctrl]">
            {editable ? (
              <Switch
                size="sm"
                checked={on}
                disabled={busy}
                aria-label={`${job.label} ${on ? "on — pause future runs" : "paused — resume"}`}
                onCheckedChange={(checked) => onAction(job, checked ? "resume" : "pause")}
              />
            ) : null}
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`${job.label} actions`}
                  />
                }
              >
                <EllipsisIcon className="size-4" />
              </MenuTrigger>
              <MenuPopup align="end">
                {canRun ? (
                  <MenuItem
                    disabled={busy || job.status === "running" || !job.ordering_installed}
                    onClick={() => onAction(job, "run")}
                  >
                    <PlayIcon className="size-4" />
                    {job.kind ? "Start brief now" : "Run now"}
                  </MenuItem>
                ) : null}
                {job.output ? (
                  <MenuItem onClick={() => window.open(job.output?.url, "_blank", "noreferrer")}>
                    <ExternalLinkIcon className="size-4" />
                    Open {job.output.label.toLowerCase()}
                  </MenuItem>
                ) : null}
                {canRun || job.output ? <MenuSeparator /> : null}
                <MenuItem onClick={() => setShowDetails((value) => !value)}>
                  {showDetails ? "Hide details" : "Show details"}
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>
        <div className={RUN_LINE_GROUP}>
          <div className="min-w-0 shrink-0 [grid-area:model] md:shrink">{model}</div>
          <div className="min-w-0 [grid-area:status]">
            <LastRun job={job} />
          </div>
        </div>
      </div>
      {showDetails ? <JobDetails job={job} jobs={jobs} /> : null}
    </div>
  );
}

function FailureBanner({
  jobs,
  busy,
  onRun,
}: {
  jobs: ReadonlyArray<AutomationJob>;
  busy: boolean;
  onRun: (job: AutomationJob) => void;
}) {
  if (jobs.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {jobs.map((job) => (
        <div
          key={job.id}
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm sm:px-4"
        >
          <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 basis-40">
            <span className="font-medium">{job.label} failed</span>
            <span className="text-muted-foreground">
              {" "}
              · {shortRunTime(job.last_finish ?? job.last_start)}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {job.output ? (
              <a
                href={job.output.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Open {job.output.label.toLowerCase()}
              </a>
            ) : null}
            {job.managed && job.installed && !job.current_thread ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy || !job.ordering_installed}
                onClick={() => onRun(job)}
              >
                Run again
              </Button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AutomationSettings({
  renderModel,
  helperRows,
  onConsumersChange,
  onRefreshModels,
}: {
  renderModel: (consumer: string) => ReactNode;
  helperRows: ReactNode;
  onConsumersChange: (consumers: string[]) => void;
  onRefreshModels: () => void;
}) {
  const [state, setState] = useState<AutomationsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const result = await fetchAutomations();
      if (request !== generation.current) return;
      setState(result);
      setError(null);
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : "Could not read automation status.");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    onConsumersChange(state?.jobs.flatMap((job) => (job.consumer ? [job.consumer] : [])) ?? []);
  }, [state, onConsumersChange]);
  // Refresh is explicit: a background poll must not erase a schedule being edited.
  const apply = async (job: AutomationJob, action: string, schedule?: AutomationSchedule) => {
    setBusy(true);
    generation.current += 1;
    try {
      const result = await editAutomation(job.id, action, schedule);
      setState(result);
      setError(null);
      const titles: Record<string, string> = {
        run: `${job.label} started`,
        pause: `${job.label} paused`,
        resume: `${job.label} resumed`,
        schedule: `${job.label} schedule saved`,
      };
      toastManager.add({
        type: "success",
        title: titles[action] ?? `${job.label} updated`,
        description:
          action === "pause"
            ? "Future runs are off. A run already in progress will finish."
            : undefined,
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not update automation",
        description: cause instanceof Error ? cause.message : "Refresh and try again.",
      });
    } finally {
      setBusy(false);
    }
  };
  const onAction = (job: AutomationJob, action: string, schedule?: AutomationSchedule) =>
    void apply(job, action, schedule);

  const managed = state?.jobs.filter((job) => job.managed) ?? [];
  const others = state?.jobs.filter((job) => !job.managed) ?? [];
  const failed = managed.filter((job) => job.status === "failed");
  const paused = managed.filter((job) => job.installed && !(job.active || job.enabled));
  const summary = state
    ? [
        `${managed.length} automations`,
        failed.length ? `${failed.length} failed` : "none failed",
        paused.length ? `${paused.length} paused` : "",
        `checked ${shortRunTime(state.checked_at)}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="space-y-2.5">
      <SettingsSection
        {...searchableSetting("automations")}
        headerAction={
          <div className="flex items-center gap-2">
            {summary ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">{summary}</span>
            ) : null}
            <Button
              size="icon-sm"
              variant="ghost-muted"
              aria-label="Refresh automations and models"
              disabled={busy}
              onClick={() => {
                void refresh();
                onRefreshModels();
              }}
            >
              <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        }
        variant="plain"
      >
        {summary ? <p className="px-3 text-xs text-muted-foreground sm:hidden">{summary}</p> : null}
        {error ? (
          <p role="alert" className="px-3 text-sm text-destructive sm:px-4">
            {error} {state ? "Showing the previous refresh." : ""}
          </p>
        ) : null}
        <FailureBanner jobs={failed} busy={busy} onRun={(job) => onAction(job, "run")} />
        <div className="rounded-xl border border-border/60 bg-card/40 shadow-xs/5 [&>*+*]:border-t [&>*+*]:border-border/50">
          <div
            aria-hidden
            className={cn(
              RUN_LINE_GRID,
              "hidden px-3 py-2 text-[11px] tracking-wide text-muted-foreground/70 uppercase sm:px-4 md:grid",
            )}
          >
            <span className="[grid-area:name]">Automation · schedule</span>
            <span className="[grid-area:model]">Model · effort</span>
            <span className="[grid-area:status]">Last run</span>
            <span className="justify-self-end [grid-area:ctrl]">On</span>
          </div>
          {!state && !error ? (
            <p className="px-3 py-4 text-sm text-muted-foreground sm:px-4">Loading automations…</p>
          ) : null}
          {managed.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              jobs={state?.jobs ?? []}
              busy={busy}
              model={
                job.consumer ? (
                  renderModel(job.consumer)
                ) : (
                  <span className="text-xs text-muted-foreground/60">No AI model</span>
                )
              }
              onAction={onAction}
            />
          ))}
          {helperRows}
        </div>
        {others.length > 0 ? (
          <details className="group px-3 pt-1 text-sm sm:px-4">
            <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
              <span className="inline-block transition-transform group-open:rotate-90">›</span>{" "}
              Other host automations · {others.length}
              {others.some((job) => job.status === "failed") ? (
                <span className="text-destructive">
                  {" "}
                  · {others.filter((job) => job.status === "failed").length} failed
                </span>
              ) : null}
            </summary>
            <div className="mt-2 -mx-3 rounded-xl border border-border/60 bg-card/40 sm:-mx-4 [&>*+*]:border-t [&>*+*]:border-border/50">
              {others.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  jobs={state?.jobs ?? []}
                  busy={busy}
                  model={null}
                  onAction={onAction}
                />
              ))}
            </div>
          </details>
        ) : null}
      </SettingsSection>
    </div>
  );
}
