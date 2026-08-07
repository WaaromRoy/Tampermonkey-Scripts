// noinspection DuplicatedCode,SpellCheckingInspection

(function () {
    'use strict';
    // <editor-fold desc="Variables">
    const DEBUG = true;
    const PREFIX = '[Token Replacer]';
    const debounceMap = new WeakMap();

    const EXPLICIT_TOKENS = {
        /*ALL*/
        'assignment group': [
            'input[name="assignment_group_input"]',
            'input[name="assignment_group"]',
            'input[aria-label="Assignment group"]'
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
    const EventsToListenFor = ['input','blur','paste','click']

    const tokenHandlers = [
        /*LINK*/{
            matches: token => token.includes('|http') &&
                !/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(token) && !/^(img|image)\|http/i.test(token),

            execute: token => {
                const [text, link] = token.split('|');

                return `$[code]<a href="${link}" target="_blank">🔗${text}</a>[/code]`;
            }
        },
        /*IMAGE*/{
            matches: token => (token.includes('|http')&& /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(token) ||
                /^(img|image)\|http/i.test(token)
            ),

            execute: token => {
                const [text, image] = token.split('|');

                return `[code]<img src="${image}" alt="${text}">[/code]`;
            }
        },
        /*BOLD*/{
            matches: token => token.endsWith('|bold'),

            execute: token => {
                const text = token.slice(0, -'|bold'.length);

                return `[code]<strong>${text}</strong>[/code]`;
            }
        },
    ];
    // </editor-fold>
    // <editor-fold desc="Console">
    function log(...args) {
        if (DEBUG) console.log(PREFIX,`[${new Date().toLocaleTimeString()}]`, ...args);
    }
    function warn(...args) {
        console.warn(PREFIX,`[${new Date().toLocaleTimeString()}]`, ...args);
    }
    function error(...args) {
        console.error(PREFIX,`[${new Date().toLocaleTimeString()}]`, ...args);
    }
    // </editor-fold>
    function normalizeText(text) {
        return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
    function getText(el) {
        if (!el) return '';
        if ('value' in el && typeof el.value === 'string') return el.value;
        if (el.isContentEditable) return el.innerText || '';
        return '';
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
    function getValueBySelectors(selectors, searchRoots) {
        for (const root of searchRoots) {
            for (const selector of selectors) {
                const el = queryAllDeep(selector, root).length ? results[0] : null;
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
                    const rawScore = (value || '').replace(/\s+/g, ' ').trim();
                    const wanted = normalizeText(labelText);

                    if (!rawScore) continue;
                    if (normalizeText(rawScore) === wanted) continue;
                    if (/^(true|false|null|undefined)$/i.test(rawScore)) continue;

                    const score = (/\s/.test(rawScore)? rawScore.length + 5 : rawScore.length);
                    // const score = scoreCandidateValue(value, labelText);

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
    function executeSpecialToken(tokenName) {
        const handler = tokenHandlers.find(item =>
            item.matches(tokenName.toLowerCase())
        );
        return !handler ? null : handler.execute(tokenName);
    }
    function resolveTokenValue(tokenName, contextEl) {
        const key = normalizeText(tokenName);
        if (BLOCKED_TOKENS.has(key)) return null;
        const roots = [];
        const seen = new Set();

        let current = contextEl;
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
        const searchRoots = roots;
        if (EXPLICIT_TOKENS[key]) {
            const explicitValue = getValueBySelectors(EXPLICIT_TOKENS[key], searchRoots);
            if (explicitValue) return explicitValue;
        }

        const specialResult = executeSpecialToken(tokenName);
        if (specialResult !== null) return specialResult;

        const normalized = normalizeText(tokenName)
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return (getValueBySelectors([
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
        ], searchRoots) || findValueNearLabel(tokenName, searchRoots) || '');
    }
    function replaceTokensInText(text, contextEl) {
        let updated = text;
        const unresolved = [];
        const tokenNames = [...new Set((text.match(/\[([^\]]+)]/g) || []).map(match => match.slice(1, -1).trim()))];

        for (const tokenName of tokenNames) {
            const value = resolveTokenValue(tokenName, contextEl);
            if (value === null) continue;

            const escapedToken = tokenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const regex = new RegExp(`\\[${escapedToken}\\]`, 'gi');

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
            if ('value' in el && typeof el.value === 'string') {
                const proto = Object.getPrototypeOf(el);
                const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
                if (descriptor?.set) {
                    descriptor.set.call(el, updated);
                } else {
                    el.value = updated;
                }
            } else if (el.isContentEditable) {
                el.innerText = updated;
            }
            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            el.dataset.tmReplacing = '0';
            log('Replaced token');
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
    // <editor-fold desc="Input Events">
    function handleEditableEvent(event) {
        const el = (event.composedPath ? event.composedPath() : [event.target])
            .find(node => node instanceof Element && isEditable(node)) || null;
        if (!el) return;
        switch (event.type) {
            case 'input':
                const text = getText(el);
                if (!text || !text.includes('[')) return;
                debounceProcess(el, 120);
                break;
            default: // blur, paste & click
                debounceProcess(el);
        }
    }
    // <editor-fold desc="Input Event Listeners">
    EventsToListenFor.forEach((event) => {
        log("Adding listener for: " + event)
        document.addEventListener(event,handleEditableEvent, true)
    })
    log('Listeners attached once on document');
    // </editor-fold>
})();