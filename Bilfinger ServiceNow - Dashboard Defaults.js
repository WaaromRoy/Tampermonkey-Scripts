// noinspection DuplicatedCode,SpellCheckingInspection

(function () {
    'use strict';
    const DEBUG = true;
    const PREFIX = '[Dashboard Defaults]';
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
    window.startDashboardDefaults = function (dashboardSysId) {
        if (dashboardSysId.toLowerCase() === 'default') {
            dashboardSysId = '831ebe9fc3e28f100e1990dd2b01318d';
        }
        log('Using dashboard:', dashboardSysId);
        const handledStores = new WeakSet();
        let changingLimit = false;
        function queryDeep(selector, root = document) {
            const results = [...root.querySelectorAll(selector)];
            if (root.shadowRoot) {
                results.push(
                    ...queryDeep(selector, root.shadowRoot)
                );
            }
            for (const element of root.querySelectorAll('*')) {
                if (element.shadowRoot) {
                    results.push(
                        ...queryDeep(selector, element.shadowRoot)
                    );
                }
            }
            return [...new Set(results)];
        }
        function loadDashboard() {
            const store = queryDeep(
                'data-store-provider[component-id^="dashboard-store-"]'
            )[0];
            if (
                !store ||
                handledStores.has(store) ||
                typeof store.dispatch !== 'function' ||
                !queryDeep('sn-dashboard-main', store).length
            ) {
                return;
            }
            handledStores.add(store);
            store.dispatch(
                'DASHBOARD_DESIGNER#GET_PAR_DASHBOARD_DETAILS',
                {
                    sys_id: dashboardSysId,
                    visibility:
                        'aa881cad73c4301045216238edf6a716',
                    include_inactive: false,
                    include_toolbox_metadata: true
                }
            );
        }
        function setPageLimit() {
            if (changingLimit) return;
            const limitSelector = queryDeep(
                'sn-pagination-limit-selector'
            ).find(element => {
                const button = queryDeep(
                    'button[role="combobox"]',
                    element
                )[0];
                return (
                    button &&
                    !button.getAttribute('aria-label')
                        ?.startsWith('100 ')
                );
            });
            if (!limitSelector) return;
            const button = queryDeep(
                'button[role="combobox"]',
                limitSelector
            )[0];
            if (!button) return;
            changingLimit = true;
            button.click();
            setTimeout(() => {
                const option = queryDeep(
                    '[role="option"][id="100"]'
                ).find(element =>
                    element.getAttribute('aria-selected') !== 'true'
                );
                if (option) {
                    option.click();
                }
                changingLimit = false;
            }, 200);
        }
        setInterval(() => {
            loadDashboard();
            setPageLimit();
        }, 500);
    };
})();