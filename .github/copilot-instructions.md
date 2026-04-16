# Copilot Instructions

Use `AGENTS.md` as the primary repository context before proposing or applying changes.

## Repository summary

- Customized OpenWrt v24.10.4 fork.
- Main current focus:
  - `package/luci-app-setup`
  - `package/al-emprator-tools`

## What to preserve

- Keep changes minimal and localized.
- Preserve default OpenWrt behavior unless the task explicitly requires otherwise.
- Respect OpenWrt package structure, UCI conventions, and LuCI conventions.
- Keep LuCI UI changes compatible with LuCI form APIs.
- Keep shell changes compatible with BusyBox/OpenWrt environments.

## Package-specific guidance

### `luci-app-setup`

- Quick Setup LuCI app for LAN, system, wireless, and DHCP settings.
- Depends on `al-emprator-tools`.
- Review its Makefile, `setup.js`, init script, `setup` UCI config, ACL, menu, and ucitrack files before changing behavior.

### `al-emprator-tools`

- Collection of shell utilities for router management tasks.
- Includes EEPROM, MAC, LED, mesh, and settings-application helpers.
- Frequently interacts with `uci`, `ubus`, `wifi`, and sometimes `/dev/mtdblock*`.

## Files to read first

- `package/luci-app-setup/Makefile`
- `package/luci-app-setup/files/www/luci-static/resources/view/setup/setup.js`
- `package/al-emprator-tools/Makefile`
- `package/al-emprator-tools/files/usr/bin/alemprator_s`
- `package/al-emprator-tools/files/usr/bin/alemprator_c`
- `package/al-emprator-tools/files/usr/bin/alemprator_f`

## Review checklist before edits

- Understand the relationship between `setup.default`, `network`, and `wireless`.
- Determine whether the change affects first boot, every boot, or only the LuCI page.
- If changing LuCI behavior, review ACL, menu, and ucitrack impact.
- Do not remove init or `uci-defaults` logic without a clear reason.

## Validation guidance

- Use existing repository commands only.
- Do not add new build, lint, or test tooling just for the task.
