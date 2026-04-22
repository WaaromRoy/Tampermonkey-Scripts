(function () {
  "use strict";

  const SELECTORS = [
    'now-uxf-page-simple-container#item-right',
    'now-uxf-page-simple-container[id="item-right"]',
    'now-uxf-page-simple-container[component-id$="-right"]',
    'now-uxf-page-simple-container[now-id$="-right"]',
    '[id^="container-"][id$="-right"]',
    // your inner viewports (if you prefer to remove just these):
    '#item-viewport_usi', '#item-viewport_dbh', '#item-viewport_eil'
  ];

  // Remove or hard-hide a node
  function obliterate(node) {
    try { node.remove(); }
    catch {
      node.style.setProperty('display', 'none', 'important');
      node.style.setProperty('visibility', 'hidden', 'important');
      node.style.setProperty('width', '0', 'important');
      node.style.setProperty('min-width', '0', 'important');
      node.style.setProperty('max-width', '0', 'important');
      node.style.setProperty('flex', '0 0 0', 'important');
      node.style.setProperty('padding', '0', 'important');
      node.style.setProperty('margin', '0', 'important');
    }
  }

  // Search a root (document or shadowRoot)
  function sweep(root) {
    try {
      root.querySelectorAll?.(SELECTORS.join(',')).forEach(obliterate);
    } catch {}
  }

  // Observe a root for changes and recurse into new shadow roots
  function observeRoot(root) {
    // Initial pass
    sweep(root);

    // Recurse into existing open shadow roots
    if (root.querySelectorAll) {
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) hookShadow(el.shadowRoot);
      });
    }

    // Mutation observer
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') {
          // New nodes: scan + dive into shadows
          m.addedNodes.forEach(n => {
            if (n.nodeType !== 1) return;
            sweep(n);
            if (n.shadowRoot) hookShadow(n.shadowRoot);
            // Also check descendants quickly
            n.querySelectorAll?.('*').forEach(d => {
              if (d.shadowRoot) hookShadow(d.shadowRoot);
            });
          });
        } else if (m.type === 'attributes') {
          const el = m.target;
          try {
            if (SELECTORS.some(sel => el.matches?.(sel))) obliterate(el);
          } catch {}
        }
      }
    });

    mo.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id', 'component-id', 'now-id', 'class', 'style']
    });
  }

  // Attach observer to a shadow root (once)
  function hookShadow(shadowRoot) {
    if (!shadowRoot || shadowRoot.__tm_hooked) return;
    shadowRoot.__tm_hooked = true;
    observeRoot(shadowRoot);
  }

  // Kick off: main document
  observeRoot(document);

  // Early boot sweeps (helps during SPA init)
  let ticks = 0;
  const boot = setInterval(() => {
    sweep(document);
    // Dive into any newly attached open shadow roots
    document.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) hookShadow(el.shadowRoot);
    });
    if (++ticks > 200) clearInterval(boot); // ~10s
  }, 50);
})();
