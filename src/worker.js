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

STEP 3 — For each SELECTED article, write a caption of at most 8 words:
- "probing": serious and precise — name the substantive thing it engages with.
- "fixating": sharp and scathing — expose WHY the fixation is absurd, don't just
  name it. Real bite is welcome. Aim it squarely at the coverage's choices and
  framing — the daft news judgement, the inflated drama, the irrelevant hook —
  never at anyone's character, appearance, or protected traits, and never as a
  partisan verdict on a real person. The funniest captions catch the gap between
  the breathless treatment and the trivial substance.
- "noting": a plain, neutral few words describing what the piece is — no wit, no
  scorn, no praise. Always write a short factual descriptor (e.g. "Routine
  conference-season profile."); never leave it blank.

CALIBRATION — real examples with the verdict and caption to aim for. Match this
bar; do not reuse these captions verbatim.
- "Analysis: Everything points to Burnham becoming PM within weeks" (BBC)
  → "probing": "Party mechanics and a realistic transition timeline."
- "Andy Burnham holds secret meeting with outgoing PM Keir Starmer" (BBC)
  → "fixating": "A diary appointment, reported as espionage." (a routine handover
  meeting inflated into 'secret' intrigue — Westminster theatre, not news.)
- "Andy Burnham, likely the UK's next PM, has been critical of President Trump"
  (CBS) → "fixating": "Criticising Trump, somehow spun into a liability." (the
  story's relevance hangs on a tangential foreign hook, not on his prospects.)

Respond with ONLY minified JSON, no prose, no markdown fences:
{"selected":[{"i":number,"verdict":"probing"|"fixating"|"noting","caption":string}]}
1 to 3 entries, in the order they should appear; each i must reference an
input candidate.`;

// Main handler with both fetch and scheduled triggers
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/api/commentary") {
      return handleCommentary(env);
    }

    // Non-asset, non-API path: 404
    return new Response("Not found", { status: 404 });
  },

  // Cron-triggered cache refresh
  async scheduled(event, env, ctx) {
    const result = await runPipeline(env);
    if (result.articles?.length) {
      await env.COMMENTARY_CACHE.put(CACHE_KEY, JSON.stringify(result), {
        expirationTtl: TTL_SECONDS,
      });
    }
  },
};

// Run the full pipeline: Perplexity -> Claude -> curate
async function runPipeline(env) {
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

    // Stage 2: Claude judges the pool and curates up to 3
    const selected = await judgeAndCurate(env, found.pool);

    const articles = selected
      .map((s) => {
        const a = found.pool[s.i];
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

    return { ...meta, articles };
  } catch (e) {
    console.error("Pipeline error:", e);
    return empty;
  }
}

// Handle /api/commentary endpoint - reads from cache, fallback to on-demand
async function handleCommentary(env) {
  const empty = { probability_pct: null, one_line: "", articles: [] };

  try {
    // Read from cache first
    const hit = await env.COMMENTARY_CACHE.get(CACHE_KEY, "json");
    if (hit) return Response.json(hit);

    // Cache miss: run pipeline on-demand as fallback
    const result = await runPipeline(env);
    
    // Cache the result if we got articles
    if (result.articles?.length) {
      await env.COMMENTARY_CACHE.put(CACHE_KEY, JSON.stringify(result), {
        expirationTtl: TTL_SECONDS,
      });
    }

    return Response.json(result);
  } catch (e) {
    console.error("Commentary error:", e);
    return Response.json(empty); // status 200 — degrade quietly
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
analysis, opinion/comment, and lighter colour pieces, and across
different outlets. Do NOT pre-select for any slant, quality, or how mockable a
piece is — just report what is actually being published. "snippet" is 1-2
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
