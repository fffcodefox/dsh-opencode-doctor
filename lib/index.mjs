/**
 * Runtime entry point for dsh-opencode-doctor.
 *
 * This plugin is config-only by design: everything it does happens in
 * `cordis.patch.yml`, where the pre-probed provider routes are registered on
 * `@deepseek-ai/dsh-llm-pi-ai`. DSH's loader applies that patch at boot, so
 * there is no imperative wiring left to do here.
 *
 * `apply` is exported because the DSH plugin convention — and the community
 * hub's listing requirements — expect every plugin to expose one. It is
 * deliberately empty, and it must stay that way: a plugin with no runtime
 * behaviour cannot destabilise the host, which is the main reason this one is
 * safe to install.
 *
 * Nothing is logged from here on purpose. `apply` runs during boot, and DSH's
 * headless mode treats stdout as the answer channel — writing to it would
 * corrupt the output of whatever the user actually asked for.
 *
 * Re-probe the gateways and rewrite the catalog with:
 *   npx dsh-opencode-doctor probe
 */

export const name = 'dsh-opencode-doctor';

export function apply() {
  // Intentionally empty — see the module comment above.
}
