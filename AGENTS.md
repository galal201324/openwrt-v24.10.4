# Repository Context for AI Tools

This repository is a customized fork of OpenWrt v24.10.4. Keep changes small, targeted, and compatible with normal OpenWrt behavior.

## Main focus areas

- `package/luci-app-setup`
- `package/al-emprator-tools`

## Package roles

### `luci-app-setup`

- LuCI quick-setup interface for common router configuration.
- Depends on `al-emprator-tools`.
- Important files:
  - `package/luci-app-setup/Makefile`
  - `package/luci-app-setup/files/etc/config/setup`
  - `package/luci-app-setup/files/etc/init.d/setup`
  - `package/luci-app-setup/files/etc/uci-defaults/40_luci-app-setup`
  - `package/luci-app-setup/files/usr/share/rpcd/acl.d/luci-app-setup.json`
  - `package/luci-app-setup/files/usr/share/luci/menu.d/luci-app-setup.json`
  - `package/luci-app-setup/files/usr/share/ucitrack/luci-app-setup.json`
  - `package/luci-app-setup/files/www/luci-static/resources/view/setup/setup.js`
- Purpose: collect LAN, system, wireless, and DHCP settings in one LuCI page.

### `al-emprator-tools`

- Shell-based router management utilities.
- Main scope includes EEPROM, MAC, LED, mesh, and applying router settings.
- Main executables:
  - `alemprator`
  - `alempratore`
  - `alemprator_c`
  - `alemprator_f`
  - `alemprator_s`
  - `alemprator_l`
  - `alemprator_m`
  - `alemprator_m_l`
- Important files:
  - `package/al-emprator-tools/Makefile`
  - `package/al-emprator-tools/files/usr/bin/alemprator_s`
  - `package/al-emprator-tools/files/usr/bin/alemprator_c`
  - `package/al-emprator-tools/files/usr/bin/alemprator_f`
- Logic commonly depends on `uci`, `ubus`, `wifi`, and sometimes `/dev/mtdblock*`.

## Relationship between the packages

- `luci-app-setup` is the web UI layer.
- `al-emprator-tools` provides helper scripts and router-specific operations used by that setup flow.

## Change boundaries

- Do not rename packages or move paths unless required.
- Do not remove init behavior or `uci-defaults` behavior without a clear reason.
- UI changes must stay compatible with the LuCI form API.
- Shell script changes must remain compatible with the lightweight OpenWrt runtime environment.
- Do not break normal OpenWrt UCI, LuCI, or package layout conventions.

## Read these files first

1. `package/luci-app-setup/Makefile`
2. `package/luci-app-setup/files/www/luci-static/resources/view/setup/setup.js`
3. `package/al-emprator-tools/Makefile`
4. `package/al-emprator-tools/files/usr/bin/alemprator_s`
5. `package/al-emprator-tools/files/usr/bin/alemprator_c`
6. `package/al-emprator-tools/files/usr/bin/alemprator_f`

## Understand before editing

- Understand how `setup.default` feeds into `network` and `wireless`.
- Check whether a change affects first boot, every boot, or only the LuCI page.
- For LuCI changes, review ACL, menu, and ucitrack impact.

## Expected workflow

- This repository uses the OpenWrt build system.
- Packages are defined through `package/.../Makefile`.
- Use existing project commands and tooling only; do not introduce new validation tools unless necessary.

## Context strategy

- Keep this file short, stable, and high-signal.
- If the AI tool supports nested instructions, add local context near `package/luci-app-setup/` and `package/al-emprator-tools/` in the future.
