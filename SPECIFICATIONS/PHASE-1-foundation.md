# Phase 1: Foundation - Project Setup & Static Page

> **Status:** Ready for implementation  
> **Priority:** High  
> **Depends on:** None  
> **Estimated effort:** 1-2 sessions

---

## Overview

**Goal:** Establish the project structure and implement a functional static page that correctly renders the hero answer from Wikidata, with all visual states defined in the design handoff.

This phase creates the foundation: the Cloudflare Worker project structure, the static HTML/CSS/JS page with all design states, and the Wikidata integration for the core hero answer.

---

## Acceptance Criteria (from project outline)

By the end of this phase, the following must be true:

1. ✅ Page loads and, using only the Wikidata call, renders the correct hero answer — `Not yet.` today — with the `(but ask again in a month)` subtitle.
2. ✅ The hero answer renders even with the Worker disabled or failing.
3. ✅ All visual elements from the design handoff are implemented:
   - Newspaper layout (masthead, dateline, weather, sections)
   - Hero section with correct typography
   - Odds Desk section
   - Papers panel section
   - Footer with PM counter
4. ✅ All six states from the handoff are represented in the code (even if some are not yet connected to live data):
   - Loading state
   - NOT YET default
   - YES success
   - Judge fallback (single neutral Noted card)
   - Offline fallback (canned trio)
   - Empty panel variant (code present but not active per spec)

---

## Deliverables

### 1. Project Structure

```
is-burnham-pm-yet/
├── public/
│   └── index.html          # Full page implementation
├── src/
│   └── worker.js            # Stub for future phases (return 404 for now)
├── wrangler.toml           # Worker configuration
├── package.json            # Minimal (if needed)
└── .gitignore               # node_modules, .dev.vars, etc.
```

### 2. wrangler.toml

```toml
name = "andy-burnham-yet"
main = "src/worker.js"
compatibility_date = "2026-06-23"

[assets]
directory = "./public"

# KV namespace will be added in Phase 4
# [[kv_namespaces]]
# binding = "COMMENTARY_CACHE"
# id = "<to-be-created>"
```

### 3. .gitignore

```
node_modules/
.dev.vars
.env
*.log
.DS_Store
```

### 4. .dev.vars (template - user will add keys)

```
# Perplexity API Key for local development
PERPLEXITY_API_KEY=your_perplexity_key_here

# Anthropic API Key for local development  
ANTHROPIC_API_KEY=your_anthropic_key_here
```

### 5. public/index.html

A complete, self-contained HTML file with:
- Full newspaper layout matching the design handoff exactly
- Inline `<style>` with all CSS (Google Fonts imports for Libre Caslon Display, Georgia, Space Mono)
- Inline `<script>` with client-side logic
- No build step required

---

## Implementation Details

### HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Burnham Question - The Daily Non-Forecast</title>
  
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Display&family=Georgia:ital,wght@0,400;0,700;1,400&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  
  <style>
    /* All CSS here - see CSS Details below */
  </style>
</head>
<body>
  <div id="page">
    <!-- Masthead -->
    <header>
      <!-- Edition, Est., Price -->
      <!-- Main title -->
      <!-- Dateline with dynamic date -->
    </header>
    
    <!-- Hero section -->
    <section id="hero">
      <!-- Question: "Is Andy Burnham the Prime Minister?" -->
      <!-- Answer: "Not yet." or "Yes." -->
      <!-- Subtitle -->
      <!-- Scoreboard status -->
    </section>
    
    <!-- Main content -->
    <section id="content">
      <!-- Odds Desk -->
      <div id="odds-desk">
        <!-- Probability percentage -->
        <!-- Caption -->
        <!-- Progress bar -->
        <!-- Disclaimer -->
      </div>
      
      <!-- Papers panel -->
      <div id="papers-panel">
        <!-- Heading: "Meanwhile, the papers are..." -->
        <!-- Articles container -->
        <div id="articles">
          <!-- Articles will be inserted here by JS -->
          <!-- Loading state placeholder -->
          <!-- Fallback canned trio -->
        </div>
      </div>
    </section>
    
    <!-- Footer -->
    <footer>
      <!-- PM counter -->
      <!-- Scoreboard status -->
    </footer>
  </div>
  
  <script>
    // Client-side logic - see JavaScript Details below
  </script>
</body>
</html>
```

### CSS Details

**Color Palette:**
```css
:root {
  --paper: #F2EEE4;
  --ink: #17130D;
  --amber: #DB8E1A;
  --amber-dark: #B07A17; /* Darkened for WCAG AA on small text */
  --green: #2F7D33;
  --muted: #7a6f5d;
  --muted-light: #9a9082;
  --muted-lighter: #c9c1b1;
  --archive-red: #9a3b2e;
  --white: #FFFFFF;
}
```

**Typography:**
- Hero answer: `Libre Caslon Display` at 158px, line-height 0.8
- Body text: `Georgia` at various sizes
- Labels/monospace: `Space Mono`

**Layout:**
- Desktop-first (match handoff breakpoints)
- Centered container with max-width
- Flexbox for content sections
- Exact spacing from handoff (padding, margins, borders)

**Animations:**
```css
@keyframes jitMemo {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

@keyframes softpulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; }
}
```

**Verdict-based styling:**
- `.verdict-fixating` - amber border, amber label
- `.verdict-probing` - green border, green label
- `.verdict-noting` - muted border, muted label
- `.fixating-card` - jitter animation

### JavaScript Details

**Core Logic:**

```javascript
// State management
const states = {
  LOADING: 'loading',
  NOT_YET: 'not_yet',
  YES: 'yes',
  JUDGE_FAILED: 'judge_failed',
  OFFLINE: 'offline'
};

// Current state
let currentState = states.LOADING;

// PM counter - hardcoded constant
const BASE_PM_COUNT = 6;
let pmCount = BASE_PM_COUNT;

// Wikidata SPARQL query
const WIKIDATA_QUERY = `
  SELECT ?pmLabel WHERE {
    wd:Q145 wdt:P6 ?pm .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }
`;

// Format date like mockup: "Sunday 21 June 2026"
function formatDate(date) {
  const options = { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  };
  return date.toLocaleDateString('en-GB', options);
}

// Check if any label contains "Burnham" (case-insensitive)
function isBurnhamPM(pmLabels) {
  return pmLabels.some(label => 
    label.toLowerCase().includes('burnham')
  );
}

// Fetch from Wikidata
async function fetchWikidataAnswer() {
  try {
    const encodedQuery = encodeURIComponent(WIKIDATA_QUERY);
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodedQuery}`;
    const response = await fetch(url);
    const data = await response.json();
    
    const labels = data.results.bindings.map(b => b.pmLabel.value);
    return isBurnhamPM(labels);
  } catch (error) {
    console.error('Wikidata error:', error);
    // Default to Not yet on error
    return false;
  }
}

// Fetch from Worker API
async function fetchCommentary() {
  try {
    const response = await fetch('/api/commentary');
    if (!response.ok) throw new Error('API error');
    return await response.json();
  } catch (error) {
    console.error('Commentary API error:', error);
    return null;
  }
}

// Render hero based on answer
function renderHero(isYes) {
  const heroSection = document.getElementById('hero');
  
  if (isYes) {
    pmCount = BASE_PM_COUNT + 1; // Tick to 7
    heroSection.innerHTML = `
      <div class="hero-question">Is Andy Burnham the Prime Minister?</div>
      <div class="hero-answer hero-answer-yes">Yes<span class="hero-period">.</span></div>
      <div class="hero-subtitle">(finally. you may sit down.)</div>
      <div class="hero-status">Scoreboard last checked: just now · confirmed via Wikidata Q145 · P6</div>
    `;
    currentState = states.YES;
  } else {
    heroSection.innerHTML = `
      <div class="hero-question">Is Andy Burnham the Prime Minister?</div>
      <div class="hero-answer hero-answer-not-yet">Not yet<span class="hero-period">.</span></div>
      <div class="hero-subtitle">(but ask again in a month)</div>
      <div class="hero-status">Scoreboard last checked: just now · the default answer is usually correct</div>
    `;
    currentState = states.NOT_YET;
  }
  
  // Update PM counter in footer
  updateFooter();
}

// Update footer with PM counter
function updateFooter() {
  const footerCounter = document.getElementById('pm-counter');
  if (footerCounter) {
    footerCounter.textContent = `Prime Ministers since the 2016 referendum: ${pmCount} · this counter is load-bearing`;
  }
}

// Render odds desk
function renderOddsDesk(data) {
  const oddsDesk = document.getElementById('odds-desk');
  
  if (!data || data.probability_pct === null) {
    oddsDesk.innerHTML = `
      <div class="odds-label">The Odds Desk</div>
      <div class="odds-percentage odds-placeholder">—%</div>
      <div class="odds-caption odds-placeholder">…still being totted up by the desk.</div>
      <div class="odds-bar odds-bar-placeholder"></div>
      <div class="odds-disclaimer">Press estimate, not a forecast. Possibly not even a guess.</div>
    `;
    return;
  }
  
  const probability = data.probability_pct;
  const caption = data.one_line || '…that he\'s behind the famous door by September.';
  
  oddsDesk.innerHTML = `
    <div class="odds-label">The Odds Desk</div>
    <div class="odds-percentage">${probability}%</div>
    <div class="odds-caption">${caption}</div>
    <div class="odds-bar">
      <div class="odds-bar-fill" style="width: ${probability}%"></div>
    </div>
    <div class="odds-disclaimer">Press estimate, not a forecast. Possibly not even a guess.</div>
  `;
}

// Render articles panel
function renderArticles(articles) {
  const articlesContainer = document.getElementById('articles');
  
  if (!articles || articles.length === 0) {
    // Show fallback canned trio for offline state
    renderCannedTrio();
    return;
  }
  
  articlesContainer.innerHTML = articles.map(article => `
    <article class="article-card ${article.verdict}">
      <div class="article-meta">
        <span class="article-outlet">${article.outlet}</span>
        <span class="article-date">${article.date}</span>
      </div>
      <h3 class="article-title">${article.title}</h3>
      <span class="article-verdict">
        <span class="verdict-label">${getVerdictLabel(article.verdict)}</span>
        <span class="verdict-caption">${article.caption}</span>
      </span>
    </article>
  `).join('');
  
  // Apply jitter animation to fixating cards
  document.querySelectorAll('.article-card.fixating').forEach(card => {
    card.classList.add('fixating-card');
  });
}

// Get verdict label text
function getVerdictLabel(verdict) {
  switch(verdict) {
    case 'fixating': return 'Fixating on:';
    case 'probing': return 'Probing';
    case 'noting': return 'Noted';
    default: return 'Noted';
  }
}

// Render canned trio fallback
function renderCannedTrio() {
  const articlesContainer = document.getElementById('articles');
  const panelHeading = document.querySelector('#papers-panel h2');
  
  // Add "From the archive" badge to heading
  if (panelHeading) {
    panelHeading.innerHTML = `
      Meanwhile, the papers are…
      <span class="archive-badge">From the archive</span>
    `;
  }
  
  articlesContainer.innerHTML = `
    <article class="article-card fixating">
      <div class="article-meta">
        <span class="article-outlet">The Daily Broadsheet</span>
        <span class="article-date">21 Jun</span>
      </div>
      <h3 class="article-title">Inside Burnham's anorak: what the zip tells us about the soul of Labour</h3>
      <span class="article-verdict">
        <span class="verdict-label verdict-fixating">Fixating on</span>
        <span class="verdict-caption">the coat</span>
      </span>
    </article>
    <article class="article-card fixating">
      <div class="article-meta">
        <span class="article-outlet">Westminster Lobby Wire</span>
        <span class="article-date">20 Jun</span>
      </div>
      <h3 class="article-title">Mood in the tearoom 'fizzy', says man who was not in the tearoom</h3>
      <span class="article-verdict">
        <span class="verdict-label verdict-fixating">Fixating on</span>
        <span class="verdict-caption">one source's choice of adjective</span>
      </span>
    </article>
    <article class="article-card fixating">
      <div class="article-meta">
        <span class="article-outlet">The Northern Question</span>
        <span class="article-date">19 Jun</span>
      </div>
      <h3 class="article-title">Could the 07:42 tram to Altrincham hold the key to Number 10?</h3>
      <span class="article-verdict">
        <span class="verdict-label verdict-fixating">Fixating on</span>
        <span class="verdict-caption">a tram timetable</span>
      </span>
    </article>
  `;
  
  // Apply jitter animation
  document.querySelectorAll('.article-card.fixating').forEach(card => {
    card.classList.add('fixating-card');
  });
}

// Render judge failed state (single neutral card)
function renderJudgeFailed(data) {
  const articlesContainer = document.getElementById('articles');
  
  if (!data || !data.articles || data.articles.length === 0) {
    renderCannedTrio();
    return;
  }
  
  // Show the single neutral card from the failed judge
  const article = data.articles[0];
  articlesContainer.innerHTML = `
    <article class="article-card noting">
      <div class="article-meta">
        <span class="article-outlet">${article.outlet}</span>
        <span class="article-date">${article.date}</span>
      </div>
      <h3 class="article-title">${article.title}</h3>
      <span class="article-verdict">
        <span class="verdict-label verdict-noting">Noted</span>
        <span class="verdict-caption">${article.caption || 'a recent update on the question'}</span>
      </span>
    </article>
    <div class="curation-note">Curation unavailable — single piece listed neutrally rather than scored.</div>
  `;
}

// Main initialization
async function init() {
  // Set dynamic date in masthead
  const today = new Date();
  const formattedDate = formatDate(today);
  document.getElementById('masthead-date').textContent = formattedDate;
  
  // Fetch Wikidata answer (core, independent)
  const isYes = await fetchWikidataAnswer();
  renderHero(isYes);
  
  // Fetch commentary (enhancement)
  const commentary = await fetchCommentary();
  
  if (commentary) {
    if (commentary.articles && commentary.articles.length > 0) {
      renderOddsDesk(commentary);
      renderArticles(commentary.articles);
    } else {
      // Empty pool - treat as offline
      renderOddsDesk(null);
      renderCannedTrio();
    }
  } else {
    // API unreachable - offline state
    renderOddsDesk(null);
    renderCannedTrio();
  }
  
  // Remove loading state
  document.body.classList.remove('loading');
}

// Query param for testing YES state
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('force') && urlParams.get('force') === 'yes') {
  // Override for testing
  document.addEventListener('DOMContentLoaded', () => {
    renderHero(true);
    renderOddsDesk({ probability_pct: 100, one_line: '...he is, in fact, behind the famous door.' });
    renderCannedTrio(); // Or test with live data if Worker is running
    document.body.classList.remove('loading');
  });
} else {
  document.addEventListener('DOMContentLoaded', init);
}
```

---

## Worker Stub (src/worker.js)

For Phase 1, the Worker only needs to handle non-asset paths with a 404. The assets binding will serve `public/index.html` automatically for `/`.

```javascript
// Phase 1: Stub only - /api/commentary will be implemented in Phase 3

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    
    // For now, any non-asset path returns 404
    // In Phase 3, we'll add /api/commentary handling
    return new Response('Not found', { status: 404 });
  }
};
```

---

## Testing Checklist

- [ ] `wrangler dev` starts successfully
- [ ] `http://localhost:8787` serves the page
- [ ] Hero answer correctly shows "Not yet." from Wikidata
- [ ] `?force=yes` query param shows YES state correctly
- [ ] All six states are visually represented in the code
- [ ] Design matches handoff exactly (colors, fonts, spacing)
- [ ] Jitter animation works on fixating cards
- [ ] `prefers-reduced-motion` is respected
- [ ] Small amber text meets WCAG AA contrast
- [ ] PM counter shows 6 in NOT YET state, 7 in YES state
- [ ] Masthead date shows today's date in correct format
- [ ] Loading state displays initially
- [ ] Fallback canned trio displays when /api/commentary fails

---

## Dependencies for Next Phase

Phase 2 (Wikidata Integration) depends on:
- [ ] Project structure established
- [ ] Basic page rendering works
- [ ] Wikidata call implemented and tested

---

## Notes

- No external dependencies (no npm packages) for Phase 1
- All code in single files (index.html, worker.js)
- No build step required
- User must add actual API keys to `.dev.vars` for Phase 3
