// ABOUT: Front-end application script for the Andy Burnham PM tracker page.
// ABOUT: Renders the hero answer, odds desk, and curated press panel.
    // ========================================
    // Configuration
    // ========================================
    const BASE_PM_COUNT = 6;
    // Andy Burnham is Prime Minister. The question is settled, so the answer is
    // a fixed "Yes" — there is no live check; the verdict is a constant.
    // To reverse it, flip this constant AND update the static defaults baked
    // into index.html (hero answer text, period colour, PM count, footer
    // status), which give scriptless and first-paint visitors the same answer.
    const DEFAULT_ANSWER_YES = true;

    // ========================================
    // State Management
    // ========================================
    const states = {
      LOADING: 'loading',
      NOT_YET: 'not_yet',
      YES: 'yes',
      JUDGE_FAILED: 'judge_failed',
      OFFLINE: 'offline'
    };

    let currentState = states.LOADING;
    let pmCount = BASE_PM_COUNT;

    // ========================================
    // Canned Fallback Trio (from handoff)
    // ========================================
    const CANNED_TRIO = [
      {
        outlet: 'The Daily Broadsheet',
        date: '21 Jun',
        title: 'Inside Burnham\'s anorak: what the zip tells us about the soul of Labour',
        verdict: 'fixating',
        caption: 'the coat'
      },
      {
        outlet: 'Westminster Lobby Wire',
        date: '20 Jun',
        title: 'Mood in the tearoom \'fizzy\', says man who was not in the tearoom',
        verdict: 'fixating',
        caption: 'one source\'s choice of adjective'
      },
      {
        outlet: 'The Northern Question',
        date: '19 Jun',
        title: 'Could the 07:42 tram to Altrincham hold the key to Number 10?',
        verdict: 'fixating',
        caption: 'a tram timetable'
      }
    ];

    // ========================================
    // Utility Functions
    // ========================================
    function formatDate(date) {
      const options = {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      };
      return date.toLocaleDateString('en-GB', options);
    }

    // ========================================
    // Data Fetching
    // ========================================
    // Worker API timeout. On a cold cache the Worker runs the full pipeline
    // synchronously: Perplexity retrieval (~15s) → Claude judge → full-text
    // fetch of the selected articles → a second Claude pass to refine verdicts.
    // That can approach ~30s, so the client waits up to 30s before falling back
    // to the canned trio. Warm cache hits return near-instantly, and the cron
    // keeps the cache warm in production, so the long wait is a rare cold-start
    // case rather than the norm.
    const COMMENTARY_TIMEOUT = 30000; // 30 seconds timeout for Worker API
    const MIN_LOADING_TIME = 2000; // Minimum 2 seconds of loading state

    async function fetchCommentary() {
      let timeoutId = null;
      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), COMMENTARY_TIMEOUT);
        
        const response = await fetch('/api/commentary', { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('Commentary API error:', error);
        return null;
      }
    }

    // ========================================
    // Render Functions
    // ========================================
    function getVerdictLabel(verdict) {
      switch(verdict) {
        case 'fixating':
        case 'fixating-on':
          return 'Fixating on:';
        case 'probing':
          return 'Probing';
        case 'noting':
          return 'Noted';
        default:
          return 'Noted';
      }
    }

    function renderHero(isYes, isForced = false) {
      const heroAnswerEl = document.getElementById('hero-answer');
      const heroAnswerTextEl = document.getElementById('hero-answer-text');
      const heroPeriodEl = document.getElementById('hero-period');
      const heroSubtitleEl = document.getElementById('hero-subtitle');
      const heroStatusEl = document.getElementById('hero-status');

      if (isYes) {
        pmCount = BASE_PM_COUNT + 1;
        heroAnswerTextEl.textContent = 'Yes';
        heroPeriodEl.textContent = '.';
        heroPeriodEl.style.color = 'var(--green)';
        heroSubtitleEl.textContent = '(finally. you may sit down.)';
        heroStatusEl.textContent = formatScoreboardStatus(true, isForced);
        currentState = states.YES;
      } else {
        pmCount = BASE_PM_COUNT;
        heroAnswerTextEl.textContent = 'Not yet';
        heroPeriodEl.textContent = '.';
        heroPeriodEl.style.color = 'var(--amber)';
        heroSubtitleEl.textContent = '(but ask again in a month)';
        heroStatusEl.textContent = formatScoreboardStatus(false, isForced);
        currentState = states.NOT_YET;
      }

      updatePMCount();
      updateFooterStatus();
    }

    function formatScoreboardStatus(isYes, isForced = false) {
      if (isForced) {
        return isYes
          ? 'Scoreboard overridden: YES (forced via query param)'
          : 'Scoreboard overridden: NOT YET (forced via query param)';
      }
      // The non-forced "Not yet" line is unreachable while DEFAULT_ANSWER_YES
      // is true (the only route to "Not yet" is ?force=no, which sets isForced).
      // Retained for the DEFAULT_ANSWER_YES flip — do not prune as dead code.
      return isYes
        ? 'Scoreboard settled · he is behind the famous door · a matter of record (Wikidata Q145 · P6)'
        : 'Scoreboard status: the default answer is usually correct';
    }

    function updatePMCount() {
      const pmCountEl = document.getElementById('pm-count');
      if (pmCountEl) {
        pmCountEl.textContent = pmCount;
      }
    }

    function updateFooterStatus() {
      const footerStatusEl = document.getElementById('footer-status');
      if (footerStatusEl) {
        footerStatusEl.textContent = currentState === states.LOADING
          ? 'Scoreboard checking…'
          : 'Scoreboard settled';
      }
    }

    function renderOddsDesk(data, captionOverride = null) {
      const percentageEl = document.getElementById('odds-percentage');
      const captionEl = document.getElementById('odds-caption');
      const barEl = document.getElementById('odds-bar');

      if (!data || data.probability_pct === null || data.probability_pct === undefined) {
        percentageEl.textContent = '—%';
        percentageEl.classList.add('odds-placeholder');
        captionEl.textContent = captionOverride || '…still being totted up by the desk.';
        captionEl.classList.add('odds-placeholder');
        barEl.className = 'odds-bar loading-bar';
        barEl.innerHTML = '';
        return;
      }

      const probability = Math.min(100, Math.max(0, Math.round(data.probability_pct)));
      const caption = data.one_line || '…that he\'s behind the famous door by September.';

      percentageEl.textContent = probability + '%';
      percentageEl.classList.remove('odds-placeholder');
      
      captionEl.textContent = caption;
      captionEl.classList.remove('odds-placeholder');

      barEl.className = 'odds-bar';
      const barColor = probability > 0 ? (probability === 100 ? 'green' : 'amber') : '';
      barEl.innerHTML = `<div class="odds-bar-fill ${barColor}" style="width: ${probability}%"></div>`;
    }

    // Build an article card from DOM nodes, assigning every untrusted field
    // via textContent so values from the Perplexity pool (outlet/title/date)
    // and Claude (caption) can never be parsed as HTML. verdict is validated
    // server-side against an allowlist, so it is safe in the class name.
    function createArticleCard(article) {
      const verdict = article.verdict || 'noting';

      const card = document.createElement('article');
      card.className = `article-card ${verdict}`;

      const meta = document.createElement('div');
      meta.className = 'article-meta';

      const outlet = document.createElement('span');
      outlet.className = 'article-outlet';
      outlet.textContent = article.outlet || 'Unknown';

      const date = document.createElement('span');
      date.className = 'article-date';
      date.textContent = article.date || '';

      meta.append(outlet, date);

      const title = document.createElement('h3');
      title.className = 'article-title';
      const titleText = article.title || 'Untitled';
      // Link the headline to its source when the URL is a safe http(s) URL.
      // The URL comes from the Perplexity pool (untrusted), so reject anything
      // that isn't http/https (e.g. a javascript: URL) and fall back to plain
      // text. The visible text is always set via textContent.
      if (article.url && /^https?:\/\//i.test(article.url)) {
        const link = document.createElement('a');
        link.href = article.url;
        link.textContent = titleText;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        title.appendChild(link);
      } else {
        title.textContent = titleText;
      }

      const verdictWrap = document.createElement('span');
      verdictWrap.className = 'article-verdict';

      const label = document.createElement('span');
      label.className = `verdict-label verdict-${verdict}`;
      label.textContent = getVerdictLabel(verdict);

      const caption = document.createElement('span');
      caption.className = 'verdict-caption';
      caption.textContent = article.caption || '';

      verdictWrap.append(label, caption);

      card.append(meta, title, verdictWrap);
      return card;
    }

    function renderArticles(articles) {
      const articlesEl = document.getElementById('articles');
      const archiveBadgeEl = document.getElementById('archive-badge');

      // Clear existing
      articlesEl.replaceChildren();
      if (archiveBadgeEl) archiveBadgeEl.textContent = '';

      if (!articles || articles.length === 0) {
        renderCannedTrio();
        return;
      }

      articles.forEach(article => {
        articlesEl.appendChild(createArticleCard(article));
      });

      // Apply jitter animation to fixating cards
      document.querySelectorAll('.article-card.fixating, .article-card.fixating-on').forEach(card => {
        card.classList.add('fixating');
      });
    }

    function renderCannedTrio() {
      const articlesEl = document.getElementById('articles');
      const archiveBadgeEl = document.getElementById('archive-badge');

      // Clear existing content
      articlesEl.replaceChildren();

      if (archiveBadgeEl) {
        archiveBadgeEl.textContent = 'From the archive';
      }

      CANNED_TRIO.forEach(article => {
        articlesEl.appendChild(createArticleCard(article));
      });

      // Apply jitter animation
      document.querySelectorAll('.article-card.fixating').forEach((card, index) => {
        card.classList.add('fixating');
        if (index === 1) card.style.animationDelay = '0.2s';
        if (index === 2) card.style.animationDelay = '0.4s';
      });
    }

    function renderJudgeFailed(data) {
      const articlesEl = document.getElementById('articles');
      const archiveBadgeEl = document.getElementById('archive-badge');

      // Clear existing content
      articlesEl.replaceChildren();

      if (archiveBadgeEl) archiveBadgeEl.textContent = '';

      if (!data || !data.articles || data.articles.length === 0) {
        renderCannedTrio();
        return;
      }

      const article = data.articles[0];
      articlesEl.appendChild(createArticleCard({
        ...article,
        verdict: article.verdict || 'noting',
        caption: article.caption || 'a recent update on the question',
      }));
    }

    // ========================================
    // Dynamic Date in Masthead
    // ========================================
    function updateMastheadDate() {
      const dateEl = document.getElementById('masthead-date');
      if (dateEl) {
        dateEl.textContent = formatDate(new Date());
      }
    }

    // ========================================
    // Main Initialization
    // ========================================
    async function init() {
      const startTime = Date.now();
      
      async function ensureMinLoadingTime() {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, MIN_LOADING_TIME - elapsed);
        if (remaining > 0) {
          await new Promise(resolve => setTimeout(resolve, remaining));
        }
      }

      try {
        // Set up dynamic elements
        updateMastheadDate();

        // Check for forced YES state
        const urlParams = new URLSearchParams(window.location.search);
        const forceYes = urlParams.get('force') === 'yes';

        // Check for forced NO state
        const forceNo = urlParams.get('force') === 'no';

        // Check for judge fallback simulation
        const simulateJudgeFail = urlParams.get('simulate') === 'judge-fail';

        // Check for offline simulation
        const simulateOffline = urlParams.get('simulate') === 'offline';

        // Determine hero answer
        let isYes;
        let isForced = false;

        if (forceYes) {
          isYes = true;
          isForced = true;
        } else if (forceNo) {
          isYes = false;
          isForced = true;
        } else {
          // No live check — the answer is settled. Default to "Yes".
          isYes = DEFAULT_ANSWER_YES;
        }

        // The headline answer is a settled fact, not a live lookup, so paint it
        // immediately rather than blanking it behind the loading delay. Only the
        // odds desk and press panel below — which genuinely load from the
        // Worker — keep the loading treatment.
        renderHero(isYes, isForced);

        // Fetch commentary data
        let commentary = null;
        if (!simulateOffline && !simulateJudgeFail) {
          commentary = await fetchCommentary();
        }

        // Ensure minimum loading time before rendering the commentary sections,
        // so a fast cache hit doesn't flash past before the eye can catch it.
        await ensureMinLoadingTime();

        // Determine state and render commentary
        if (simulateOffline) {
          // Offline state - show canned trio
          renderOddsDesk(null, '…the desk is out. The verdict above stands regardless.');
          renderCannedTrio();
          currentState = states.OFFLINE;
        } else if (simulateJudgeFail) {
          // Judge failed state - show single noting card with mock data
          renderOddsDesk({ probability_pct: 24, one_line: '...that he\'s behind the famous door by September.' });
          renderJudgeFailed({
            articles: [{
              outlet: 'Westminster Lobby Wire',
              date: '20 Jun',
              title: 'Burnham addresses party members at constituency event',
              verdict: 'noting',
              caption: 'a recent update on the question'
            }]
          });
          currentState = states.JUDGE_FAILED;
        } else {
          // Normal operation
          if (commentary) {
            if (commentary.articles && commentary.articles.length > 0) {
              renderOddsDesk(commentary);
              renderArticles(commentary.articles);
            } else {
              // Empty pool
              renderOddsDesk(commentary);
              renderCannedTrio();
            }
          } else {
            // API unreachable
            renderOddsDesk(null, '…the desk is out. The verdict above stands regardless.');
            renderCannedTrio();
            currentState = states.OFFLINE;
          }
        }
      } catch (error) {
        console.error('Initialization error:', error);
        // Ensure minimum loading time even on error
        await ensureMinLoadingTime();
      } finally {
        // Always remove loading state, even on error
        document.body.classList.remove('loading');
      }
    }

    // ========================================
    // Initialize on DOM load
    // ========================================
    // Bootstrap only in the browser, where the page markup is present.
    // The guard keeps the module importable by tests without side effects.
    if (typeof document !== 'undefined' && document.getElementById('hero-answer')) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    }
  
// Exported for unit testing (see test/render.test.js). The browser loads this
// module via <script type="module"> and self-bootstraps above.
export { createArticleCard, getVerdictLabel, renderHero, formatScoreboardStatus };
