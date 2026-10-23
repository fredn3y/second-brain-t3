import { describe, expect, it } from "vite-plus/test";
import {
  automationTime,
  lastRunSummary,
  scheduleLabel,
  shortRunTime,
  type AutomationJob,
} from "./automationSettings";

describe("automation display", () => {
  it("shows London time across daylight-saving boundaries", () => {
    expect(automationTime("2026-09-14T06:00:00Z")).toContain("07:00");
    expect(automationTime("2026-12-14T07:00:00Z")).toContain("07:00");
    expect(automationTime(null)).toBe("—");
  });
  it("keeps the exact schedule visible for an unsupported cadence", () => {
    expect(scheduleLabel({ form: null, schedule: ["monthly calendar"] } as AutomationJob)).toBe(
      "monthly calendar",
    );
  });
  it("shortens run times to the clock today and weekday otherwise", () => {
    const now = new Date("2026-09-24T14:00:00Z");
    expect(shortRunTime("2026-09-24T06:00:00Z", now)).toBe("07:00");
    expect(shortRunTime("2026-09-25T06:00:00Z", now)).toBe("Fri 07:00");
    expect(shortRunTime(null, now)).toBe("—");
  });
  it("summarises the last run with a tone for failures", () => {
    const now = new Date("2026-09-24T14:00:00Z");
    const job = {
      installed: true,
      status: "failed",
      last_start: "2026-09-24T06:00:00Z",
      last_finish: "2026-09-24T06:01:00Z",
    } as AutomationJob;
    expect(lastRunSummary(job, now)).toEqual({ text: "Failed · 07:01", tone: "failed" });
    expect(lastRunSummary({ ...job, installed: false }, now).text).toBe("Not installed");
    expect(lastRunSummary({ ...job, status: "never" }, now).tone).toBe("idle");
  });
});
