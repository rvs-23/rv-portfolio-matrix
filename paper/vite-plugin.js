/**
 * @file paper/vite-plugin.js
 * Builds the paper site (the home page, walkthroughs, notes) inside the normal
 * Vite build, so a local build and a Cloudflare build are the same command.
 * The Matrix terminal is a plain source page at /matrix/.
 *
 * Release mode — PAPER_PUBLISH:
 *   unset        → "review": everything ships; drafts are tagged "in review"
 *   "preview"    → the same, plus a banner and noindex (Cloudflare Preview)
 *   "production" → strict: a draft in timeline.json or a walkthrough fails
 *                  the build; draft notes are left out
 *
 * Generated HTML is written to <root>/.paper/ (.paper-dev/ for the dev
 * server; both gitignored), wiped on every
 * run so a deleted note can't leave a stale page behind. Vite names an HTML
 * entry's output after its path under the root, so the bundle step moves each
 * page up to the site root, and the dev server maps URLs the same way.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";

// Dev and build write to different folders, so a build never disturbs the
// pages a running dev server is serving.
const outName = (dev) => (dev ? ".paper-dev" : ".paper");
import { loadContent, listDrafts } from "./content.js";
import {
  aboutPage,
  notFoundPage,
  notePage,
  projectPage,
  feedXml,
  sitemapXml,
  SITE_URL,
} from "./templates.js";

const MODES = new Set(["preview", "production"]);

export function resolveMode(value = process.env.PAPER_PUBLISH) {
  if (value && !MODES.has(value)) {
    throw new Error(`PAPER_PUBLISH must be "preview" or "production", got "${value}"`);
  }
  return value || "review";
}

/**
 * Render every page to disk. Returns the generated file paths plus the data
 * the bundle step needs (feed, terminal index).
 */
export function generate({
  root,
  mode,
  dev = false,
  buildDate = new Date(),
  outDir = join(root, outName(dev)),
}) {
  // Validate before touching disk: a failed run leaves the last pages intact.
  const content = loadContent(join(root, "content"));
  if (mode === "production") {
    // Draft notes are simply left out of production; anything else blocks it.
    const drafts = listDrafts({ ...content, notes: [] });
    if (drafts.length) {
      throw new Error(`PAPER_PUBLISH=production but drafts remain: ${drafts.join(", ")}`);
    }
  }
  rmSync(outDir, { recursive: true, force: true });
  const notes =
    mode === "production" ? content.notes.filter((n) => !n.draft) : content.notes;
  const ctx = {
    mode,
    site: content.timeline.site,
    timeline: content.timeline,
    notes,
    projects: content.projects,
    figuresDir: join(root, "content", "figures"),
    buildDate: buildDate.toISOString().slice(0, 10),
  };

  const pages = [
    [join(outDir, "index.html"), aboutPage(ctx)],
    // Without a 404.html, Cloudflare Pages answers every unknown URL with /.
    [join(outDir, "404.html"), notFoundPage(ctx)],
  ];
  for (const note of notes.filter((n) => !n.inline)) {
    pages.push([join(outDir, note.slug, "index.html"), notePage(note, ctx)]);
  }
  for (const project of content.projects) {
    pages.push([join(outDir, project.slug, "index.html"), projectPage(project, ctx)]);
  }
  for (const [file, html] of pages) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  return { files: pages.map(([f]) => f), notes, projects: content.projects, site: ctx.site };
}

/** The small index the terminal's `about` / `notes` commands read. */
export function terminalIndex(notes, projects = []) {
  return {
    about: "/",
    projects: projects.map((p) => ({ title: p.title, summary: p.summary, url: `/${p.slug}/` })),
    notes: notes.map((n) => ({
      title: n.title,
      date: n.date,
      summary: n.summary,
      url: n.inline ? `/#note-${n.slug}` : `/${n.slug}/`,
    })),
  };
}

/** Cloudflare's _redirects: retired recruiter paths go home (hash and query
 *  variants are handled in js/legacyLinks.js). */
const REDIRECTS = "/recruiter   /   301\n/recruiter/  /   301\n";

export default function paperPlugin() {
  let root;
  let mode;
  let command;
  let result = { files: [], notes: [], projects: [], site: null };

  return {
    name: "paper",
    enforce: "post",

    config(config, env) {
      root = config.root || process.cwd();
      command = env.command;
      mode = resolveMode();
      result = generate({ root, mode, dev: command === "serve" });
      if (command !== "build") return;
      const input = { matrix: join(root, "matrix", "index.html") };
      for (const file of result.files) {
        // Keyed by path, so no slug can collide with the home page's entry.
        input[`page:${relative(join(root, outName(false)), file)}`] = file;
      }
      return { build: { rollupOptions: { input } } };
    },

    configureServer(server) {
      const regenerate = (file) => {
        if (!file.includes(`${root}/content/`) && !file.includes(`${root}/paper/`)) return;
        try {
          result = generate({ root, mode, dev: true });
          server.ws.send({ type: "full-reload" });
        } catch (err) {
          server.config.logger.error(`[paper] ${err.message}`);
        }
      };
      server.watcher.add(join(root, "content"));
      server.watcher.on("change", regenerate);
      server.watcher.on("add", regenerate);
      server.watcher.on("unlink", regenerate);

      // Pages are served from the site root; build-only artefacts are served live.
      server.middlewares.use((req, res, next) => {
        const [path, query] = req.url.split("?");
        const out = outName(true);
        if (!existsSync(join(root, out, "index.html"))) {
          result = generate({ root, mode, dev: true });
        }
        if (path.endsWith("/") && existsSync(join(root, out, path, "index.html"))) {
          req.url = `/${out}${path}index.html${query ? `?${query}` : ""}`;
        }
        if (path === "/feed.xml") {
          res.setHeader("Content-Type", "application/rss+xml");
          return res.end(feedXml(result.notes, { site: result.site }));
        }
        if (path === "/config/content/paper.json") {
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(terminalIndex(result.notes, result.projects)));
        }
        next();
      });
    },

    generateBundle(_options, bundle) {
      if (command !== "build") return;
      const emit = (fileName, source) => this.emitFile({ type: "asset", fileName, source });
      emit("_redirects", REDIRECTS);
      emit("feed.xml", feedXml(result.notes, { site: result.site }));
      emit("config/content/paper.json", JSON.stringify(terminalIndex(result.notes, result.projects)));
      if (mode !== "preview") {
        emit("sitemap.xml", sitemapXml(result.notes, result.projects));
        emit("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
      }

      // Move each page from .paper/ up to the site root.
      for (const [key, asset] of Object.entries(bundle)) {
        const OUT = outName(false);
        if (!key.startsWith(`${OUT}/`) || !key.endsWith(".html")) continue;
        delete bundle[key];
        asset.fileName = key.slice(OUT.length + 1);
        bundle[asset.fileName] = asset;
      }
    },
  };
}

export { SITE_URL };
