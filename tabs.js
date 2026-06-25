/**
 * tabs.js — OmniTender Homepage Tab Navigation
 * Organizes the long homepage into tabbed panels.
 * Works by DOM index on direct children of #main.
 * Graceful degradation: all content visible if JS disabled.
 * Updated to match actual index.html structure.
 */

(function () {
  'use strict';

  // DOM indexes (0-based) of #main direct children for each tab
  // Index 0 = .hero, 1 = .trust-bar, 2 = .fine (always shown)
  // Tab 1 (How It Works): payment-types + cards + how-it-works + steps + use-cases sections
  // Tab 2 (See It Live): see-it-in-action + product-preview-grid + testimonials + deposit-mock + security-banner
  // Tab 3 (Pricing):     fee-calculator + narrative-block
  // Tab 4 (Get Started): signup-card container
  const TAB_GROUPS = [
    { id: 'tab-how',      label: 'How It Works',       indexes: [3, 4, 5, 6, 7, 8, 9, 10] },
    { id: 'tab-demo',     label: 'See It Live',         indexes: [11, 12, 13, 14, 15, 16] },
    { id: 'tab-pricing',  label: 'Pricing & Savings',   indexes: [17, 18] },
    { id: 'tab-contact',  label: 'Get Started',         indexes: [19, 20] }
  ];

  var panels = [];
  var tabBtns = [];

  function buildQuickActions(main, insertBefore) {
    var wrap = document.createElement('div');
    wrap.className = 'quick-actions';
    wrap.setAttribute('role', 'navigation');
    wrap.setAttribute('aria-label', 'Quick actions');
    var tiles = [
      { label: '📊 Free Rate Analysis', href: 'savings.html' },
      { label: '⚡ How It Works',              tab: 'tab-how' },
      { label: '💰 Fee Calculator',        tab: 'tab-pricing' },
      { label: '🖥️ See It Live',     tab: 'tab-demo' },
      { label: '🚀 Apply Now',             href: 'apply.html' }
    ];
    tiles.forEach(function (t) {
      var el;
      if (t.href) {
        el = document.createElement('a');
        el.href = t.href;
      } else {
        el = document.createElement('button');
        el.type = 'button';
        (function (tid) {
          el.addEventListener('click', function () { showTab(tid); });
        }(t.tab));
      }
      el.className = 'quick-tile';
      el.textContent = t.label;
      wrap.appendChild(el);
    });
    main.insertBefore(wrap, insertBefore);
    return wrap;
  }

  function buildTabNav(main, insertBefore) {
    var nav = document.createElement('nav');
    nav.className = 'tab-nav';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Homepage sections');
    TAB_GROUPS.forEach(function (tab, i) {
      var btn = document.createElement('button');
      btn.className = 'tab-btn' + (i === 0 ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      btn.setAttribute('aria-controls', tab.id);
      btn.setAttribute('data-tab', tab.id);
      btn.textContent = tab.label;
      (function (tid) {
        btn.addEventListener('click', function () { showTab(tid); });
      }(tab.id));
      nav.appendChild(btn);
      tabBtns.push(btn);
    });
    main.insertBefore(nav, insertBefore);
    return nav;
  }

  function buildPanels(mainChildren) {
    var main = document.getElementById('main');
    TAB_GROUPS.forEach(function (tab, i) {
      var panel = document.createElement('div');
      panel.id = tab.id;
      panel.className = 'tab-panel' + (i === 0 ? ' active' : '');
      panel.setAttribute('role', 'tabpanel');
      panels.push(panel);
      // Find first section to insert panel before
      var firstEl = mainChildren[tab.indexes[0]];
      if (firstEl) {
        main.insertBefore(panel, firstEl);
      } else {
        main.appendChild(panel);
      }
      // Move sections into panel
      tab.indexes.forEach(function (idx) {
        var el = mainChildren[idx];
        if (el) { panel.appendChild(el); }
      });
    });
  }

  // Public: show a specific tab
  window.showTab = function (tabId) {
    panels.forEach(function (p) {
      if (p.id === tabId) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });
    tabBtns.forEach(function (btn) {
      var isActive = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    var nav = document.querySelector('.tab-nav');
    if (nav) { nav.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    // Update URL hash for shareability
    if (history && history.replaceState) {
      history.replaceState(null, '', '#' + tabId);
    }
  };

  function init() {
    var main = document.getElementById('main');
    if (!main) return;
    // Snapshot direct children BEFORE we start moving them
    var mainChildren = Array.from(main.children);
    if (mainChildren.length < 4) {
      console.warn('[tabs.js] Unexpected DOM — skipping tab init.');
      return;
    }
    // Build panels (this moves children into panels)
    buildPanels(mainChildren);
    // Insert quick-action tiles and tab nav after trust-bar (index 1)
    // The trust-bar is now still a direct child of main
    var trustBar = main.querySelector('.trust-bar') || main.querySelector('.fine') || main.firstElementChild;
    var firstPanel = main.querySelector('.tab-panel');
    buildQuickActions(main, firstPanel);
    buildTabNav(main, firstPanel);
    // Check URL hash on load
    var hash = window.location.hash.replace('#', '');
    if (hash && document.getElementById(hash) && document.getElementById(hash).classList.contains('tab-panel')) {
      showTab(hash);
    }
    console.log('[tabs.js] Tabs initialized with ' + TAB_GROUPS.length + ' tabs.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
