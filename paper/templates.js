/**
 * @file paper/templates.js
 * HTML for the home page, note and walkthrough pages, the RSS feed and the sitemap. Plain
 * template strings: every content string is either escaped here or comes out
 * of renderMarkdown (which rejects raw HTML).
 */

import { renderMarkdown, renderInline, loadFigureSvg } from "./markdown.js";
import { dataFigureSvg } from "./figures.js";
import { COLUMNS, yearRows } from "./timeview.js";
import { posix } from "node:path";

export const SITE_URL = "https://rvs23.dev";
const REPO_URL = "https://github.com/rvs-23/rv-portfolio-matrix/blob/main";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-05" → "5 Jul 2026", without locale surprises ("Sept"). */
function formatDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function draftTag(item, ctx) {
  return item.draft && ctx.mode !== "production"
    ? ` <span class="draft-tag">in review</span>`
    : "";
}

function linksHtml(links, cls = "links") {
  if (!links?.length) return "";
  const items = links.map((l) => {
    const external = /^https?:/.test(l.href);
    const attrs = external ? ` rel="noopener"` : "";
    return `<a href="${esc(l.href)}"${attrs}>${esc(l.label)}</a>`;
  });
  // Real spaces around the separator so the row can wrap on narrow screens.
  return `<p class="${cls}">${items.join(` <span class="sep" aria-hidden="true">·</span> `)}</p>`;
}

/**
 * An organisation's logo tile. The root-relative src lets Vite fingerprint
 * the file on build, and only pages that render a logo ship it.
 */
function logoHtml(item) {
  if (!item.logo) return "";
  return `<img class="logo" src="/content/logos/${esc(item.logo)}" alt="" width="48" height="48" decoding="async" />`;
}

/** The skills an entry used, as one quiet line. */
function skillsHtml(skills) {
  if (!skills?.length) return "";
  return `<p class="skills">${skills.map(esc).join(` <span class="sep" aria-hidden="true">·</span> `)}</p>`;
}

function md(src, ctx, where) {
  return renderMarkdown(src, { file: where, figuresDir: ctx.figuresDir }).html;
}

/** Shared <head> + running header + body wrapper. */
function shell({ title, description, path, body, ctx, runhead, cls = "", noindex = false }) {
  // Only a preview build hides from search engines and says so.
  const preview = ctx.mode === "preview";
  const robots = preview || noindex ? `\n    <meta name="robots" content="noindex" />` : "";
  const banner = preview
    ? `<p class="preview-banner">Preview build — not indexed.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />${robots}
    <link rel="canonical" href="${SITE_URL}${path}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${SITE_URL}${path}" />
    <meta name="twitter:card" content="summary" />
    <link rel="alternate" type="application/rss+xml" title="Notes" href="/feed.xml" />
    <link rel="icon" href="/paper/icon.svg" type="image/svg+xml" />
    <link rel="icon" href="/paper/icon-32.png" sizes="32x32" type="image/png" />
    <link rel="apple-touch-icon" href="/paper/icon-180.png" />
    <link rel="stylesheet" href="/paper/paper.css" />
    <script type="module" src="/paper/paper.js"></script>
  </head>
  <body class="paper${cls ? ` ${cls}` : ""}">
    <a class="skip" href="#main">Skip to content</a>
    ${banner}
    <header class="runhead">
      <a class="runhead-name" href="/">${esc(ctx.site.name)}</a>
      <span class="runhead-sec" data-runhead>${esc(runhead)}</span>
      ${linksHtml(ctx.site.links, "runhead-links")}
    </header>
    <main id="main">
${body}
    </main>
  </body>
</html>
`;
}

const sortKey = (d) => (d.length === 4 ? `${d}-00` : d);

const fmtDate = (d) => (d.length > 4 ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : d);

/** "Aug 2025 → now", "2024 → 2025", "May 2021": an entry's span, compactly. */
function when(e) {
  if (!e.end) return fmtDate(e.start);
  return `${fmtDate(e.start)} → ${e.end === "present" ? "now" : fmtDate(e.end)}`;
}

/** Everything dated, newest first: timeline.json entries plus the notes. */
function timelineItems(ctx) {
  const notes = ctx.notes.map((n) => ({
    id: `note-${n.slug}`,
    kind: "writing",
    start: n.date.slice(0, 7),
    label: n.source ? "Primer" : "Note",
    title: n.title,
    summary: n.summary,
    walkthrough: n.inline ? undefined : `/${n.slug}/`,
    draft: n.draft,
    note: n,
  }));
  return [...ctx.timeline.entries, ...notes].sort((a, b) => sortKey(b.start).localeCompare(sortKey(a.start)));
}

/**
 * A small inline version of the entry's figure, linking to its walkthrough.
 * Decorative here (the walkthrough has it full size, with a caption).
 */
function thumbHtml(e, ctx) {
  if (!e.thumb) return "";
  const svg =
    typeof e.thumb === "string"
      ? loadFigureSvg(ctx.figuresDir, e.thumb, `entries.${e.id}`)
      : dataFigureSvg(e.thumb);
  const art = svg.replace("<svg", '<svg aria-hidden="true" focusable="false"');
  const href = e.walkthrough ?? e.repo;
  return href
    ? `<a class="thumb" href="${esc(href)}" tabindex="-1" aria-hidden="true">${art}</a>`
    : `<div class="thumb" aria-hidden="true">${art}</div>`;
}

/** The link that opens an entry's depth: our walkthrough, a note, or Medium. */
function walkLink(e) {
  if (!e.walkthrough) return "";
  const external = e.walkthrough.startsWith("https://");
  const medium = external && /medium\.com|faun\.pub/.test(e.walkthrough);
  const label = medium ? "Read on Medium" : e.kind === "writing" ? "Read" : "Walkthrough";
  return `<a class="walk" href="${esc(e.walkthrough)}"${external ? ' rel="noopener"' : ""}>${label} ${external ? "↗" : "→"}</a>`;
}

function entryLinks(e) {
  const code = e.repo ? `<a class="walk" href="${esc(e.repo)}" rel="noopener">Code ↗</a>` : "";
  return walkLink(e) || code ? `<p class="entry-links">${walkLink(e)}${code}</p>` : "";
}

const titleHtml = (e, ctx) => renderInline(e.title, { file: `entries.${e.id}`, figuresDir: ctx.figuresDir });

/** One event in a column. A main event (a role, a degree) carries a logo, a
 *  larger title and its skills; the rest are a compact title and a line. */
function eventHtml(e, ctx) {
  // The title opens the entry's depth: its walkthrough or article, else its code.
  const href = e.walkthrough ?? e.repo;
  const title = href ? `<a href="${esc(href)}"${href.startsWith("https://") ? ' rel="noopener"' : ""}>${titleHtml(e, ctx)}</a>` : titleHtml(e, ctx);
  // Short notes open in place; everything else is one line plus a link.
  const inlineNote = e.note?.inline
    ? `<details class="note-inline"><summary>Read it here</summary><div class="prose">${md(e.note.body, ctx, `notes/${e.note.file}`)}</div></details>`
    : "";
  return `<article class="ev ${e.main ? "ev-main" : "ev-minor"}" id="${esc(e.id)}">
                <i class="node" aria-hidden="true"></i>
                ${e.main ? logoHtml(e) : ""}
                <div class="ev-body">
                  <p class="kicker">${e.tag ? `<span class="tag">${esc(e.tag)}</span> ` : ""}${esc(e.label)}${draftTag(e, ctx)}</p>
                  <h2 class="ev-title">${title}</h2>
                  <p class="ev-when">${esc(when(e))}</p>
                  <p class="ev-summary">${esc(e.summary)}</p>
                  ${thumbHtml(e, ctx)}
                  ${e.body ? `<div class="prose">${md(e.body, ctx, `entries.${e.id}`)}</div>` : ""}
                  ${inlineNote}
                  ${e.main ? skillsHtml(e.skills) : ""}
                  ${entryLinks(e)}
                </div>
              </article>`;
}

/**
 * The timeline: a row per year around one centre line. The column names head
 * the page once; on a phone, where the columns stack, each group repeats its
 * own.
 */
function timelineSection(ctx) {
  const rows = yearRows(timelineItems(ctx)).map(({ year, columns }) => {
    const cols = columns.map(
      ({ column, items }) => `            <div class="tl-col tl-${column.id}${items.length ? "" : " is-empty"}">
              <p class="kicker tl-label">${esc(column.label)}</p>
              ${items.map((e) => eventHtml(e, ctx)).join("\n              ")}
            </div>`,
    );
    return `          <div class="tl-row">
            <p class="tl-year"><span>${year}</span></p>
${cols.join("\n")}
          </div>`;
  });
  return `      <section class="sec" id="timeline" data-title="Timeline">
        <div class="tl">
          <div class="tl-row tl-top">${COLUMNS.map((c) => `<p class="kicker">${esc(c.label)}</p>`).join("")}</div>
${rows.join("\n")}
        </div>
      </section>`;
}

function colophon(ctx) {
  return `      <footer class="colophon" id="colophon">
        <p>Updated ${formatDay(ctx.buildDate)}.</p>
      </footer>`;
}

/** The home page. */
export function aboutPage(ctx) {
  const { site } = ctx.timeline;
  const body = `      <header class="masthead">
        <h1 class="name">${esc(site.name)}</h1>
        ${site.motto ? `<p class="motto">${esc(site.motto)}</p>` : ""}
        ${site.dek ? `<p class="${site.motto ? "roles" : "dek"}">${esc(site.dek)}${draftTag(site, ctx)}</p>` : ""}
        ${site.intro ? `<div class="prose intro">${md(site.intro, ctx, "site.intro")}</div>` : ""}
      </header>
${timelineSection(ctx)}
${colophon(ctx)}`;
  return shell({
    title: site.name,
    description: site.description || site.dek || site.name,
    path: "/",
    body,
    ctx,
    runhead: "rvs23.dev",
    cls: "home",
  });
}

/** The page Cloudflare serves for any URL that isn't one of ours. */
export function notFoundPage(ctx) {
  const body = `      <article class="post">
        <header class="post-head">
          <p class="kicker">404</p>
          <h1 class="post-title">Nothing here</h1>
          <p class="dek">That page doesn't exist, or it moved.</p>
        </header>
        <footer class="post-foot"><p><a href="/">← Back to the timeline</a></p></footer>
      </article>`;
  return shell({
    title: `Not found — ${ctx.site.name}`,
    description: "This page doesn't exist.",
    path: "/",
    body,
    ctx,
    runhead: "404",
    noindex: true,
  });
}

/**
 * Links written relative to a note's source file: another published source
 * becomes its note URL, any other repo path points at GitHub.
 */
function noteLinkResolver(note, notes) {
  if (!note.source) return undefined;
  const bySource = new Map(notes.filter((n) => n.source).map((n) => [n.source, n]));
  return (url) => {
    if (/^([a-z]+:|#|\/)/i.test(url)) return url;
    const [path, hash = ""] = url.split("#");
    const target = posix.normalize(posix.join(posix.dirname(note.source), path));
    const other = bySource.get(target);
    if (other) return `/${other.slug}/${hash ? `#${hash}` : ""}`;
    return `${REPO_URL}/${target}${hash ? `#${hash}` : ""}`;
  };
}

/** A standalone note page at /<slug>/. */
export function notePage(note, ctx) {
  const { html } = renderMarkdown(note.body, {
    file: `notes/${note.file}`,
    figuresDir: ctx.figuresDir,
    resolveLink: noteLinkResolver(note, ctx.notes),
  });
  const email = ctx.site.links?.find((l) => l.href.startsWith("mailto:"));
  const body = `      <article class="post">
        <header class="post-head">
          <p class="kicker"><time datetime="${note.date}">${formatDay(note.date)}</time> · Notes${draftTag(note, ctx)}</p>
          <h1 class="post-title">${esc(note.title)}</h1>
          <p class="dek">${esc(note.summary)}</p>
        </header>
        <div class="prose">${html}</div>
        <footer class="post-foot">
          ${email ? `<p>Replies → <a href="${esc(email.href)}">email</a></p>` : ""}
          <p><a href="/#timeline">← Back to the timeline</a></p>
        </footer>
      </article>`;
  return shell({
    title: `${note.title} — ${ctx.site.name}`,
    description: note.summary,
    path: `/${note.slug}/`,
    body,
    ctx,
    runhead: "Notes",
  });
}

/** A project's walkthrough at /<slug>/. */
export function projectPage(project, ctx) {
  const entry = ctx.timeline.entries.find((e) => e.walkthrough === `/${project.slug}/`);
  const { html } = renderMarkdown(project.body, { file: `projects/${project.file}`, figuresDir: ctx.figuresDir });
  const links = [
    entry?.repo && { label: "Code", href: entry.repo },
    { label: "Back to the timeline", href: `/#${entry?.id ?? "timeline"}` },
  ].filter(Boolean);
  const body = `      <article class="post">
        <header class="post-head">
          <p class="kicker">${esc(entry ? `${entry.label} · ${when(entry)}` : "Project")}${draftTag(project, ctx)}</p>
          <h1 class="post-title">${esc(project.title)}</h1>
          <p class="dek">${esc(project.summary)}</p>
          ${skillsHtml(entry?.skills)}
        </header>
        <div class="prose">${html}</div>
        <footer class="post-foot">${linksHtml(links)}</footer>
      </article>`;
  return shell({
    title: `${project.title} — ${ctx.site.name}`,
    description: project.summary,
    path: `/${project.slug}/`,
    body,
    ctx,
    runhead: entry?.label ?? "Project",
  });
}

/** RSS 2.0 over the published notes. */
export function feedXml(notes, ctx) {
  const x = (s) => esc(s).replace(/'/g, "&apos;");
  const items = notes
    .map((n) => {
      const link = n.inline ? `${SITE_URL}/#note-${n.slug}` : `${SITE_URL}/${n.slug}/`;
      return `  <item>
    <title>${x(n.title)}</title>
    <link>${link}</link>
    <guid>${link}</guid>
    <pubDate>${new Date(`${n.date}T00:00:00Z`).toUTCString()}</pubDate>
    <description>${x(n.summary)}</description>
  </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${x(ctx.site.name)} — notes</title>
  <link>${SITE_URL}/</link>
  <description>${x(ctx.site.dek || "Notes")}</description>
${items}
</channel>
</rss>
`;
}

export function sitemapXml(notes, projects = []) {
  const urls = [
    "/",
    ...projects.map((p) => `/${p.slug}/`),
    ...notes.filter((n) => !n.inline).map((n) => `/${n.slug}/`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}
</urlset>
`;
}
