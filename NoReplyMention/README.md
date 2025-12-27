# NoReplyMention

A BetterDiscord plugin that automatically disables reply pings, with optional per-user and per-server exceptions.

By default, replying to a message in Discord pings the original author. This plugin removes that behavior unless explicitly allowed.

---

## Features

- Automatically disables reply pings
- Per-user whitelist and blacklist
- Per-server whitelist and blacklist
- Right-click context menu controls for users and servers
- Configurable rule priority (whitelist vs blacklist)
- Optional debug logging

---

## Installation

1. Download `NoReplyMention.plugin.js`
2. Move it to your BetterDiscord plugins folder:
   - **Windows:** `%AppData%\BetterDiscord\plugins`
   - **macOS:** `~/Library/Application Support/BetterDiscord/plugins`
   - **Linux:** `~/.config/BetterDiscord/plugins`
3. Enable **NoReplyMention** in **Settings → BetterDiscord → Plugins**

---

## Usage

Once enabled, reply pings are disabled automatically.

You can manage exceptions by:

- Opening the plugin settings
- Right-clicking a user or server to add/remove whitelist or blacklist rules

Changes apply immediately.

---

## Behavior Summary

| Condition               | Result                       |
| ----------------------- | ---------------------------- |
| Normal reply            | No ping                      |
| Whitelisted user        | Ping allowed                 |
| Blacklisted user/server | No ping                      |
| Conflicting rules       | Resolved by priority setting |

---

## Notes

- Only affects reply pings (manual @mentions are unchanged)
- Designed for current Discord desktop builds
- Enable debug logging only when troubleshooting

---

## Author

FranticPanic
Based off Qb's NoReplyMention plug-in
