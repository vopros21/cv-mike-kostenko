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

`stats/collect.mjs` writes `docs/data/live.json`, then bakes the figures into `docs/index.html`: the sentences between `<!-- live:start -->` and `<!-- live:end -->`, and the status words in the "Systems I run" table. Only metrics with `"public": true` and a numeric `value` are shown; `null` is never displayed. With nothing publishable, the static sentence with no numbers is written instead. The output depends only on the data, so re-running on the same JSON gives no diff.

`docs/scripts/live.js` does only what depends on the visitor's clock: "updated X ago", the stale styling once `generatedAt` is older than 48 hours (grey figures, "figures as of <date>", amber dot, "Data stale since <date>" for old system checks). There is no animation.

The collector Each metric has its own source function. They are all TODO stubs that return `null` for now, so a run produces a file with only `null` values.

```sh
node stats/collect.mjs --dry-run     # print the JSON
node stats/collect.mjs               # write docs/data/live.json and bake docs/index.html
node stats/collect.mjs --from x.json --out /tmp/site/data/live.json --html /tmp/site/index.html
                                     # render existing data into a copy of the site (no sources run)
```

Node 18+ and no dependencies. Environment variables for the sources, once they're wired up:

| Variable | Used by |
| --- | --- |
| `CF_API_TOKEN` | PNCT visitors, Cloudflare GraphQL Analytics API (Analytics:Read) |
| `CF_ZONE_OR_SITE_TAG` | PNCT visitors, zone tag or Web Analytics site tag |
| `CF_ACCOUNT_ID` | PNCT visitors, if you query Web Analytics (account-scoped) |

Parking metrics are `"public": false` in `stats/collect.mjs` and stay that way until Devexperts approves publishing them.

### Running it from cron on the Raspberry Pi

Every 6 hours is plenty: data goes stale after 48 hours, and every run is a commit (and a Pages deploy).

```sh
# ~/singledev-stats.sh
set -euo pipefail
cd ~/cv-mike-kostenko
set -a; . ~/.config/singledev-stats.env; set +a   # CF_API_TOKEN=... etc., chmod 600
git pull --quiet --rebase
node stats/collect.mjs
git add docs/data/live.json docs/index.html
git diff --cached --quiet || { git commit --quiet -m "Live figures: update"; git push --quiet; }
```

```cron
0 */6 * * * /bin/bash ~/singledev-stats.sh >> ~/singledev-stats.log 2>&1
```

The Pi needs a deploy key (or fine-grained token) that can push to this repository.

## Fonts

IBM Plex Sans and IBM Plex Serif, self-hosted as Latin-subset woff2 in `docs/fonts/` (from Fontsource 5.3.0, SIL Open Font License, see `docs/fonts/OFL.txt`). No requests go to Google Fonts.
