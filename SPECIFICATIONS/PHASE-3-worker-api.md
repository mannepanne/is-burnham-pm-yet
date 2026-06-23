# Phase 3: Worker API - Commentary Pipeline

> **Status:** Ready for implementation  
> **Priority:** High  
> **Depends on:** Phase 1 (Project Setup), Phase 2 (Wikidata Integration)  
> **Estimated effort:** 1-2 sessions

---

## Overview

**Goal:** Implement the `/api/commentary` endpoint in the Cloudflare Worker that retrieves a pool of recent articles from Perplexity Sonar, curates them using Claude, and returns clean JSON for the frontend to render.

This phase implements the two-stage pipeline:
1. **Stage 1 (Perplexity):** Retrieve ~9 recent articles about Burnham/UK PM
2. **Stage 2 (Claude):** Judge each article and select 1-3 for the panel

---

## Acceptance Criteria

By the end of this phase:

1. ✅ `/api/commentary` endpoint returns valid JSON with structure: `{ probability_pct, one_line, articles }`
2. ✅ Stage 1: Perplexity Sonar retrieves ~9 recent articles (pool)
3. ✅ Stage 2: Claude judges pool and selects 1-3 articles with verdict and caption
4. ✅ Verdict types: `probing`, `fixating`, `noting` are correctly assigned
5. ✅ Judge is NOT reflexively cynical: `probing` genuinely appears when earned
6. ✅ Panel reflects pool composition honestly (not forced 2:1 ratio)
7. ✅ API keys never exposed to client (verify in network tab)
8. ✅ Graceful degradation:
   - If Stage 1 fails → return empty articles array
   - If Stage 2 fails but Stage 1 succeeded → return single `noting` card
   - If both succeed → return curated panel
9. ✅ Always at least one article when pool is non-empty
10. ✅ Outlet diversity: avoid multiple pieces from same publication

---

## Implementation Details

### Worker Structure (src/worker.js)

```javascript
import { JUDGE_PROMPT } from './prompts.js';

// Configuration constants
export const JUDGE_MODEL = 'claude-haiku-4-5'; // One-line switch to 'claude-sonnet-4-6'
export const POOL_TARGET = 9;
export const PANEL_SIZE = 3;
export const NEUTRAL_CAPTION = 'A recent update on the question.';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    
    if (url.pathname === '/api/commentary') {
      return handleCommentary(req, env);
    }
    
    // Non-asset, non-API path
    return new Response('Not found', { status: 404 });
  }
};

async function handleCommentary(req, env) {
  const empty = { probability_pct: null, one_line: '', articles: [] };
  
  try {
    // Stage 1: Retrieve pool from Perplexity
    const found = await retrievePool(env);
    const meta = {
      probability_pct: found.probability_pct ?? null,
      one_line: found.one_line ?? ''
    };
    
    // If pool is empty, return meta with empty articles
    if (!found.pool?.length) {
      return Response.json({ ...empty, ...meta });
    }
    
    // Stage 2: Judge and curate with Claude
    const selected = await judgeAndCurate(env, found.pool);
    
    // Map selected indices back to pool articles
    const articles = selected
      .map(s => {
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
    
    return Response.json({ ...meta, articles });
    
  } catch (e) {
    console.error('Commentary error:', e);
    return Response.json(empty);
  }
}
```

### Stage 1: Perplexity Integration

```javascript
async function retrievePool(env) {
  const API_KEY = env.PERPLEXITY_API_KEY;
  
  if (!API_KEY) {
    console.error('PERPLEXITY_API_KEY not set');
    return { probability_pct: null, one_line: '', pool: [] };
  }
  
  const systemPrompt = `You answer ONLY with minified JSON, no prose, no markdown fences.
Schema: {"probability_pct": number, "one_line": string,
"pool": [{"title": string, "url": string, "outlet": string,
"date": string, "snippet": string}]}
Return up to ${POOL_TARGET} recent articles that TOGETHER form a fair,
representative sample of how the UK media is currently covering whether Andy
Burnham is or will become Prime Minister. Aim for a spread across hard news and
analysis, opinion/comment, and lighter colour or sketch pieces, and across
different outlets. Do NOT pre-select for any slant, quality, or how mockable a
piece is — just report what is actually being published. "snippet" is 1-2
sentences on what each article actually says, in neutral terms.
"probability_pct" (0-100) is your best estimate Burnham is PM within 3 months;
"one_line" is a dry one-sentence state of play.`;

  const userPrompt = 'How is the UK press currently covering whether Andy Burnham is or will become Prime Minister? Give a representative range of recent articles and estimate the probability.';
  
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      search_recency_filter: 'week',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });
  
  if (!response.ok) {
    throw new Error(`Perplexity error: ${response.status}`);
  }
  
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  
  // Clean up response (remove markdown fences if present)
  const cleanContent = content.replace(/```json|```/g, '').trim();
  
  try {
    return JSON.parse(cleanContent);
  } catch {
    console.error('Failed to parse Perplexity response');
    return { probability_pct: null, one_line: '', pool: [] };
  }
}
```

### Stage 2: Claude Judge

```javascript
// prompts.js - External file for maintainability

export const JUDGE_PROMPT = `You are the editor of a dry, sardonic site that tracks whether Andy Burnham has
become UK Prime Minister. You are honest about the British press: where coverage
is substantive you say so plainly; where it fixates on trivia you point that out
with a raised eyebrow; and where it is simply unremarkable you just note it,
without forcing a verdict either way. You will receive a JSON array of candidate
articles, each with an index "` + "`i`" + `", a title, an outlet, and a short neutral snippet
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
Report what is being said; only when what is being said is trivial do you say so.
Never inflate, exaggerate, or invent froth, and never twist a snippet to make
a piece look more foolish than it is.
- Honest over rigid. The press often fixates more than it probes, so the panel
will frequently lean that way — commonly around two "fixating" to one "probing".
That is an observation about the coverage, NOT a target to hit. If a week is
mostly substantive, show more "probing"; if it is dull, "noting" is fine; if it
is all froth, show "fixating". Mirror the pool you were given.
- "probing" must genuinely appear when a piece earns it; reflexive cynicism is
a failure. Equally, never award "probing" to a weak piece just to balance the
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
1 to 3 entries, in the order they should appear; each "i" must reference an input candidate.`;

// judgeAndCurate.js

async function judgeAndCurate(env, pool) {
  const API_KEY = env.ANTHROPIC_API_KEY;
  
  if (!API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    // Return first article as noting
    return pool.length ? [{ i: 0, verdict: 'noting', caption: NEUTRAL_CAPTION }] : [];
  }
  
  // Prepare candidates with indices
  const candidates = pool.map((a, i) => ({
    i,
    title: a.title,
    outlet: a.outlet,
    snippet: a.snippet ?? ''
  }));
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 600,
      system: JUDGE_PROMPT,
      messages: [
        { role: 'user', content: JSON.stringify({ candidates }) }
      ]
    })
  });
  
  if (!response.ok) {
    throw new Error(`Claude error: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Extract text content from response
  let text = '';
  if (data.content && Array.isArray(data.content)) {
    text = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  } else if (data.content && typeof data.content === 'string') {
    text = data.content;
  }
  
  // Clean up response
  text = text.replace(/```json|```/g, '').trim();
  
  const VERDICTS = new Set(['probing', 'fixating', 'noting']);
  
  try {
    const parsed = JSON.parse(text);
    const selected = (parsed.selected || [])
      .filter(s => Number.isInteger(s.i) && pool[s.i]) // Valid index
      .map(s => ({
        i: s.i,
        verdict: VERDICTS.has(s.verdict) ? s.verdict : 'noting',
        caption: s.caption ?? ''
      }))
      .slice(0, PANEL_SIZE);
    
    // Always show at least one when pool has anything
    if (!selected.length && pool.length) {
      return [{ i: 0, verdict: 'noting', caption: NEUTRAL_CAPTION }];
    }
    
    return selected;
  } catch {
    // Judge failed: list first candidate plainly
    return pool.length ? [{ i: 0, verdict: 'noting', caption: NEUTRAL_CAPTION }] : [];
  }
}
```

---

## Response Contract

The `/api/commentary` endpoint returns JSON with this structure:

```json
{
  "probability_pct": 22,
  "one_line": "Burnham is the frontrunner but the contest hasn't been run yet.",
  "articles": [
    {
      "title": "Inside Burnham's anorak: what the zip tells us about the soul of Labour",
      "url": "https://example.com/article",
      "outlet": "The Daily Broadsheet",
      "date": "2026-06-21",
      "verdict": "fixating",
      "caption": "the coat"
    },
    {
      "title": "Can a Prime Minister take office mid-term without a general election?",
      "url": "https://example.com/article2",
      "outlet": "The Constitution Unit",
      "date": "2026-06-20",
      "verdict": "probing",
      "caption": "the legitimacy of a mid-term handover"
    }
  ]
}
```

**Field definitions:**
- `probability_pct`: Number (0-100) or null
- `one_line`: String (dry one-sentence state of play) or empty string
- `articles`: Array of 0-3 article objects (but always at least 1 if pool was non-empty)

**Empty states:**
- Stage 1 fails → `articles: []`, `probability_pct: null`
- Stage 1 succeeds, Stage 2 fails → `articles: [{...}]` with single `noting` card
- Both succeed → `articles: [...]` with 1-3 curated cards

---

## Testing Checklist

### API Tests
- [ ] `/api/commentary` returns 200 with valid JSON
- [ ] Response has correct structure (probability_pct, one_line, articles)
- [ ] Articles have all required fields (title, url, outlet, date, verdict, caption)
- [ ] Verdict values are only 'probing', 'fixating', or 'noting'
- [ ] At least one article returned when pool is non-empty
- [ ] Empty articles array when Stage 1 fails
- [ ] Single noting card when Stage 2 fails but Stage 1 succeeded

### Integration Tests
- [ ] Frontend correctly renders articles from API response
- [ ] Verdict labels display correctly (Fixating on:, Probing, Noted:)
- [ ] Probability shows in Odds Desk
- [ ] One-line caption shows in Odds Desk
- [ ] Articles show outlet, date, title, caption

### Security Tests
- [ ] No API keys visible in network tab
- [ ] No API keys in source code (only in secrets)
- [ ] Worker secrets accessible in Worker environment
- [ ] Local dev works with `.dev.vars`

### Editorial Integrity Tests
- [ ] Test with mock pool containing substantive article → verify `probing` verdict
- [ ] Test with mock pool containing frothy article → verify `fixating` verdict
- [ ] Test with mock pool containing neutral article → verify `noting` verdict
- [ ] Test with mixed pool → verify honest representation (not forced ratio)
- [ ] Test with empty pool → verify empty articles array

---

## Mock Testing

For local testing without API keys, add a mock mode:

```javascript
// In src/worker.js - add mock support
const USE_MOCK = process.env.USE_MOCK === 'true';

async function handleCommentary(req, env) {
  if (USE_MOCK) {
    return mockCommentary();
  }
  // ... real implementation
}

function mockCommentary() {
  return Response.json({
    probability_pct: 31,
    one_line: 'Burnham is the frontrunner but the contest has not been run yet.',
    articles: [
      {
        title: 'Inside Burnham\'s anorak: what the zip tells us about the soul of Labour',
        url: 'https://example.com/1',
        outlet: 'The Daily Broadsheet',
        date: '21 Jun',
        verdict: 'fixating',
        caption: 'the coat'
      },
      {
        title: 'Can a Prime Minister take office mid-term without a general election?',
        url: 'https://example.com/2',
        outlet: 'The Constitution Unit',
        date: '20 Jun',
        verdict: 'probing',
        caption: 'the legitimacy of a mid-term handover'
      },
      {
        title: 'Burnham confirms he will stand in the Labour leadership contest',
        url: 'https://example.com/3',
        outlet: 'Westminster Lobby Wire',
        date: '19 Jun',
        verdict: 'noting',
        caption: 'a straight update on the contest'
      }
    ]
  });
}
```

Run with: `USE_MOCK=true npx wrangler dev`

---

## Error Handling

| Error Point | Behavior |
|-------------|----------|
| Missing PERPLEXITY_API_KEY | Log error, return empty pool |
| Missing ANTHROPIC_API_KEY | Log error, return single noting card from first pool item |
| Perplexity network error | Catch, return empty |
| Perplexity HTTP error | Throw, caught by handler, return empty |
| Perplexity parse error | Return empty pool |
| Claude network error | Throw, caught by handler, return single noting card |
| Claude HTTP error | Throw, caught by handler, return single noting card |
| Claude parse error | Return single noting card from first pool item |

---

## Dependencies for Next Phase

Phase 4 (Caching) depends on:
- [ ] `/api/commentary` endpoint working correctly
- [ ] Both Stage 1 and Stage 2 integrated
- [ ] Error handling verified
- [ ] Response contract stable

---

## Notes

- **Model choice:** Starting with `claude-haiku-4-5` (fast, cheap). Switch to `claude-sonnet-4-6` if captions feel flat or judgement feels coarse.
- **Pool size:** Target ~9 articles from Perplexity for good representation, then curate to 1-3.
- **Verdict integrity:** The judge prompt is the heart of the feature. Do not modify without careful consideration.
- **Outlets:** Ensure diversity in the pool by checking outlet names and avoiding duplicates.
