// Cloudflare Worker for Andy Burnham PM Tracker
// Handles /api/commentary endpoint with cron-triggered cache refresh

// Configuration
const JUDGE_MODEL = "claude-haiku-4-5";
const POOL_TARGET = 9;
const PANEL_SIZE = 3;
const NEUTRAL_CAPTION = "A recent update on the question.";

// KV Cache
const CACHE_KEY = "commentary:v1";
const TTL_SECONDS = 6 * 60 * 60; // 6 hours
// Short TTL for an empty result, so a transient empty window (Perplexity down,
// parse failure) doesn't re-run the paid pipeline on every on-demand request.
const NEGATIVE_TTL_SECONDS = 120; // 2 minutes

// Archive: an append-only record of every article that has appeared on the panel,
// newest-first (index 0 = most recent). Written only from the cron `scheduled`
// path (single writer, so no read-modify-write race), and read both to page the
// archive endpoint and to steer each cycle's selection away from articles already
// shown — which is what rotates the front page across cron cycles.
const ARCHIVE_KEY = "archive:v1";
const ARCHIVE_PAGE_SIZE = 20;
const MAX_ARCHIVE = 1000; // cap the stored array; oldest entries trimmed

// Judge prompt
const JUDGE_PROMPT = `You are the editor of a dry, sardonic site that tracks whether Andy Burnham has
become UK Prime Minister. You are honest about the British press: where coverage
is substantive you say so plainly; where it fixates on trivia you point that out
with a raised eyebrow; and where it is simply unremarkable you just note it,
without forcing a verdict either way. You will receive a JSON array of candidate
articles, each with an index i, a title, an outlet, and a short neutral snippet
— a representative sample of the week's coverage.

STEP 1 — Judge how each candidate TREATS the subject. One of three verdicts:
- "probing": engages with what actually matters — what Burnham intends to do in
  office, the mechanics or legitimacy of a mid-term transition, the political or
  policy stakes, or a genuinely new angle or argument.
- "fixating": dwells on froth, OR inflates a mundane event into drama, OR hangs a
  succession story on a tangential hook. Examples: clothes, food, haircut, who he
  travels with, security-detail optics, "swept in by helicopter without an
  election" process theatre, personality colour, recycled trivia dressed up as
  analysis — AND breathless intrigue framing (a routine transition meeting sold as
  a "secret meeting", "showdown", "crisis talks", or who-met-whom drama) — AND
  pieces that use an unrelated angle (a foreign leader, a celebrity spat, a stray
  quote) as the lens on his prospects rather than engaging with them.
- "noting": neither substantive nor inflated — a genuinely flat, factual update,
  reported straight (e.g. "Burnham confirms he will stand"). Use this honestly,
  but do NOT use it as a polite escape hatch: if the outlet dresses a non-event up
  as intrigue, that is "fixating", not "noting". And never promote a forgettable
  piece to "fixating" just to get a joke, or to "probing" just to seem balanced.
Judge the TREATMENT, not merely the topic. The same underlying event splits by
how it's handled: a transition meeting reported plainly is "noting"; the same
meeting sold as a "secret" rendezvous is "fixating". A thoughtful piece on the
legitimacy of taking office mid-term is "probing"; a snide helicopter jab is
"fixating".

STEP 2 — Select 1 to 3 candidates for the panel (ALWAYS at least one), optimising
for:
- a faithful reflection of the pool — the panel should mirror the real character
  of the coverage, not an exaggerated version of it;
- outlet diversity — avoid multiple pieces from the same publication;
- no near-duplicates — if several cover the same angle, keep the strongest one;
- the clearest example of each type you include.
If nothing in the pool is good or interesting, still pick the single most
representative piece and give it the "noting" verdict — list it, don't mock it.

PRINCIPLES — read carefully, they define the site's integrity:
- Reflect, don't hunt. You are NOT looking for the worst or silliest articles.
  Report what is being said; only when what is being said is trivial do you say
  so. Never inflate, exaggerate, or invent froth, and never twist a snippet to
  make a piece look more foolish than it is.
- Honest over rigid. The press often fixates more than it probes, so the panel
  will frequently lean that way — commonly around two "fixating" to one "probing".
  That is an observation about the coverage, NOT a target to hit. If a
  week is mostly substantive, show more "probing"; if it is dull, "noting" is
  fine; if it is all froth, show "fixating". Mirror the pool you were given.
- "probing" must genuinely appear when a piece earns it; reflexive cynicism is a
  failure. Equally, never award "probing" to a weak piece just to balance the
  panel.
- Judge only what each snippet supports. Invent nothing.

STEP 3 — For each SELECTED article, write a caption. Hard limit of 15 words —
this is a ceiling, NOT a target; most captions should be far shorter. Register by
verdict:
- "probing": serious, precise and honest, with a dry edge at most. Name the
  substantive thing the piece actually engages with. This is the site's credible
  register — the credit has to land read straight; never sarcastic.
- "fixating": openly mocking — ridicule the coverage, don't just diagnose it.
  Deadpan contempt and a raised eyebrow at the newsroom are fair game; twist the
  knife on the daft news judgement. Aim it squarely at the coverage's choices and
  framing — the inflated drama, the irrelevant hook, the froth promoted to
  front-page news — never at anyone's character, appearance, or protected traits,
  and never as a partisan verdict on a real person. The best captions expose the
  gap between the breathless treatment and the nothing underneath.
- "noting": deadpan and dry — a flat, factual descriptor delivered with a straight
  face. Any humour is understatement from stating the obvious plainly; never a
  tacked-on ironic kicker, no scorn, no praise. Say what the piece is; never leave
  it blank.

VOICE — write like a sharp human sub-editor, not a caption generator. Avoid these
AI tells:
- The comma-pivot reframe: "[small thing], [passive verb] as [grand thing]" (e.g.
  "a meeting, reported as espionage"). It is the most overused AI-wit formula — use
  it at most once across the whole panel, ideally never.
- Abstract-noun openers: don't start on a nominalisation + relative clause ("The
  scrutiny an uncontested handover skips"). Name a concrete thing a person did.
- Reach-for-it satire vocabulary: no "optics", "theatre", "coronation",
  "spectacle", "narrative", "item". If it wouldn't be said in a pub, cut it.
- Hollow kickers: no lone adverb or symmetry trick doing the joke's work
  ("...Overwhelmingly.", "...the unsurprising.", "...no twist.").
- Prefer the physical and specific over the abstract ("before stepping through the
  No 10 door" beats "before the keys").
- Vary the sentence shape — a flat statement, a question, a dry aside. Don't let
  every caption share one skeleton. Read it aloud; if it sounds generated, redo it.

CALIBRATION — real examples showing the target register and voice. Match this bar;
never reuse these captions verbatim.
- "UK's likely next PM, Andy Burnham, says he wants to put more pressure on Israel"
  (Reuters) → "fixating": "He talks Israel; the story is somehow about Downing
  Street." (a routine policy line framed as proof of his inevitability.)
- "To Andy Burnham, first of all, first piece of advice" (Theresa May clip)
  → "fixating": "Since when is Theresa May offering advice a headline?" (a throwaway
  conference soundbite inflated into a story.)
- "The UK was too slow to call for a ceasefire, Andy Burnham tells the Guardian"
  (Guardian) → "probing": "Setting up a Gaza reversal before stepping through the
  No 10 door." (engages with what he would actually change in office.)
- "Andy Burnham moves closer to leadership after overwhelming MP backing" (Arise)
  → "noting": "Labour MPs line up behind the one name available." (a flat, factual
  update, reported straight.)

Respond with ONLY minified JSON, no prose, no markdown fences:
{"selected":[{"i":number,"verdict":"probing"|"fixating"|"noting","caption":string}]}
1 to 3 entries, in the order they should appear; each i must reference an
input candidate.`;

// Security headers attached to static asset responses. style-src keeps
// 'unsafe-inline' for the inline stylesheet and JS-set element.style; there
// are no inline scripts, so script-src does not need 'unsafe-inline'.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "connect-src 'self' https://query.wikidata.org https://cloudflareinsights.com",
  "img-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

// Return a copy of an asset response with the security headers attached.
function withSecurityHeaders(response) {
  const withHeaders = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    withHeaders.headers.set(name, value);
  }
  return withHeaders;
}

// Main handler with both fetch and scheduled triggers
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/api/commentary") {
      return handleCommentary(env);
    }

    if (url.pathname === "/api/archive") {
      return handleArchive(env, req);
    }

    if (url.pathname === "/api/refresh") {
      return handleRefresh(env, req);
    }

    // Everything else is a static asset. Serve it through the assets binding
    // and attach the security headers. (A _headers file is not honoured for a
    // Worker-plus-assets project, so the Worker owns these headers; this runs
    // because run_worker_first is set in wrangler.toml.)
    const assetResponse = await env.ASSETS.fetch(req);
    return withSecurityHeaders(assetResponse);
  },

  // Cron-triggered cache refresh. This is the ONLY path that writes the archive,
  // so archive writes have a single writer and no read-modify-write race. It reads
  // the archive first to steer selection away from already-shown articles (rotating
  // the panel), then appends whatever was shown back to the archive.
  async scheduled(event, env, ctx) {
    const kv = env.COMMENTARY_CACHE;

    const archive = kv ? (await kv.get(ARCHIVE_KEY, "json")) ?? [] : [];
    const seen = new Set(
      archive.map((a) => normalizeUrl(a?.url)).filter((k) => k !== null),
    );

    const result = await runPipeline(env, { seen });

    if (result.articles?.length) {
      if (kv) {
        await kv.put(CACHE_KEY, JSON.stringify(result), { expirationTtl: TTL_SECONDS });

        const updated = appendToArchive(archive, result.articles, MAX_ARCHIVE);
        // Archive has no TTL — it is the site's permanent record.
        await kv.put(ARCHIVE_KEY, JSON.stringify(updated));
        // Observability: how many of this cycle's cards were genuinely new tells us
        // how often rotation actually fires for this niche topic.
        const added = updated.length - archive.length;
        console.log(`Archive: ${result.articles.length} shown, ${added} new, ${updated.length} total`);
      }
    }
  },
};

// Run the full pipeline: Perplexity -> Claude -> curate.
// `opts.seen` is a Set of normalised URLs already shown (the caller reads it from
// the archive). When present it biases selection toward fresh articles so the panel
// rotates. When absent, selection is unbiased and the full pool is judged.
async function runPipeline(env, { seen } = {}) {
  const empty = { probability_pct: null, one_line: "", articles: [] };

  try {
    // Stage 1: Perplexity retrieves a representative pool
    const found = await retrievePool(env);
    const meta = {
      probability_pct: found.probability_pct ?? null,
      one_line: found.one_line ?? ""
    };

    if (!found.pool?.length) {
      return { ...empty, ...meta };
    }

    // Bias selection toward articles not shown before. The judge indexes into
    // `judgePool`, so selections MUST be resolved against `judgePool` too — the two
    // are a matched pair; indexing the raw pool here would dereference the wrong
    // article.
    const judgePool = computeJudgePool(found.pool, seen);

    // Stage 2: Claude judges the pool and curates up to 3
    const selected = await judgeAndCurate(env, judgePool);

    const articles = selected
      .map((s) => {
        const a = judgePool[s.i];
        return a && {
          title: a.title,
          url: a.url,
          outlet: a.outlet,
          date: a.date,
          verdict: s.verdict,
          caption: s.caption
        };
      })
      .filter(Boolean)
      .slice(0, PANEL_SIZE);

    // Stage 3: Full-text refinement (optional upgrade)
    const refinedArticles = await refineWithFullText(articles, env);

    return { ...meta, articles: refinedArticles };
  } catch (e) {
    console.error("Pipeline error:", e);
    return empty;
  }
}

// Helper: Extract readable text from HTML
function extractText(html) {
  // Use DOMParser if available (Workers runtime)
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      // Remove script, style, nav, footer, header elements
      const selectorsToRemove = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'noscript'];
      selectorsToRemove.forEach(selector => {
        const elements = doc.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      });
      return doc.body.textContent
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 1500); // Cap at ~1500 chars
    } catch (e) {
      // Fall through to regex approach
    }
  }
  
  // Regex-based fallback for environments without DOMParser
  // Remove script/style tags and their content
  let text = html
    .replace(/<script[^>]*>.*?<\/script>/gsi, '')
    .replace(/<style[^>]*>.*?<\/style>/gsi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 1500);
  
  return text;
}

// Helper: only fetch public https:// URLs. The article URLs come from the
// Perplexity response (not the site operator), so this blocks SSRF-style
// targets — non-https schemes and loopback / link-local / private hosts.
const MAX_ARTICLE_BYTES = 2_000_000; // 2 MB cap on a fetched article body

function isPublicHttpsUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "0.0.0.0" || host === "::1" || host === "::") return false;
  if (host === "169.254.169.254") return false; // cloud metadata
  if (/^127\./.test(host)) return false; // loopback
  if (/^10\./.test(host)) return false; // private
  if (/^192\.168\./.test(host)) return false; // private
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false; // private
  if (/^169\.254\./.test(host)) return false; // link-local
  if (/^(fe80|fc|fd)/.test(host)) return false; // IPv6 link-local / unique-local
  return true;
}

// Helper: Fetch article URL with timeout
async function fetchArticle(url, timeout = 5000) {
  if (!isPublicHttpsUrl(url)) {
    return null;
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AndyBurnhamYet/1.0; +https://andyburnhamyet.hultberg.org/)',
        'Accept': 'text/html',
      },
    });
    clearTimeout(id);

    if (!response.ok) {
      return null;
    }

    // Best-effort size cap (content-length may be absent on chunked responses).
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_ARTICLE_BYTES) {
      return null;
    }

    const html = await response.text();
    return html;
  } catch (e) {
    clearTimeout(id);
    return null;
  }
}

// Stage 3: Refine verdicts with full article text
async function refineWithFullText(articles, env) {
  if (!articles || articles.length === 0) {
    return articles;
  }

  // Fetch full text for each article
  const texts = await Promise.all(
    articles.map(async (a, index) => {
      const html = await fetchArticle(a.url);
      if (!html) return null;
      return {
        index: index,
        text: extractText(html),
        url: a.url,
      };
    })
  );

  // Filter out failed fetches
  const successful = texts.filter(t => t && t.text && t.text.length > 50);
  
  if (successful.length === 0) {
    // All fetches failed, return original articles
    return articles;
  }

  // Build refinement prompt
  const refinementPrompt = `You are refining article verdicts and captions based on the FULL TEXT.
Each article below has already been judged based on its snippet. Now review the
full text and confirm or refine the verdict and caption. Be more precise now that
you have the complete article.

For each article, return:
- index: the original index
- verdict: keep or change from the original (probing/fixating/noting)
- caption: refined caption based on full text (hard limit 15 words, a ceiling not
  a target — keep it tight). Keep the same voice: openly mocking for "fixating",
  serious for "probing", deadpan for "noting", and no AI tells (no comma-pivot
  "small thing, reported as grand thing" reframes, no abstract-noun openers).

Only refine if the full text changes your assessment. If the snippet-based
judgment still holds, keep the original verdict and caption.

Articles to refine:`;

  const articleContexts = successful.map((t, i) => {
    const original = articles[t.index];
    return `\n\nArticle ${t.index}: "${original.title}" (${original.outlet})\nURL: ${t.url}\nOriginal verdict: ${original.verdict}\nOriginal caption: "${original.caption}"\nFull text:\n${t.text.substring(0, 2000)}`;
  }).join('');

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        max_tokens: 400,
        // Instructions go in `system`; the article contexts go in a user
        // message. The Messages API rejects an empty `messages` array (400),
        // so the per-article payload must be a real user turn — mirroring how
        // judgeAndCurate is structured.
        system: refinementPrompt + '\n\nRespond with ONLY minified JSON: {"refined":[{"index":number,"verdict":"probing"|"fixating"|"noting","caption":string}]}',
        messages: [
          { role: "user", content: articleContexts },
        ],
      }),
    });

    const data = await r.json();
    let text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    const VERDICTS = new Set(["probing", "fixating", "noting"]);
    
    try {
      const parsed = JSON.parse(text);
      const refined = parsed.refined ?? [];
      
      // Apply refinements to articles
      const refinedArticles = [...articles];
      for (const ref of refined) {
        if (
          Number.isInteger(ref.index) && 
          ref.index >= 0 && 
          ref.index < refinedArticles.length &&
          VERDICTS.has(ref.verdict)
        ) {
          refinedArticles[ref.index] = {
            ...refinedArticles[ref.index],
            verdict: ref.verdict,
            caption: ref.caption ?? refinedArticles[ref.index].caption,
          };
        }
      }
      
      return refinedArticles;
    } catch {
      // Parse failed, return original
      return articles;
    }
  } catch (e) {
    console.error("Full-text refinement error:", e);
    // Fallback to original articles
    return articles;
  }
}

// Handle /api/commentary endpoint - reads from cache, fallback to on-demand
async function handleCommentary(env) {
  const empty = { probability_pct: null, one_line: "", articles: [] };

  // Helper to check if KV is available (not in local dev without KV)
  const kv = env.COMMENTARY_CACHE;

  try {
    // Read from cache first (if KV is available)
    if (kv) {
      const hit = await kv.get(CACHE_KEY, "json");
      if (hit) return Response.json(hit);
    }

    // Cache miss or no KV: run pipeline on-demand as fallback
    const result = await runPipeline(env);

    // Cache the result if KV is available. A full result gets the normal TTL;
    // an empty result is cached briefly so repeated misses during an empty
    // window don't each re-run the paid pipeline. (This only runs on a miss,
    // so it can't clobber an existing good cache entry.)
    if (kv) {
      await kv.put(CACHE_KEY, JSON.stringify(result), {
        expirationTtl: result.articles?.length ? TTL_SECONDS : NEGATIVE_TTL_SECONDS,
      });
    }

    return Response.json(result);
  } catch (e) {
    console.error("Commentary error:", e);
    return Response.json(empty); // status 200 — degrade quietly
  }
}

// Handle manual refresh with secret protection
async function handleRefresh(env, req) {
  // Require the secret in a request header, not the URL: query-string secrets
  // leak into edge/access logs, the Referer header, and browser history.
  const secret = req.headers.get("x-refresh-key");
  if (!secret || secret !== env.REFRESH_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const empty = { probability_pct: null, one_line: "", articles: [] };

  try {
    const result = await runPipeline(env);
    
    // Cache the result if we got articles and KV is available
    const kv = env.COMMENTARY_CACHE;
    if (kv && result.articles?.length) {
      await kv.put(CACHE_KEY, JSON.stringify(result), {
        expirationTtl: TTL_SECONDS,
      });
    }

    return Response.json(result);
  } catch (e) {
    console.error("Refresh error:", e);
    return Response.json(empty);
  }
}

// Stage 1: Retrieve pool from Perplexity Sonar
async function retrievePool(env) {
  const sys = `You answer ONLY with minified JSON, no prose, no markdown fences.
Schema: {"probability_pct": number, "one_line": string,
"pool": [{"title": string, "url": string, "outlet": string,
"date": string, "snippet": string}]}
Return up to ${POOL_TARGET} recent articles that TOGETHER form a fair,
representative sample of how the UK media is currently covering whether Andy
Burnham is or will become Prime Minister. Aim for a spread across hard news and
analysis, opinion/comment, and lighter colour pieces.
Aim for a spread across the political and editorial spectrum, not just the sober
centre, and balanced across left, centre and right. Deliberately span: national
broadsheets and mid-market/tabloid papers (e.g. Guardian, Mirror, i, Times, Sunday
Times, Telegraph, Mail, Express); broadcast and opinion-broadcast outlets including
partisan ones (e.g. BBC, Sky, GB News, TalkTV, LBC); comment, satirical and
independent outlets from across the spectrum (e.g. Spectator, The Critic, UnHerd,
Guido Fawkes, New Statesman, Novara Media, Zeteo UK, The Nerve, Private Eye); and
regional coverage close to Burnham (e.g. Manchester Evening News). The louder,
outrage-driven end of the press is part of the real picture and should not be left
out when genuinely present — but include an outlet only where it has genuinely
published on the topic. Never invent an article, headline or outlet, and never
attribute a piece to an outlet that has not run one. Do NOT pre-select for any
slant, quality, or how mockable a piece is — just report what is actually being
published, right across the spectrum. "snippet" is 1-2
sentences on what each article actually says, in neutral terms.
"probability_pct" (0-100) is your best estimate Burnham is PM within 3 months;
"one_line" is a dry one-sentence state of play.`;

  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      search_recency_filter: "week",
      messages: [
        { role: "system", content: sys },
        { 
          role: "user", 
          content: "How is the UK press currently covering whether Andy Burnham is or will become Prime Minister? Give a representative range of recent articles and estimate the probability." 
        },
      ],
    }),
  });

  const data = await r.json();
  let payload = data.choices?.[0]?.message?.content ?? "{}";
  payload = payload.replace(/```json|```/g, "").trim();
  
  try { 
    return JSON.parse(payload); 
  } catch { 
    return { probability_pct: null, one_line: "", pool: [] }; 
  }
}

// Stage 2: Claude judges and curates
async function judgeAndCurate(env, pool) {
  // Send only what judgement needs, tagged with the pool index i
  const candidates = pool.map((a, i) => ({
    i, title: a.title, outlet: a.outlet, snippet: a.snippet ?? "",
  }));

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 600,
      system: JUDGE_PROMPT,
      messages: [
        { role: "user", content: JSON.stringify({ candidates }) },
      ],
    }),
  });

  const data = await r.json();
  let text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .replace(/```json|```/g, "")
    .trim();

  const VERDICTS = new Set(["probing", "fixating", "noting"]);

  try {
    const parsed = JSON.parse(text);
    const selected = (parsed.selected ?? [])
      .filter((s) => Number.isInteger(s.i) && pool[s.i])
      .map((s) => ({
        i: s.i, 
        verdict: VERDICTS.has(s.verdict) ? s.verdict : "noting", 
        caption: s.caption ?? ""
      }))
      .slice(0, PANEL_SIZE);

    // Always show at least one when the pool has anything
    if (!selected.length && pool.length) {
      return [{ i: 0, verdict: "noting", caption: NEUTRAL_CAPTION }];
    }
    return selected;
  } catch {
    // Judge failed: list the first candidate plainly
    return pool.length ? [{ i: 0, verdict: "noting", caption: NEUTRAL_CAPTION }] : [];
  }
}

// Normalise an article URL into a dedup key: lowercase host, path without a
// trailing slash, no query or hash — so http/https and tracking-param variants
// of the same article collapse to one key. Returns null (never throws) for junk
// or absent input, so URL-less articles can be filtered out safely.
function normalizeUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${path}`;
}

// Choose which pool articles the judge sees, biased toward those not shown before
// so the panel rotates across cron cycles. `seenSet` holds normalised URLs already
// in the archive.
//
// - When at least `panelSize` fresh URL-bearing articles exist, judge ONLY those —
//   guaranteeing rotation.
// - Otherwise (a thin news week) lead with the fresh ones and top up with
//   already-seen items so the judge still sees a representative pool and the panel
//   is never empty; some cards may then repeat, which honestly reflects a quiet week.
//
// Articles without a usable URL are treated as "seen" — never counted as fresh and
// never used as a dedup key. The returned array is what the judge indexes into, so
// callers MUST resolve selections against THIS array (see runPipeline), not the raw
// pool — otherwise indices dereference the wrong article.
function computeJudgePool(pool, seenSet, panelSize = PANEL_SIZE, poolTarget = POOL_TARGET) {
  const seen = seenSet ?? new Set();
  const unseen = pool.filter((a) => {
    const key = normalizeUrl(a?.url);
    return key !== null && !seen.has(key);
  });
  if (unseen.length >= panelSize) {
    return unseen;
  }
  const unseenSet = new Set(unseen);
  const seenItems = pool.filter((a) => !unseenSet.has(a));
  return [...unseen, ...seenItems].slice(0, poolTarget);
}

// Prepend newly-shown articles to the archive, newest-first, deduped by normalised
// URL. An already-archived URL is kept as first stored (the archive records what was
// shown WHEN first shown), so a re-surfaced story never mutates or duplicates its
// entry. URL-less shown articles are dropped (no dedup key). A null/undefined
// existing archive is treated as empty, and the result is capped at `maxArchive`
// keeping the newest entries.
function appendToArchive(existing, shown, maxArchive = MAX_ARCHIVE) {
  const archive = Array.isArray(existing) ? existing : [];
  const have = new Set(
    archive.map((a) => normalizeUrl(a?.url)).filter((k) => k !== null),
  );
  const shownAt = new Date().toISOString();
  const fresh = [];
  for (const a of shown ?? []) {
    const key = normalizeUrl(a?.url);
    if (key === null || have.has(key)) continue;
    have.add(key);
    fresh.push({
      title: a.title,
      url: a.url,
      outlet: a.outlet,
      date: a.date,
      verdict: a.verdict,
      caption: a.caption,
      shown_at: shownAt,
    });
  }
  return [...fresh, ...archive].slice(0, maxArchive);
}

// Slice a newest-first list into a page. `page` is clamped: non-numeric / 0 /
// negative → 1; beyond the last page → the last page; an empty list → page 1 of 0.
// The returned `page` is the clamped value so the client can build correct links.
function paginate(items, page, pageSize = ARCHIVE_PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const totalPages = Math.ceil(total / pageSize);
  let p = Number.parseInt(page, 10);
  if (!Number.isFinite(p) || p < 1) p = 1;
  if (totalPages === 0) p = 1; // empty archive → page 1 of 0
  else if (p > totalPages) p = totalPages;
  const start = (p - 1) * pageSize;
  return { page: p, pageSize, total, totalPages, items: list.slice(start, start + pageSize) };
}

// Handle /api/archive — a paginated, newest-first view of the archive. Mirrors the
// other JSON endpoints: no security headers or Cache-Control (those attach only to
// static assets), and degrades to a 200 empty archive on any error.
async function handleArchive(env, req) {
  const url = new URL(req.url);
  const pageParam = url.searchParams.get("page");
  try {
    const kv = env.COMMENTARY_CACHE;
    const archive = kv ? await kv.get(ARCHIVE_KEY, "json") : null;
    return Response.json(paginate(archive, pageParam));
  } catch (e) {
    console.error("Archive error:", e);
    return Response.json({ page: 1, pageSize: ARCHIVE_PAGE_SIZE, total: 0, totalPages: 0, items: [] });
  }
}

// Named exports for unit testing. The Cloudflare runtime uses the default
// export above; these expose the pipeline internals to the test suite without
// changing runtime behaviour.
export {
  handleCommentary,
  handleRefresh,
  handleArchive,
  judgeAndCurate,
  extractText,
  refineWithFullText,
  isPublicHttpsUrl,
  normalizeUrl,
  computeJudgePool,
  appendToArchive,
  paginate,
};
