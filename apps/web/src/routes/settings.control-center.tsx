import { createFileRoute } from "@tanstack/react-router";

import { ControlCenterSettingsPanel } from "../components/settings/ControlCenterSettings";

export const Route = createFileRoute("/settings/control-center")({
  component: ControlCenterSettingsPanel,
});
