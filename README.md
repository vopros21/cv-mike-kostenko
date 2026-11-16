# Mike Kostenko
Public CV: work experience, areas of interests, pet projects.

## Writing a post

1. Create `blog/posts/<slug>.md` (a leading `YYYY-MM-DD-` in the filename is stripped from the slug) with front matter:
   ```yaml
   ---
   title: My post            # required
   date: 2026-10-05          # required, YYYY-MM-DD
   summary: One sentence.    # required
   category: tech            # tech | life
   draft: false              # optional; drafts are not published
   ---
   ```
   Images go in `blog/posts/images/` and are referenced as `images/<file>`.
2. Build: `cd blog && npm i && npm run build`. This regenerates `docs/blog/` (index, post pages, `.md` copies, `feed.xml`) and the Blog section of `docs/llms.txt`.
3. Commit the post and the `docs/` changes. GitHub Pages serves `docs/` as is; there is no CI.

The build also regenerates the homepage's Writing section (latest three posts) and its "Writing" nav link, between the `writing:*` and `writing-nav:*` markers in `docs/index.html`. With no published posts, both are left out; the blog index page always exists.

## Live figures ("Right now" on the homepage)

`stats/collect.mjs` writes `docs/data/live.json`, then bakes the figures into `docs/index.html`: the sentences between `<!-- live:start -->` and `<!-- live:end -->`, and the status words in the "Systems I run" table. A metric is shown only if it is `"public": true`, has a numeric `value`, and the value reaches its optional `minPublic` threshold; `null` is never displayed. With nothing publishable, the static sentence with no numbers is written instead. The output depends only on the data, so re-running on the same JSON gives no diff.

`docs/scripts/live.js` does only what depends on the visitor's clock: "updated X ago", and the stale styling once `generatedAt` is older than 48 hours (grey figures, "figures as of <date>", amber dot, "Data stale since <date>" for old system checks). There is no animation.

```sh
node stats/collect.mjs --dry-run     # run the sources, print the JSON, write nothing
node stats/collect.mjs               # write docs/data/live.json and bake docs/index.html
node stats/collect.mjs --from x.json --out /tmp/site/data/live.json --html /tmp/site/index.html
                                     # render existing data into a copy of the site (no sources run)
node stats/collect.mjs --check-cf    # verify the Cloudflare query against the live GraphQL schema
node stats/collect.mjs --dry-run --now 2026-12-20T09:00:00Z
                                     # testing: place the PNCT 30-day window as of that date
```

Node 18+ (the Pi has Debian's Node 20), no npm dependencies. A source that fails logs the error and gives `null`; the run still succeeds.

### Sources and definitions

| Metric | `minPublic` | Shown as | Source |
| --- | --- | --- | --- |
| `prazo_active_users` | 10 | "Prazo is reminding N people about Portuguese deadlines." | `SELECT people_reminded FROM public_stats` in Prazo's database, with `psql -At` as the read-only role `cv_stats` over the local socket |
| `pnct_visitors_30d` | 100 | "The PNCT map had N visitors in the last 30 days." | Cloudflare Web Analytics, GraphQL `rumPageloadEventsAdaptiveGroups` → `sum.visits`, filtered by site tag and `requestHost: pnct.singledev.eu` |
| `uptime_30d` | none | "Over the last 30 days, N% of health checks on my public systems passed." | `docs/data/checks.json`, written by the collector itself |
| `parking_*` | none | hidden (`"public": false`) | not collected: the Pi can't reach the company network; stays private until Devexperts approves |

**Thresholds.** `minPublic` (optional, set per metric in `stats/collect.mjs` and copied into `live.json`) keeps a figure off the page until it is worth showing. Below it, the metric is still collected and stored, just not rendered; with nothing above its threshold the page keeps the static sentence.

- **People Prazo is reminding**: users who finished onboarding (Prazo only creates the user row then; `/delete` removes it), have at least one obligation that produces reminders (a car, a property, landlord, or IRS reminders on), and whose most recent delivery attempt is not a permanent Telegram failure (blocked the bot, account deactivated, chat not found). The view lives in Prazo's repo (`V5__public_stats_view.sql`) and returns counts only; the role setup is in Prazo's `ops/cv-stats/`.
- **PNCT visitors**: Cloudflare's "visits" (the figure Web Analytics shows as Visits) over the last 30 full days in Europe/Lisbon, today excluded, counting only the production host (Pages preview hosts share the site tag). Web Analytics data starts on 16 Nov 2026 (`PNCT_DATA_SINCE`), so the value stays `null` until the whole window lies after it: the first figure comes on 16 Dec 2026. A window with no recorded data gives `null`, not 0.
- **Uptime**: every run appends one row to `docs/data/checks.json`, `{"at": …, "prazo": true|false|null, "pnct": true|false|null}` (passed, failed, not checked), one row per line, and drops rows older than 35 days. `uptime_30d` is passed checks ÷ all checks (both systems) over the last 30 days, rounded down to 0.1 % so a single failure never shows as 100 %. It stays `null` until the history covers 30 days.
- **Statuses**: `prazo` is Running if `systemctl is-active prazo.service` succeeds, otherwise Degraded; `pnct` is Running if `https://pnct.singledev.eu/` answers 200 within 10 s, otherwise Degraded; `parking` and `hubithab` aren't checked: parking shows the static text "Internal, in use daily" (the Pi can't reach it), hubithab "In development".
- Singular forms ("1 person", "1 visitor") come from each metric's `sentenceOne`.

### On the Raspberry Pi (`prazo-pi`)

What runs where:

| Thing | Location |
| --- | --- |
| Dedicated clone | `~/cv-site` (remote `git@github-cv-site:vopros21/cv-mike-kostenko.git`) |
| Deploy key | `~/.ssh/cv-site-deploy`, used through the `github-cv-site` host alias in `~/.ssh/config`; write access to this repository only |
| Secrets | `~/.config/singledev-stats/env` (chmod 600): `CF_API_TOKEN`, `CF_ACCOUNT_TAG`, `CF_SITE_TAG` |
| Runner | `stats/run-on-pi.sh`: pull --rebase --autostash on `main`, collect, commit `docs/data/live.json` + `docs/index.html` + `docs/data/checks.json` only if a value or status changed or the last data commit is over 24 h old, push. Commit message `data: refresh live figures`. New check rows alone don't trigger a commit; `checks.json` stays modified in `~/cv-site` until the next data commit. Exits non-zero on failure and restores `live.json`/`index.html`, so a failed run commits nothing (and adds no check row) |
| Schedule | systemd user units from `stats/systemd/`, installed in `~/.config/systemd/user/`; every 6 h, `Persistent=true`; logs: `journalctl --user -u singledev-stats` |
| Database access | role `cv_stats` (read-only, `SELECT` on `public_stats` only), peer-mapped from the OS user `mike` in `pg_hba.conf`/`pg_ident.conf` |

The runner can target another branch for testing: `BRANCH=some-test-branch ~/cv-site/stats/run-on-pi.sh`.

Enable the timer (once `main` contains `stats/`):

```sh
ssh prazo-pi 'sudo loginctl enable-linger mike && systemctl --user daemon-reload && systemctl --user enable --now singledev-stats.timer && systemctl --user list-timers singledev-stats.timer'
```

`enable-linger` lets user timers run without an open login session. Run once by hand with `systemctl --user start singledev-stats.service`.

Once the Pi pushes to `main`, run `git pull --rebase` before pushing from a laptop.

### Cloudflare token

Create it in the dashboard: My Profile → API Tokens → Create Token → Custom token. Permissions: **Account → Account Analytics → Read**, nothing else. Account Resources: Include → your account. No zone resources, no IP filter needed, set a TTL if you like. Put the token in `CF_API_TOKEN` on the Pi, then check with `cd ~/cv-site && set -a && . ~/.config/singledev-stats/env && set +a && node stats/collect.mjs --check-cf`.

- `CF_ACCOUNT_TAG`: the account ID (dashboard → Account Home → the ⋯ menu next to the account → Copy account ID, or the 32-character hex in the dashboard URL).
- `CF_SITE_TAG`: dashboard → Analytics & Logs → Web Analytics → pnct.singledev.eu; the URL contains `siteTag~in=<tag>` (a 32-character hex).

### Rotating credentials

- **Cloudflare token**: create a new one as above, replace `CF_API_TOKEN` in `~/.config/singledev-stats/env`, run `--check-cf`, then delete the old token under My Profile → API Tokens.
- **Deploy key**: on the Pi, `ssh-keygen -t ed25519 -N "" -C "prazo-pi cv-site deploy key" -f ~/.ssh/cv-site-deploy-new`; on a machine with `gh`: `gh repo deploy-key add cv-site-deploy-new.pub -R vopros21/cv-mike-kostenko --allow-write -t "prazo-pi stats (cv-site)"`; on the Pi, `mv ~/.ssh/cv-site-deploy-new ~/.ssh/cv-site-deploy && mv ~/.ssh/cv-site-deploy-new.pub ~/.ssh/cv-site-deploy.pub` and test with `ssh -T github-cv-site`; then remove the old key: `gh repo deploy-key list -R vopros21/cv-mike-kostenko` and `gh repo deploy-key delete <id> -R vopros21/cv-mike-kostenko`.
- **Database role**: there's no password to rotate (peer auth); to revoke access, see Prazo's `ops/cv-stats/README.md`.

## Fonts

IBM Plex Sans and IBM Plex Serif, self-hosted as Latin-subset woff2 in `docs/fonts/` (from Fontsource 5.3.0, SIL Open Font License, see `docs/fonts/OFL.txt`). No requests go to Google Fonts.
