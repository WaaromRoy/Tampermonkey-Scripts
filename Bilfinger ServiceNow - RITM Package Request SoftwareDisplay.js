// noinspection DuplicatedCode

(function () {
    'use strict';
    // <editor-fold desc="Variables">
    const DEBUG = true;
    const PREFIX = '[SoftwareDisplay]';
    const SELECTORS = ['.row'];
    const InitialEvents = ['click']
    let overlayTrackingFrame = null;
    let overlayUpdateScheduled = false;
    let rowObserver = null;
    let observedRowRoot = null;
    let rowUpdateTimer = null;
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
    function queryAllDeep(selectors, root = document) {
        // log('queryAllDeep');
        const results = [...root.querySelectorAll(selectors.join(','))];
        try {
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) {
                    results.push(...queryAllDeep(selectors, el.shadowRoot));
                }
            });
        } catch (e) {
            error(e)
        }
        return results;
    }
    function updateOverlayPositions() {
        overlayUpdateScheduled = false;

        document
            .querySelectorAll('.software-display-overlay')
            .forEach(overlay => {
                const original = overlay._softwareDisplaySource;
                const cell = overlay._softwareDisplayCell;

                if (
                    !original?.isConnected ||
                    !cell?.isConnected
                ) {
                    overlay.remove();
                    return;
                }

                const textRect = original.getBoundingClientRect();
                const cellRect = cell.getBoundingClientRect();

                if (
                    textRect.width === 0 ||
                    textRect.height === 0 ||
                    textRect.bottom < 0 ||
                    textRect.top > window.innerHeight
                ) {
                    overlay.style.display = 'none';
                    return;
                }

                overlay.style.display = '';
                overlay.style.left = `${textRect.left}px`;
                overlay.style.top = `${textRect.top}px`;
                overlay.style.width =
                    `${Math.max(textRect.width, cellRect.right - textRect.left)}px`;
                overlay.style.minHeight = `${textRect.height}px`;
            });
    }
    function scheduleOverlayUpdate() {
        if (overlayUpdateScheduled) return;

        overlayUpdateScheduled = true;
        requestAnimationFrame(updateOverlayPositions);
    }
    function startOverlayTracking() {
        if (overlayTrackingFrame !== null) return;

        function track() {
            const overlays = document.querySelectorAll(
                '.software-display-overlay'
            );

            if (overlays.length === 0) {
                overlayTrackingFrame = null;
                return;
            }

            updateOverlayPositions();
            overlayTrackingFrame = requestAnimationFrame(track);
        }

        overlayTrackingFrame = requestAnimationFrame(track);
    }
    function stopOverlayTracking() {
        if (overlayTrackingFrame === null) return;

        cancelAnimationFrame(overlayTrackingFrame);
        overlayTrackingFrame = null;
    }
    function editRow(row) {
        if (!row?.isConnected) return;

        const requestId = row.dataset.id;
        if (!requestId) return;

        const appName = GM_getValue(requestId);
        if (!appName) return;

        const cell = row.querySelector(
            '[data-test="To request upgrades and new software - DAL ONLY!"]'
        );
        if (!cell?.isConnected) return;

        const original = cell.querySelector('span.-wordwrap');
        if (!original?.isConnected) return;

        const textRect = original.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const originalStyle = getComputedStyle(original);

        if (textRect.width === 0 || textRect.height === 0) return;

        const overlay = document.createElement('span');

        overlay.className = 'software-display-overlay';
        overlay.textContent = String(appName);

        Object.assign(overlay.style, {
            position: 'fixed',
            left: `${textRect.left}px`,
            top: `${textRect.top}px`,
            width: `${Math.max(textRect.width, cellRect.right - textRect.left)}px`,
            minHeight: `${textRect.minHeight}px`,

            zIndex: '2147483647',
            pointerEvents: 'none',

            backgroundColor: getBackgroundColor(cell),
            color: originalStyle.color,
            fontFamily: originalStyle.fontFamily,
            fontSize: originalStyle.fontSize,
            fontWeight: originalStyle.fontWeight,
            fontStyle: originalStyle.fontStyle,
            lineHeight: originalStyle.lineHeight,
            letterSpacing: originalStyle.letterSpacing,
            textAlign: originalStyle.textAlign,
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            alignItems: 'center'
        });

        overlay._softwareDisplaySource = original;
        overlay._softwareDisplayCell = cell;

        document.body.appendChild(overlay);

        startOverlayTracking();

        log('Displaying overlay:', requestId, '=>', appName);
    }
    function getBackgroundColor(element) {
        let current = element;

        while (current) {
            const color = getComputedStyle(current).backgroundColor;

            if (
                color &&
                color !== 'transparent' &&
                color !== 'rgba(0, 0, 0, 0)'
            ) {
                return color;
            }

            current = current.parentElement;
        }

        return getComputedStyle(document.body).backgroundColor;
    }
    function clearSoftwareDisplays() {
        document
            .querySelectorAll('.software-display-overlay')
            .forEach(overlay => overlay.remove());

        stopOverlayTracking();
    }
    function AddObserver(rows){
        rows.forEach(row => {
            const root = row.getRootNode()
            if (!(root instanceof ShadowRoot)|| observedRowRoot === root)
                return;

            observedRowRoot = root;
            rowObserver = new MutationObserver(() => {
                clearTimeout(rowUpdateTimer);

                // Allow ServiceNow to finish the current render.
                rowUpdateTimer = setTimeout(() => {
                    log('Rows changed inside the shadow root');
                    observeRoot(root);
                }, 50);
            });

            rowObserver.observe(root, {
                childList: true,
                subtree: true
            });
            log('Row observer attached to:', root);

            InitialEvents.forEach((event) => {
                document.removeEventListener(event, observeRoot, true);
            })

            log('Temporary listeners removed');
        });
    }
    function observeRoot(root = document) {
        clearSoftwareDisplays();
        const rows = queryAllDeep(SELECTORS, root);
        AddObserver(rows);
        const pathParts = window.location.pathname.split('/');
        if (pathParts[pathParts.length - 1] === 'home') {
            rows.forEach(row => {
                if (row.textContent.includes('To request upgrades and new software - DAL ONLY!')) {
                    editRow(row);
                }
            });
        } else if (pathParts[pathParts.length - 2] === 'sc_req_item') {
            const applicationName = queryAllDeep(['input[name="variables.application_name"]'])
                .find(field => field.offsetParent !== null)?.value;

            if (applicationName !== undefined) {
                const requestId = pathParts[pathParts.length - 1];

                GM_setValue(requestId, applicationName);
                log(`Stored ${requestId} => ${applicationName}`);
            }
        }
    }
    // <editor-fold desc="Input Event Listeners">
    // Only needed to initialize, is replaced by observer ASAP
    InitialEvents.forEach(event => {
        log('Adding listener for:', event);

        document.addEventListener(event, () => {
            // ServiceNow updates different views at slightly different times.
            [150, 400, 800].forEach(delay => {
                setTimeout(() => {
                    observeRoot(document);
                }, delay);
            });
        }, true);
    });

    window.addEventListener(
        'resize',
        scheduleOverlayUpdate,
        { passive: true }
    );
    log('Listeners attached once on document');
    // </editor-fold>
})();
