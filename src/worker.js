// Cloudflare Worker for Andy Burnham PM Tracker
// Handles /api/commentary endpoint

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
- "fixating": dwells on froth — clothes, food, haircut, who he travels with,
security-detail optics, "swept in by helicopter without an election" process
theatre, personality colour, or recycled trivia dressed up as analysis.
- "noting": neither clearly substantive nor clearly trivial — a straight,
unremarkable update. Use this honestly; it is the correct home for forgettable
coverage, and you must NOT promote such a piece to "fixating" just to get a joke
or to "probing" just to seem balanced.
Judge the treatment, not merely the topic: a thoughtful piece on whether it is
legitimate to take office mid-term is "probing"; a snide jab about the helicopter
is "fixating", even though both touch the same event.

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
That is an observation about the coverage, NOT a target to hit.
- "probing" must genuinely appear when a piece earns it; reflexive cynicism is a
failure. Equally, never award "probing" to a weak piece just to balance the
panel.
- Judge only what each snippet supports. Invent nothing.

STEP 3 — For each SELECTED article, write a caption of at most 8 words:
- "probing": serious and precise — name the substantive thing it engages with.
- "fixating": tongue-in-cheek — name the trivial thing it obsesses over. Dry wit,
not cruelty; the humour is in the accuracy.
- "noting": a plain, neutral few words describing what the piece is — no wit, no
scorn, no praise. Always write a short factual descriptor (e.g. "Routine
conference-season profile."); never leave it blank.

Respond with ONLY minified JSON, no prose, no markdown fences:
{"selected":[{"i":number,"verdict":"probing"|"fixating"|"noting","caption":string}]}
1 to 3 entries, in the order they should appear; each i must reference an
input candidate.`;

// Main handler
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/api/commentary") {
      return handleCommentary(env);
    }

    // Non-asset, non-API path: 404
    return new Response("Not found", { status: 404 });
  },
};

// Handle /api/commentary endpoint
async function handleCommentary(env) {
  const empty = { probability_pct: null, one_line: "", articles: [] };

  try {
    // Check cache first
    const hit = await env.COMMENTARY_CACHE.get(CACHE_KEY, "json");
    if (hit) return Response.json(hit);

    // Stage 1: Perplexity retrieves a representative pool
    const found = await retrievePool(env);
    const meta = { 
      probability_pct: found.probability_pct ?? null, 
      one_line: found.one_line ?? "" 
    };
    
    if (!found.pool?.length) {
      return Response.json({ ...empty, ...meta });
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

    const result = { ...meta, articles };
    
    // Cache real results
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
