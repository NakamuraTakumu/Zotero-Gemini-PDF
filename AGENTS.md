# AGENTS.md

## Scope

This file applies to `/home/nakamura/gemini-pdf`.

## Zotero GUI Debugging

Use Xpra HTML5 over the Tailscale IP when debugging the Zotero desktop UI from this remote workspace.

### Preconditions

- `xpra` must be installed on the server.
- `tailscale` must be running on the server.
- Zotero is available at `/home/nakamura/.local/opt/zotero/zotero`.
- This repository uses `npm start`, which runs `zotero-plugin serve`.

### Start Session

Prefer binding Xpra directly to the Tailscale IPv4 address instead of `0.0.0.0`.
Do not write the generated Xpra password into tracked files.

```bash
TAIL_IP=$(tailscale ip -4 | head -n 1)
PASS_FILE=/tmp/xpra-gemini-pdf.password
LOG_FILE=/tmp/xpra-gemini-pdf.log

umask 077
if [ ! -s "$PASS_FILE" ]; then
  openssl rand -base64 18 > "$PASS_FILE"
fi

xpra start :100 \
  --bind-tcp=${TAIL_IP}:14500 \
  --html=on \
  --opengl=no \
  --mdns=no \
  --tcp-auth=file \
  --ws-auth=file \
  --password-file="$PASS_FILE" \
  --start-child="bash -lc 'cd /home/nakamura/gemini-pdf && ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/home/nakamura/.local/opt/zotero/zotero npm start'" \
  --exit-with-children=no \
  --log-file="$LOG_FILE"
```

Open `http://<tailscale-ip>:14500` in a browser from a device that can reach the tailnet. Use username `nakamura` and the password stored in `/tmp/xpra-gemini-pdf.password`.

### Runtime Facts

- Xpra session: `:100`.
- Xpra web port: `14500` on the Tailscale IPv4 address.
- Main log: `/tmp/xpra-gemini-pdf.log`.
- Zotero profile: `/home/nakamura/gemini-pdf/.scaffold/profile`.
- Zotero data dir: `/home/nakamura/gemini-pdf/.scaffold/data`.
- Zotero remote debugger is started by scaffold with `-start-debugger-server`; inspect the current port with `pgrep -af zotero` or `ss -ltnp`.

### UI Test Credentials

The API keys configured in the scaffold profile are test keys. For debugging this repository, Codex may operate the Zotero UI and send test requests to the configured providers without asking the user to re-enter keys.

Do not copy API key values into chat, documentation, logs, commits, or command output summaries. If a key value appears in raw tool output, treat it as secret and summarize only the relevant setting name or provider.

When running real provider/API tests, use only low-cost models such as Gemini Flash, OpenAI mini/nano-class models, or Anthropic Haiku-class models. Do not use pro/high-cost models for manual verification unless the user explicitly authorizes that specific test.

### UI Automation

Use `xdotool` for Zotero UI testing when it is available.

```bash
DISPLAY=:100 xdotool --version
DISPLAY=:100 xdotool search --class Zotero getwindowgeometry %@
```

Do not assume that pixel coordinates in `xpra screenshot` match X11 root coordinates. Xpra window placement and screenshots can be offset from each other, so root-coordinate clicks may hit outside the Zotero window even when the screenshot looks correct.

Prefer window-relative operations against the main Zotero window ID.

```bash
WIN=$(DISPLAY=:100 xdotool search --class Zotero | tail -n 1)
DISPLAY=:100 xdotool windowactivate "$WIN"
DISPLAY=:100 xdotool mousemove --window "$WIN" <x> <y> click 1
```

After each non-trivial UI action, take a screenshot and verify the visible state before continuing.

```bash
xpra screenshot /tmp/zotero-ui-check.png :100
```

If no Xpra HTML client is attached, windows may remain hidden from screenshots even though Zotero is running. Show them before capturing:

```bash
xpra control :100 show-all-windows
xpra screenshot /tmp/zotero-ui-check.png :100
```

When `xdotool` can focus Zotero but visible section switching is unreliable, use Zotero's remote debugger as a UI automation fallback. Inspect the current debugger port from `pgrep -af zotero`, connect to the Firefox Remote Debugging Protocol, get the parent process target, and use the target `consoleActor` with `evaluateJSAsync` to operate real DOM controls such as `#llm-provider-select`, `#chat-input`, and `#send-button`. Treat this as UI automation, not a replacement for provider/API tests, because it still exercises the ChatPane event handlers.

For Zotero sandbox errors from browser-oriented SDKs, check missing globals before adding workarounds. `console`, `performance`, `fetch`, `Blob`, `File`, `FormData`, streams, `crypto`, `AbortController`, and related Web APIs may need to be injected in `addon/bootstrap.js`. Keep SDK `console` logging no-op unless there is a specific debugging need, because forwarding dependency logs can expose request details.

### Clean Restart

`zotero-plugin serve` can leave an orphaned `zotero-bin` process if the wrapper process is killed. When a restart must reload `bootstrap.js` or sandbox globals, verify that the old Zotero process is gone before starting a new child.

```bash
pgrep -af 'zotero|zotero-bin|zotero-plugin|npm start'
```

If stale processes remain, terminate the old Zotero and scaffold processes, then start a fresh child in the existing Xpra session.

```bash
kill <old-zotero-pid> <old-npm-start-pid> <old-zotero-plugin-pid>
xpra control :100 start-child "bash -lc 'cd /home/nakamura/gemini-pdf && ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/home/nakamura/.local/opt/zotero/zotero npm start'"
```

Do not use broad `pkill -f 'zotero|npm start|zotero-plugin'` patterns while Xpra is running. The Xpra parent process command line contains the `--start-child` command, so broad matching can terminate Xpra itself. Prefer `pgrep -af ...`, inspect the PIDs, and kill only the specific stale child processes.

### Log Checking

Use the Xpra log for `npm start`, `zotero-plugin serve`, build/watch output, Zotero startup stderr/stdout, and Xpra client events.

```bash
tail -f /tmp/xpra-gemini-pdf.log
```

To reduce Xpra video encoder noise:

```bash
tail -f /tmp/xpra-gemini-pdf.log | rg -v 'video pipeline|non-video fallback|BGRA|ffmpeg:'
```

If plugin behavior is not visible in that log, add temporary `Zotero.debug(...)` instrumentation in the relevant source file and ask the user to reproduce the UI operation in the Xpra browser session.

### Stop Session

```bash
xpra stop :100
```

If the session is stale, inspect listeners and processes before starting another one:

```bash
ss -ltnp | rg '(14500|38045)'
pgrep -af 'xpra|zotero|zotero-plugin|npm start'
```
