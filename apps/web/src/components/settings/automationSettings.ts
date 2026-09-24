import { controlCenterRequest } from "./controlCenterModels";

export interface AutomationSchedule {
  cadence: string;
  time?: string;
  day?: string;
  minutes?: number;
  start?: number;
  end?: number;
  offset?: number;
  weekdays?: boolean;
}

export interface AutomationJob {
  id: string;
  label: string;
  description: string;
  consumer: string | null;
  kind: string | null;
  managed: boolean;
  installed: boolean;
  enabled: boolean;
  active: boolean;
  status: "running" | "failed" | "never" | "launched" | "finished";
  last_start: string | null;
  last_finish: string | null;
  next_run: string | null;
  result: string | null;
  schedule: string[];
  schedule_mode: string | null;
  form: AutomationSchedule | null;
  after: string[];
  ordering_installed: boolean;
  output_error: boolean;
  output: { label: string; url: string; created_at: string } | null;
  current_thread: boolean;
}

export interface AutomationsState {
  ok: true;
  checked_at: string;
  timezone: string;
  jobs: AutomationJob[];
}

export function automationTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function scheduleLabel(job: AutomationJob): string {
  const form = job.form;
  if (!form) return job.schedule.join(" · ");
  if (form.cadence === "interval") {
    return `Every ${form.minutes} min · ${form.weekdays ? "weekdays " : ""}${form.start}:00–${form.end}:59`;
  }
  const day =
    form.cadence === "weekdays" ? "Weekdays" : form.cadence === "weekly" ? form.day : "Daily";
  return `${day} · ${form.time}`;
}

const PATH = "/api/control-center/automations";
export function fetchAutomations(): Promise<AutomationsState> {
  return controlCenterRequest({ method: "GET" }, PATH);
}
export function editAutomation(
  id: string,
  action: string,
  schedule?: AutomationSchedule,
): Promise<AutomationsState> {
  return controlCenterRequest(
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action, ...(schedule ? { schedule } : {}) }),
    },
    PATH,
  );
}

/** Compact London time for a run line: "15:27" today, otherwise "Thu 07:00". */
export function shortRunTime(value: string | null, now: Date = new Date()): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "short" });
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  if (day.format(date) === day.format(now)) return time;
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(date);
  return `${weekday} ${time}`;
}

export type RunTone = "failed" | "running" | "ok" | "idle";

/** Last-run cell: what happened, when, and how loudly to show it. */
export function lastRunSummary(
  job: AutomationJob,
  now: Date = new Date(),
): { readonly text: string; readonly tone: RunTone } {
  if (!job.installed) return { text: "Not installed", tone: "idle" };
  const when = shortRunTime(job.last_finish ?? job.last_start, now);
  switch (job.status) {
    case "failed":
      return { text: `Failed · ${when}`, tone: "failed" };
    case "running":
      return { text: `Running since ${shortRunTime(job.last_start, now)}`, tone: "running" };
    case "launched":
      return { text: `Thread · ${when}`, tone: "ok" };
    case "finished":
      return { text: `Done · ${when}`, tone: "ok" };
    default:
      return { text: "No run yet", tone: "idle" };
  }
}
