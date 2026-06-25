/**
 * tabs.js — OmniTender Homepage Tab Navigation
 * Organizes the long homepage into tabbed panels.
 * Injected via <script src="tabs.js"> in index.html.
 * Degrades gracefully: all content visible if JS disabled.
 */

(function () {
  'use strict';

  // Section IDs that belong to each tab panel
  const TAB_CONFIG = [
    {
      id: 'tab-how',
      label: 'How It Works',
      sections: ['payment-types', 'how-it-works', 'see-it-in-action']
    },
    {
      id: 'tab-pricing',
      label: 'Pricing & Savings',
      sections: ['fee-calculator', 'security-panel', 'settlement-preview']
    },
    {
      id: 'tab-demo',
      label: 'Why OmniTender',
      sections: ['why-omnitender', 'use-cases', 'operator-concerns']
    },
    {
      id: 'tab-contact',
      label: 'Get Started',
      sections: ['final-cta', 'signup-card']
    }
  ];

  // Map section IDs to their parent elements
  function getSectionEl(id) {
    // Try direct ID
    let el = document.getElementById(id);
    if (el) return el;
    // Try class-based
    el = document.querySelector('[class*="' + id + '"]');
    if (el) return el;
    return null;
  }

  // Find a section's wrapping element (climb up to a direct child of main)
  function getWrapperEl(sectionId) {
    const inner = document.getElementById(sectionId);
    if (!inner) return null;
    const main = document.getElementById('main');
    if (!main) return inner;
    let el = inner;
    while (el && el.parentElement && el.parentElement !== main) {
      el = el.parentElement;
    }
    return el;
  }

  // Build tab nav HTML
  function buildTabNav() {
    const nav = document.createElement('nav');
    nav.className = 'tab-nav';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Homepage sections');
    TAB_CONFIG.forEach(function (tab, i) {
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (i === 0 ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      btn.setAttribute('aria-controls', tab.id);
      btn.setAttribute('data-tab', tab.id);
      btn.textContent = tab.label;
      btn.addEventListener('click', function () { showTab(tab.id); });
      nav.appendChild(btn);
    });
    return nav;
  }

  // Build quick-action tiles
  function buildQuickActions() {
    const wrap = document.createElement('div');
    wrap.className = 'quick-actions';
    wrap.setAttribute('role', 'navigation');
    wrap.setAttribute('aria-label', 'Quick actions');
    const tiles = [
      { label: '📊 Free Rate Analysis', href: 'savings.html' },
      { label: '⚡ How It Works', tab: 'tab-how' },
      { label: '💰 Fee Calculator', tab: 'tab-pricing' },
      { label: '🖥️ See It Live', tab: 'tab-demo' },
      { label: '🚀 Apply Now', href: 'apply.html' }
    ];
    tiles.forEach(function (tile) {
      let el;
      if (tile.href) {
        el = document.createElement('a');
        el.href = tile.href;
      } else {
        el = document.createElement('button');
        el.type = 'button';
        el.addEventListener('click', function () { showTab(tile.tab); });
      }
      el.className = 'quick-tile';
      el.textContent = tile.label;
      wrap.appendChild(el);
    });
    return wrap;
  }

  // Build tab panel wrappers
  function buildPanels() {
    const main = document.getElementById('main');
    if (!main) return;
    // Collect all sections and their wrappers for each tab
    TAB_CONFIG.forEach(function (tab, i) {
      const panel = document.createElement('div');
      panel.id = tab.id;
      panel.className = 'tab-panel' + (i === 0 ? ' active' : '');
      panel.setAttribute('role', 'tabpanel');
      // Move relevant sections into this panel
      const sectionEls = [];
      tab.sections.forEach(function (secId) {
        const el = document.getElementById(secId);
        if (el) {
          // Find the direct child of main
          let wrapper = el;
          while (wrapper && wrapper.parentElement && wrapper.parentElement !== main) {
            wrapper = wrapper.parentElement;
          }
          if (wrapper && wrapper.parentElement === main) {
            sectionEls.push(wrapper);
          } else {
            sectionEls.push(el);
          }
        }
      });
      if (sectionEls.length > 0) {
        // Insert panel before the first section
        main.insertBefore(panel, sectionEls[0]);
        sectionEls.forEach(function (el) {
          panel.appendChild(el);
        });
      }
    });
  }

  // Show a tab and hide others
  window.showTab = function (tabId) {
    // Update panel visibility
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      if (panel.id === tabId) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });
    // Update button states
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      const isActive = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    // Scroll to tab nav
    const nav = document.querySelector('.tab-nav');
    if (nav) {
      nav.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  // Initialize on DOMContentLoaded
  function init() {
    const main = document.getElementById('main');
    if (!main) return;
    // First check if there are section IDs we know about
    const knownSections = TAB_CONFIG.flatMap(function (t) { return t.sections; });
    const hasSections = knownSections.some(function (id) { return document.getElementById(id); });
    if (!hasSections) {
      console.warn('[tabs.js] No known section IDs found — tab nav not injected.');
      return;
    }
    // Find the hero element (first child of main)
    const hero = main.querySelector('.hero') || main.firstElementChild;
    // Build panels first (reorganizes DOM)
    buildPanels();
    // Build quick-action tiles
    const quickActions = buildQuickActions();
    // Build tab nav
    const tabNav = buildTabNav();
    // Find where to insert (after hero/trust-bar)
    const trustBar = main.querySelector('.trust-bar') || main.querySelector('[role="region"]');
    const insertAfter = trustBar || hero;
    if (insertAfter && insertAfter.nextSibling) {
      main.insertBefore(quickActions, insertAfter.nextSibling);
      main.insertBefore(tabNav, quickActions.nextSibling);
    } else {
      main.insertBefore(tabNav, main.querySelector('.tab-panel'));
      main.insertBefore(quickActions, tabNav);
    }
    console.log('[tabs.js] Tab navigation initialized.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
