# WhatsApp Multi

A small desktop app that runs several fully-isolated web messengers in one window — multiple
accounts of the same service included — with native notifications and unread badges.

Built on Electron 43. Linux-first (developed and verified on Ubuntu 26.04 / Wayland / GNOME 50).

![WhatsApp](https://img.shields.io/badge/WhatsApp-25D366?style=flat-square&logo=whatsapp&logoColor=white)
![Discord](https://img.shields.io/badge/Discord-5865F2?style=flat-square&logo=discord&logoColor=white)
![Slack](https://img.shields.io/badge/Slack-4A154B?style=flat-square)
![Messenger](https://img.shields.io/badge/Messenger-0084FF?style=flat-square&logo=messenger&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-2AABEE?style=flat-square&logo=telegram&logoColor=white)
![Google Messages](https://img.shields.io/badge/Google_Messages-1A73E8?style=flat-square&logo=googlemessages&logoColor=white)
![Reddit Chat](https://img.shields.io/badge/Reddit_Chat-FF4500?style=flat-square&logo=reddit&logoColor=white)
![Microsoft Teams](https://img.shields.io/badge/Microsoft_Teams-6264A7?style=flat-square)
![Element](https://img.shields.io/badge/Element-0DBD8B?style=flat-square&logo=element&logoColor=white)
![Custom URL](https://img.shields.io/badge/Custom_URL-8696A0?style=flat-square)

*(Slack and Microsoft Teams show without a logo — both have been withdrawn from the icon set
this uses.)*

> **Status: usable.** Everything in the [feature table](#feature-status) is verified working,
> including voice/video calls, screen share and voice-message recording. Auto-update and tab
> reordering are the notable gaps.
>
> The app is still named for WhatsApp — its config directory, app id and desktop entry all
> use `WhatsAppMulti`. Renaming would orphan existing sessions, so that is left alone
> deliberately.

## Services

Unread counts come from whichever source that service actually exposes:

| Source | Services | Accuracy |
|---|---|---|
| IndexedDB (`model-storage`) | WhatsApp | Exact, and splits direct from muted |
| IndexedDB (matrix-js-sdk) | Reddit Chat, Element | Exact, already post-push-rules |
| `(3)` prefix in the page title | Discord, Slack, Messenger, Telegram, Google Messages, Teams | Whatever the app puts there |
| Title prefix, if present | Custom URLs | Best effort |

Every account is a separate session, so several accounts of the *same* service can be signed
in at once — that was the original point and it generalises unchanged.

Adding a service costs one entry in [`src/shared/services.ts`](src/shared/services.ts): a URL,
the hosts its view may navigate to, and which unread strategy to use. Everything else —
session isolation, the notification shim, priority alerts, the User-Agent strip, permissions,
downloads, spellcheck, the context menu — is service-agnostic already.

**Navigation is pinned** to each service's own domains, plus a small allowlist of identity
providers (Google, Apple, Microsoft, Okta, Auth0). Without those, sign-in flows that bounce
through an IdP would be sent to the system browser and the login would appear to do nothing.
Anything else opens externally.

> Verified that all of the above reach their real sign-in page in this shell, with no
> "unsupported browser" wall. The **title-based unread counts are not verified against
> signed-in accounts** — only WhatsApp's IndexedDB reader has been checked against live data.

---

## Download

Grab a build from the [Releases page](../../releases) — no toolchain needed.

```bash
sudo apt install ./whatsapp-multi_<version>_amd64.deb
```

**Prefer the `.deb`.** Its post-install script configures `chrome-sandbox` and installs an
AppArmor profile, so the Chromium sandbox stays **on**, and it registers the desktop entry and
icons. The AppImage needs no install but runs **unsandboxed** on Ubuntu 24.04+ — see
[Troubleshooting](#troubleshooting) for why. This app renders a third-party site, so that
difference matters.

---

## Why this exists

There is no official WhatsApp desktop client for Linux, and WhatsApp Web itself has no
multi-account support. The existing wrappers either only handle one account, or are built
on Electron APIs that are deprecated or discouraged.

Calls, screen share and voice-message recording all work here. That is worth stating plainly
because it is not a given: voice-message recording is an open crash in Altus
([#333](https://github.com/amanharwara/altus/issues/333), since 2024), and WhatsApp Web only
gained calls in early 2026 — the surveyed wrappers have open, unanswered issues for it. Three
decisions are load-bearing for that:

- `webRTCIPHandlingPolicy` is left at Electron's default. Ferdium ships
  `disable_non_proxied_udp`, which makes WhatsApp calls hang forever at "connecting" behind a
  misleading network error ([ferdium#2399](https://github.com/ferdium/ferdium-app/issues/2399)).
- `media` and `display-capture` are granted in **both** `setPermissionRequestHandler` and
  `setPermissionCheckHandler`. Installing only the first is a common and subtle omission.
- `autoplay-policy=no-user-gesture-required`, or a background account is silent — no
  notification ping and no incoming-call ringtone.

---

## Requirements

- **Node.js 22+** and npm
- **Linux desktop** with a session D-Bus (notifications and the launcher badge use it)
- `gdbus` (ships with glib, almost always present) — used for the launcher badge
- `fonts-noto-color-emoji` — otherwise emoji render as tofu

Each running account consumes one of WhatsApp's **4 linked-device slots for that phone
number**. Multiple accounts mean multiple *different* numbers; pairing the same number
twice costs two of its four slots.

---

## Quick start

```bash
npm install
npm run dev          # dev server with HMR
```

Then press **+** in the tab bar and scan the QR code with your phone.

```bash
npm run build        # typecheck + bundle to out/
npm start            # run the built app
npm run typecheck    # main/preload and renderer, separately
npm test             # unit tests (node:test)
npm run icons        # regenerate build/icons from the generator script
npm run dist         # build .deb + AppImage into dist/
```

Tests bundle the modules under test with esbuild, aliasing `electron` to a stub — they are
TypeScript and import Electron, neither of which `node --test` consumes directly. Coverage is
the logic worth pinning: keyword matching (including whole-word false positives and non-Latin
boundaries), unread counting, download filename safety, and autostart entry handling.

### Getting the app icon to show up

On Wayland a window carries **no icon of its own**. The compositor matches the window's
`app_id` to an installed `.desktop` file and uses that file's `Icon=`. Electron derives
`app_id` from `app.setDesktopName()`, so without a matching entry you get a generic
placeholder in the dock, the switcher *and* on notifications.

Packaged `.deb` builds install one automatically. When running from source:

```bash
npm run desktop:install     # writes to ~/.local/share, no sudo
npm run desktop:uninstall
```

The app reports the result at startup, so a missing entry is never a silent mystery:

```text
[desktop] app_id=com.sheryar.WhatsAppMulti -> ~/.local/share/applications/com.sheryar.WhatsAppMulti.desktop
```

If the app does not start when launched from the desktop, see
[Troubleshooting](#troubleshooting) — that is a different problem from a missing icon.

### Settings

**⚙ Settings** in the tab bar, **File → Settings…** (`Ctrl+,`), or the tray. Four sections:

| | |
|---|---|
| **General** | Start at login |
| **Notifications** | Per-account on/off, and priority alerts (keywords, whole-word matching) |
| **Accounts** | What is configured, which service, current unread |
| **About** | Versions, config directory, resolved desktop entry |

Adding a setting means adding a row to one of those sections. The tray, menu bar and tab
context menus keep their shortcuts, but they are no longer the *only* route to anything.

#### Start at login

Launches with `--hidden`, so at login the app comes up in the tray rather than stealing focus —
accounts still connect and notifications still arrive. If the tray failed to initialise the
window is shown anyway, so the app can never start unreachable.

`app.setLoginItemSettings()` is **not** used: it is an empty function on Linux, so enabling
autostart through it appears to succeed and silently does nothing. An XDG autostart entry is
written to `~/.config/autostart/` instead. Entries disabled by a desktop settings editor
(`Hidden=true` or `X-GNOME-Autostart-enabled=false`) are read back correctly rather than
reported as enabled.

#### Notifications, per account

Turning an account off silences it completely, including priority alerts. Unread badges are
unaffected — silencing an account is not the same as not wanting to know it has messages.

It is enforced *inside the page*, not in main: for an ordinary message the site constructs the
notification itself, so there is nothing to suppress after the fact — it has to not be created.

#### Priority alerts

Messages containing one of your keywords get a notification that **stays on screen until
dismissed**, instead of the normal one that auto-expires. Clicking it opens that chat.

Whole-word matching is on by default, so `urgent` does not fire on `insurgent`. Word boundaries
use Unicode letter/number classes rather than `\b`, which is ASCII-only in JavaScript and would
mis-handle non-Latin text.

The mechanism is worth knowing, because it is not simply "add an option to the notification":

- `urgency` exists only on Electron's **main-process** `Notification`, not the web API. So a
  priority alert cannot be an upgraded version of the site's own notification — the site's has
  to be **suppressed** and ours fired instead, or you would get two per message.
- Suppression has to happen synchronously *inside the page*, before the constructor runs, so
  the keyword list is pushed into the main world and matched there.
- The shim is therefore a `Proxy` with a `construct` trap rather than a subclass: a subclass
  cannot skip its own `super()` call. On a match it returns a stand-in implementing enough of
  `Notification` (`onclick`, `close()`, events) for the site's own code to keep working, and
  main replays the real click into it so the chat still opens.

---

## How it works

One `BrowserWindow` renders the account tab bar; each account is a separate `WebContentsView`
laid out beneath it.

```text
┌─ BrowserWindow ─────────────────────────────────┐
│ [Work] [Personal 3] [Client] [+]   ← tab bar,   │  renderer (React), 40px
├─────────────────────────────────────────────────┤
│                                                 │
│   WebContentsView  session=Accounts/<uuid>      │  inset 40px from the top
│   → web.whatsapp.com                            │
└─────────────────────────────────────────────────┘
```

Tabs show each service's **real favicon** rather than bundled logos, which keeps custom URLs
correct too and avoids shipping other people's trademarks. The bytes are fetched in main
through that account's own session and inlined as a data URL — the shell renderer runs under a
CSP that forbids remote images, and lives in a different session anyway. Until a page
advertises one, the tab falls back to the account's colour dot.

Views paint *above* the DOM, so the tab bar is a reserved region rather than an overlay —
nothing in the renderer can draw on top of an account. `TAB_BAR_HEIGHT` in
[`src/shared/types.ts`](src/shared/types.ts) is the single source of truth; the CSS variable
`--tabbar-height` must match it.

A few choices worth knowing about, because the obvious alternatives are wrong:

- **`WebContentsView`, not `<webview>` or `BrowserView`.** `BrowserView` is formally
  deprecated; `<webview>` carries a standing "we recommend not using this" warning from the
  Electron team. The cost is manual bounds management: there is no `setAutoResize`, and
  laying out on `resize` alone is not enough — a view created before the window settles keeps
  stale bounds, so `show`/`restore`/`maximize`/fullscreen are all wired too.

- **`session.fromPath()`, not `partition: 'persist:<id>'`.** Electron lowercases and
  percent-escapes partition names before they hit disk, so the directory name would not be
  the account id and "delete this account cleanly" becomes guesswork.

- **Accounts are never hibernated.** WhatsApp Web has no Web Push — notifications come from
  the live page's own WebSocket. A hibernated account is a silent account. Hidden-but-alive
  is deliberate, and `backgroundThrottling` is off.

- **Notifications wrap rather than replace.** Measured on Electron 43: the page-context
  `Notification` constructor reaches `org.freedesktop.Notifications` correctly, while
  `ServiceWorkerRegistration.showNotification()` *resolves its promise and sends nothing*
  ([electron#13041](https://github.com/electron/electron/issues/13041)). So the main-world
  shim subclasses the working constructor — adding the account prefix and a click listener —
  and redirects the dead service-worker path into it.

- **Unread counts come from IndexedDB**, not `document.title`. A title regex matches any
  digit, so a group named "2024 Planning" reads as 2024 unread messages. The reader runs in
  the preload's *isolated* world (IndexedDB is keyed by origin, not JS world), so WhatsApp's
  page code cannot observe or break it.

- **The launcher badge emits `com.canonical.Unity.LauncherEntry` over D-Bus directly**,
  rather than `app.setBadgeCount()` — Electron 44 removes Unity support and makes that API
  macOS-only.

---

## Feature status

| | Status |
|---|---|
| Multiple isolated accounts | ✅ Verified — one signed in while another shows a fresh QR |
| Multiple services (Discord, Slack, Messenger, …) | ✅ Verified each loads its real sign-in page |
| Custom URLs | ✅ Pinned to that domain and its subdomains |
| Session persists across restart | ✅ Verified |
| Desktop notifications | ✅ Works (native, via libnotify) |
| Notification click → right account | ✅ Verified per-account, not just focused window |
| Per-account notification prefix | ✅ Applied only when >1 account |
| Unread badges (tab + launcher) | ✅ Verified against real non-zero counts, live |
| Muted vs. direct unread split | ✅ Muted shows a dot, excluded from launcher count |
| Right-click menu (copy/paste/links/images) | ✅ Built by hand — Electron gives embedded content none |
| Spellcheck suggestions | ✅ Built from the context-menu event + `replaceMisspelling()` |
| Download handling | ✅ Auto-saves to `~/Downloads`, never clobbers, toast reveals the file |
| Rename accounts | ✅ Double-click a tab, or right-click → Rename |
| Media, emoji, drag-and-drop upload | ✅ Verified |
| Voice message recording | ✅ Verified — note this crashes the closest prior art ([altus#333](https://github.com/amanharwara/altus/issues/333)) |
| Voice / video calls | ✅ Verified |
| Screen share | ✅ Verified (xdg-desktop-portal picker on Wayland) |
| Tray icon + close-to-tray | ✅ Verified registered with `org.kde.StatusNotifierWatcher` |
| Per-tab menu (rename / reload / remove / notifications) | ✅ Native menu on right-click |
| Service icons on tabs | ✅ Each page's real favicon, fetched via its own session |
| Settings page | ✅ General / Notifications / Accounts / About |
| Notifications on/off per account | ✅ Enforced in the page, so nothing is created |
| Backgrounded accounts report as hidden | ✅ Restored — Electron stops propagating it after first show |
| Packaging (.deb + AppImage) | ✅ Both built and inspected; `.deb` postinst fixes the sandbox |
| Reorder accounts | ❌ Not implemented |
| App / tray / notification icon | ✅ Generated set + desktop entry; startup verifies the chain |
| Start at login | ✅ XDG autostart entry, launches hidden to the tray |
| Priority alerts (keyword → persistent notification) | ✅ Verified: urgency=2 on D-Bus, no duplicate, click opens the chat |
| Auto-update | ❌ Not implemented |

Notification **inline reply** is not possible on this target: GNOME's notification daemon
does not advertise the `inline-reply` capability (it does advertise `actions`, which is why
click routing works).

**Reddit Chat raises no desktop notifications**, and that is Reddit's web app, not this shell —
verified by firing one through the same pipeline on that page and watching it arrive over
D-Bus, with the account genuinely backgrounded. Reddit never calls the Notification API and
holds no push subscription, so there is nothing to intercept. Its unread badge works.

---

## Data layout

```text
~/.config/whatsapp-multi/     # packaged build
~/.config/WhatsAppMulti-dev/  # unpackaged, so dev never touches real accounts
  config.json                 # account list, atomic writes
  Accounts/<uuid>/            # one Chromium session tree per account
```

`config.json` is a **sibling** of `Accounts/`, never a parent, so wiping an account can
never take the config with it.

Three safety properties are enforced and tested:

- A **corrupt `config.json` never prunes session directories.** Otherwise "no accounts in
  config" would mean "delete every account's data". Load distinguishes *missing* (first run,
  safe) from *corrupt* (refuse to act).
- **A second instance exits immediately.** `app.quit()` is asynchronous and does not stop
  the script, so without this a doomed second instance would run through `whenReady`, mint an
  account, create a session directory, and only then die.
- **Config survives `SIGKILL`** — writes are debounced then atomic (tmp + rename).

---

## Development notes

Sandboxed preloads **cannot be ESM**. `package.json` is deliberately CommonJS, and the
preload build is pinned to `format: 'cjs'` with a `.cjs` extension in
[`electron.vite.config.ts`](electron.vite.config.ts). If `"type": "module"` is ever added,
electron-vite will silently emit an ESM preload that loads without error but whose
`contextBridge` globals never appear.

The main-world shim is passed through `contextBridge.executeInMainWorld`, which is marked
**Experimental** and **serializes** the function — so it must not close over anything outside
its own parameters, and must avoid syntax that makes the bundler emit helpers (which is why
it uses `Object.defineProperty` instead of a static class field). Install status is reported
to the main process and logged loudly on failure, so a future Electron change surfaces as
`[notify] SHIM NOT INSTALLED` rather than silently losing click routing.

---

## Releasing

CI runs typecheck, tests and a build on every push and pull request. It also asserts two
things that fail silently otherwise: that the built preloads contain no ESM syntax, and that
`build/icons` still matches its generator.

To publish:

```bash
npm version minor -m "release %s"   # bumps package.json and tags
git push --follow-tags
```

The tag triggers `.github/workflows/release.yml`, which re-runs the same gates, builds the
`.deb` and AppImage, and attaches them to a GitHub Release along with `latest-linux.yml` (the
update manifest, shipped now so auto-update can be added later without re-cutting releases).

`workflow_dispatch` builds artifacts without tagging, to exercise the pipeline.

---

## Caveats

WhatsApp's terms discourage unofficial clients. Wrapping `web.whatsapp.com` in a webview is
what several long-lived open-source projects do, but that is not a guarantee — use an account
you can afford to lose.

Electron has no LTS: three majors are supported, roughly eight weeks apart. Expect to bump it
regularly, and read `docs/breaking-changes.md` each time — the Unity badge removal is only
documented there.

---

## License

MIT
