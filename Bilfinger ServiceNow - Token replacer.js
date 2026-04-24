
(function () {
    'use strict';

    const DEBUG = false;
    const PREFIX = '[Token Replacer]';
    const debounceMap = new WeakMap();

    const EXPLICIT_TOKENS = {
        /*ALL*/
        'first name': [ // Get the first name of "affected person" (INC) / "requested for" (requested for) depending on ticket type. 
            'input[name="first_name_input"]',
            'input[name="first_name"]',
            'input[aria-label="First name. This field supports 100 or fewer characters.""]'
        ],
        'assignment group': [
            'input[name="assigned_to_input"]',
            'input[name="assigned_to"]',
            'input[aria-label="Assigned to"]'
        ],
        'assigned to': [
            'input[name="assigned_to_input"]',
            'input[name="assigned_to"]',
            'input[aria-label="Assigned to"]'
        ],
        /*INC*/
        'affected person': [
            'input[name="caller_id_input"]',
            'input[name="caller_id"]',
            'input[aria-label="Affected person"]'
        ],
        'caller': [
            'input[name="u_caller_input"]',
            'input[name="u_caller"]',
            'input[aria-label="Caller"]'
        ],
        /*RITM / SCTASK*/
        'requested for': [
            'input[name="requested_for_input"]',
            'input[name="requested_for"]',
            'input[aria-label="Requested for"]'
        ],
    };

    const BLOCKED_TOKENS = new Set([
        'code','/code'
    ]);

    function log(...args) {
        if (DEBUG) console.log(PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(PREFIX, ...args);
    }

    function normalizeText(text) {
        return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function safeMatches(node, selector) {
        try {
            return !!(node && node.matches && node.matches(selector));
        } catch {
            return false;
        }
    }

    function isEditable(el) {
        if (!el || !(el instanceof Element)) return false;
        if (el.disabled || el.readOnly) return false;

        return (
            safeMatches(el, 'textarea') ||
            safeMatches(el, 'input[type="text"]') ||
            safeMatches(el, 'input:not([type])') ||
            el.isContentEditable
        );
    }

    function getEditableFromEvent(event) {
        const path = event.composedPath ? event.composedPath() : [event.target];
        return path.find(node => node instanceof Element && isEditable(node)) || null;
    }

    function getText(el) {
        if (!el) return '';
        if ('value' in el && typeof el.value === 'string') return el.value;
        if (el.isContentEditable) return el.innerText || '';
        return '';
    }

    function setText(el, value) {
        if ('value' in el && typeof el.value === 'string') {
            const proto = Object.getPrototypeOf(el);
            const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
            if (descriptor?.set) {
                descriptor.set.call(el, value);
            } else {
                el.value = value;
            }
        } else if (el.isContentEditable) {
            el.innerText = value;
        }
    }

    function fireInputEvents(el) {
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    function getValueFromElement(el) {
        if (!el) return '';

        if (typeof el.value === 'string' && el.value.trim()) {
            return el.value.trim();
        }

        const attrs = [
            'value',
            'display-value',
            'displayvalue',
            'display_value',
            'aria-label',
            'aria-description',
            'title',
            'data-value',
            'data-display-value',
            'label'
        ];

        for (const attr of attrs) {
            const val = el.getAttribute?.(attr);
            if (val && val.trim()) return val.trim();
        }

        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return text || '';
    }

    function scoreCandidateValue(value, labelText) {
        const raw = (value || '').replace(/\s+/g, ' ').trim();
        const wanted = normalizeText(labelText);

        if (!raw) return -1;
        if (normalizeText(raw) === wanted) return -1;
        if (/^(true|false|null|undefined)$/i.test(raw)) return -1;

        let score = raw.length;
        if (/\s/.test(raw)) score += 5;
        return score;
    }

    function queryAllDeep(selector, root) {
        const results = [];
        const seen = new Set();

        function walk(currentRoot) {
            if (!currentRoot || seen.has(currentRoot)) return;
            seen.add(currentRoot);

            if (!currentRoot.querySelectorAll) return;

            try {
                results.push(...currentRoot.querySelectorAll(selector));
            } catch {}

            let all = [];
            try {
                all = currentRoot.querySelectorAll('*');
            } catch {}

            for (const el of all) {
                if (el.shadowRoot) walk(el.shadowRoot);
            }
        }

        walk(root);
        return [...new Set(results)];
    }

    function queryFirstDeep(selector, root) {
        const results = queryAllDeep(selector, root);
        return results.length ? results[0] : null;
    }

    function getLocalRoots(startEl) {
        const roots = [];
        const seen = new Set();

        let current = startEl;
        while (current) {
            const rootNode = current.getRootNode?.();
            if (rootNode && !seen.has(rootNode)) {
                seen.add(rootNode);
                roots.push(rootNode);
            }

            if (current instanceof ShadowRoot) {
                current = current.host || null;
            } else {
                current = current.parentNode || current.host || null;
            }
        }

        if (!seen.has(document)) {
            roots.push(document);
        }

        return roots;
    }

    function getValueBySelectors(selectors, searchRoots) {
        for (const root of searchRoots) {
            for (const selector of selectors) {
                const el = queryFirstDeep(selector, root);
                if (el) {
                    const value = getValueFromElement(el);
                    if (value) {
                        log('Resolved via selector', selector, '=>', value);
                        return value;
                    }
                }
            }
        }
        return '';
    }

    function makeNameBasedSelectors(tokenName) {
        const normalized = normalizeText(tokenName)
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');

        return [
            `input[name="${normalized}_input"]`,
            `input[name="${normalized}"]`,
            `textarea[name="${normalized}"]`,
            `select[name="${normalized}"]`,
            `input[aria-label="${tokenName}"]`,
            `textarea[aria-label="${tokenName}"]`,
            `button[aria-label="${tokenName}"]`,
            `[label="${tokenName}"]`,
            `[data-field-name="${normalized}"] input`,
            `[data-field-name="${normalized}"] textarea`,
            `[data-field="${normalized}"] input`,
            `[data-field="${normalized}"] textarea`,
            `[field-name="${normalized}"] input`,
            `[field-name="${normalized}"] textarea`,
            `[sn-field-name="${normalized}"] input`,
            `[sn-field-name="${normalized}"] textarea`
        ];
    }

    function findValueNearLabel(labelText, searchRoots) {
        const wanted = normalizeText(labelText);

        for (const root of searchRoots) {
            const nodes = queryAllDeep('label, [label], [aria-label], span, div, p, dt', root);

            for (const node of nodes) {
                const label = normalizeText(
                    node.getAttribute?.('label') ||
                    node.getAttribute?.('aria-label') ||
                    node.textContent
                );

                if (label !== wanted) continue;

                let container = node;
                for (let i = 0; i < 4 && container; i++) {
                    container = container.parentNode || container.host || null;
                    if (container && container.querySelectorAll) break;
                }

                const scope = container || root;
                const candidates = queryAllDeep(
                    'input, textarea, select, button, [contenteditable="true"], [value], [display-value], span, div',
                    scope
                );

                let bestValue = '';
                let bestScore = -1;

                for (const candidate of candidates) {
                    if (candidate === node) continue;

                    const value = getValueFromElement(candidate);
                    const score = scoreCandidateValue(value, labelText);

                    if (score > bestScore) {
                        bestScore = score;
                        bestValue = value;
                    }
                }

                if (bestValue) {
                    log('Resolved near label', labelText, '=>', bestValue);
                    return bestValue;
                }
            }
        }

        return '';
    }

    function resolveTokenValue(tokenName, contextEl) {
        const key = normalizeText(tokenName);
        const searchRoots = getLocalRoots(contextEl);

        if (EXPLICIT_TOKENS[key]) {
            const explicitValue = getValueBySelectors(EXPLICIT_TOKENS[key], searchRoots);
            if (explicitValue) return explicitValue;
        }

        const generatedValue = getValueBySelectors(makeNameBasedSelectors(tokenName), searchRoots);
        if (generatedValue) return generatedValue;

        const nearbyValue = findValueNearLabel(tokenName, searchRoots);
        if (nearbyValue) return nearbyValue;

        return '';
    }

    function extractTokensFromText(text) {
        const matches = text.match(/\[([^\]]+)\]/g) || [];
        return [...new Set(matches.map(match => match.slice(1, -1).trim()))];
    }

    function replaceTokensInText(text, contextEl) {
        let updated = text;
        const unresolved = [];
        const tokenNames = extractTokensFromText(text);

        for (const tokenName of tokenNames) {
            if (BLOCKED_TOKENS.has(normalizeText(tokenName))) continue;

            const value = resolveTokenValue(tokenName, contextEl);
            const regex = new RegExp(`\\[${escapeRegex(tokenName)}\\]`, 'gi');

            if (!regex.test(updated)) continue;

            if (!value) {
                unresolved.push(tokenName);
                continue;
            }

            updated = updated.replace(regex, value);
        }

        return { updated, unresolved };
    }

    function processEditable(el) {
        if (!isEditable(el)) return;
        if (el.dataset.tmReplacing === '1') return;

        const text = getText(el);
        if (!text || !text.includes('[') || !text.includes(']')) return;

        const { updated, unresolved } = replaceTokensInText(text, el);

        if (updated !== text) {
            el.dataset.tmReplacing = '1';
            setText(el, updated);
            fireInputEvents(el);
            el.dataset.tmReplacing = '0';
            log('Replaced token text');
        }

        for (const tokenName of unresolved) {
            warn(`Found [${tokenName}], but could not resolve a value.`);
        }
    }

    function debounceProcess(el, delay = 120) {
        const existing = debounceMap.get(el);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            debounceMap.delete(el);
            processEditable(el);
        }, delay);

        debounceMap.set(el, timer);
    }

    function onInput(event) {
        const el = getEditableFromEvent(event);
        if (!el) return;

        const text = getText(el);
        if (!text || !text.includes('[')) return;

        debounceProcess(el, 120);
    }

    function onBlur(event) {
        const el = getEditableFromEvent(event);
        if (!el) return;
        processEditable(el);
    }

    function onPaste(event) {
        const el = getEditableFromEvent(event);
        if (!el) return;
        debounceProcess(el, 150);
    }

    function onKeydown(event) {
        const el = getEditableFromEvent(event);
        if (!el) return;

        if (event.key === 'Tab' || event.key === 'Enter') {
            processEditable(el);
        }
    }

    document.addEventListener('input', onInput, true);
    document.addEventListener('blur', onBlur, true);
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('keydown', onKeydown, true);

    log('Listeners attached once on document');
})();
