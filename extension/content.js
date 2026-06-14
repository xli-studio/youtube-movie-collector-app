(function () {
  'use strict';

  const SERVER = 'http://localhost:3457';

  let btn = null;
  let currentPlaylistId = null;
  let pollTimer = null;

  // ── Styles ─────────────────────────────────────────────────────────────────

  const BASE_STYLE = {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '2147483647',
    padding: '12px 18px',
    border: 'none',
    borderRadius: '10px',
    fontSize: '13px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
    transition: 'opacity 0.15s, transform 0.15s, background 0.2s',
    lineHeight: '1.5',
    maxWidth: '260px',
    textAlign: 'center',
    whiteSpace: 'pre-line',
    color: '#ffffff',
  };

  const COLORS = {
    idle:     '#1a1a2e',
    working:  '#16213e',
    done:     '#0d7377',
    error:    '#7d2828',
  };

  function applyStyle(el, extra) {
    Object.assign(el.style, BASE_STYLE, extra || {});
  }

  // ── Button management ──────────────────────────────────────────────────────

  function ensureButton() {
    if (btn && document.body.contains(btn)) return;
    btn = document.createElement('button');
    applyStyle(btn, { background: COLORS.idle });

    btn.addEventListener('mouseenter', () => {
      btn.style.opacity = '0.88';
      btn.style.transform = 'translateY(-2px)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.opacity = '1';
      btn.style.transform = 'none';
    });

    document.body.appendChild(btn);
  }

  function setState(label, color, clickHandler, disabled) {
    ensureButton();
    btn.textContent = label;
    btn.style.background = color;
    btn.style.display = 'block';
    btn.disabled = !!disabled;
    btn.onclick = clickHandler || null;
  }

  function showIdle() {
    stopPolling();
    setState('📽️ Collect this playlist', COLORS.idle, startCollect, false);
  }

  function showStarting() {
    setState('⏳ Starting…', COLORS.working, null, true);
  }

  function showProgress(processed, total) {
    const pct = total > 0 ? ` ${Math.round((processed / total) * 100)}%` : '';
    setState(`⏳ Processing… (${processed}/${total || '?'})${pct}`, COLORS.working, null, true);
  }

  function showDone(confirmed, pendingReview) {
    const reviewLine = pendingReview > 0 ? `\n${pendingReview} need review` : '';
    setState(`✓ Found ${confirmed} movies${reviewLine}`, COLORS.done, openDashboard, false);
  }

  function showError(message) {
    setState(`❌ ${message}\nClick to retry`, COLORS.error, startCollect, false);
  }

  function hideButton() {
    if (btn) btn.style.display = 'none';
  }

  // ── Core logic ─────────────────────────────────────────────────────────────

  function openDashboard() {
    window.open(SERVER, '_blank');
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function startCollect() {
    showStarting();

    let jobId;
    try {
      const res = await fetch(`${SERVER}/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId: currentPlaylistId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${res.status}`);
      }

      ({ jobId } = await res.json());
    } catch (e) {
      const msg = e.message.includes('fetch') ? 'Server not running' : e.message;
      showError(msg);
      return;
    }

    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${SERVER}/status/${jobId}`);
        const job = await res.json();

        showProgress(job.processed, job.total);

        if (job.status === 'done') {
          stopPolling();
          showDone(job.confirmed, job.pending_review);
        } else if (job.status === 'error') {
          stopPolling();
          showError(job.error || 'Processing failed');
        }
      } catch {
        // Transient network hiccup — keep polling
      }
    }, 2000);
  }

  // ── YouTube SPA navigation ─────────────────────────────────────────────────

  function onNavigate() {
    const params = new URLSearchParams(window.location.search);
    const playlistId = params.get('list');

    if (!playlistId) {
      hideButton();
      stopPolling();
      currentPlaylistId = null;
      return;
    }

    if (playlistId !== currentPlaylistId) {
      // Navigated to a new playlist — reset to idle
      currentPlaylistId = playlistId;
      showIdle();
    } else if (btn) {
      // Same playlist — just keep button visible
      btn.style.display = 'block';
    }
  }

  // YouTube fires this on SPA navigation
  document.addEventListener('yt-navigate-finish', onNavigate);

  // Fallback URL watcher for edge cases
  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onNavigate();
    }
  }).observe(document.documentElement, { subtree: true, childList: true });

  // Run on initial page load
  onNavigate();
})();
