# Screenshots

These feed the screenshot table in the top-level `README.md`.

Currently committed:

| File | Shot |
|---|---|
| `01-home.png` | The welcome screen — brand, feature cards, sidebar with saved sessions, theme indicator. |
| `02-command-palette.png` | The `⌘K` command palette over the home screen, showing command-history search. |

Nice to add (need a live session to a demo server):

| Suggested file | Shot |
|---|---|
| `03-terminal.png` | A connected session — terminal output, tabs, the live CPU/MEM/LOAD/NET status bar. |
| `04-ai-agent.png` | The AI Agent drawer open (`⌘J`), mid-task — a `tool_use` call running a command and its result. |
| `05-sftp.png` | The right-side SFTP panel + a remote file open in the Monaco editor. |

Tips:
- Use a throwaway demo server and hide any real hostnames / IPs / credentials before committing.
- Window width ~1280 px renders cleanly in the README table.
- Keep each file under ~500 KB (PNG is fine; `pngquant` / `oxipng` help).
- After adding files, update the table in the top-level `README.md` to reference them.
