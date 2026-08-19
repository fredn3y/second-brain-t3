import { describe, expect, it } from "vite-plus/test";
import { automationTime, scheduleLabel, type AutomationJob } from "./automationSettings";

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
});
