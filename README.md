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
