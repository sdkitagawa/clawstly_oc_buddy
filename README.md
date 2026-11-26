# Clawstly

Clawstly is an ASCII mascot for the OpenCode TUI. It sits above the OpenCode wordmark on the
home screen and inside the session sidebar, with a selectable tier line, a movable placement and
a live working directory.

It is a TUI-only plugin: no OpenCode source changes, no patch, no recompile. OpenCode discovers
the folder and hot-reloads it on save.

## Clawstly Buddy ASCII Art Samples

### Idle

```
    ▝▚   ▞▘
    ▐▛███▛█        Clawstly vX.X.X
   ▝▜██████▀       Clawstly · Plan
    ▝▝   ▝▝        X:\Users\…
```

### Busy 1

```
▝   ▝▚   ▞▘
 ▝  ▐▛███▛█        Clawstly vX.X.X
▀  ▝▜██████▀       Clawstly · Plan
    ▝▝   ▝▝        X:\Users\…
     ▐████▌
     ▀▀▀▀▀▀
```

### Busy 2

```
    ▝▚   ▞▘ ▝ 
    ▐▛███▛█    ▀   Clawstly vX.X.X
   ▝▜██████▀ ▝     Clawstly · Plan
    ▝▝   ▝▝        X:\Users\…
     ▐████▌
     ▀▀▀▀▀▀
```

### Error

```
    ▝▚   ▞▘   ▐█
    ▐▛███▛█   ▝▀   Clawstly vX.X.X
   ▝▜██████▀  ▝▀   Clawstly · Plan
    ▝▝   ▝▝        X:\Users\…  
```

## Features

- **Home** - Clawstly sits above the wordmark, horizontally centred on it.
- **Session** - Clawstly lives inside the sidebar, horizontally centred in the panel; the placement is selectable.
- **Tiers** - Pick `Free`, `Pro`, `Max` or `Ultra` from a dialog; the choice is persisted.
- **Live directory** - Shows the active session's real working directory, drive letter included.
- **Working animation** - Two poses alternate while the model thinks or runs tools; a brief error
  pose follows a failure. The art returns to the exact idle drawing when work ends.
- **One colour** - Every glyph uses `#D77757`, with no state-based colour changes.
- **No build step** — OpenCode loads `tui.tsx` directly and hot-reloads on save.

## Requirements

- OpenCode `>= 2.2.7` (the TUI plugin API with slots, keymap layers and `ui.dialog.select`).
- Windows, macOS or Linux. Nothing else to install. OpenCode provides the runtime.

## Install

OpenCode loads every immediate directory under `~/.config/opencode/plugins/` as a plugin, so
installing means cloning this repository into that directory under any folder name.

### Global (all projects)

Windows (PowerShell):

```powershell
git clone https://github.com/sdkitagawa/clawstly "$env:USERPROFILE\.config\opencode\plugins\clawstly"
```

macOS / Linux:

```bash
git clone https://github.com/sdkitagawa/clawstly ~/.config/opencode/plugins/clawstly
```

### Per project

Clone into the project's `.opencode/plugins/` directory instead:

```bash
git clone https://github.com/sdkitagawa/clawstly .opencode/plugins/clawstly
```

### Verify

Start OpenCode and check:

- the home screen shows Clawstly above the wordmark;
- opening a session shows Clawstly at the top of the sidebar, under the session name;
- typing `/` lists `/clawstly` and `/clawstly-placement`.

If the folder does not appear in the slash list, see [Troubleshooting](#troubleshooting).

### Update

```bash
git -C ~/.config/opencode/plugins/clawstly pull
```

OpenCode hot-reloads the plugin when files change; restart it if you want a clean slate.

### Uninstall

Delete the clone:

```bash
rm -rf ~/.config/opencode/plugins/clawstly
```

## Usage

### Tier

The second line reads `Clawstly · <tier>`, where the tier is one of **Free**, **Pro**, **Max**
or **Ultra**. Change it any of three ways:

- type `/clawstly` in the prompt;
- run **Clawstly: set tier** from the command palette (`ctrl+p`);
- click the `Clawstly · …` line on the mascot.

The choice is stored in OpenCode's TUI plugin storage, so it survives hot reloads and restarts.
`options.tier` only seeds the first value; after that the saved choice wins.

### Placement

By default the session copy sits at the top of the sidebar, directly under the session name and
above the Context, Todo and MCP blocks. Three placements are available:

| Placement | Where it sits                                            |
| --------- | -------------------------------------------------------- |
| `Top`     | Under the session name, at the top of the panel body      |
| `Bottom`  | Above the `~` path line, at the foot of the panel         |
| `Hidden`  | Not in the session sidebar at all; the home copy remains  |

Change it any of three ways:

- type `/clawstly-placement` in the prompt;
- run **Clawstly: set placement** from the command palette (`ctrl+p`);
- click the mascot art.

The choice is persisted next to the tier, and `options.placement` only seeds the first value.

`Top` is a slot claim on `sidebar.content`, so it scrolls with the sidebar body. `Bottom` claims
`sidebar.footer`, which is pinned. OpenCode publishes no slot above the session name, so `Top` is
the highest position a plugin can take without patching the host.

### Animation

While a session is thinking or running tools, Clawstly alternates between two working poses every
500 ms: diagonal ticks appear at the left edge in the first pose and at the right edge in the second,
with a small two-row appendage below the body in both. When an execution fails or is interrupted, a
right-side appendage is held for one second. The exact idle art returns on success, after that
one-second hold, or after 2.5 seconds without activity. The colour never changes; the motion is
glyph-only.

The home copy has no session to follow and stays on the idle art. Set `options.animate: false` to
keep the idle art at all times, including the error pose.

### Directory line

The last line follows the active session's `location.directory`, or the launch directory on the
home screen. It shows the literal path with the drive letter and truncates in the middle when it
is too long, so it never wraps.

### Colour

The mascot and all three text lines are always `#D77757`. There are no state-based colours; the
only motion is the glyph-only working animation described above.

### Sidebar visibility

The session copy lives inside the sidebar. If the sidebar is hidden, there is no rectangle to
sit in, so Clawstly hides with it. The sidebar appears automatically above roughly 120 columns,
or when toggled with the sidebar keybind.

## Configuration

Options are read from `ctx.options` and only apply when the plugin is listed explicitly in
`cli.json`:

```json
{
  "plugins": [
    {
      "package": "opencode-clawstly",
      "options": {
        "tier": "Ultra",
        "placement": "top",
        "subtitle": "",
        "version": "0.1.0",
        "enabled": true,
        "animate": true
      }
    }
  ]
}
```

| Option      | Type                                  | Default   | Meaning                                              |
| ----------- | ------------------------------------- | --------- | ---------------------------------------------------- |
| `enabled`   | `boolean`                             | `true`    | `false` disables the plugin without deleting it      |
| `tier`      | `"Free" \| "Pro" \| "Max" \| "Ultra"` | `"Ultra"` | Seeds the tier until the user picks one              |
| `placement` | `"top" \| "bottom" \| "hidden"`       | `"top"`   | Seeds the sidebar placement until the user picks one |
| `subtitle`  | `string`                              | `""`      | Replaces the whole `Clawstly · <tier>` line          |
| `version`   | `string`                              | `"0.1.0"` | Version shown in the `Clawstly v…` line               |
| `animate`   | `boolean`                             | `true`    | `false` keeps the exact idle art at all times       |

## License

MIT. See [LICENSE](LICENSE).
