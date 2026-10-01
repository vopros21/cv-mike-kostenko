// Builds the blog from blog/posts/*.md into docs/blog/ (committed, served by GitHub Pages).
// Usage: cd blog && npm i && npm run build
//
// docs/blog/ is regenerated from scratch on every build. Outside it, only the
// <!-- blog:start --> ... <!-- blog:end --> section of docs/llms.txt is touched.
// Output is deterministic (no build timestamps), so rebuilding without changes gives no diff.
import { readdir, readFile, writeFile, mkdir, rm, cp, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';

const here = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(here, 'posts');
const IMAGES_DIR = path.join(POSTS_DIR, 'images');
const DOCS = path.join(here, '..', 'docs');
const OUT = path.join(DOCS, 'blog');
const LLMS = path.join(DOCS, 'llms.txt');

const SITE = 'https://singledev.eu';
const BLOG_URL = `${SITE}/blog/`;
const OG_IMAGE = `${SITE}/images/og.png`;
const CATEGORIES = ['tech', 'life'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- helpers ----------
const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escapeXml = escapeHtml;

const toUtcDate = iso => new Date(`${iso}T00:00:00Z`);
const formatDate = iso => { const d = toUtcDate(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const rfc822 = iso => {
  const d = toUtcDate(iso);
  return `${DAYS[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} 00:00:00 +0000`;
};
const readingTime = md => {
  const words = md.replace(/```[\s\S]*?```/g, m => m.replace(/[^\s\w]/g, ' ')).split(/\s+/).filter(w => /\w/.test(w)).length;
  return Math.max(1, Math.round(words / 200));
};

class BuildError extends Error {}
const fail = msg => { throw new BuildError(msg); };

// ---------- load + validate posts ----------
async function loadPosts() {
  const files = (await readdir(POSTS_DIR)).filter(f => f.endsWith('.md')).sort();
  const posts = [];
  const bySlug = new Map();

  for (const file of files) {
    const where = `blog/posts/${file}`;
    const { data, content, matter: rawFrontMatter } = matter(await readFile(path.join(POSTS_DIR, file), 'utf8'));

    for (const field of ['title', 'date', 'summary']) {
      if (data[field] === undefined || data[field] === null || String(data[field]).trim() === '') {
        fail(`${where}: missing required front-matter field "${field}"`);
      }
    }
    // YAML turns an unquoted 2026-10-05 into a Date and silently rolls over invalid ones
    // (2026-13-40 becomes 2027-02-09), so validate the raw text from the front matter.
    const rawDate = (rawFrontMatter.match(/^date:\s*["']?([^"'\s#]+)/m) || [])[1];
    const date = String(rawDate ?? data.date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(toUtcDate(date)) || toUtcDate(date).toISOString().slice(0, 10) !== date) {
      fail(`${where}: "date" must be a valid YYYY-MM-DD date, got "${date}"`);
    }
    if (data.category !== undefined && !CATEGORIES.includes(data.category)) {
      fail(`${where}: "category" must be one of ${CATEGORIES.map(c => `"${c}"`).join(', ')}, got "${data.category}"`);
    }
    if (data.draft !== undefined && typeof data.draft !== 'boolean') {
      fail(`${where}: "draft" must be true or false, got "${data.draft}"`);
    }

    const slug = file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      // Jekyll (still active on docs/) skips names starting with "_" or "."; keep slugs URL-safe.
      fail(`${where}: slug "${slug}" must use lowercase letters, digits and hyphens, and must not start with "_", "." or "-"`);
    }
    if (bySlug.has(slug)) fail(`${where}: duplicate slug "${slug}" (also used by blog/posts/${bySlug.get(slug)})`);
    bySlug.set(slug, file);

    posts.push({
      slug, date,
      title: String(data.title).trim(),
      summary: String(data.summary).trim(),
      category: data.category,
      draft: data.draft === true,
      body: content.replace(/^\s*\n/, ''),
    });
  }

  return posts
    .filter(p => !p.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

// ---------- page shell (same as docs/projects/parking.html) ----------
function shell({ title, description, canonical, ogType, body }) {
  return `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="${ogType}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${OG_IMAGE}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="alternate" type="application/rss+xml" title="Mike Kostenko — Blog" href="${BLOG_URL}feed.xml">
    <link rel="stylesheet" href="../styles.css">
    <link rel="icon" type="image/x-icon" href="../images/favicon.ico">
</head>

<body>
    <header class="topbar glass">
        <a href="../index.html" class="monogram">MK</a>
        <span style="flex:1"></span>
        <a id="pdf-button" href="../cv.pdf" download="CV_Kostenko_Java_Dev.pdf">Download CV</a>
    </header>
    <main>
        <div class="cv-card">
${body}
        </div>
    </main>
    <footer>
        <p>© 2023–2026 Mike Kostenko · <a href="mailto:contact@singledev.eu">contact@singledev.eu</a> · <a href="index.html">Blog</a></p>
    </footer>
</body>

</html>
`;
}

const categoryChip = c => c ? `<span class="cat cat-${c}">${escapeHtml(c)}</span>` : '';

function indexPage(posts) {
  const items = posts.map(p => `                <li class="post-item">
                    <h2><a href="${p.slug}.html">${escapeHtml(p.title)}</a></h2>
                    <p class="post-meta"><time datetime="${p.date}">${formatDate(p.date)}</time>${p.category ? ` ${categoryChip(p.category)}` : ''}</p>
                    <p class="post-summary">${escapeHtml(p.summary)}</p>
                </li>`).join('\n');
  const list = posts.length
    ? `            <ul class="post-list">\n${items}\n            </ul>`
    : `            <p class="post-empty">No posts yet. Check back soon, or subscribe to the <a href="feed.xml">RSS feed</a>.</p>`;
  return shell({
    title: 'Blog — Mike Kostenko',
    description: 'Posts by Mike Kostenko, Java Software Engineer in Porto: software engineering and life.',
    canonical: BLOG_URL,
    ogType: 'website',
    body: `            <section>
                <a href="../index.html" class="back-link">← Home</a>
                <h1 class="blog-title">Blog</h1>
                <p class="subtitle">Software engineering and life. <a href="feed.xml">RSS feed</a></p>
${list}
            </section>`,
  });
}

function postPage(post, newer, older) {
  const nav = [
    older ? `<a class="older" href="${older.slug}.html"><span>← Older</span>${escapeHtml(older.title)}</a>` : '',
    newer ? `<a class="newer" href="${newer.slug}.html"><span>Newer →</span>${escapeHtml(newer.title)}</a>` : '',
  ].filter(Boolean).join('\n                ');
  return shell({
    title: `${post.title} — Mike Kostenko`,
    description: post.summary,
    canonical: `${BLOG_URL}${post.slug}.html`,
    ogType: 'article',
    body: `            <a href="index.html" class="back-link">← All posts</a>
            <header class="post-header">
                <h1>${escapeHtml(post.title)}</h1>
                <p class="post-meta"><time datetime="${post.date}">${formatDate(post.date)}</time>${post.category ? ` ${categoryChip(post.category)}` : ''} <span class="read-time">· ${readingTime(post.body)} min read</span></p>
            </header>
            <article class="prose">
${marked.parse(post.body).trim()}
            </article>${nav ? `
            <nav class="post-nav" aria-label="More posts">
                ${nav}
            </nav>` : ''}`,
  });
}

const postMarkdown = p => `# ${p.title}\n\n${formatDate(p.date)}\n\n${p.body.trim()}\n`;

function feed(posts) {
  const latest = posts.slice(0, 20);
  const items = latest.map(p => `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${BLOG_URL}${p.slug}.html</link>
      <guid isPermaLink="true">${BLOG_URL}${p.slug}.html</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <description>${escapeXml(p.summary)}</description>${p.category ? `\n      <category>${escapeXml(p.category)}</category>` : ''}
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Mike Kostenko — Blog</title>
    <link>${BLOG_URL}</link>
    <description>Posts by Mike Kostenko, Java Software Engineer in Porto.</description>
    <language>en</language>
    <atom:link href="${BLOG_URL}feed.xml" rel="self" type="application/rss+xml"/>${latest.length ? `\n    <lastBuildDate>${rfc822(latest[0].date)}</lastBuildDate>\n${items}` : ''}
  </channel>
</rss>
`;
}

async function updateLlms(posts) {
  const START = '<!-- blog:start -->', END = '<!-- blog:end -->';
  const lines = posts.length
    ? posts.map(p => `- [${p.title}](${BLOG_URL}${p.slug}.md): ${p.summary}`).join('\n')
    : '- No posts yet.';
  const section = `${START}\n## Blog\n\n${lines}\n${END}`;
  let txt = await readFile(LLMS, 'utf8');
  if (txt.includes(START) && txt.includes(END)) {
    txt = txt.slice(0, txt.indexOf(START)) + section + txt.slice(txt.indexOf(END) + END.length);
  } else if (txt.includes('\n## Optional')) {
    txt = txt.replace('\n## Optional', `\n${section}\n\n## Optional`);
  } else {
    txt = `${txt.trimEnd()}\n\n${section}\n`;
  }
  await writeFile(LLMS, txt);
}

// ---------- build ----------
async function exists(p) { try { await stat(p); return true; } catch { return false; } }

try {
  const posts = await loadPosts();          // validate everything before touching docs/
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  if (await exists(IMAGES_DIR)) {
    const images = (await readdir(IMAGES_DIR)).filter(f => !f.startsWith('.') && !f.startsWith('_'));
    if (images.length) {
      await mkdir(path.join(OUT, 'images'));
      for (const f of images) await cp(path.join(IMAGES_DIR, f), path.join(OUT, 'images', f), { recursive: true });
    }
  }

  await writeFile(path.join(OUT, 'index.html'), indexPage(posts));
  for (const [i, post] of posts.entries()) {
    await writeFile(path.join(OUT, `${post.slug}.html`), postPage(post, posts[i - 1], posts[i + 1]));
    await writeFile(path.join(OUT, `${post.slug}.md`), postMarkdown(post));
  }
  await writeFile(path.join(OUT, 'feed.xml'), feed(posts));
  await updateLlms(posts);

  console.log(`docs/blog/ written: ${posts.length} post(s)${posts.length ? ' — ' + posts.map(p => p.slug).join(', ') : ''}`);
} catch (e) {
  if (e instanceof BuildError) { console.error(`Blog build failed: ${e.message}`); process.exit(1); }
  throw e;
}
