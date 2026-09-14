import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import {
  automationTime,
  editAutomation,
  fetchAutomations,
  scheduleLabel,
  type AutomationJob,
  type AutomationSchedule,
  type AutomationsState,
} from "./automationSettings";
import { SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const statusLabels = {
  running: "Running",
  failed: "Failed",
  never: "No run recorded since restart",
  launched: "Thread launched",
  finished: "Finished",
};

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
          className="h-8 w-28"
          onChange={(event) => setDraft({ ...draft, time: event.target.value })}
        />
      ) : null}
      <Button
        size="sm"
        variant="outline"
        disabled={busy || JSON.stringify(draft) === JSON.stringify(job.form)}
        onClick={() => onSave(draft)}
      >
        Save schedule
      </Button>
    </div>
  );
}

export function AutomationSettings({
  renderModel,
  onConsumersChange,
}: {
  renderModel: (consumer: string) => ReactNode;
  onConsumersChange: (consumers: string[]) => void;
}) {
  const [state, setState] = useState<AutomationsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await fetchAutomations();
      if (request !== generation.current) return;
      setState(result);
      setError(null);
    } catch (cause) {
      if (request === generation.current)
        setError(cause instanceof Error ? cause.message : "Could not read automation status.");
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
      toastManager.add({
        type: "success",
        title: action === "run" ? `${job.label} queued` : `${job.label} updated`,
        description:
          action === "pause"
            ? "Future runs paused. A run already in progress will finish."
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
  const renderJob = (job: AutomationJob) => (
    <details key={job.id} className="group rounded-xl border border-border/50 px-3 py-3 sm:px-4">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <span className="font-medium">{job.label}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{scheduleLabel(job)}</span>
        </span>
        <span className={job.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
          {!job.installed
            ? "Not installed"
            : `${!job.active ? "Paused · " : ""}${statusLabels[job.status]}`}{" "}
          <span aria-hidden="true" className="ml-2 inline-block group-open:rotate-90">
            ›
          </span>
        </span>
      </summary>
      <div className="mt-4 space-y-4 text-xs text-muted-foreground">
        <p>{job.description}</p>
        {job.after.map((id) => {
          const prerequisite = state?.jobs.find((candidate) => candidate.id === id);
          return (
            <p key={id}>
              After{" "}
              <strong className="font-medium text-foreground">{prerequisite?.label ?? id}</strong>
              {prerequisite
                ? ` · ${!prerequisite.active ? "paused · " : ""}${statusLabels[prerequisite.status]}`
                : ""}
              .
              {job.kind === "daybrief"
                ? " Reviews the scan report, including failures."
                : " Uses the latest collected data."}
            </p>
          );
        })}
        {job.after.length > 0 && !job.ordering_installed ? (
          <p className="text-destructive">
            Dependency ordering needs installation before this job can be started here.
          </p>
        ) : null}
        <div className="grid gap-1 sm:grid-cols-2">
          <p>Last start: {automationTime(job.last_start)}</p>
          <p>Next: {job.active ? automationTime(job.next_run) : "Paused"}</p>
          <p>
            {job.kind ? "Launcher finished" : "Last finish"}: {automationTime(job.last_finish)}
          </p>
          {job.status === "failed" ? (
            <p className="text-destructive">Result: {job.result}</p>
          ) : null}
        </div>
        {job.kind ? (
          <p>
            One thread per {job.kind === "invoices" ? "week" : "day"}. “Thread launched” confirms
            the launch; open the thread to check the agent’s result.
          </p>
        ) : null}
        {job.output ? (
          <a
            href={job.output.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block underline underline-offset-2"
          >
            {job.output.label} · {automationTime(job.output.created_at)}
          </a>
        ) : null}
        {job.output_error ? (
          <p className="text-destructive">The latest report or thread could not be read.</p>
        ) : null}
        {job.managed && job.installed ? (
          <>
            <ScheduleEditor
              job={job}
              busy={busy}
              onSave={(form) => void apply(job, "schedule", form)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void apply(job, job.active || job.enabled ? "pause" : "resume")}
              >
                {job.active || job.enabled ? "Pause" : "Resume"}
              </Button>
              {!job.current_thread ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || job.status === "running" || !job.ordering_installed}
                  onClick={() => void apply(job, "run")}
                >
                  {job.kind ? "Start brief" : "Run now"}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
        {job.consumer ? renderModel(job.consumer) : null}
      </div>
    </details>
  );
  return (
    <SettingsSection
      {...searchableSetting("automations")}
      headerAction={
        <Button
          size="icon-sm"
          variant="ghost-muted"
          aria-label="Refresh automations"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      }
    >
      <p className="px-3 text-[13px] text-muted-foreground sm:px-4">
        Recurring work, models and run results. Times are Europe/London. Installed dependencies wait
        for a running prerequisite; failures remain visible for review.
      </p>
      {error ? (
        <p role="alert" className="px-3 text-sm text-destructive">
          {error} {state ? "The status below is from the previous refresh." : ""}
        </p>
      ) : null}
      {!state && !error ? (
        <p className="px-3 text-sm text-muted-foreground">Loading automations…</p>
      ) : null}
      {state ? (
        <>
          <p className="px-3 text-xs text-muted-foreground">
            Checked {automationTime(state.checked_at)} ·{" "}
            {state.jobs.filter((job) => job.status === "failed").length} failed
          </p>
          <div className="space-y-2">{state.jobs.filter((job) => job.managed).map(renderJob)}</div>
          <details className="px-3 py-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Other host automations · {state.jobs.filter((job) => !job.managed).length}
            </summary>
            <div className="mt-3 space-y-2">
              {state.jobs.filter((job) => !job.managed).map(renderJob)}
            </div>
          </details>
        </>
      ) : null}
    </SettingsSection>
  );
}
