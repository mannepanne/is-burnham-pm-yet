# Phase 2: Wikidata Integration - Hero Answer

> **Status:** ✅ Completed (2026-06-24)
> **Priority:** High  
> **Depends on:** Phase 1 (Project Setup & Static Page)  
> **Estimated effort:** 0.5-1 session
> **Actual effort:** ~0.5 session

---

## Overview

**Goal:** Ensure the hero answer correctly determines whether Andy Burnham is UK Prime Minister by querying Wikidata's SPARQL endpoint, with robust error handling and graceful degradation.

This phase focuses on the core functionality: the client-side Wikidata call that determines the hero state. This is the source of truth and must work independently of the Worker.

---

## Acceptance Criteria

By the end of this phase:

1. ✅ Hero answer correctly shows `Not yet.` when Wikidata does NOT list Burnham as UK PM
2. ✅ Hero answer correctly shows `Yes.` when Wikidata DOES list Burnham as UK PM
3. ✅ Hero answer defaults to `Not yet.` if Wikidata call fails or times out
4. ✅ PM counter correctly shows 6 (Not yet) or 7 (Yes)
5. ✅ `?force=yes` query param correctly simulates YES state for testing
6. ✅ `?force=no` query param correctly simulates NOT YET state for testing
7. ✅ Wikidata call is made client-side (browser), not server-side
8. ✅ No CORS issues with the Wikidata endpoint

---

## Implementation Details

### SPARQL Query

The query fetches the current UK head of government (P6 property on Q145 entity) and returns labels in English:

```sparql
SELECT ?pmLabel WHERE {
  wd:Q145 wdt:P6 ?pm .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

### Client-Side Implementation

In `public/index.html`, the JavaScript should:

1. **Encode and send the query:**
```javascript
const WIKIDATA_QUERY = `
  SELECT ?pmLabel WHERE {
    wd:Q145 wdt:P6 ?pm .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }
`;

function encodeSPARQL(query) {
  return encodeURIComponent(query);
}

async function fetchWikidataAnswer() {
  const encodedQuery = encodeSPARQL(WIKIDATA_QUERY);
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodedQuery}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Wikidata HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    return parseWikidataResponse(data);
  } catch (error) {
    console.error('Wikidata fetch error:', error);
    // Default to Not yet on any error
    return false;
  }
}
```

2. **Parse the response:**
```javascript
function parseWikidataResponse(data) {
  // Extract all PM labels from the response
  const labels = data.results.bindings
    .map(binding => binding.pmLabel?.value)
    .filter(label => label && typeof label === 'string');
  
  // Check if any label contains "Burnham" (case-insensitive)
  return labels.some(label => 
    label.toLowerCase().includes('burnham')
  );
}
```

3. **Render the hero with correct styling:**
```javascript
function renderHero(isYes) {
  const heroSection = document.getElementById('hero');
  const pmCounterEl = document.getElementById('pm-counter');
  
  // Update PM counter
  const pmCount = isYes ? BASE_PM_COUNT + 1 : BASE_PM_COUNT;
  if (pmCounterEl) {
    pmCounterEl.textContent = `Prime Ministers since the 2016 referendum: ${pmCount} · this counter is load-bearing`;
  }
  
  // Render hero HTML
  if (isYes) {
    heroSection.innerHTML = `
      <div class="hero-question">Is Andy Burnham the Prime Minister?</div>
      <div class="hero-answer hero-answer-yes">
        Yes<span class="hero-period" style="color: var(--green)">.</span>
      </div>
      <div class="hero-subtitle">(finally. you may sit down.)</div>
      <div class="hero-status">Scoreboard last checked: just now · confirmed via Wikidata Q145 · P6</div>
    `;
  } else {
    heroSection.innerHTML = `
      <div class="hero-question">Is Andy Burnham the Prime Minister?</div>
      <div class="hero-answer hero-answer-not-yet">
        Not yet<span class="hero-period" style="color: var(--amber)">.</span>
      </div>
      <div class="hero-subtitle">(but ask again in a month)</div>
      <div class="hero-status">Scoreboard last checked: just now · the default answer is usually correct</div>
    `;
  }
}
```

4. **Handle query param for testing:**
```javascript
// Check for ?force=yes in URL
const urlParams = new URLSearchParams(window.location.search);
const FORCE_YES = urlParams.get('force') === 'yes';

async function init() {
  let isYes;
  
  if (FORCE_YES) {
    // For testing YES state
    isYes = true;
  } else {
    // Real Wikidata call
    isYes = await fetchWikidataAnswer();
  }
  
  renderHero(isYes);
  // Continue with rest of initialization...
}
```

---

## Error Handling

### Network Errors
- If fetch fails (network down, CORS blocked, etc.) → default to `Not yet.`
- Log error to console for debugging

### HTTP Errors
- If Wikidata returns non-200 status → default to `Not yet.`

### Parse Errors
- If response JSON is malformed → default to `Not yet.`

### Empty Response
- If no bindings returned → default to `Not yet.`

### Multiple Values
- Wikidata may return multiple values during transitions
- Any value containing "Burnham" triggers `Yes.`
- This handles the case where P6 has multiple entries

---

## Testing Checklist

### Wikidata Tests
- [x] Visit page without query params → shows "Not yet." (current reality)
- [x] Visit page with `?force=yes` → shows "Yes." with green styling
- [x] Visit page with `?force=no` → shows "Not yet." with amber styling
- [x] Disable network in DevTools → hero still renders "Not yet."
- [x] Check Network tab → verify SPARQL request to query.wikidata.org
- [x] Verify response parsing handles multiple bindings
- [x] Verify case-insensitive matching for "Burnham"

### PM Counter Tests
- [x] "Not yet." state → counter shows "6"
- [x] "Yes." state → counter shows "7"
- [x] Footer counter updates correctly with state change

### CORS Tests
- [x] Verify no CORS errors in console
- [x] Verify request succeeds from localhost:8787

---

## Verification Queries

To manually verify Wikidata data:

1. **Current UK PM:**
   ```
   https://query.wikidata.org/sparql?format=json&query=SELECT%20%3FpmLabel%20WHERE%20%7B%0A%20%20wd%3AQ145%20wdt%3AP6%20%3Fpm%20.%0A%20%20SERVICE%20wikibase%3Alabel%20%7B%20bd%3AserviceParam%20wikibase%3Alanguage%20%22en%22.%20%7D%0A%7D
   ```

2. **Test with Burnham (simulated):**
   The query should return labels, and we check if any contain "Burnham"

---

## Edge Cases to Handle

| Scenario | Behavior |
|----------|----------|
| Wikidata endpoint down | Default to "Not yet." |
| Network disconnected | Default to "Not yet." |
| CORS blocked | Default to "Not yet." |
| Empty response | Default to "Not yet." |
| Multiple PMs (transition) | "Yes." if any contains "Burnham" |
| Case variations (BURNHAM, burnham) | Case-insensitive match |
| Middle names (Andy Burnham, Andrew Burnham) | Substring match works |

---

## Dependencies for Next Phase

Phase 3 (Worker API) depends on:
- [x] Wikidata integration working correctly
- [x] Hero answer rendering independently
- [x] Error handling verified

---

## Notes

- The Wikidata call is intentionally client-side (browser) because:
  1. It's CORS-friendly (no API key needed)
  2. It doesn't require server resources
  3. It ensures the hero answer works even if the Worker fails
  4. It's the source of truth for the binary question

- The query is simple and fast (typically < 200ms)
- No rate limiting concerns for this endpoint
- The default to "Not yet." is correct 99.9% of the time anyway

---

## Completion Summary

**Completed:** 2026-06-24

All acceptance criteria met. Key deliverables:
- Wikidata SPARQL query with proper timeout/retry logic (10s timeout, 2 retries, 3s delay between retries)
- `?force=yes` and `?force=no` query parameters for testing
- 2-second minimum loading state for the entire page (hero + articles)
- Bug fixes: Added null checks for `b.pmLabel?.value` to handle missing bindings
- 20 random loading words with animated ellipsis
- All tests passing
