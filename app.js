// ==========================================
// Developed by Hanif Alkhairi
// ==========================================

let userAccounts = [
    { name: "Cash", type: "Cash", initial: 1200500 },
    { name: "BCA", type: "Bank", initial: 2200100 },
    { name: "Bank Jago", type: "Bank", initial: 1000000 },
    { name: "Gopay", type: "E Wallet", initial: 55499 },
];

let userCategories = {
    income: ['Gaji', 'Hadiah', 'Profit'],
    expense: ['Makan', 'Kebutuhan', 'Belanja', 'Langganan', 'Donasi', 'Otomotif',],
    neutral: ['Hutang', 'Piutang', 'Lainnya']
};

let transactions = [
    { id: "1", date: "2026-06-15", name: "Gaji", credit: 0, debit: 6500000, category: "Gaji", account: "BCA", notes: "Transfer Bulanan" },
    { id: "2", date: "2026-06-18", name: "Makan Siang", credit: 45000, debit: 0, category: "Makan", account: "Cash", notes: "" },
    { id: "3", date: "2026-07-02", name: "Belanja", credit: 52600, debit: 0, category: "Belanja", account: "Cash", notes: "" }
];

let userLoans = [];

let activePage = 'dashboard';
let deleteTargetId = null;
let deleteTypeContext = 'transaction';
let detailTransactionId = null;
let chartIncExpInstance = null;
let chartCatInstance = null;
let chartSaldoInstance = null;
let dashboardChartAnimationPending = false;
let dashboardChartAnimationPlayed = false;
let isBalanceObscured = false;
let isInitialLoading = false;
let cloudSyncTimer = null;
let cloudSyncInFlight = false;
let cloudSyncQueued = false;
let cloudFetchInFlight = false;
let localMutationVersion = 0;
let transactionSearchTimer = null;
let loanTypeFilter = 'all';
let loanStatusFilter = 'unpaid';
let loanMonthFilter = '';

let loanRepaymentTargetId = null;
let loanRepaymentMode = 'existing';
let loanRepaymentSearchQuery = '';
let loanRepaymentSelectedIds = new Set();
let loanRepaymentSwipeState = null;
let loanRepaymentSwipeSuppressClickUntil = 0;

let loanDetailTargetId = null;
let loanUnlinkTargetTransactionId = null;
let loanDeleteTargetId = null;

const LOAN_REPAYMENT_SWIPE_DISTANCE = 88;

const CLOUD_SYNC_DELAY = 650;
const emptyStateHTML = `<div class="p-6 flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 w-full col-span-full">
    <i data-lucide="inbox" class="w-10 h-10 mb-2 stroke-[1.5]"></i>
    <span class="text-xs text-slate-400 italic">Data Tidak Tersedia</span>
</div>`;

const emptyTableRowHTML = (colspan) => `<tr><td colspan="${colspan}" class="py-8 text-center text-xs text-slate-400 italic"><i data-lucide="inbox" class="w-6 h-6 mx-auto mb-2 stroke-[1.5] text-slate-300 dark:text-slate-700"></i>Data Tidak Tersedia</td></tr>`;

function normalizeMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function normalizeText(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

function openPickerSafely(input) {
    if (
        !input ||
        input.disabled ||
        input.getAttribute('aria-disabled') === 'true'
    ) {
        return;
    }

    if (typeof input.showPicker === 'function') {
        try {
            input.showPicker();
            return;
        } catch (error) {
            // Browser tertentu tetap membuka date picker
            // melalui perilaku native setelah event click.
        }
    }

    try {
        input.focus({ preventScroll: true });
    } catch (error) {
        input.focus();
    }
}

function normalizeDateValue(value) {
    const raw = normalizeText(value);
    if (!raw) return '';
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function createTransactionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createLoanId() {
    if (
        window.crypto &&
        typeof window.crypto.randomUUID ===
            'function'
    ) {
        return window.crypto.randomUUID();
    }

    return `loan-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
}

function simpleHash(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function normalizeAccounts(input) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const result = [];

    input.forEach(account => {
        const name = normalizeText(account && account.name);
        if (!name) return;
        const key = name.toLocaleLowerCase('id-ID');
        if (seen.has(key)) return;
        seen.add(key);
        result.push({
            name,
            type: normalizeText(account.type) || 'Cash',
            initial: normalizeMoney(account.initial)
        });
    });

    return result;
}

function normalizeCategories(input) {
    const source = input && typeof input === 'object' ? input : {};
    const normalizeList = list => {
        if (!Array.isArray(list)) return [];
        const seen = new Set();
        return list.map(normalizeText).filter(name => {
            const key = name.toLocaleLowerCase('id-ID');
            if (!name || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    const result = {
        income: normalizeList(source.income),
        expense: normalizeList(source.expense),
        neutral: normalizeList(source.neutral)
    };

    const globalSeen = new Set();
    ['income', 'expense', 'neutral'].forEach(type => {
        result[type] = result[type].filter(name => {
            const key = name.toLocaleLowerCase('id-ID');
            if (globalSeen.has(key)) return false;
            globalSeen.add(key);
            return true;
        });
    });

    return result;
}

function normalizeLoans(input) {
    if (!Array.isArray(input)) {
        return [];
    }

    const byId = new Map();

    input.forEach(loan => {
        if (
            !loan ||
            typeof loan !== 'object'
        ) {
            return;
        }

        const rawType =
            normalizeText(
                loan.type
            ).toLocaleLowerCase('id-ID');

        let type = '';

        if (rawType === 'hutang') {
            type = 'Hutang';
        }

        if (rawType === 'piutang') {
            type = 'Piutang';
        }

        const normalized = {
            id:
                normalizeText(loan.id) ||
                createLoanId(),

            date:
                normalizeDateValue(
                    loan.date
                ),

            name:
                normalizeText(
                    loan.name
                ),

            type,

            principal:
                Math.max(
                    0,
                    normalizeMoney(
                        loan.principal
                    )
                ),

            party:
                normalizeText(
                    loan.party
                ),

            notes:
                normalizeText(
                    loan.notes
                ),

            dueDate:
                normalizeDateValue(
                    loan.dueDate
                )
        };

        if (
            !normalized.name ||
            !normalized.type ||
            normalized.principal <= 0
        ) {
            return;
        }

        byId.set(
            normalized.id,
            normalized
        );
    });

    return Array.from(
        byId.values()
    );
}

function normalizeTransactions(input) {
    if (!Array.isArray(input)) {
        return [];
    }

    const byId = new Map();

    input.forEach(
        (transaction, index) => {
            if (
                !transaction ||
                typeof transaction !==
                    'object'
            ) {
                return;
            }

            const rawLoanRole =
                normalizeText(
                    transaction.loanRole
                ).toLocaleLowerCase(
                    'id-ID'
                );

            const normalized = {
                id:
                    normalizeText(
                        transaction.id
                    ),

                date:
                    normalizeDateValue(
                        transaction.date
                    ),

                name:
                    normalizeText(
                        transaction.name
                    ),

                credit:
                    Math.max(
                        0,
                        normalizeMoney(
                            transaction.credit
                        )
                    ),

                debit:
                    Math.max(
                        0,
                        normalizeMoney(
                            transaction.debit
                        )
                    ),

                category:
                    normalizeText(
                        transaction.category
                    ),

                account:
                    normalizeText(
                        transaction.account
                    ),

                targetAccount:
                    normalizeText(
                        transaction.targetAccount
                    ),

                notes:
                    normalizeText(
                        transaction.notes
                    ),

                loanId:
                    normalizeText(
                        transaction.loanId
                    ),

                loanRole:
                    (
                        rawLoanRole ===
                            'principal' ||
                        rawLoanRole ===
                            'repayment'
                    )
                        ? rawLoanRole
                        : '',

                isTransfer:
                    Boolean(
                        transaction.isTransfer ||
                        normalizeText(
                            transaction.targetAccount
                        )
                    )
            };

            if (!normalized.id) {
                const legacySignature =
                    JSON.stringify([
                        normalized.date,
                        normalized.name,
                        normalized.credit,
                        normalized.debit,
                        normalized.category,
                        normalized.account,
                        normalized.targetAccount,
                        normalized.notes,
                        index
                    ]);

                normalized.id =
                    `legacy-${simpleHash(
                        legacySignature
                    )}`;
            }

            if (
                normalized.isTransfer
            ) {
                normalized.category = '';

                const amount =
                    normalized.credit ||
                    normalized.debit;

                normalized.credit =
                    amount;

                normalized.debit = 0;

                normalized.loanId = '';
                normalized.loanRole = '';
            }

            if (!normalized.loanId) {
                normalized.loanRole = '';
            }

            byId.set(
                normalized.id,
                normalized
            );
        }
    );

    return Array.from(
        byId.values()
    );
}

function commitDataChange({
    sync = true,
    render = true
} = {}) {
    userAccounts =
        normalizeAccounts(userAccounts);

    userCategories =
        normalizeCategories(
            userCategories
        );

    transactions =
        normalizeTransactions(
            transactions
        );

    userLoans =
        normalizeLoans(userLoans);

    localMutationVersion += 1;

    populateFormDropdowns();

    if (render) {
        renderDashboard();
    }

    if (sync) {
        triggerCloudPush();
    }
}

function setSyncStatus(message) {
    const statusEl = document.getElementById('syncStatus');
    if (statusEl) statusEl.innerText = message;
}

function getCloudConfig() {
    return {
        mode: localStorage.getItem('dbMode') || 'sheets',
        url: (localStorage.getItem('sheetsUrl') || '').trim()
    };
}

function buildCloudPayload() {
    return {
        action: 'syncAll',

        userAccounts:
            normalizeAccounts(
                userAccounts
            ),

        userCategories:
            normalizeCategories(
                userCategories
            ),

        transactions:
            normalizeTransactions(
                transactions
            ),

        userLoans:
            normalizeLoans(
                userLoans
            ),

        clientUpdatedAt:
            new Date().toISOString()
    };
}

function getWorkspaceSignature(
    data = null
) {
    const source = data || {
        userAccounts,
        userCategories,
        transactions,
        userLoans
    };

    return simpleHash(
        JSON.stringify({
            userAccounts:
                normalizeAccounts(
                    source.userAccounts || []
                ),

            userCategories:
                normalizeCategories(
                    source.userCategories || {}
                ),

            transactions:
                normalizeTransactions(
                    source.transactions || []
                ),

            userLoans:
                normalizeLoans(
                    source.userLoans || []
                )
        })
    );
}

function parseNominal(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let raw = normalizeText(value).replace(/\s/g, '');
    if (!raw) return 0;

    if (raw.includes(',') && raw.includes('.')) {
        raw = raw.replace(/\./g, '').replace(',', '.');
    } else if (raw.includes(',')) {
        raw = raw.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
        raw = raw.replace(/\./g, '');
    }

    raw = raw.replace(/[^0-9.-]/g, '');
    const number = Number(raw);
    return Number.isFinite(number) ? number : 0;
}

window.addEventListener('DOMContentLoaded', async () => {

    if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
    if (localStorage.getItem('isBalanceObscured') === 'true') isBalanceObscured = true;

    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById(
    'dashboardMonthFilter'
).value = currentYearMonth;

    document.getElementById('dbMode').value = 'sheets';
    localStorage.setItem(
        'dbMode',
        'sheets'
    );
    document.getElementById('sheetsUrl').value = localStorage.getItem('sheetsUrl') || '';

    changeDbMode();
    updateHeaderCloudIndicator();
    updateObscureUI();
    populateFormDropdowns();

    const transactionMonthFilter =
        document.getElementById(
            'txMonthFilter'
        );

    if (transactionMonthFilter) {
        transactionMonthFilter.value =
            currentYearMonth;
    }

    switchPage('dashboard');
    initializeFloatingTransactionButton();

    const { mode, url } = getCloudConfig();
    if (mode === 'sheets' && url) {
        await fetchFromGoogleSheets();
    }

    setInterval(() => {
    const { mode, url } = getCloudConfig();

        if (
            mode === 'sheets' &&
            url &&
            !cloudFetchInFlight &&
            !cloudSyncInFlight
        ) {
            fetchFromGoogleSheets({
                silent: true
            });
        }
    }, 60000);

    lucide.createIcons();
});

function toggleObscure() {
    isBalanceObscured = !isBalanceObscured;
    localStorage.setItem('isBalanceObscured', isBalanceObscured);
    updateObscureUI();
    renderDashboard();

    requestAnimationFrame(
    updateFloatingTransactionButton
);
}

function updateObscureUI() {
    const iconBtn = document.getElementById('obscureIconBtn');

    if (!iconBtn) return;

    const label = isBalanceObscured
        ? 'Tampilkan saldo'
        : 'Sembunyikan saldo';

    iconBtn.setAttribute(
        'data-lucide',
        isBalanceObscured ? 'eye-off' : 'eye'
    );

    const button = iconBtn.closest('button');

    if (button) {
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
    }

    lucide.createIcons();
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    if (activePage === 'reports') renderReportsPage();
    if (activePage === 'dashboard') renderDashboard();
}

function switchPage(pageId) {
    activePage = pageId;

    document.querySelectorAll('.page-content').forEach(element => {
        element.classList.add('hidden');
    });

    const targetPage = document.getElementById('page-' + pageId);
    if (!targetPage) {
        console.error(`Halaman "${pageId}" tidak ditemukan.`);
        return;
    }

    targetPage.classList.remove('hidden');

    document.querySelectorAll('header nav button').forEach(button => {
        button.className = `
            px-4 py-1.5 rounded-lg transition-all
            text-slate-500 dark:text-slate-400 hover:text-slate-900
        `;
    });

    const navPageId = pageId.startsWith('settings-')
        ? 'settings'
        : pageId;

    const activeDesktopButton = document.getElementById('nav-' + navPageId);
    if (activeDesktopButton) {
        activeDesktopButton.className = `
            px-4 py-1.5 rounded-lg transition-all
            bg-white dark:bg-slate-800
            text-blueSystem-500 dark:text-white shadow-sm
        `;
    }

    document.querySelectorAll(
        '#bottomMobileNav .bottom-nav-item'
    ).forEach(button => {
        button.classList.remove('is-active');
    });

    const bottomPageId =
        pageId === 'loans'
            ? 'dashboard'
            : pageId.startsWith('settings-')
                ? 'settings'
                : pageId;

    const activeBottomButton = document.getElementById(
        'nav-bottom-' + bottomPageId
    );

    if (activeBottomButton) {
        activeBottomButton.classList.add('is-active');
    }

    renderDashboard();

    requestAnimationFrame(updateFloatingTransactionButton);
}
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function encodeActionValue(value) {
    return btoa(unescape(encodeURIComponent(String(value))));
}

function decodeActionValue(value) {
    return decodeURIComponent(escape(atob(value)));
}

function getCurrentYearMonth() {
    const now = new Date();

    return `${now.getFullYear()}-${String(
        now.getMonth() + 1
    ).padStart(2, '0')}`;
}

function formatTransactionMonthLabel(
    monthValue
) {
    const match =
        String(monthValue || '')
            .match(/^(\d{4})-(\d{2})$/);

    if (!match) return monthValue;

    const date = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        1
    );

    return date.toLocaleDateString(
        'id-ID',
        {
            month: 'long',
            year: 'numeric'
        }
    );
}

function populateTransactionMonthFilter() {
    const monthSelect =
        document.getElementById(
            'txMonthFilter'
        );

    if (!monthSelect) return;

    const previousValue =
        monthSelect.value;

    const availableMonths =
        new Set([
            getCurrentYearMonth()
        ]);

    transactions.forEach(transaction => {
        const transactionMonth =
            getLocalMonth(
                transaction.date
            );

        if (transactionMonth) {
            availableMonths.add(
                transactionMonth
            );
        }
    });

    const sortedMonths =
        [...availableMonths]
            .sort((a, b) =>
                b.localeCompare(a)
            );

    monthSelect.innerHTML = `
        <option value="">
            Semua Tanggal
        </option>

        ${sortedMonths
            .map(month => `
                <option value="${month}">
                    ${escapeHtml(
                        formatTransactionMonthLabel(
                            month
                        )
                    )}
                </option>
            `)
            .join('')}
    `;

    const previousValueExists =
        previousValue === '' ||
        sortedMonths.includes(
            previousValue
        );

    monthSelect.value =
        previousValueExists
            ? previousValue
            : getCurrentYearMonth();
}

function populateFormDropdowns() {
    userAccounts = normalizeAccounts(userAccounts);
    userCategories = normalizeCategories(userCategories);

    const accountSelect =
        document.getElementById('form-account');

    const targetAccountSelect =
        document.getElementById('form-target-account');

    const filterAccountSelect =
        document.getElementById('txFilterAccount');

    const filterCategorySelect =
        document.getElementById('txFilterCategory');

    /*
     * Simpan pilihan user sebelum isi dropdown
     * dibuat ulang saat refresh cloud.
     */
    const selectedAccount =
        accountSelect?.value || '';

    const selectedTargetAccount =
        targetAccountSelect?.value || '';

    const selectedFilterAccount =
        filterAccountSelect?.value || '';

    const selectedFilterCategory =
        filterCategorySelect?.value || '';

    const accountHtml = userAccounts.length > 0
        ? userAccounts
            .map(account => `
                <option value="${escapeHtml(account.name)}">
                    ${escapeHtml(account.name)}
                </option>
            `)
            .join('')
        : `
            <option value="">
                -- Buat Akun Dulu --
            </option>
        `;

    if (accountSelect) {
        accountSelect.innerHTML = accountHtml;
    }

    if (targetAccountSelect) {
        targetAccountSelect.innerHTML = accountHtml;
    }

    if (filterAccountSelect) {
        filterAccountSelect.innerHTML = `
            <option value="">Semua Akun</option>
            ${accountHtml}
        `;
    }

    const allCategories = [
        ...userCategories.income,
        ...userCategories.expense,
        ...userCategories.neutral
    ];

    const uniqueCategories =
        [...new Set(allCategories)];

    if (filterCategorySelect) {
        filterCategorySelect.innerHTML = `
            <option value="">Semua Kategori</option>
            ${uniqueCategories
                .map(category => `
                    <option value="${escapeHtml(category)}">
                        ${escapeHtml(category)}
                    </option>
                `)
                .join('')}
        `;
    }

    /*
     * Kembalikan pilihan user jika akun atau
     * kategorinya masih tersedia.
     */
    const restoreValue = (
        selectElement,
        previousValue
    ) => {
        if (!selectElement) return;

        const valueStillExists =
            Array.from(selectElement.options)
                .some(option =>
                    option.value === previousValue
                );

        if (valueStillExists) {
            selectElement.value = previousValue;
        }
    };

    restoreValue(
        accountSelect,
        selectedAccount
    );

    restoreValue(
        targetAccountSelect,
        selectedTargetAccount
    );

    restoreValue(
        filterAccountSelect,
        selectedFilterAccount
    );

    restoreValue(
    filterCategorySelect,
    selectedFilterCategory
    );

    populateTransactionMonthFilter();
}

function updateCategoryDropdown(selectedValue = '') {
    const catSelect = document.getElementById('form-category');
    const typeSelect = document.getElementById('form-type');
    if (!catSelect || !typeSelect) return;

    const type = typeSelect.value;
    let availableCategories = [];
    if (type === 'Credit') {
        availableCategories = [...userCategories.expense, ...userCategories.neutral];
    } else if (type === 'Debit') {
        availableCategories = [...userCategories.income, ...userCategories.neutral];
    }

    catSelect.innerHTML = '<option value="" disabled>Pilih Kategori...</option>' +
        [...new Set(availableCategories)].map(cat =>
            `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`
        ).join('');

    if (selectedValue && availableCategories.includes(selectedValue)) {
        catSelect.value = selectedValue;
    } else if (availableCategories.length > 0) {
        catSelect.value = availableCategories[0];
    } else {
        catSelect.value = '';
    }
}

function formatRupiah(amount, forceShow = false) {
    if (!forceShow && isBalanceObscured) return "Rp •••••••";
    if (amount === 0 || isNaN(amount)) return "Rp 0,00";
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 2 }).format(amount);
}

function formatInputNominal(input) {

    let value = String(input.value || '')
        .replace(/\s/g, '')
        .replace(/[^0-9,]/g, '');

    if (!value) {
        input.value = '';
        return;
    }

    const commaIndex = value.indexOf(',');

    let integerPart;
    let decimalPart = null;

    if (commaIndex >= 0) {
        integerPart = value.slice(0, commaIndex);

        decimalPart = value
            .slice(commaIndex + 1)
            .replace(/,/g, '')
            .slice(0, 2);
    } else {
        integerPart = value;
    }

    integerPart = integerPart.replace(/^0+(?=\d)/, '');

    if (integerPart === '') {
        integerPart = '0';
    }

    const formattedInteger = new Intl.NumberFormat('id-ID', {
        maximumFractionDigits: 0
    }).format(Number(integerPart));

    input.value = decimalPart === null
        ? formattedInteger
        : `${formattedInteger},${decimalPart}`;
}

function calculateBalancesUntil(selectedMonthIso = null) {
    const balances = {};
    userAccounts.forEach(a => balances[a.name] = a.initial);

    transactions.forEach(t => {
        if (selectedMonthIso && getLocalMonth(t.date) > selectedMonthIso) return;
        
        if (balances[t.account] !== undefined) {
            balances[t.account] += (Number(t.debit) || 0) - (Number(t.credit) || 0);
        }
        if (t.isTransfer && t.targetAccount && balances[t.targetAccount] !== undefined) {
            balances[t.targetAccount] += (Number(t.credit) || Number(t.debit) || 0);
        }
    });
    return balances;
}

function openBalanceDetailModal() {
    const modal =
        document.getElementById(
            'balanceDetailModal'
        );

    const listContainer =
        document.getElementById(
            'balanceDetailList'
        );

    const totalElement =
        document.getElementById(
            'balanceDetailTotal'
        );

    const monthFilter =
        document.getElementById(
            'dashboardMonthFilter'
        );

    if (
        !modal ||
        !listContainer ||
        !totalElement
    ) {
        return;
    }

    const selectedMonth =
        monthFilter?.value || '';

    const balances =
        calculateBalancesUntil(
            selectedMonth
        );

    let totalBalance = 0;

    if (userAccounts.length === 0) {
        listContainer.innerHTML = `
            <div class="
                py-8 text-center
                text-xs text-slate-400
            ">
                Belum ada akun keuangan.
            </div>
        `;
    } else {
        listContainer.innerHTML =
            userAccounts
                .map(account => {
                    const balance =
                        Number(
                            balances[account.name]
                        ) || 0;

                    totalBalance += balance;

                    const balanceColor =
                        balance < 0
                            ? `
                                text-rose-600
                                dark:text-rose-400
                            `
                            : `
                                text-slate-900
                                dark:text-white
                            `;

                    return `
    <div class="
        flex items-center
        justify-between gap-4
        p-3.5 rounded-xl
        bg-slate-50
        dark:bg-slate-900
        border border-slate-200
        dark:border-slate-800
    ">
        <div class="min-w-0 flex-1">
            <p class="
                text-sm font-semibold
                text-slate-900
                dark:text-white
                truncate
            ">
                ${escapeHtml(account.name)}
            </p>

            <p class="
                mt-0.5
                text-[10px]
                text-slate-400
                dark:text-slate-500
                truncate
            ">
                ${escapeHtml(account.type || 'Akun')}
            </p>
        </div>

        <span class="
            shrink-0
            self-center
            text-sm font-bold
            whitespace-nowrap
            ${balanceColor}
        ">
            ${formatRupiah(balance)}
        </span>
    </div>
`;
                })
                .join('');
    }

    totalElement.textContent =
        formatRupiah(totalBalance);

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    lucide.createIcons();
}

function closeBalanceDetailModal() {
    const modal =
        document.getElementById(
            'balanceDetailModal'
        );

    if (!modal) return;

    modal.classList.add('hidden');
    modal.style.display = 'none';
}

function isCategoryCalculatedToIncomeExpense(categoryName) {
    const category = normalizeText(categoryName);
    if (!category) return false;
    const neutralCategories = userCategories.neutral || [];
    return !neutralCategories.some(item => item.toLocaleLowerCase('id-ID') === category.toLocaleLowerCase('id-ID'));
}

function renderDashboard() {
    const dashMonth = document.getElementById('dashboardMonthFilter').value;
    const txMonth = document.getElementById('txMonthFilter').value;

    if (activePage === 'dashboard') {
        renderDashboardPage(dashMonth);
    } else if (activePage === 'transactions') {
        renderTransactionsPage(txMonth);
    } else if (activePage === 'loans') {
        renderLoansPage();
    } else if (activePage === 'reports') {
        renderReportsPage();
    } else if (
        activePage === 'settings' ||
        activePage === 'settings-accounts' ||
        activePage === 'settings-categories'
    ) {
        renderSettingsPage();
    }
    lucide.createIcons();
}

function parseLocalDateAtMidnight(dateValue) {
    const normalizedDate = normalizeDateValue(dateValue);

    if (!normalizedDate) {
        return null;
    }

    const match = normalizedDate.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
    );

    if (!match) {
        return null;
    }

    return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
    );
}

function getDaysUntilLoanDueDate(dueDate) {
    const dueDateObject = parseLocalDateAtMidnight(dueDate);
    const todayObject = parseLocalDateAtMidnight(
        getTodayLocalDate()
    );

    if (!dueDateObject || !todayObject) {
        return null;
    }

    return Math.round(
        (dueDateObject.getTime() - todayObject.getTime()) /
        86400000
    );
}

function getDashboardActiveDebts() {
    return normalizeLoans(userLoans)
        .filter(loan => {
            if (loan.type !== 'Hutang') {
                return false;
            }

            return getLoanProgress(loan).remaining > 0;
        })
        .map(loan => {
            const progress = getLoanProgress(loan);
            const dueDate = normalizeDateValue(
                loan.dueDate
            );

            return {
                loan,
                progress,
                dueDate,
                daysUntilDue:
                    dueDate
                        ? getDaysUntilLoanDueDate(dueDate)
                        : null
            };
        })
        .sort((firstItem, secondItem) => {
            const firstHasDueDate = Boolean(
                firstItem.dueDate
            );

            const secondHasDueDate = Boolean(
                secondItem.dueDate
            );

            if (firstHasDueDate !== secondHasDueDate) {
                return firstHasDueDate ? -1 : 1;
            }

            if (
                firstHasDueDate &&
                firstItem.daysUntilDue !==
                    secondItem.daysUntilDue
            ) {
                return (
                    firstItem.daysUntilDue -
                    secondItem.daysUntilDue
                );
            }

            return String(secondItem.loan.date || '')
                .localeCompare(
                    String(firstItem.loan.date || '')
                );
        });
}

function getDashboardDebtReminderStyle(daysUntilDue) {
    if (daysUntilDue < 0) {
        return {
            title: 'Hutang Melewati Jatuh Tempo',
            icon: 'triangle-alert',
            containerClass: [
                'border-rose-200',
                'bg-rose-50',
                'dark:border-rose-900/50',
                'dark:bg-rose-900/30'
            ].join(' '),
            iconClass: [
                'bg-rose-100',
                'text-rose-600',
                'dark:bg-rose-900/30',
                'dark:text-rose-400'
            ].join(' '),
            accentClass:
                'text-rose-600 dark:text-rose-400'
        };
    }

    if (daysUntilDue <= 1) {
        return {
            title:
                daysUntilDue === 0
                    ? 'Hutang Jatuh Tempo Hari Ini'
                    : 'Hutang Jatuh Tempo Besok',
            icon: 'alarm-clock',
            containerClass: [
                'border-rose-200',
                'bg-rose-50',
                'dark:border-rose-900/50',
                'dark:bg-rose-900/30'
            ].join(' '),
            iconClass: [
                'bg-rose-100',
                'text-rose-600',
                'dark:bg-rose-900/30',
                'dark:text-rose-400'
            ].join(' '),
            accentClass:
                'text-rose-600 dark:text-rose-400'
        };
    }

    if (daysUntilDue <= 7) {
        return {
            title: 'Hutang Jatuh Tempo Dalam 7 Hari',
            icon: 'clock-3',
            containerClass: [
                'border-slate-200',
                'bg-amber-50',
                'dark:border-slate-800',
                'dark:bg-amber-900/30'
            ].join(' '),
            iconClass: [
                'bg-white',
                'text-amber-600',
                'dark:bg-slate-900',
                'dark:text-amber-400'
            ].join(' '),
            accentClass:
                'text-amber-600 dark:text-amber-400'
        };
    }

    return {
        title: 'Hutang Jatuh Tempo Dalam 30 Hari',
        icon: 'calendar-clock',
        containerClass: [
            'border-blueSystem-500',
            'bg-blueSystem-50',
            'dark:border-slate-800',
            'dark:bg-blueSystem-900/30'
        ].join(' '),
        iconClass: [
            'bg-white',
            'text-blueSystem-500',
            'dark:bg-slate-900',
            'dark:text-blueSystem-100'
        ].join(' '),
        accentClass:
            'text-blueSystem-500 dark:text-blueSystem-100'
    };
}

function getDashboardDebtDueText(item) {
    if (!item.dueDate) {
        return 'Tanpa jatuh tempo';
    }

    const daysUntilDue = item.daysUntilDue;

    if (daysUntilDue < 0) {
        const overdueDays = Math.abs(daysUntilDue);

        return `Terlambat ${overdueDays} hari`;
    }

    if (daysUntilDue === 0) {
        return 'Jatuh tempo hari ini';
    }

    if (daysUntilDue === 1) {
        return 'Jatuh tempo besok';
    }

    return `Jatuh tempo ${daysUntilDue} hari lagi`;
}

function openDashboardDebtList() {
    loanTypeFilter = 'debt';
    loanStatusFilter = 'unpaid';
    loanMonthFilter = '';

    switchPage('loans');

    const typeFilter = document.getElementById(
        'loanTypeFilter'
    );

    const statusFilter = document.getElementById(
        'loanStatusFilter'
    );

    const monthFilter = document.getElementById(
        'loanMonthFilter'
    );

    if (typeFilter) {
        typeFilter.value = 'debt';
    }

    if (statusFilter) {
        statusFilter.value = 'unpaid';
    }

    if (monthFilter) {
        monthFilter.value = '';
    }

    renderLoansPage();
}

function renderDashboardDebtReminder(activeDebts) {
    const section = document.getElementById(
        'dashboardDebtReminderSection'
    );

    if (!section) {
        return;
    }

    const reminderDebts = activeDebts.filter(item => {
        return (
            item.dueDate &&
            item.daysUntilDue !== null &&
            item.daysUntilDue <= 30
        );
    });

    if (reminderDebts.length === 0) {
        section.classList.add('hidden');
        section.innerHTML = '';
        return;
    }

    const nearestDebt = reminderDebts[0];
    const style = getDashboardDebtReminderStyle(
        nearestDebt.daysUntilDue
    );

    const encodedLoanId = encodeActionValue(
        nearestDebt.loan.id
    );

    const additionalCount =
        reminderDebts.length - 1;

    section.className = '';
    section.innerHTML = `
        <div class="
            rounded-2xl border p-4 shadow-sm
            ${style.containerClass}
        ">
            <div>
                <div class="min-w-0">
                    <div class="
                        flex flex-col sm:flex-row
                        sm:items-center sm:justify-between
                        gap-2
                    ">
                        <div class="min-w-0">
                            <h3 class="
                                text-sm font-bold
                                text-slate-900 dark:text-white
                            ">
                                ${escapeHtml(style.title)}
                            </h3>
                        </div>

                        ${additionalCount > 0 ? `
                            <span class="
                                self-start shrink-0
                                rounded-full px-2.5 py-1
                                bg-white/70 dark:bg-slate-950/50
                                text-[10px] font-semibold
                                text-slate-600 dark:text-slate-300
                            ">
                                +${additionalCount} lainnya
                            </span>
                        ` : ''}
                    </div>

                    <button
                        type="button"
                        onclick="
                            openLoanDetailModal(
                                decodeActionValue('${encodedLoanId}')
                            )
                        "
                        class="
                            mt-3 w-full
                            flex items-center justify-between
                            gap-4 text-left
                            rounded-xl
                            bg-white/75 dark:bg-slate-950/55
                            border border-white/80
                            dark:border-slate-800/80
                            px-3 py-3
                            hover:bg-white
                            dark:hover:bg-slate-950
                            transition-colors
                        "
                    >
                        <div class="min-w-0 flex-1">
                            <p class="
                                text-xs font-semibold
                                text-slate-900 dark:text-white
                                truncate
                            ">
                                ${escapeHtml(nearestDebt.loan.name)}
                            </p>

                            <p class="
                                mt-1 text-[10px]
                                ${style.accentClass}
                            ">
                                ${escapeHtml(
                                    formatTanggalIndo(
                                        nearestDebt.dueDate
                                    )
                                )}
                            </p>
                        </div>

                        <div class="shrink-0 text-right">
                            <p class="
                                text-[9px] font-medium
                                text-slate-400 uppercase
                                tracking-wider
                            ">
                                Sisa
                            </p>

                            <p class="
                                mt-0.5 text-sm font-bold
                                whitespace-nowrap
                                ${style.accentClass}
                            ">
                                ${formatRupiah(
                                    nearestDebt.progress.remaining
                                )}
                            </p>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderDashboardActiveDebts(activeDebts) {
    const section = document.getElementById(
        'dashboardActiveDebtSection'
    );

    if (!section) {
        return;
    }

    if (activeDebts.length === 0) {
        section.classList.add('hidden');
        section.innerHTML = '';
        return;
    }

    const totalRemaining = activeDebts.reduce(
        (total, item) =>
            total + item.progress.remaining,
        0
    );

    const displayedDebts = activeDebts.slice(0, 3);

    const debtRows = displayedDebts.map(item => {
        const encodedLoanId = encodeActionValue(
            item.loan.id
        );

        const isUrgent = Boolean(
            item.dueDate &&
            item.daysUntilDue !== null &&
            item.daysUntilDue <= 7
        );

        const dueTextClass = isUrgent
            ? 'text-rose-600 dark:text-rose-400 font-semibold'
            : 'text-slate-400';

        return `
            <button
                type="button"
                onclick="
                    openLoanDetailModal(
                        decodeActionValue('${encodedLoanId}')
                    )
                "
                class="
                    w-full px-4 py-3
                    flex items-center justify-between
                    gap-4 text-left
                    hover:bg-slate-50
                    dark:hover:bg-slate-900/60
                    transition-colors
                "
            >
                <div class="min-w-0 flex-1">
                    <p class="
                        text-xs font-semibold
                        text-slate-900 dark:text-white
                        truncate
                    ">
                        ${escapeHtml(item.loan.name)}
                    </p>

                    <p class="
                        mt-1 text-[10px]
                        ${dueTextClass}
                    ">
                        ${escapeHtml(
                            getDashboardDebtDueText(item)
                        )}
                        ${item.loan.party ? `
                            <span class="mx-1">•</span>
                            ${escapeHtml(item.loan.party)}
                        ` : ''}
                    </p>
                </div>

                <div class="shrink-0 text-right">
                    <p class="
                        text-[9px] font-medium
                        text-slate-400 uppercase
                        tracking-wider
                    ">
                        Sisa
                    </p>

                    <p class="
                        mt-0.5 text-xs font-bold
                        text-rose-600 dark:text-rose-400
                        whitespace-nowrap
                    ">
                        ${formatRupiah(
                            item.progress.remaining
                        )}
                    </p>
                </div>

                <i
                    data-lucide="chevron-right"
                    class="
                        shrink-0 w-4 h-4
                        text-slate-300 dark:text-slate-700
                    "
                ></i>
            </button>
        `;
    }).join('');

    section.className = [
        'bg-white',
        'dark:bg-slate-950',
        'border',
        'border-slate-200',
        'dark:border-slate-800',
        'rounded-2xl',
        'shadow-sm',
        'overflow-hidden'
    ].join(' ');

    section.innerHTML = `
        <div class="
            p-4 border-b
            border-slate-100 dark:border-slate-800
            flex items-center justify-between gap-3
        ">
            <div class="min-w-0">
                <h3 class="
                    text-sm font-bold
                    text-slate-900 dark:text-white
                    flex items-center gap-1.5
                ">
                    <i
                        data-lucide="hand-coins"
                        class="w-4 h-4 text-rose-500"
                    ></i>
                    Kamu Punya Hutang
                </h3>
            </div>

            <button
                type="button"
                onclick="openDashboardDebtList()"
                class="
                    shrink-0
                    text-[11px] font-semibold
                    text-blueSystem-500
                    border border-blueSystem-500
                    px-3 py-1.5 rounded-lg
                    hover:bg-blueSystem-50
                    dark:hover:bg-blueSystem-900/30
                    transition-colors
                "
            >
                Lihat Semua
            </button>
        </div>

        <div class="
            px-4 py-4
            bg-slate-50/70 dark:bg-slate-900/45
            border-b border-slate-100 dark:border-slate-800
            flex items-center justify-between gap-4
        ">
            <div class="min-w-0">
                <p class="
                    text-[10px] font-semibold
                    uppercase tracking-wider
                    text-slate-400
                ">
                    Total Sisa Hutang
                </p>

                <p class="
                    mt-1 text-xl sm:text-2xl
                    font-bold text-rose-600
                    dark:text-rose-400
                    whitespace-nowrap
                ">
                    ${formatRupiah(totalRemaining)}
                </p>
            </div>

            <div class="
                shrink-0 w-11 h-11 rounded-xl
                flex items-center justify-center
                bg-rose-50 dark:bg-rose-950/30
                text-rose-600 dark:text-rose-400
            ">
                <i
                    data-lucide="wallet-cards"
                    class="w-5 h-5"
                ></i>
            </div>
        </div>

        <div class="
            divide-y divide-slate-100
            dark:divide-slate-800
        ">
            ${debtRows}
        </div>

        ${activeDebts.length > displayedDebts.length ? `
            <button
                type="button"
                onclick="openDashboardDebtList()"
                class="
                    w-full px-4 py-3
                    text-[11px] font-semibold
                    text-blueSystem-500
                    hover:bg-slate-50
                    dark:hover:bg-slate-900/60
                    transition-colors
                "
            >
                Lihat ${activeDebts.length - displayedDebts.length}
                hutang lainnya
            </button>
        ` : ''}
    `;
}

function renderDashboardDebtInformation() {
    const activeDebts = getDashboardActiveDebts();

    renderDashboardDebtReminder(activeDebts);
    renderDashboardActiveDebts(activeDebts);
}

function renderDashboardPage(selectedMonth) {
    const balances = calculateBalancesUntil(selectedMonth);
    let netWorth = 0, totalBank = 0, totalWallet = 0, totalCash = 0, totalSaving = 0;
    
    userAccounts.forEach(a => {
        const bal = balances[a.name] ?? 0;
        netWorth += bal;
        if (a.type === 'Bank') totalBank += bal;
        else if (a.type === 'E Wallet') totalWallet += bal;
        else if (a.type === 'Cash') totalCash += bal;
        else if (a.type === 'Tabungan') totalSaving += bal;
    });

    document.getElementById('dash-net-worth').innerText = formatRupiah(netWorth);
    document.getElementById('dash-donut-total').innerText = formatRupiah(netWorth);

    let overallIncome = 0, overallExpense = 0;
    const categorySums = {};

    transactions.forEach(t => {
        if (t.date && getLocalMonth(t.date) === selectedMonth && !t.isTransfer) {
            if(isCategoryCalculatedToIncomeExpense(t.category)) {
                overallIncome += (Number(t.debit) || 0);
                overallExpense += (Number(t.credit) || 0);
                
                if (t.category && t.credit > 0) {
                    categorySums[t.category] = (categorySums[t.category] || 0) + Number(t.credit);
                }
            }
        }
    });

    document.getElementById('dash-inc-month').innerText = formatRupiah(overallIncome);
    document.getElementById('dash-exp-month').innerText = formatRupiah(overallExpense);

    renderDashboardDebtInformation();

    const ctx = document.getElementById('chartSaldoDonut');

if (ctx) {
    const isEmpty =
        netWorth === 0 &&
        userAccounts.length === 0;

    const chartLabels = isEmpty
        ? []
        : [
            'Dana di Bank',
            'Dana Tabungan',
            'Dana Cash',
            'Dana E Wallet'
        ];

    const chartData = isEmpty
        ? [1]
        : [
            totalBank,
            totalSaving,
            totalCash,
            totalWallet
        ];

    const chartColors = isEmpty
        ? ['#e2e8f0']
        : [
            '#3b82f6',
            '#10b981',
            '#ef4444',
            '#a855f7'
        ];

    const borderColor =
        document.documentElement.classList.contains('dark')
            ? '#020617'
            : '#ffffff';

    const shouldAnimate =
        dashboardChartAnimationPending &&
        !dashboardChartAnimationPlayed;

    if (shouldAnimate && chartSaldoInstance) {
        chartSaldoInstance.destroy();
        chartSaldoInstance = null;
    }

    if (!chartSaldoInstance) {
        chartSaldoInstance = new Chart(
            ctx.getContext('2d'),
            {
                type: 'doughnut',

                data: {
                    labels: chartLabels,

                    datasets: [{
                        data: chartData,
                        backgroundColor: chartColors,
                        borderWidth: isEmpty ? 0 : 2,
                        borderColor: borderColor,
                        hoverOffset: isEmpty ? 0 : 4
                    }]
                },

                options: {
                    cutout: '75%',
                    responsive: true,
                    maintainAspectRatio: false,

                    animation: shouldAnimate
                        ? {
                            duration: 1000,
                            easing: 'easeOutQuart'
                        }
                        : false,

                    plugins: {
                        legend: {
                            display: false
                        },

                        tooltip: {
                            enabled: !isEmpty
                        }
                    }
                }
            }
        );

        if (shouldAnimate) {
            dashboardChartAnimationPlayed = true;
            dashboardChartAnimationPending = false;
        }
    } else {
        const dataset =
            chartSaldoInstance.data.datasets[0];

        chartSaldoInstance.data.labels =
            chartLabels;

        dataset.data =
            chartData;

        dataset.backgroundColor =
            chartColors;

        dataset.borderWidth =
            isEmpty ? 0 : 2;

        dataset.borderColor =
            borderColor;

        dataset.hoverOffset =
            isEmpty ? 0 : 4;

        chartSaldoInstance.options.plugins.tooltip.enabled =
            !isEmpty;

        chartSaldoInstance.update('none');
    }
}

    const legendData = [
        { label: 'Dana di Bank', amount: totalBank, color: 'bg-blue-500' },
        { label: 'Dana Tabungan', amount: totalSaving, color: 'bg-emerald-500' },
        { label: 'Dana Cash', amount: totalCash, color: 'bg-rose-500' },
        { label: 'Dana E Wallet', amount: totalWallet, color: 'bg-purple-500' }
    ];

    if (userAccounts.length === 0) {
        document.getElementById('dashSaldoLegend').innerHTML = emptyStateHTML;
    } else {
        document.getElementById('dashSaldoLegend').innerHTML = legendData.map(item => {
            const pct = netWorth > 0 ? ((item.amount / netWorth) * 100).toFixed(1) : 0;
            return `
                <div class="flex items-center justify-between py-2.5">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full ${item.color}"></span>
                        <p class="text-[11px] font-semibold text-slate-700 dark:text-slate-300">${item.label}</p>
                    </div>
                    <div class="flex items-center gap-4 text-[11px]">
                        <span class="font-medium text-slate-900 dark:text-white">${formatRupiah(item.amount)}</span>
                        <span class="text-slate-400 w-8 text-right">${pct}%</span>
                    </div>
                </div>`;
        }).join('');
    }

    const categories = Object.keys(categorySums).sort((a,b) => categorySums[b] - categorySums[a]);
    const catContainer = document.getElementById('dashCategoriesContainer');
    
    if (categories.length === 0) {
        catContainer.innerHTML = emptyStateHTML;
    } else {
        catContainer.innerHTML = categories.map(cat => {
            const amt = categorySums[cat];
            const pct = overallExpense > 0 ? Math.round((amt / overallExpense) * 100) : 0;
            return `
                <div class="space-y-1.5 py-2 shrink-0">
                    <div class="flex justify-between text-[11px]">
                        <span class="font-medium text-slate-600 dark:text-slate-300">${escapeHtml(cat)}</span>
                        <span class="font-bold text-slate-900 dark:text-white">${formatRupiah(amt, true)} <span class="text-[10px] text-slate-400 font-normal">(${pct}%)</span></span>
                    </div>
                    <div class="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div class="bg-blueSystem-500 h-full rounded-full" style="width: ${pct}%"></div>
                    </div>
                </div>`;
        }).join('');
    }

    const recentTx = sortTransactionsNewestFirst(
        transactions
    ).slice(0, 5);

    const recentList = document.getElementById(
        'dashboardRecentList'
    );

    if (recentList) {
        if (recentTx.length === 0) {
            recentList.innerHTML = `
                <div class="px-4 py-8 text-center">
                    <i
                        data-lucide="receipt-text"
                        class="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700"
                    ></i>
                    <p class="mt-2 text-xs text-slate-400">
                        Belum ada transaksi.
                    </p>
                </div>
            `;
        } else {
            recentList.innerHTML = recentTx.map(transaction => {
                let amount = Number(transaction.credit) || 0;
                let amountClass =
                    'text-rose-600 dark:text-rose-400';
                let icon = 'arrow-up-right';
                let iconClass = [
                    'bg-rose-50',
                    'text-rose-600',
                    'dark:bg-rose-950/30',
                    'dark:text-rose-400'
                ].join(' ');
                let displayCategory =
                    transaction.category || '-';
                let displayAccount =
                    transaction.account || '-';

                if (transaction.isTransfer) {
                    amount =
                        Number(transaction.credit) ||
                        Number(transaction.debit) ||
                        0;
                    amountClass =
                        'text-blueSystem-500 dark:text-blueSystem-100';
                    icon = 'repeat-2';
                    iconClass = [
                        'bg-blueSystem-50',
                        'text-blueSystem-500',
                        'dark:bg-blueSystem-900/30',
                        'dark:text-blueSystem-100'
                    ].join(' ');
                    displayCategory = 'Transfer Dana';
                    displayAccount =
                        `${transaction.account} ➔ ` +
                        `${transaction.targetAccount}`;
                } else if (Number(transaction.debit) > 0) {
                    amount = Number(transaction.debit) || 0;
                    amountClass =
                        'text-emerald-600 dark:text-emerald-400';
                    icon = 'arrow-down-left';
                    iconClass = [
                        'bg-emerald-50',
                        'text-emerald-600',
                        'dark:bg-emerald-900/30',
                        'dark:text-emerald-400'
                    ].join(' ');
                }

                const encodedId = encodeActionValue(
                    transaction.id
                );

                const note = normalizeText(
                    transaction.notes
                );

                return `
                    <button
                        type="button"
                        onclick="
                            openTransactionDetailModal(
                                decodeActionValue('${encodedId}')
                            )
                        "
                        class="
                            w-full px-4 py-3.5
                            flex items-center gap-3
                            text-left
                            hover:bg-slate-50
                            dark:hover:bg-slate-900/60
                            transition-colors
                        "
                    >
                        <span class="
                            shrink-0 w-9 h-9 rounded-xl
                            flex items-center justify-center
                            ${iconClass}
                        ">
                            <i
                                data-lucide="${icon}"
                                class="w-4 h-4"
                            ></i>
                        </span>

                        <span class="min-w-0 flex-1">
                            <span class="
                                block text-xs font-semibold
                                text-slate-900 dark:text-white
                                truncate
                            ">
                                ${escapeHtml(transaction.name || '-')}
                            </span>

                            <span class="
                                mt-1 block text-[10px]
                                text-slate-400 truncate
                            ">
                                ${escapeHtml(
                                    formatTanggalIndo(transaction.date)
                                )}
                                <span class="mx-1">•</span>
                                ${escapeHtml(displayCategory)}
                                ${note ? `
                                    <span class="mx-1">•</span>
                                    ${escapeHtml(note)}
                                ` : ''}
                            </span>
                        </span>

                        <span class="shrink-0 text-right" style="max-width: 42%;">
                            <span class="
                                block text-xs font-bold
                                whitespace-nowrap
                                ${amountClass}
                            ">
                                ${formatRupiah(amount, true)}
                            </span>

                            <span class="
                                mt-1 inline-block max-w-full
                                truncate rounded
                                bg-slate-100 dark:bg-slate-800
                                px-1.5 py-0.5
                                text-[9px] font-medium
                                text-slate-500 dark:text-slate-300
                            ">
                                ${escapeHtml(displayAccount)}
                            </span>
                        </span>
                    </button>
                `;
            }).join('');
        }
    }
}

function scheduleTransactionSearch() {
    clearTimeout(
        transactionSearchTimer
    );

    transactionSearchTimer = setTimeout(
        () => {
            renderDashboard();
        },
        200
    );
}

function renderTransactionsPage(selectedMonth) {
    const currentMonth =
    getCurrentYearMonth();

    const summaryMonth =
        selectedMonth || currentMonth;

    const liveBalances =
        calculateBalancesUntil(
            summaryMonth
        );
    
    const balContainer = document.getElementById('txAccountBalancesContainer');
    if(userAccounts.length === 0) balContainer.innerHTML = emptyStateHTML;
    else {
        balContainer.innerHTML = userAccounts.map(a => `
            <div class="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl">
                <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">${escapeHtml(a.name)}</span>
                <span class="text-[11px] font-bold text-slate-900 dark:text-slate-200">${formatRupiah(liveBalances[a.name] || 0)}</span>
            </div>`).join('');
    }

    const searchInput =
    document.getElementById(
        'txSearchBar'
    );

const kw =
    normalizeText(
        searchInput?.value
    ).toLowerCase();

const filterAcc =
    document.getElementById(
        'txFilterAccount'
    ).value;

const filterCat =
    document.getElementById(
        'txFilterCategory'
    ).value;

const tableBody =
    document.getElementById(
        'txTableBody'
    );

const mobileCards =
    document.getElementById(
        'txMobileCards'
    );

tableBody.innerHTML = '';

if (mobileCards) {
    mobileCards.innerHTML = '';
}

let filteredIncomeTotal = 0;
let filteredExpenseTotal = 0;

const matchesActiveFilters =
    transaction => {
        const transactionName =
            normalizeText(
                transaction.name
            ).toLowerCase();

        const transactionNotes =
            normalizeText(
                transaction.notes
            ).toLowerCase();

        const matchKeyword =
            transactionName.includes(kw) ||
            transactionNotes.includes(kw);

        const matchAccount =
            filterAcc === '' ||
            transaction.account ===
                filterAcc ||
            (
                transaction.isTransfer &&
                transaction.targetAccount ===
                    filterAcc
            );

        const matchCategory =
            filterCat === '' ||
            transaction.category ===
                filterCat;

        return (
            matchKeyword &&
            matchAccount &&
            matchCategory
        );
    };

/*
 * Daftar transaksi mengikuti filter tanggal.
 * Jika kosong, semua tanggal ditampilkan.
 */
const filtered =
    transactions.filter(transaction => {
        const matchMonth =
            selectedMonth
                ? getLocalMonth(
                    transaction.date
                ) === selectedMonth
                : true;

        return (
            matchMonth &&
            matchesActiveFilters(
                transaction
            )
        );
    });

/*
 * Total pendapatan dan pengeluaran:
 * - Bulan terpilih jika ada.
 * - Bulan saat ini jika memilih Semua Tanggal.
 */
const summaryTransactions =
    transactions.filter(transaction => {
        return (
            getLocalMonth(
                transaction.date
            ) === summaryMonth &&
            matchesActiveFilters(
                transaction
            )
        );
    });

summaryTransactions.forEach(
    transaction => {
        if (
            !transaction.isTransfer &&
            isCategoryCalculatedToIncomeExpense(
                transaction.category
            )
        ) {
            filteredIncomeTotal +=
                Number(
                    transaction.debit
                ) || 0;

            filteredExpenseTotal +=
                Number(
                    transaction.credit
                ) || 0;
        }
    }
);

document.getElementById(
    'tx-summary-Income'
).innerText =
    formatRupiah(
        filteredIncomeTotal
    );

document.getElementById(
    'tx-summary-Expenses'
).innerText =
    formatRupiah(
        filteredExpenseTotal
    );

    if (filtered.length === 0) {
    tableBody.innerHTML =
        emptyTableRowHTML(7);

    if (mobileCards) {
        mobileCards.innerHTML =
            emptyStateHTML;
    }
} else {
    const sortedTransactions =
        sortTransactionsNewestFirst(filtered);

    renderMobileTransactionCards(
        sortedTransactions
    );

    sortedTransactions.forEach(t => {
            let colorClass = 'text-rose-600 dark:text-rose-400 font-bold';
            let amt = t.credit;
            let displayCategory = t.category || '-';
            let displayAccount = t.account;

            if (t.isTransfer) {
                colorClass = 'text-blueSystem-500 dark:text-blueSystem-100 font-bold';
                amt = t.credit || t.debit;
                displayCategory = 'Transfer Dana';
                displayAccount = `${t.account} ➔ ${t.targetAccount}`;
            } else if (t.debit > 0) {
                colorClass = 'text-emerald-600 dark:text-emerald-400 font-bold';
                amt = t.debit;
            }

            tableBody.innerHTML += `
                <tr
    onclick="openTransactionDetailModal(
        decodeActionValue('${encodeActionValue(t.id)}')
    )"
    onkeydown="
        if (
            event.target === event.currentTarget &&
            (event.key === 'Enter' || event.key === ' ')
        ) {
            event.preventDefault();

            openTransactionDetailModal(
                decodeActionValue('${encodeActionValue(t.id)}')
            );
        }
    "
    tabindex="0"
    title="Klik untuk melihat detail transaksi"
    class="cursor-pointer
           hover:bg-slate-50 dark:hover:bg-slate-900/60
           focus:bg-slate-50 dark:focus:bg-slate-900/60
           focus:outline-none
           transition-colors"
>
                    <td class="py-2.5 px-4 text-slate-500 whitespace-nowrap">${escapeHtml(formatTanggalIndo(t.date))}</td>
                    <td class="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">${escapeHtml(t.name)}</td>
                    <td class="py-2.5 px-4 ${colorClass}">${formatRupiah(amt, true)}</td>
                    <td class="py-2.5 px-4 text-slate-500">${escapeHtml(displayCategory)}</td>
                    <td class="py-2.5 px-4"><span class="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300 font-medium">${escapeHtml(displayAccount)}</span></td>
                    <td class="py-2.5 px-4 text-slate-400 max-w-[120px] truncate" title="${escapeHtml(t.notes || '')}">${escapeHtml(t.notes || '-')}</td>
                    <td class="py-2.5 px-4 text-center space-x-2 whitespace-nowrap">
    <button
        type="button"
        onclick="event.stopPropagation(); duplicateTransaction(decodeActionValue('${encodeActionValue(t.id)}'))"
        class="text-slate-400 hover:text-violet-500 inline-block"
        title="Duplikat transaksi"
        aria-label="Duplikat transaksi"
    >
        <i
            data-lucide="copy"
            class="w-3.5 h-3.5"
        ></i>
    </button>

    <button onclick="event.stopPropagation(); editTransaction(decodeActionValue('${encodeActionValue(t.id)}'))" class="text-slate-400 hover:text-blueSystem-500 inline-block"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
                        <button onclick="event.stopPropagation(); triggerDeleteConfirm(decodeActionValue('${encodeActionValue(t.id)}'), 'transaction')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                    </td>
                </tr>`;
        });
    }
}

function renderMobileTransactionCards(transactionList) {
    const container = document.getElementById('txMobileCards');
    if (!container) return;

    let html = '';
    let currentDate = '';

    transactionList.forEach(transaction => {
        let amountClass = 'text-rose-600 dark:text-rose-400';
        let amount = Number(transaction.credit) || 0;
        let icon = 'arrow-up-right';
        let iconClass = [
            'bg-rose-50',
            'text-rose-600',
            'dark:bg-rose-950/30',
            'dark:text-rose-400'
        ].join(' ');

        let displayCategory = transaction.category || '-';
        let displayAccount = transaction.account || '-';

        if (transaction.isTransfer) {
            amount = Number(transaction.credit) || Number(transaction.debit) || 0;
            amountClass = 'text-blueSystem-500 dark:text-blueSystem-100';
            icon = 'repeat-2';
            iconClass = [
                'bg-blueSystem-50',
                'text-blueSystem-500',
                'dark:bg-blueSystem-900/30',
                'dark:text-blueSystem-100'
            ].join(' ');
            displayCategory = 'Transfer Dana';
            displayAccount = `${transaction.account} ➔ ${transaction.targetAccount}`;
        } else if (Number(transaction.debit) > 0) {
            amount = Number(transaction.debit) || 0;
            amountClass = 'text-emerald-600 dark:text-emerald-400';
            icon = 'arrow-down-left';
            iconClass = [
                'bg-emerald-50',
                'text-emerald-600',
                'dark:bg-emerald-900/30',
                'dark:text-emerald-400'
            ].join(' ');
        }

        if (transaction.date !== currentDate) {
            if (currentDate !== '') {
                html += `</div></section>`;
            }

            currentDate = transaction.date;
            html += `
                <section>
                    <h3 class="
                        px-1 pb-1.5 pt-1
                        text-xs font-bold
                        text-slate-500 dark:text-slate-400
                    ">
                        ${escapeHtml(formatTanggalIndo(transaction.date))}
                    </h3>

                    <div class="
                        divide-y divide-slate-200
                        dark:divide-slate-800
                    ">
            `;
        }

        const encodedId = encodeActionValue(transaction.id);
        const note = normalizeText(transaction.notes);

        html += `
            <button
                type="button"
                onclick="openTransactionDetailModal(
                    decodeActionValue('${encodedId}')
                )"
                class="
                    w-full py-3.5 px-1
                    flex items-center gap-3
                    text-left
                    active:bg-slate-100/70
                    dark:active:bg-slate-900/70
                    transition-colors
                "
            >
                <span class="
                    shrink-0 w-9 h-9 rounded-xl
                    flex items-center justify-center
                    ${iconClass}
                ">
                    <i data-lucide="${icon}" class="w-4 h-4"></i>
                </span>

                <span class="min-w-0 flex-1">
                    <span class="
                        block text-sm font-semibold
                        text-slate-900 dark:text-white
                        truncate
                    ">
                        ${escapeHtml(transaction.name || '-')}
                    </span>

                    <span class="
                        mt-1 block text-[10px]
                        text-slate-400 truncate
                    ">
                        ${escapeHtml(displayCategory)}
                        ${note ? `
                            <span class="mx-1">•</span>
                            ${escapeHtml(note)}
                        ` : ''}
                    </span>
                </span>

                <span class="shrink-0 text-right" style="max-width: 44%;">
                    <span class="
                        block text-sm font-bold
                        whitespace-nowrap
                        ${amountClass}
                    ">
                        ${formatRupiah(amount, true)}
                    </span>

                    <span class="
                        mt-1 inline-block max-w-full
                        truncate rounded
                        bg-slate-100 dark:bg-slate-800
                        px-1.5 py-0.5
                        text-[9px] font-medium
                        text-slate-500 dark:text-slate-300
                    ">
                        ${escapeHtml(displayAccount)}
                    </span>
                </span>
            </button>
        `;
    });

    if (currentDate !== '') {
        html += `</div></section>`;
    }

    container.innerHTML = html || emptyStateHTML;
}

function getTodayLocalDate() {
    const today = new Date();

    return [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0')
    ].join('-');
}

function getLoanTransactions(loanId, role = '') {
    const normalizedLoanId = normalizeText(loanId);

    return transactions.filter(transaction => {
        if (normalizeText(transaction.loanId) !== normalizedLoanId) {
            return false;
        }

        if (!role) {
            return true;
        }

        return normalizeText(transaction.loanRole).toLowerCase() === role;
    });
}

function getLoanRepaymentAmount(loan, transaction) {
    if (!loan || !transaction || transaction.isTransfer) {
        return 0;
    }

    if (normalizeText(transaction.loanRole).toLowerCase() !== 'repayment') {
        return 0;
    }

    if (loan.type === 'Piutang') {
        return Math.max(0, Number(transaction.debit) || 0);
    }

    return Math.max(0, Number(transaction.credit) || 0);
}

function getLoanProgress(loan) {
    const principal = Math.max(0, Number(loan?.principal) || 0);

    const repaymentTransactions = getLoanTransactions(
        loan?.id,
        'repayment'
    );

    const totalRepayment = repaymentTransactions.reduce(
        (total, transaction) => {
            return total + getLoanRepaymentAmount(loan, transaction);
        },
        0
    );

    const paid = Math.min(principal, totalRepayment);
    const remaining = Math.max(0, principal - totalRepayment);
    const overpayment = Math.max(0, totalRepayment - principal);

    let status = 'unpaid';
    let statusLabel = 'Belum Lunas';

    if (principal > 0 && remaining <= 0) {
        status = 'paid';
        statusLabel = 'Lunas';
    } else if (totalRepayment > 0) {
        status = 'partial';
        statusLabel = 'Dicicil';
    }

    return {
        principal,
        totalRepayment,
        paid,
        remaining,
        overpayment,
        status,
        statusLabel,
        repaymentCount: repaymentTransactions.length
    };
}

function populateLoanMonthFilter() {
    const monthSelect = document.getElementById('loanMonthFilter');

    if (!monthSelect) {
        return;
    }

    const availableMonths = new Set();

    userLoans.forEach(loan => {
        const month = getLocalMonth(loan.date);

        if (month) {
            availableMonths.add(month);
        }
    });

    const sortedMonths = [...availableMonths]
        .sort((firstMonth, secondMonth) =>
            secondMonth.localeCompare(firstMonth)
        );

    monthSelect.innerHTML = `
        <option value="">Semua Bulan</option>
        ${sortedMonths.map(month => `
            <option value="${month}">
                ${escapeHtml(formatTransactionMonthLabel(month))}
            </option>
        `).join('')}
    `;

    if (
        loanMonthFilter &&
        !sortedMonths.includes(loanMonthFilter)
    ) {
        loanMonthFilter = '';
    }

    monthSelect.value = loanMonthFilter;
}

function handleLoanFilterChange() {
    loanTypeFilter =
        document.getElementById('loanTypeFilter')?.value || 'all';

    loanStatusFilter =
        document.getElementById('loanStatusFilter')?.value || 'unpaid';

    loanMonthFilter =
        document.getElementById('loanMonthFilter')?.value || '';

    renderLoansPage();
}

function populateLoanOriginAccountOptions() {
    const accountSelect = document.getElementById('loanOriginAccountInput');

    if (!accountSelect) {
        return;
    }

    accountSelect.innerHTML = userAccounts.length > 0
        ? userAccounts.map(account => `
            <option value="${escapeHtml(account.name)}">
                ${escapeHtml(account.name)}
            </option>
        `).join('')
        : '<option value="">Belum ada akun</option>';
}

function updateLoanTypeButtons() {
    const typeInput = document.getElementById('loanTypeInput');
    const hutangButton = document.getElementById('loanTypeHutangButton');
    const piutangButton = document.getElementById('loanTypePiutangButton');

    if (!typeInput || !hutangButton || !piutangButton) {
        return;
    }

    const selectedType = typeInput.value === 'Hutang'
        ? 'Hutang'
        : 'Piutang';

    const isLocked = typeInput.dataset.locked === 'true';

    const baseClasses = [
        'rounded-lg',
        'px-3',
        'py-2.5',
        'text-xs',
        'font-semibold',
        'transition-all'
    ];

    const inactiveClasses = [
        'text-slate-500',
        'dark:text-slate-400',
        'hover:bg-white/70',
        'dark:hover:bg-slate-800/70'
    ];

    const buttonConfigs = [
        {
            button: hutangButton,
            type: 'Hutang',
            activeClasses: [
                'bg-rose-600',
                'text-white',
                'shadow-sm'
            ]
        },
        {
            button: piutangButton,
            type: 'Piutang',
            activeClasses: [
                'bg-blueSystem-500',
                'text-white',
                'shadow-sm'
            ]
        }
    ];

    buttonConfigs.forEach(config => {
        const isActive = selectedType === config.type;

        config.button.className = [
            ...baseClasses,
            ...(isActive
                ? config.activeClasses
                : inactiveClasses),
            ...(isLocked
                ? ['cursor-not-allowed', 'opacity-70']
                : [])
        ].join(' ');

        config.button.disabled = isLocked;
        config.button.setAttribute(
            'aria-pressed',
            isActive ? 'true' : 'false'
        );
    });
}

function setLoanFormType(type, { force = false } = {}) {
    const typeInput = document.getElementById('loanTypeInput');

    if (!typeInput) {
        return;
    }

    if (
        typeInput.dataset.locked === 'true' &&
        !force
    ) {
        return;
    }

    typeInput.value = type === 'Hutang'
        ? 'Hutang'
        : 'Piutang';

    updateLoanTypeButtons();
    updateLoanPartyField();
    updateLoanOriginFields();
}

function setLoanFormTypeLocked(isLocked) {
    const typeInput = document.getElementById('loanTypeInput');

    if (!typeInput) {
        return;
    }

    typeInput.dataset.locked = isLocked
        ? 'true'
        : 'false';

    updateLoanTypeButtons();
}

function updateLoanDueDateField() {
    const noDueDateInput =
        document.getElementById(
            'loanNoDueDateInput'
        );

    const dueDateInput =
        document.getElementById(
            'loanDueDateInput'
        );

    if (
        !noDueDateInput ||
        !dueDateInput
    ) {
        return;
    }

    const hasNoDueDate =
        noDueDateInput.checked;

    // Keep the native date input enabled so iOS Safari does not
    // change its intrinsic width when the checkbox state changes.
    dueDateInput.disabled = false;
    dueDateInput.readOnly = false;
    dueDateInput.required = !hasNoDueDate;
    dueDateInput.tabIndex = hasNoDueDate ? -1 : 0;
    dueDateInput.setAttribute(
        'aria-disabled',
        hasNoDueDate ? 'true' : 'false'
    );
    dueDateInput.classList.toggle(
        'loan-due-date-disabled',
        hasNoDueDate
    );

    if (hasNoDueDate) {
        dueDateInput.value = '';
    }
}

function showLoanNoticeModal(title, message) {
    const modal = document.getElementById('loanNoticeModal');
    const titleElement = document.getElementById('loanNoticeTitle');
    const messageElement = document.getElementById('loanNoticeMessage');

    if (!modal || !titleElement || !messageElement) {
        return;
    }

    titleElement.textContent = normalizeText(title) || 'Perhatian';
    messageElement.textContent = normalizeText(message);

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.body.classList.add('overflow-hidden');

    lucide.createIcons();
}

function closeLoanNoticeModal() {
    const modal = document.getElementById('loanNoticeModal');

    if (!modal) {
        return;
    }

    modal.classList.add('hidden');
    modal.style.display = '';

    const hasOpenLoanModal = [
        'loanFormModal',
        'loanDetailModal',
        'loanRepaymentModal'
    ].some(modalId => {
        const element = document.getElementById(modalId);
        return element && !element.classList.contains('hidden');
    });

    if (!hasOpenLoanModal) {
        document.body.classList.remove('overflow-hidden');
    }
}

function handleLoanNoticeBackdrop(event) {
    if (event.target?.id === 'loanNoticeModal') {
        closeLoanNoticeModal();
    }
}

function updateLoanPartyField() {
    const typeInput = document.getElementById('loanTypeInput');
    const partyLabel = document.getElementById('loanPartyLabel');
    const partyInput = document.getElementById('loanPartyInput');

    if (!typeInput) {
        return;
    }

    const type = typeInput.value === 'Hutang'
        ? 'Hutang'
        : 'Piutang';

    if (partyLabel) {
        partyLabel.textContent = type === 'Hutang'
            ? 'Pemberi Dana'
            : 'Penerima Dana';
    }

    if (partyInput) {
        partyInput.placeholder = 'Nama Orang / Toko';
    }
}

function updateLoanOriginModeButtons() {
    const modeInput = document.getElementById('loanOriginModeInput');
    const yesButton = document.getElementById('loanOriginYesButton');
    const noButton = document.getElementById('loanOriginNoButton');

    if (!modeInput || !yesButton || !noButton) {
        return;
    }

    const selectedMode = modeInput.value === 'account'
        ? 'account'
        : 'none';

    const baseClasses = [
        'rounded-lg',
        'px-3',
        'py-2',
        'text-xs',
        'font-semibold',
        'transition-all'
    ];

    const inactiveClasses = [
        'text-slate-500',
        'dark:text-slate-400',
        'hover:bg-white/70',
        'dark:hover:bg-slate-800/70'
    ];

    [
        {
            button: yesButton,
            mode: 'account'
        },
        {
            button: noButton,
            mode: 'none'
        }
    ].forEach(config => {
        const isActive = selectedMode === config.mode;

        config.button.className = [
            ...baseClasses,
            ...(isActive
                ? [
                    'bg-blueSystem-500',
                    'text-white',
                    'shadow-sm'
                ]
                : inactiveClasses)
        ].join(' ');

        config.button.setAttribute(
            'aria-pressed',
            isActive ? 'true' : 'false'
        );
    });
}

function setLoanOriginMode(mode) {
    const modeInput = document.getElementById('loanOriginModeInput');

    if (!modeInput) {
        return;
    }

    modeInput.value = mode === 'account'
        ? 'account'
        : 'none';

    updateLoanOriginModeButtons();
    updateLoanOriginFields();
}

function updateLoanOriginFields() {
    const typeInput = document.getElementById('loanTypeInput');
    const modeInput = document.getElementById('loanOriginModeInput');
    const accountContainer = document.getElementById(
        'loanOriginAccountContainer'
    );
    const helpElement = document.getElementById('loanOriginHelp');

    if (!typeInput || !modeInput || !accountContainer) {
        return;
    }

    const type = typeInput.value === 'Hutang'
        ? 'Hutang'
        : 'Piutang';

    const usesAccount = modeInput.value === 'account';

    accountContainer.classList.toggle(
        'hidden',
        !usesAccount
    );

    updateLoanPartyField();
    updateLoanOriginModeButtons();

    if (helpElement) {
        if (usesAccount) {
            helpElement.textContent = type === 'Piutang'
                ? 'Saldo berkurang saat dana diberikan.'
                : 'Saldo bertambah saat dana diterima.';
        } else {
            helpElement.textContent = type === 'Piutang'
                ? 'Saldo tidak berubah pada pencatatan awal.'
                : 'Saldo tidak berubah pada pencatatan awal.';
        }
    }
}

function setLoanFormHeader({ editing = false } = {}) {
    const title = document.getElementById('loanFormTitle');
    const submitText = document.getElementById('loanFormSubmitText');

    if (title) {
        title.textContent = editing
            ? 'Edit Pinjaman'
            : 'Tambah Pinjaman';
    }

    if (submitText) {
        submitText.textContent = editing
            ? 'Simpan Perubahan'
            : 'Simpan Pinjaman';
    }
}

function updateLoanFormLayout({ editing = false } = {}) {
    const originModeContainer = document.getElementById(
        'loanOriginModeContainer'
    );
    const originAccountContainer = document.getElementById(
        'loanOriginAccountContainer'
    );
    const originHelp = document.getElementById('loanOriginHelp');
    const partyField = document.getElementById(
        'loanPartyFieldContainer'
    );

    originModeContainer?.classList.toggle('hidden', editing);
    originAccountContainer?.classList.add('hidden');
    originHelp?.classList.toggle('hidden', editing);
    partyField?.classList.toggle('col-span-2', editing);
}

function openLoanFormModal() {
    const modal = document.getElementById('loanFormModal');
    const form = document.getElementById('loanForm');

    if (!modal || !form) {
        return;
    }

    form.reset();

    const editIdInput = document.getElementById('loanFormEditId');
    const dateInput = document.getElementById('loanDateInput');
    const modeInput = document.getElementById('loanOriginModeInput');
    const noDueDateInput = document.getElementById('loanNoDueDateInput');
    const dueDateInput = document.getElementById('loanDueDateInput');

    if (editIdInput) {
        editIdInput.value = '';
    }

    if (dateInput) {
        dateInput.value = getTodayLocalDate();
    }

    if (modeInput) {
        modeInput.value = 'none';
    }

    if (noDueDateInput) {
        noDueDateInput.checked = true;
    }

    if (dueDateInput) {
        dueDateInput.value = '';
    }

    updateLoanDueDateField();
    setLoanFormTypeLocked(false);
    setLoanFormType('Piutang', { force: true });
    updateLoanFormLayout({ editing: false });
    populateLoanOriginAccountOptions();
    updateLoanOriginFields();
    setLoanFormHeader({ editing: false });

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.body.classList.add('overflow-hidden');

    window.setTimeout(() => {
        document.getElementById('loanNameInput')?.focus();
    }, 50);

    lucide.createIcons();
}

function openLoanEditModal(loanId) {
    const loan = getLoanById(loanId);
    const modal = document.getElementById('loanFormModal');
    const form = document.getElementById('loanForm');

    if (!loan || !modal || !form) {
        return;
    }

    form.reset();

    const editIdInput = document.getElementById('loanFormEditId');

    if (editIdInput) {
        editIdInput.value = loan.id;
    }

    document.getElementById('loanNameInput').value =
        loan.name || '';

    document.getElementById('loanDateInput').value =
        loan.date || '';

    document.getElementById('loanPrincipalInput').value =
        new Intl.NumberFormat('id-ID', {
            minimumFractionDigits:
                Number.isInteger(Number(loan.principal)) ? 0 : 2,
            maximumFractionDigits: 2
        }).format(Number(loan.principal) || 0);

    document.getElementById('loanPartyInput').value =
        loan.party || '';

    document.getElementById('loanNotesInput').value =
        loan.notes || '';

    const noDueDateInput = document.getElementById('loanNoDueDateInput');
    const dueDateInput = document.getElementById('loanDueDateInput');
    const dueDate = normalizeDateValue(loan.dueDate);

    if (noDueDateInput) {
        noDueDateInput.checked = !dueDate;
    }

    if (dueDateInput) {
        dueDateInput.value = dueDate;
    }

    updateLoanDueDateField();
    setLoanFormType(loan.type, { force: true });
    setLoanFormTypeLocked(true);
    updateLoanFormLayout({ editing: true });
    setLoanFormHeader({ editing: true });

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.body.classList.add('overflow-hidden');

    window.setTimeout(() => {
        document.getElementById('loanNameInput')?.focus();
    }, 50);

    lucide.createIcons();
}

function closeLoanFormModal() {
    const modal = document.getElementById('loanFormModal');
    const editIdInput = document.getElementById('loanFormEditId');

    if (!modal) {
        return;
    }

    modal.classList.add('hidden');
    modal.style.display = '';

    if (editIdInput) {
        editIdInput.value = '';
    }

    setLoanFormTypeLocked(false);
    document.body.classList.remove('overflow-hidden');
}

function handleLoanFormBackdrop(event) {
    if (event.target?.id === 'loanFormModal') {
        closeLoanFormModal();
    }
}

function submitLoanForm(event) {
    event.preventDefault();

    const editId = normalizeText(
        document.getElementById('loanFormEditId')?.value
    );

    const type = normalizeText(
        document.getElementById('loanTypeInput')?.value
    );

    const name = normalizeText(
        document.getElementById('loanNameInput')?.value
    );

    const date = normalizeDateValue(
        document.getElementById('loanDateInput')?.value
    );

    const principal = Math.max(
        0,
        parseNominal(
            document.getElementById('loanPrincipalInput')?.value
        )
    );

    const party = normalizeText(
        document.getElementById('loanPartyInput')?.value
    );

    const notes = normalizeText(
        document.getElementById('loanNotesInput')?.value
    );

    const hasNoDueDate = Boolean(
        document.getElementById('loanNoDueDateInput')?.checked
    );

    const dueDate = hasNoDueDate
        ? ''
        : normalizeDateValue(
            document.getElementById('loanDueDateInput')?.value
        );

    if (!['Hutang', 'Piutang'].includes(type)) {
        showLoanNoticeModal('Jenis Tidak Valid', 'Pilih Hutang atau Piutang.');
        return;
    }

    if (!name || !date) {
        showLoanNoticeModal('Data Belum Lengkap', 'Nama dan tanggal wajib diisi.');
        return;
    }

    if (principal <= 0) {
        showLoanNoticeModal('Nominal Tidak Valid', 'Nominal harus lebih besar dari 0.');
        return;
    }

    if (!hasNoDueDate && !dueDate) {
        showLoanNoticeModal('Jatuh Tempo Belum Dipilih', 'Pilih tanggal jatuh tempo atau aktifkan opsi tanpa jatuh tempo.');
        return;
    }

    if (dueDate && dueDate < date) {
        showLoanNoticeModal('Jatuh Tempo Tidak Valid', 'Tanggal jatuh tempo tidak boleh lebih awal daripada tanggal pencatatan.');
        return;
    }

    if (editId) {
        const loan = getLoanById(editId);

        if (!loan) {
            showLoanNoticeModal('Data Tidak Ditemukan', 'Record pinjaman yang diedit tidak ditemukan.');
            return;
        }

        const progress = getLoanProgress(loan);

        if (principal < progress.totalRepayment) {
            showLoanNoticeModal(
                'Nominal Tidak Dapat Diubah',
                'Nominal tidak boleh lebih kecil daripada total ' +
                `pelunasan yang sudah tercatat (${formatRupiah(
                    progress.totalRepayment
                )}).`
            );
            return;
        }

        userLoans = userLoans.map(item => {
            if (item.id !== editId) {
                return item;
            }

            return {
                ...item,
                name,
                date,
                type: item.type,
                principal,
                party,
                notes,
                dueDate
            };
        });

        closeLoanFormModal();
        commitDataChange();
        return;
    }

    const originMode =
        document.getElementById('loanOriginModeInput')?.value || 'none';

    const originAccount = normalizeText(
        document.getElementById('loanOriginAccountInput')?.value
    );

    if (originMode === 'account') {
        const accountExists = userAccounts.some(
            account => account.name === originAccount
        );

        if (!accountExists) {
            showLoanNoticeModal('Akun Belum Dipilih', 'Pilih akun yang saldonya akan berubah.');
            return;
        }
    }

    const loanId = createLoanId();

    userLoans.push({
        id: loanId,
        date,
        name,
        type,
        principal,
        party,
        notes,
        dueDate
    });

    if (originMode === 'account') {
        const categoryExists = userCategories.neutral.some(
            category =>
                category.toLocaleLowerCase('id-ID') ===
                type.toLocaleLowerCase('id-ID')
        );

        if (!categoryExists) {
            userCategories.neutral.push(type);
        }

        transactions.push({
            id: createTransactionId(),
            date,
            name,
            credit: type === 'Piutang' ? principal : 0,
            debit: type === 'Hutang' ? principal : 0,
            category: type,
            account: originAccount,
            targetAccount: '',
            notes: party
                ? `Pihak terkait: ${party}`
                : '',
            loanId,
            loanRole: 'principal',
            isTransfer: false
        });
    }

    closeLoanFormModal();
    commitDataChange();
}

function getLoanById(loanId) {
    const normalizedLoanId = normalizeText(loanId);

    return userLoans.find(
        loan => normalizeText(loan.id) === normalizedLoanId
    ) || null;
}

function getLoanRepaymentCandidateAmount(loan, transaction) {
    if (!loan || !transaction || transaction.isTransfer) {
        return 0;
    }

    return loan.type === 'Piutang'
        ? Math.max(0, Number(transaction.debit) || 0)
        : Math.max(0, Number(transaction.credit) || 0);
}

function isLoanRepaymentCandidate(loan, transaction) {
    if (!loan || !transaction || transaction.isTransfer) {
        return false;
    }

    if (
        normalizeText(transaction.loanId) ||
        normalizeText(transaction.loanRole)
    ) {
        return false;
    }

    const transactionCategory = normalizeText(transaction.category)
        .toLocaleLowerCase('id-ID');

    const loanCategory = normalizeText(loan.type)
        .toLocaleLowerCase('id-ID');

    if (transactionCategory !== loanCategory) {
        return false;
    }

    return getLoanRepaymentCandidateAmount(loan, transaction) > 0;
}

function getLoanRepaymentCandidates(loan) {
    return sortTransactionsNewestFirst(
        transactions.filter(transaction =>
            isLoanRepaymentCandidate(loan, transaction)
        )
    );
}

function setLoanRepaymentMode(mode) {
    loanRepaymentMode = mode === 'new' ? 'new' : 'existing';

    const existingPanel = document.getElementById(
        'loanRepaymentExistingPanel'
    );
    const newPanel = document.getElementById(
        'loanRepaymentNewPanel'
    );
    const existingTab = document.getElementById(
        'loanRepaymentExistingTab'
    );
    const newTab = document.getElementById(
        'loanRepaymentNewTab'
    );

    existingPanel?.classList.toggle(
        'hidden',
        loanRepaymentMode !== 'existing'
    );

    newPanel?.classList.toggle(
        'hidden',
        loanRepaymentMode !== 'new'
    );

    const activeClass = [
        'bg-white',
        'dark:bg-slate-800',
        'text-blueSystem-500',
        'dark:text-white',
        'shadow-sm'
    ];

    const inactiveClass = [
        'text-slate-500',
        'dark:text-slate-400'
    ];

    [existingTab, newTab].forEach(button => {
        if (!button) return;

        button.classList.remove(
            ...activeClass,
            ...inactiveClass
        );
    });

    const activeTab = loanRepaymentMode === 'existing'
        ? existingTab
        : newTab;

    const inactiveTab = loanRepaymentMode === 'existing'
        ? newTab
        : existingTab;

    activeTab?.classList.add(...activeClass);
    inactiveTab?.classList.add(...inactiveClass);
}

function populateLoanRepaymentAccountOptions() {
    const accountSelect = document.getElementById(
        'loanRepaymentAccountInput'
    );

    if (!accountSelect) {
        return;
    }

    accountSelect.innerHTML = userAccounts.length > 0
        ? userAccounts.map(account => `
            <option value="${escapeHtml(account.name)}">
                ${escapeHtml(account.name)}
            </option>
        `).join('')
        : '<option value="">Belum ada akun</option>';
}

function handleLoanRepaymentSearch() {
    loanRepaymentSearchQuery = normalizeText(
        document.getElementById('loanRepaymentSearchInput')?.value
    ).toLocaleLowerCase('id-ID');

    const loan = getLoanById(loanRepaymentTargetId);

    if (loan) {
        renderLoanRepaymentCandidates(loan);
    }
}

function toggleLoanRepaymentCandidate(transactionId, isChecked) {
    const normalizedId = normalizeText(transactionId);

    if (!normalizedId) {
        return;
    }

    if (isChecked) {
        loanRepaymentSelectedIds.add(normalizedId);
    } else {
        loanRepaymentSelectedIds.delete(normalizedId);
    }

    updateLoanRepaymentSelection();
}

function renderLoanRepaymentCandidates(loan) {
    const container = document.getElementById(
        'loanRepaymentCandidateList'
    );

    if (!container) {
        return;
    }

    const progress = getLoanProgress(loan);
    const allCandidates = getLoanRepaymentCandidates(loan);

    const candidates = allCandidates.filter(transaction => {
        if (!loanRepaymentSearchQuery) {
            return true;
        }

        const searchableText = [
            transaction.name,
            transaction.account,
            transaction.notes,
            transaction.category,
            formatTanggalIndo(transaction.date)
        ]
            .map(value => normalizeText(value))
            .join(' ')
            .toLocaleLowerCase('id-ID');

        return searchableText.includes(
            loanRepaymentSearchQuery
        );
    });

    if (candidates.length === 0) {
        const hasSearch = Boolean(loanRepaymentSearchQuery);

        container.innerHTML = `
            <div class="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center">
                <i
                    data-lucide="${hasSearch ? 'search-x' : 'inbox'}"
                    class="w-7 h-7 mx-auto text-slate-300 dark:text-slate-700"
                ></i>

                <p class="mt-2 text-[11px] text-slate-400">
                    ${
                        hasSearch
                            ? 'Tidak ada transaksi yang cocok dengan pencarian.'
                            : 'Belum ada transaksi yang dapat dihubungkan.'
                    }
                </p>

                ${!hasSearch ? `
                    <button
                        type="button"
                        onclick="setLoanRepaymentMode('new')"
                        class="mt-3 text-[11px] font-semibold text-blueSystem-500"
                    >
                        Catat transaksi baru
                    </button>
                ` : ''}
            </div>
        `;

        updateLoanRepaymentSelection();
        lucide.createIcons();
        return;
    }

    container.innerHTML = candidates.map(transaction => {
        const amount = getLoanRepaymentCandidateAmount(
            loan,
            transaction
        );

        const exceedsRemaining = amount > progress.remaining;
        const isSelected = loanRepaymentSelectedIds.has(
            transaction.id
        );

        return `
            <label class="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-3 ${
                exceedsRemaining
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer hover:border-blueSystem-500/50'
            } transition-colors">
                <input
                    type="checkbox"
                    name="loanRepaymentCandidate"
                    value="${escapeHtml(transaction.id)}"
                    data-amount="${amount}"
                    onchange="toggleLoanRepaymentCandidate(this.value, this.checked)"
                    class="shrink-0 w-4 h-4 rounded border-slate-300 text-blueSystem-500 focus:ring-blueSystem-500"
                    ${isSelected ? 'checked' : ''}
                    ${exceedsRemaining ? 'disabled' : ''}
                >

                <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        ${escapeHtml(transaction.name || '-')}
                    </p>

                    <p class="mt-1 text-[10px] text-slate-400 truncate">
                        ${escapeHtml(formatTanggalIndo(transaction.date))}
                        <span class="mx-1">•</span>
                        ${escapeHtml(transaction.account || '-')}
                    </p>

                    ${exceedsRemaining ? `
                        <p class="mt-1 text-[9px] font-medium text-rose-500">
                            Nominal melebihi sisa pinjaman
                        </p>
                    ` : ''}
                </div>

                <span class="shrink-0 text-xs font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    ${formatRupiah(amount)}
                </span>
            </label>
        `;
    }).join('');

    updateLoanRepaymentSelection();
}

function updateLoanRepaymentSelection() {
    const loan = getLoanById(loanRepaymentTargetId);

    if (!loan) {
        loanRepaymentSelectedIds.clear();
    }

    const validCandidateIds = new Set(
        loan
            ? getLoanRepaymentCandidates(loan)
                .map(transaction => transaction.id)
            : []
    );

    Array.from(loanRepaymentSelectedIds).forEach(
        transactionId => {
            if (!validCandidateIds.has(transactionId)) {
                loanRepaymentSelectedIds.delete(transactionId);
            }
        }
    );

    const selectedTotal = loan
        ? transactions.reduce(
            (total, transaction) => {
                if (!loanRepaymentSelectedIds.has(transaction.id)) {
                    return total;
                }

                return total + getLoanRepaymentCandidateAmount(
                    loan,
                    transaction
                );
            },
            0
        )
        : 0;

    const totalElement = document.getElementById(
        'loanRepaymentSelectedTotal'
    );

    if (totalElement) {
        totalElement.textContent = formatRupiah(selectedTotal);
    }
}

function openLoanRepaymentModal(loanId) {
    const loan = getLoanById(loanId);

    if (!loan) {
        return;
    }

    const progress = getLoanProgress(loan);

    if (progress.status === 'paid') {
        showLoanNoticeModal('Pinjaman Sudah Lunas', 'Tidak ada sisa nominal yang perlu dilunasi.');
        return;
    }

    loanRepaymentTargetId = loan.id;
    loanRepaymentSearchQuery = '';
    loanRepaymentSelectedIds.clear();

    const subtitle = document.getElementById(
        'loanRepaymentModalSubtitle'
    );

    if (subtitle) {
        subtitle.textContent = [
            loan.type,
            loan.name,
            loan.party
        ].filter(Boolean).join(' • ');
    }

    const principalElement = document.getElementById(
        'loanRepaymentPrincipal'
    );
    const paidElement = document.getElementById(
        'loanRepaymentPaid'
    );
    const remainingElement = document.getElementById(
        'loanRepaymentRemaining'
    );

    if (principalElement) {
        principalElement.textContent = formatRupiah(progress.principal);
    }

    if (paidElement) {
        paidElement.textContent = formatRupiah(progress.paid);
    }

    if (remainingElement) {
        remainingElement.textContent = formatRupiah(progress.remaining);
    }

    const searchInput = document.getElementById(
        'loanRepaymentSearchInput'
    );

    if (searchInput) {
        searchInput.value = '';
    }

    renderLoanRepaymentCandidates(loan);
    populateLoanRepaymentAccountOptions();

    const dateInput = document.getElementById(
        'loanRepaymentDateInput'
    );
    const amountInput = document.getElementById(
        'loanRepaymentAmountInput'
    );
    const nameInput = document.getElementById(
        'loanRepaymentNameInput'
    );
    const notesInput = document.getElementById(
        'loanRepaymentNotesInput'
    );

    if (dateInput) {
        dateInput.value = getTodayLocalDate();
    }

    if (amountInput) {
        amountInput.value = '';
    }

    if (nameInput) {
        nameInput.value = `Pelunasan ${loan.name}`;
    }

    if (notesInput) {
        notesInput.value = '';
    }

    setLoanRepaymentMode('existing');

    const modal = document.getElementById(
        'loanRepaymentModal'
    );

    if (!modal) {
        return;
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.body.classList.add('overflow-hidden');

    lucide.createIcons();
}

function closeLoanRepaymentModal() {
    const modal = document.getElementById(
        'loanRepaymentModal'
    );

    if (!modal) {
        return;
    }

    modal.classList.add('hidden');
    modal.style.display = '';
    document.body.classList.remove('overflow-hidden');

    loanRepaymentTargetId = null;
    loanRepaymentSearchQuery = '';
    loanRepaymentSelectedIds.clear();

    const searchInput = document.getElementById(
        'loanRepaymentSearchInput'
    );

    if (searchInput) {
        searchInput.value = '';
    }
}

function handleLoanRepaymentBackdrop(event) {
    if (event.target?.id === 'loanRepaymentModal') {
        closeLoanRepaymentModal();
    }
}

function linkSelectedLoanRepayments() {
    const loan = getLoanById(loanRepaymentTargetId);

    if (!loan) {
        closeLoanRepaymentModal();
        return;
    }

    const selectedIds = new Set(
        loanRepaymentSelectedIds
    );

    if (selectedIds.size === 0) {
        showLoanNoticeModal('Belum Ada Transaksi Dipilih', 'Pilih minimal satu transaksi pelunasan.');
        return;
    }

    const validCandidateIds = new Set(
        getLoanRepaymentCandidates(loan)
            .map(transaction => transaction.id)
    );

    const containsInvalidSelection = Array.from(
        selectedIds
    ).some(transactionId =>
        !validCandidateIds.has(transactionId)
    );

    if (containsInvalidSelection) {
        showLoanNoticeModal(
            'Transaksi Tidak Tersedia',
            'Sebagian transaksi yang dipilih sudah tidak dapat dihubungkan. ' +
            'Silakan pilih ulang.'
        );

        renderLoanRepaymentCandidates(loan);
        return;
    }

    const progress = getLoanProgress(loan);

    const selectedTotal = transactions.reduce(
        (total, transaction) => {
            if (!selectedIds.has(transaction.id)) {
                return total;
            }

            return total + getLoanRepaymentCandidateAmount(
                loan,
                transaction
            );
        },
        0
    );

    if (selectedTotal > progress.remaining) {
        showLoanNoticeModal('Nominal Melebihi Sisa', 'Total transaksi yang dipilih melebihi sisa pinjaman.');
        return;
    }

    transactions = transactions.map(transaction => {
        if (!selectedIds.has(transaction.id)) {
            return transaction;
        }

        return {
            ...transaction,
            loanId: loan.id,
            loanRole: 'repayment'
        };
    });

    closeLoanRepaymentModal();
    commitDataChange();
}

function submitNewLoanRepayment(event) {
    event.preventDefault();

    const loan = getLoanById(loanRepaymentTargetId);

    if (!loan) {
        closeLoanRepaymentModal();
        return;
    }

    const progress = getLoanProgress(loan);

    const name = normalizeText(
        document.getElementById('loanRepaymentNameInput')?.value
    );
    const date = normalizeDateValue(
        document.getElementById('loanRepaymentDateInput')?.value
    );
    const amount = Math.max(
        0,
        parseNominal(
            document.getElementById('loanRepaymentAmountInput')?.value
        )
    );
    const account = normalizeText(
        document.getElementById('loanRepaymentAccountInput')?.value
    );
    const notes = normalizeText(
        document.getElementById('loanRepaymentNotesInput')?.value
    );

    if (!name || !date) {
        showLoanNoticeModal('Data Belum Lengkap', 'Nama dan tanggal transaksi wajib diisi.');
        return;
    }

    if (amount <= 0) {
        showLoanNoticeModal('Nominal Tidak Valid', 'Nominal pelunasan harus lebih besar dari 0.');
        return;
    }

    if (amount > progress.remaining) {
        showLoanNoticeModal('Nominal Melebihi Sisa', 'Nominal pelunasan melebihi sisa pinjaman.');
        return;
    }

    const accountExists = userAccounts.some(
        item => item.name === account
    );

    if (!accountExists) {
        showLoanNoticeModal('Akun Belum Dipilih', 'Pilih akun keuangan untuk transaksi pelunasan.');
        return;
    }

    const categoryExists = userCategories.neutral.some(
        category => category.toLocaleLowerCase('id-ID') ===
            loan.type.toLocaleLowerCase('id-ID')
    );

    if (!categoryExists) {
        userCategories.neutral.push(loan.type);
    }

    transactions.push({
        id: createTransactionId(),
        date,
        name,
        credit: loan.type === 'Hutang' ? amount : 0,
        debit: loan.type === 'Piutang' ? amount : 0,
        category: loan.type,
        account,
        targetAccount: '',
        notes,
        loanId: loan.id,
        loanRole: 'repayment',
        isTransfer: false
    });

    closeLoanRepaymentModal();
    commitDataChange();
}

function resetLoanRepaymentSwipeCard(card) {
    if (!card) return;

    card.style.transition = 'transform 180ms ease-out';
    card.style.transform = 'translate3d(0, 0, 0)';

    window.setTimeout(() => {
        card.style.transition = '';
    }, 200);
}

function startLoanRepaymentSwipe(event, loanId) {
    if (window.matchMedia('(min-width: 768px)').matches) {
        return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
    }

    const loan = getLoanById(loanId);

    if (!loan || getLoanProgress(loan).status === 'paid') {
        return;
    }

    const card = event.currentTarget;

    loanRepaymentSwipeState = {
        loanId: loan.id,
        card,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        currentX: 0,
        isDragging: false
    };

    card.style.transition = 'none';

    try {
        card.setPointerCapture(event.pointerId);
    } catch (error) {
    }
}

function moveLoanRepaymentSwipe(event) {
    const state = loanRepaymentSwipeState;

    if (
        !state ||
        state.card !== event.currentTarget ||
        state.pointerId !== event.pointerId
    ) {
        return;
    }

    const distanceX = event.clientX - state.startX;
    const distanceY = event.clientY - state.startY;

    if (!state.isDragging) {
        if (Math.abs(distanceX) < 6 && Math.abs(distanceY) < 6) {
            return;
        }

        if (Math.abs(distanceY) > Math.abs(distanceX)) {
            resetLoanRepaymentSwipeCard(state.card);
            loanRepaymentSwipeState = null;
            return;
        }

        state.isDragging = true;
    }

    const maximumDistance = Math.min(
        140,
        state.card.clientWidth * 0.46
    );

    state.currentX = Math.min(
        maximumDistance,
        Math.max(0, distanceX)
    );

    state.card.style.transform =
        `translate3d(${state.currentX}px, 0, 0)`;

    event.preventDefault();
}

function finishLoanRepaymentSwipe(event) {
    const state = loanRepaymentSwipeState;

    if (
        !state ||
        state.card !== event.currentTarget ||
        state.pointerId !== event.pointerId
    ) {
        return;
    }

    const requiredDistance = Math.min(
        LOAN_REPAYMENT_SWIPE_DISTANCE,
        state.card.clientWidth * 0.3
    );

    const shouldOpenModal =
        state.isDragging &&
        state.currentX >= requiredDistance;

    if (state.isDragging) {
        loanRepaymentSwipeSuppressClickUntil = Date.now() + 450;
    }

    resetLoanRepaymentSwipeCard(state.card);

    const loanId = state.loanId;
    loanRepaymentSwipeState = null;

    if (shouldOpenModal) {
        window.setTimeout(() => {
            openLoanRepaymentModal(loanId);
        }, 180);
    }
}

function cancelLoanRepaymentSwipe(event) {
    const state = loanRepaymentSwipeState;

    if (!state || state.card !== event.currentTarget) {
        return;
    }

    resetLoanRepaymentSwipeCard(state.card);
    loanRepaymentSwipeState = null;
}

function getLoanStatusClasses(status) {
    if (status === 'paid') {
        return [
            'bg-emerald-50',
            'text-emerald-600',
            'dark:bg-emerald-900/30',
            'dark:text-emerald-400'
        ];
    }

    if (status === 'partial') {
        return [
            'bg-amber-50',
            'text-amber-600',
            'dark:bg-amber-900/30',
            'dark:text-amber-400'
        ];
    }

    return [
        'bg-slate-100',
        'text-slate-600',
        'dark:bg-slate-800',
        'dark:text-slate-300'
    ];
}

function renderLoanLinkedTransactionRow(
    loan,
    transaction,
    { allowUnlink = false } = {}
) {
    const amount = normalizeText(transaction.loanRole)
        .toLocaleLowerCase('id-ID') === 'repayment'
        ? getLoanRepaymentAmount(loan, transaction)
        : Math.max(
            0,
            Number(transaction.credit) ||
            Number(transaction.debit) ||
            0
        );

    const encodedTransactionId = encodeActionValue(
        transaction.id
    );

    return `
        <div class="
            flex items-center gap-2
            rounded-xl
            bg-slate-50 dark:bg-slate-900
            border border-slate-200 dark:border-slate-800
            p-3
        ">
            <button
                type="button"
                onclick="openLinkedLoanTransactionDetail(
                    decodeActionValue('${encodedTransactionId}')
                )"
                class="
                    min-w-0 flex-1
                    flex items-center justify-between gap-3
                    text-left
                "
            >
                <div class="min-w-0">
                    <p class="
                        text-xs font-semibold
                        text-slate-900 dark:text-white
                        truncate
                    ">
                        ${escapeHtml(transaction.name || '-')}
                    </p>

                    <p class="mt-1 text-[10px] text-slate-400 truncate">
                        ${escapeHtml(formatTanggalIndo(transaction.date))}
                        <span class="mx-1">•</span>
                        ${escapeHtml(transaction.account || '-')}
                    </p>
                </div>

                <span class="
                    shrink-0 text-xs font-bold
                    text-slate-700 dark:text-slate-200
                    whitespace-nowrap
                ">
                    ${formatRupiah(amount)}
                </span>
            </button>

            ${allowUnlink ? `
                <button
                    type="button"
                    onclick="openLoanUnlinkConfirm(
                        decodeActionValue('${encodedTransactionId}')
                    )"
                    class="
                        shrink-0 w-8 h-8 rounded-lg
                        flex items-center justify-center
                        text-slate-400
                        hover:bg-amber-50 hover:text-amber-600
                        dark:hover:bg-amber-900/30
                        dark:hover:text-amber-400
                        transition-colors
                    "
                    aria-label="Batalkan tautan transaksi"
                    title="Batalkan tautan"
                >
                    <i data-lucide="unlink" class="w-3.5 h-3.5"></i>
                </button>
            ` : ''}
        </div>
    `;
}

function renderLoanDetailModalContent(loanId = loanDetailTargetId) {
    const loan = getLoanById(loanId);

    if (!loan) {
        closeLoanDetailModal();
        return;
    }

    loanDetailTargetId = loan.id;

    const progress = getLoanProgress(loan);
    const isDebt = loan.type === 'Hutang';
    const typeColor = isDebt
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-blueSystem-500 dark:text-blueSystem-100';

    const typeElement = document.getElementById(
        'loanDetailType'
    );
    const nameElement = document.getElementById(
        'loanDetailName'
    );
    const metaElement = document.getElementById(
        'loanDetailMeta'
    );
    const statusElement = document.getElementById(
        'loanDetailStatus'
    );
    const notesElement = document.getElementById(
        'loanDetailNotes'
    );
    const dueDateElement = document.getElementById(
        'loanDetailDueDate'
    );
    const principalTitleElement = document.getElementById(
        'loanDetailPrincipalTitle'
    );

    if (typeElement) {
        typeElement.className = `text-[11px] font-semibold ${typeColor}`;
        typeElement.textContent = loan.type;
    }

    if (nameElement) {
        nameElement.textContent = loan.name || '-';
    }

    if (metaElement) {
        metaElement.textContent = [
            formatTanggalIndo(loan.date),
            loan.party
        ].filter(Boolean).join(' • ');
    }

    if (statusElement) {
        statusElement.className = [
            'shrink-0',
            'inline-flex',
            'rounded-full',
            'px-2.5',
            'py-1',
            'text-[10px]',
            'font-semibold',
            ...getLoanStatusClasses(progress.status)
        ].join(' ');

        statusElement.textContent = progress.statusLabel;
    }

    if (notesElement) {
        const notes = normalizeText(loan.notes);
        notesElement.textContent = notes;
        notesElement.classList.toggle('hidden', !notes);
    }

    if (dueDateElement) {
        const dueDate = normalizeDateValue(loan.dueDate);
        const isOverdue = Boolean(
            dueDate &&
            progress.status !== 'paid' &&
            dueDate < getTodayLocalDate()
        );

        dueDateElement.textContent = dueDate
            ? `Jatuh tempo: ${formatTanggalIndo(dueDate)}${isOverdue ? ' • Terlambat' : ''}`
            : 'Tanpa jatuh tempo';

        dueDateElement.className = isOverdue
            ? 'mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400'
            : 'mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400';
    }

    if (principalTitleElement) {
        principalTitleElement.textContent = isDebt
            ? 'Dana Diterima'
            : 'Dana Diberikan';
    }

    const summaryValues = {
        loanDetailPrincipal: progress.principal,
        loanDetailPaid: progress.paid,
        loanDetailRemaining: progress.remaining
    };

    Object.entries(summaryValues).forEach(
        ([elementId, amount]) => {
            const element = document.getElementById(elementId);

            if (element) {
                element.textContent = formatRupiah(amount);
            }
        }
    );

    const principalTransactions = sortTransactionsNewestFirst(
        getLoanTransactions(loan.id, 'principal')
    );

    const repaymentTransactions = sortTransactionsNewestFirst(
        getLoanTransactions(loan.id, 'repayment')
    );

    const principalCountElement = document.getElementById(
        'loanDetailPrincipalCount'
    );
    const principalList = document.getElementById(
        'loanDetailPrincipalList'
    );

    if (principalCountElement) {
        principalCountElement.textContent = principalTransactions.length > 0
            ? `${principalTransactions.length} transaksi`
            : 'Tanpa arus kas';
    }

    if (principalList) {
        principalList.innerHTML = principalTransactions.length > 0
            ? principalTransactions
                .map(transaction =>
                    renderLoanLinkedTransactionRow(
                        loan,
                        transaction
                    )
                )
                .join('')
            : `
                <div class="
                    rounded-xl
                    border border-dashed
                    border-slate-200 dark:border-slate-800
                    p-4
                    text-[11px] leading-relaxed
                    text-slate-400
                ">
                    Record ini dibuat tanpa arus dana awal.
                </div>
            `;
    }

    const repaymentCountElement = document.getElementById(
        'loanDetailRepaymentCount'
    );
    const repaymentList = document.getElementById(
        'loanDetailRepaymentList'
    );

    if (repaymentCountElement) {
        repaymentCountElement.textContent =
            `${repaymentTransactions.length} transaksi`;
    }

    if (repaymentList) {
        repaymentList.innerHTML = repaymentTransactions.length > 0
            ? repaymentTransactions
                .map(transaction =>
                    renderLoanLinkedTransactionRow(
                        loan,
                        transaction,
                        { allowUnlink: true }
                    )
                )
                .join('')
            : `
                <div class="
                    rounded-xl
                    border border-dashed
                    border-slate-200 dark:border-slate-800
                    p-5 text-center
                ">
                    <i
                        data-lucide="receipt-text"
                        class="w-6 h-6 mx-auto text-slate-300 dark:text-slate-700"
                    ></i>

                    <p class="mt-2 text-[11px] text-slate-400">
                        Belum ada transaksi cicilan atau pelunasan.
                    </p>
                </div>
            `;
    }

    const repaymentButton = document.getElementById(
        'loanDetailRepaymentButton'
    );

    if (repaymentButton) {
        repaymentButton.classList.toggle(
            'hidden',
            progress.status === 'paid'
        );
    }

    const footerActions = document.getElementById(
        'loanDetailFooterActions'
    );

    if (footerActions) {
        footerActions.className = [
            'shrink-0',
            'grid',
            progress.status === 'paid' ? 'grid-cols-2' : 'grid-cols-3',
            'gap-2',
            'px-5',
            'py-4',
            'border-t',
            'border-slate-200',
            'dark:border-slate-800',
            'bg-white',
            'dark:bg-slate-950'
        ].join(' ');
    }

    lucide.createIcons();
}

function openLoanDetailModal(loanId) {
    const loan = getLoanById(loanId);
    const modal = document.getElementById('loanDetailModal');

    if (!loan || !modal) {
        return;
    }

    loanDetailTargetId = loan.id;
    renderLoanDetailModalContent(loan.id);

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.body.classList.add('overflow-hidden');
}

function closeLoanDetailModal() {
    const modal = document.getElementById('loanDetailModal');

    if (!modal) {
        return;
    }

    modal.classList.add('hidden');
    modal.style.display = '';
    document.body.classList.remove('overflow-hidden');

    loanDetailTargetId = null;
}

function handleLoanDetailBackdrop(event) {
    if (event.target?.id === 'loanDetailModal') {
        closeLoanDetailModal();
    }
}

function openLoanRepaymentFromDetail() {
    const loanId = loanDetailTargetId;

    if (!loanId) {
        return;
    }

    closeLoanDetailModal();

    window.setTimeout(() => {
        openLoanRepaymentModal(loanId);
    }, 80);
}


function openLoanEditFromDetail() {
    const loanId = loanDetailTargetId;

    if (!loanId || !getLoanById(loanId)) {
        return;
    }

    closeLoanDetailModal();

    window.setTimeout(() => {
        openLoanEditModal(loanId);
    }, 80);
}

function openLoanDeleteConfirm() {
    const loan = getLoanById(loanDetailTargetId);
    const modal = document.getElementById(
        'loanDeleteConfirmModal'
    );

    if (!loan || !modal) {
        return;
    }

    loanDeleteTargetId = loan.id;

    const progress = getLoanProgress(loan);
    const linkedTransactions = getLoanTransactions(loan.id);

    const nameElement = document.getElementById(
        'loanDeleteConfirmName'
    );
    const infoElement = document.getElementById(
        'loanDeleteConfirmInfo'
    );

    if (nameElement) {
        nameElement.textContent = loan.name || '-';
    }

    if (infoElement) {
        infoElement.textContent = [
            loan.type,
            `Nominal ${formatRupiah(progress.principal)}`,
            `${linkedTransactions.length} transaksi terkait`
        ].join(' • ');
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.body.classList.add('overflow-hidden');

    lucide.createIcons();
}

function closeLoanDeleteConfirm() {
    const modal = document.getElementById(
        'loanDeleteConfirmModal'
    );

    if (!modal) {
        return;
    }

    modal.classList.add('hidden');
    modal.style.display = '';
    loanDeleteTargetId = null;

    const detailModal = document.getElementById(
        'loanDetailModal'
    );

    const detailIsOpen = Boolean(
        detailModal &&
        !detailModal.classList.contains('hidden')
    );

    if (!detailIsOpen) {
        document.body.classList.remove('overflow-hidden');
    }
}

function handleLoanDeleteBackdrop(event) {
    if (event.target?.id === 'loanDeleteConfirmModal') {
        closeLoanDeleteConfirm();
    }
}

function confirmLoanDelete() {
    const loanId = normalizeText(loanDeleteTargetId);
    const loan = getLoanById(loanId);

    if (!loan) {
        closeLoanDeleteConfirm();
        return;
    }

    userLoans = userLoans.filter(
        item => item.id !== loanId
    );

    transactions = transactions.map(transaction => {
        if (normalizeText(transaction.loanId) !== loanId) {
            return transaction;
        }

        return {
            ...transaction,
            loanId: '',
            loanRole: ''
        };
    });

    const deleteModal = document.getElementById(
        'loanDeleteConfirmModal'
    );
    const detailModal = document.getElementById(
        'loanDetailModal'
    );

    deleteModal?.classList.add('hidden');

    if (deleteModal) {
        deleteModal.style.display = '';
    }

    detailModal?.classList.add('hidden');

    if (detailModal) {
        detailModal.style.display = '';
    }

    loanDeleteTargetId = null;
    loanDetailTargetId = null;
    document.body.classList.remove('overflow-hidden');

    commitDataChange();
}

function openLinkedLoanTransactionDetail(transactionId) {
    closeLoanDetailModal();

    window.setTimeout(() => {
        openTransactionDetailModal(transactionId);
    }, 80);
}

function openLoanUnlinkConfirm(transactionId) {
    const transaction = transactions.find(
        item => item.id === String(transactionId)
    );

    if (
        !transaction ||
        normalizeText(transaction.loanRole)
            .toLocaleLowerCase('id-ID') !== 'repayment'
    ) {
        return;
    }

    const loan = getLoanById(transaction.loanId);

    if (!loan) {
        return;
    }

    loanUnlinkTargetTransactionId = transaction.id;

    const nameElement = document.getElementById(
        'loanUnlinkConfirmName'
    );
    const amountElement = document.getElementById(
        'loanUnlinkConfirmAmount'
    );

    if (nameElement) {
        nameElement.textContent = transaction.name || '-';
    }

    if (amountElement) {
        amountElement.textContent = formatRupiah(
            getLoanRepaymentAmount(loan, transaction)
        );
    }

    const modal = document.getElementById(
        'loanUnlinkConfirmModal'
    );

    if (!modal) {
        return;
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.body.classList.add('overflow-hidden');

    lucide.createIcons();
}

function closeLoanUnlinkConfirm() {
    const modal = document.getElementById(
        'loanUnlinkConfirmModal'
    );

    if (!modal) {
        return;
    }

    modal.classList.add('hidden');
    modal.style.display = '';
    loanUnlinkTargetTransactionId = null;
}

function handleLoanUnlinkBackdrop(event) {
    if (event.target?.id === 'loanUnlinkConfirmModal') {
        closeLoanUnlinkConfirm();
    }
}

function confirmLoanRepaymentUnlink() {
    const transactionId = loanUnlinkTargetTransactionId;

    if (!transactionId) {
        return;
    }

    const transaction = transactions.find(
        item => item.id === String(transactionId)
    );

    if (!transaction) {
        closeLoanUnlinkConfirm();
        return;
    }

    const currentLoanId = normalizeText(transaction.loanId);

    transactions = transactions.map(item => {
        if (item.id !== String(transactionId)) {
            return item;
        }

        return {
            ...item,
            loanId: '',
            loanRole: ''
        };
    });

    closeLoanUnlinkConfirm();
    commitDataChange();

    if (
        loanDetailTargetId &&
        loanDetailTargetId === currentLoanId
    ) {
        renderLoanDetailModalContent(currentLoanId);
    }
}

function renderLoanRecordCard(loan) {
    const progress = getLoanProgress(loan);
    const isDebt = loan.type === 'Hutang';
    const encodedLoanId = encodeActionValue(loan.id);

    const amountColor = isDebt
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-blueSystem-500 dark:text-blueSystem-100';

    const statusColor = getLoanStatusClasses(
        progress.status
    ).join(' ');

    const normalizedDueDate = normalizeDateValue(
        loan.dueDate
    );

    const isOverdue = Boolean(
        progress.status !== 'paid' &&
        normalizedDueDate &&
        normalizedDueDate < getTodayLocalDate()
    );

    return `
        <article
            onclick="
                openLoanDetailModal(
                    decodeActionValue('${encodedLoanId}')
                );
            "
            onkeydown="
                if (
                    event.target === event.currentTarget &&
                    (event.key === 'Enter' || event.key === ' ')
                ) {
                    event.preventDefault();

                    openLoanDetailModal(
                        decodeActionValue('${encodedLoanId}')
                    );
                }
            "
            tabindex="0"
            class="
                relative h-full min-w-0
                cursor-pointer
                bg-white dark:bg-slate-950
                border border-slate-200 dark:border-slate-800
                rounded-2xl p-4 shadow-sm
                hover:bg-slate-50 dark:hover:bg-slate-900/60
                focus:outline-none focus:ring-2
                focus:ring-blueSystem-500/30
                transition-colors
            "
        >
            <div class="flex items-center justify-between gap-3">
                <span class="text-[11px] font-semibold ${amountColor}">
                    ${escapeHtml(loan.type)}
                </span>

                <span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusColor}">
                    ${progress.statusLabel}
                </span>
            </div>

            <div class="mt-3 flex items-center justify-between gap-4">
                <div class="min-w-0 flex-1">
                    <h3 class="text-sm font-semibold text-slate-900 dark:text-white break-words">
                        ${escapeHtml(loan.name)}
                    </h3>

                    <p class="mt-1 text-[11px] text-slate-400">
                        ${escapeHtml(formatTanggalIndo(loan.date))}
                        ${loan.party
                            ? `<span class="mx-1">•</span>${escapeHtml(loan.party)}`
                            : ''}
                    </p>

                    ${normalizedDueDate ? `
                        <p class="mt-1 text-[10px] ${
                            isOverdue
                                ? 'font-semibold text-rose-600 dark:text-rose-400'
                                : 'text-slate-400'
                        }">
                            Jatuh tempo ${escapeHtml(
                                formatTanggalIndo(normalizedDueDate)
                            )}
                        </p>
                    ` : ''}
                </div>

                <div class="shrink-0 self-center text-right">
                    <p class="text-[10px] font-medium text-slate-400">
                        ${progress.status === 'paid' ? 'Nominal' : 'Sisa'}
                    </p>

                    <p class="mt-0.5 text-sm font-bold whitespace-nowrap ${amountColor}">
                        ${formatRupiah(
                            progress.status === 'paid'
                                ? progress.principal
                                : progress.remaining
                        )}
                    </p>
                </div>
            </div>

            <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3 text-[10px] text-slate-400">
                <span>
                    Nominal:<br>
                    <strong class="font-semibold text-slate-600 dark:text-slate-300">
                        ${formatRupiah(progress.principal)}
                    </strong>
                </span>

                <span class="text-right">
                    Terbayar:<br>
                    <strong class="font-semibold text-slate-600 dark:text-slate-300">
                        ${formatRupiah(progress.paid)}
                    </strong>
                </span>
            </div>
        </article>
    `;
}

function renderLoansPage() {
    populateLoanMonthFilter();

    const sortedLoans = sortTransactionsNewestFirst(
        normalizeLoans(userLoans)
    );

    const monthFilteredLoans = sortedLoans.filter(loan => {
        return !loanMonthFilter ||
            getLocalMonth(loan.date) === loanMonthFilter;
    });

    const totals = monthFilteredLoans.reduce(
        (result, loan) => {
            const progress = getLoanProgress(loan);
            const isDebt = loan.type === 'Hutang';

            if (isDebt) {
                if (progress.status === 'paid') {
                    result.debtPaid += progress.principal;
                } else {
                    result.debtUnpaid += progress.remaining;
                }
            } else if (progress.status === 'paid') {
                result.receivablePaid += progress.principal;
            } else {
                result.receivableUnpaid += progress.remaining;
            }

            return result;
        },
        {
            debtUnpaid: 0,
            receivableUnpaid: 0,
            debtPaid: 0,
            receivablePaid: 0
        }
    );

    const summaryValues = {
        loanDebtUnpaidTotal: totals.debtUnpaid,
        loanReceivableUnpaidTotal: totals.receivableUnpaid,
        loanDebtPaidTotal: totals.debtPaid,
        loanReceivablePaidTotal: totals.receivablePaid
    };

    Object.entries(summaryValues).forEach(([elementId, amount]) => {
        const element = document.getElementById(elementId);

        if (element) {
            element.textContent = formatRupiah(amount);
        }
    });

    const visibleLoans = monthFilteredLoans.filter(loan => {
        const progress = getLoanProgress(loan);

        const matchesType =
            loanTypeFilter === 'all' ||
            (loanTypeFilter === 'debt' && loan.type === 'Hutang') ||
            (loanTypeFilter === 'receivable' && loan.type === 'Piutang');

        const matchesStatus =
            loanStatusFilter === 'all' ||
            (loanStatusFilter === 'paid' && progress.status === 'paid') ||
            (loanStatusFilter === 'unpaid' && progress.status !== 'paid');

        return matchesType && matchesStatus;
    });

    if (loanStatusFilter === 'all') {
        visibleLoans.sort((firstLoan, secondLoan) => {
            const firstPaid = getLoanProgress(firstLoan).status === 'paid';
            const secondPaid = getLoanProgress(secondLoan).status === 'paid';

            if (firstPaid === secondPaid) {
                return 0;
            }

            return firstPaid ? 1 : -1;
        });
    }

    const container = document.getElementById('loanListContainer');

    if (!container) {
        return;
    }

    if (userLoans.length === 0) {
        container.className = '';
        container.innerHTML = `
            <div class="
                bg-white dark:bg-slate-950
                border border-dashed border-slate-200 dark:border-slate-800
                rounded-2xl p-8 text-center
            ">
                <i data-lucide="landmark" class="
                    w-9 h-9 mx-auto
                    text-slate-300 dark:text-slate-700
                "></i>

                <p class="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Belum ada catatan hutang atau piutang
                </p>

                <p class="mt-1 text-xs text-slate-400">
                    Tambahkan pinjaman baru tanpa mengubah transaksi lama.
                </p>

                <button
                    type="button"
                    onclick="openLoanFormModal()"
                    class="
                        mt-4 inline-flex items-center gap-1.5
                        bg-blueSystem-500 hover:bg-blueSystem-600
                        text-white px-4 py-2.5 rounded-xl
                        text-xs font-semibold transition-colors
                    "
                >
                    <i data-lucide="plus" class="w-4 h-4"></i>
                    Tambah Pinjaman
                </button>
            </div>
        `;
    } else if (visibleLoans.length === 0) {
        container.className = '';
        container.innerHTML = `
            <div class="
                bg-white dark:bg-slate-950
                border border-dashed border-slate-200 dark:border-slate-800
                rounded-2xl p-8 text-center
            ">
                <i data-lucide="search-x" class="
                    w-8 h-8 mx-auto
                    text-slate-300 dark:text-slate-700
                "></i>

                <p class="mt-3 text-xs text-slate-400 italic">
                    Tidak ada pinjaman yang sesuai dengan filter.
                </p>
            </div>
        `;
    } else {
        container.className = 'grid grid-cols-1 xl:grid-cols-2 gap-3';
        container.innerHTML = visibleLoans
            .map(renderLoanRecordCard)
            .join('');
    }

    lucide.createIcons();
}

function handleReportCategoryFilterChange(value) {
    const selectedValue = value || 'all';

    localStorage.setItem(
        'reportCategoryFilter',
        selectedValue
    );

    renderReportsPage();
}

function renderReportsPage() {
    const monthlyTotals = {};
    const monthlyCategories = {};
    const uniqueCategories = new Set();

    transactions.forEach(t => {
        if (!t.date || t.isTransfer) return;
        const month = getLocalMonth(t.date);
        if (!monthlyTotals[month]) monthlyTotals[month] = { income: 0, expense: 0 };
        
        if (isCategoryCalculatedToIncomeExpense(t.category)) {
            monthlyTotals[month].income += (Number(t.debit) || 0);
            monthlyTotals[month].expense += (Number(t.credit) || 0);
        }

        if (t.category && t.credit > 0 && isCategoryCalculatedToIncomeExpense(t.category)) {
            uniqueCategories.add(t.category);
            if (!monthlyCategories[month]) monthlyCategories[month] = {};
            monthlyCategories[month][t.category] = (monthlyCategories[month][t.category] || 0) + Number(t.credit);
        }
    });

    const availableCategories = Array.from(uniqueCategories)
    .sort((a, b) =>
        a.localeCompare(b, 'id-ID')
    );

    const categoryFilter =
        document.getElementById('reportCategoryFilter');

    let selectedCategory =
        localStorage.getItem('reportCategoryFilter') ||
        'all';

    /*
    * Jika kategori yang sebelumnya dipilih sudah dihapus,
    * otomatis kembali ke Semua Kategori.
    */
    if (
        selectedCategory !== 'all' &&
        !availableCategories.includes(selectedCategory)
    ) {
        selectedCategory = 'all';

        localStorage.setItem(
            'reportCategoryFilter',
            'all'
        );
    }

    if (categoryFilter) {
        categoryFilter.innerHTML =
            `<option value="all">Semua Kategori</option>` +
            availableCategories
                .map(category => `
                    <option value="${escapeHtml(category)}">
                        ${escapeHtml(category)}
                    </option>
                `)
                .join('');

        categoryFilter.value = selectedCategory;
    }

    const sortedMonths = Object.keys(monthlyTotals).sort();

    const chartLabels = [];
    const incomeDataset = [];
    const expenseDataset = [];
    const categoryDatasetsInfo = {};
    uniqueCategories.forEach(c => categoryDatasetsInfo[c] = []);

    sortedMonths.forEach(m => {
        const inc = monthlyTotals[m].income;
        const exp = monthlyTotals[m].expense;
        const net = inc - exp;
        const parts = m.split('-');
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
        const readableLabel = `${monthNames[parseInt(parts[1]) - 1]} ${parts[0]}`;

        chartLabels.push(readableLabel);
        incomeDataset.push(inc);
        expenseDataset.push(exp);

        uniqueCategories.forEach(c => {
            categoryDatasetsInfo[c].push((monthlyCategories[m] && monthlyCategories[m][c]) ? monthlyCategories[m][c] : 0);
        });


    });

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#334155' : '#f1f5f9';
    const textColor = isDark ? '#f8fafc' : '#1e293b';

    if (chartIncExpInstance) chartIncExpInstance.destroy();
    chartIncExpInstance = new Chart(document.getElementById('chartIncomeExpense').getContext('2d'), {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [
                { label: 'Total Pendapatan', data: incomeDataset, borderColor: '#10b981', backgroundColor: '#10b981', borderWidth: 3, tension: 0.2 },
                { label: 'Total Pengeluaran', data: expenseDataset, borderColor: '#ef4444', backgroundColor: '#ef4444', borderWidth: 3, tension: 0.2 }
            ]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { 
                    labels: { 
                        color: textColor, 
                        usePointStyle: true, 
                        boxWidth: 6,
                        boxHeight: 6
                    } 
                } 
            }, 
            scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor } } } 
        }
    });

    if (chartCatInstance) {
    chartCatInstance.destroy();
    }

    const catDatasets = [];

    const colors = [
        '#f59e0b',
        '#a855f7',
        '#0056a3',
        '#ec4899',
        '#64748b',
        '#06b6d4',
        '#14b8a6',
        '#f43f5e',
        '#84cc16',
        '#6366f1',
        '#0ea5e9',
        '#d946ef'
    ];

    const displayedCategories =
        selectedCategory === 'all'
            ? availableCategories
            : [selectedCategory];

    displayedCategories.forEach(category => {
        const originalCategoryIndex =
            availableCategories.indexOf(category);

        const color =
            colors[
                originalCategoryIndex % colors.length
            ];

        catDatasets.push({
            label: category,
            data: categoryDatasetsInfo[category] || [],
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2.5,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 6,
            fill: false,
            spanGaps: true
        });
    });

    chartCatInstance = new Chart(
    document
        .getElementById('chartCategoriesTrend')
        .getContext('2d'),
    {
        type: 'line',

        data: {
            labels: chartLabels,
            datasets: catDatasets
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            interaction: {
                mode: 'nearest',
                intersect: false
            },

            plugins: {
                legend: {
                    display: catDatasets.length > 0,

                    labels: {
                        color: textColor,
                        usePointStyle: true,
                        boxWidth: 6,
                        boxHeight: 6
                    }
                },

                tooltip: {
                    callbacks: {
                        label(context) {
                            return (
                                `${context.dataset.label}: ` +
                                formatRupiah(
                                    context.parsed.y,
                                    true
                                )
                            );
                        }
                    }
                }
            },

            scales: {
                x: {
                    grid: {
                        color: gridColor
                    },

                    ticks: {
                        color: textColor
                    }
                },

                y: {
                    beginAtZero: true,

                    grid: {
                        color: gridColor
                    },

                    ticks: {
                        color: textColor,

                        callback(value) {
                            return new Intl.NumberFormat(
                                'id-ID',
                                {
                                    notation: 'compact',
                                    maximumFractionDigits: 1
                                }
                            ).format(value);
                        }
                    }
                }
            }
        }
    }
);
}

function renderSettingsPage() {
    const accBody = document.getElementById('setupAccountsTableBody');
    if (accBody && userAccounts.length === 0) {
        accBody.innerHTML = emptyTableRowHTML(4);
    } else if (accBody) {
        accBody.innerHTML = userAccounts.map((a, index) => `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 draggable-row transition-colors" 
                draggable="true" ondragstart="handleDragStart(event, ${index})" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, ${index})">
                <td class="py-2.5 px-3 text-slate-300 dark:text-slate-600 font-bold select-none text-center cursor-grab">⋮⋮</td>
                <td class="py-2.5 px-3 font-semibold text-slate-950 dark:text-white">${escapeHtml(a.name)}</td>
                <td class="py-2.5 px-3 text-slate-500"><span class="border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full text-[10px] font-medium">${escapeHtml(a.type)}</span></td>
                <td class="py-2.5 px-3 text-center space-x-2.5 whitespace-nowrap">
                    <button onclick="editSetupAccount(decodeActionValue('${encodeActionValue(a.name)}'))" class="text-slate-400 hover:text-blueSystem-500 inline-block"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
                    <button onclick="triggerDeleteConfirm(decodeActionValue('${encodeActionValue(a.name)}'), 'account')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </td>
            </tr>`).join('');
    }

    const catBody = document.getElementById('setupCategoriesTableBody');
    let catHtml = '';
    
    userCategories.income.forEach(cat => {
        catHtml += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
                <td class="py-2.5 px-3 font-semibold text-slate-950 dark:text-white">${escapeHtml(cat)}</td>
                <td class="py-2.5 px-3 text-slate-500"><span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Masuk</span></td>
                <td class="py-2.5 px-3 text-center whitespace-nowrap">
                    <button onclick="triggerDeleteConfirm(decodeActionValue('${encodeActionValue(cat)}'), 'category_in')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </td>
            </tr>`;
    });
    
    userCategories.expense.forEach(cat => {
        catHtml += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
                <td class="py-2.5 px-3 font-semibold text-slate-950 dark:text-white">${escapeHtml(cat)}</td>
                <td class="py-2.5 px-3 text-slate-500"><span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">Keluar</span></td>
                <td class="py-2.5 px-3 text-center whitespace-nowrap">
                    <button onclick="triggerDeleteConfirm(decodeActionValue('${encodeActionValue(cat)}'), 'category_out')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </td>
            </tr>`;
    });

    userCategories.neutral.forEach(cat => {
    catHtml += `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
            <td class="py-2.5 px-3 font-semibold text-slate-950 dark:text-white">${escapeHtml(cat)}</td>
            <td class="py-2.5 px-3 text-slate-500"><span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">Netral</span></td>
            <td class="py-2.5 px-3 text-center whitespace-nowrap">
                <button onclick="triggerDeleteConfirm(decodeActionValue('${encodeActionValue(cat)}'), 'category_neutral')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
            </td>
        </tr>`;
    });

    if (catBody) {
        catBody.innerHTML = catHtml === '' ? emptyTableRowHTML(3) : catHtml;
    }

    lucide.createIcons();
}

let dragSourceIndex = null;
function handleDragStart(e, index) { dragSourceIndex = index; e.dataTransfer.effectAllowed = 'move'; }
function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function handleDrop(e, targetIndex) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (dragSourceIndex === null || dragSourceIndex === targetIndex) return;

    const movedItem = userAccounts.splice(dragSourceIndex, 1)[0];
    userAccounts.splice(targetIndex, 0, movedItem);
    dragSourceIndex = null;
    commitDataChange();
}

function openSettingsModal(type) {
    if (type === 'account') {
        document.getElementById('setupAccTitle').innerHTML = `<i data-lucide="wallet" class="text-blueSystem-500 w-4 h-4"></i> Tambah Akun`;
        document.getElementById('setup-acc-edit-id').value = '';
        document.getElementById('setup-acc-name').value = '';
        document.getElementById('setup-acc-balance').value = '';
        document.getElementById('setupAccountModal').classList.remove('hidden');
        document.getElementById('setupAccountModal').style.display = 'flex';
    } else {
        document.getElementById('setupCatTitle').innerHTML = `<i data-lucide="tag" class="text-blueSystem-500 w-4 h-4"></i> Tambah Kategori`;
        document.getElementById('setup-cat-name').value = '';
        document.getElementById('setupCategoryModal').classList.remove('hidden');
        document.getElementById('setupCategoryModal').style.display = 'flex';
    }
    lucide.createIcons();
}

function closeSettingsModal(type) {
    if (type === 'account') {
        const m = document.getElementById('setupAccountModal');
        m.classList.add('hidden'); m.style.display = '';
    } else {
        const m = document.getElementById('setupCategoryModal');
        m.classList.add('hidden'); m.style.display = '';
    }
}

function saveSetupAccount(e) {
    e.preventDefault();
    const editId = normalizeText(document.getElementById('setup-acc-edit-id').value);
    const name = normalizeText(document.getElementById('setup-acc-name').value);
    const type = normalizeText(document.getElementById('setup-acc-type').value);
    const initBal = normalizeMoney(document.getElementById('setup-acc-balance').value);

    if (!name) {
        alert('Nama akun wajib diisi.');
        return;
    }

    const duplicate = userAccounts.some(a =>
        a.name.toLocaleLowerCase('id-ID') === name.toLocaleLowerCase('id-ID') && a.name !== editId
    );
    if (duplicate) {
        alert('Nama akun ini sudah terdaftar.');
        return;
    }

    if (editId) {
        const index = userAccounts.findIndex(a => a.name === editId);
        if (index === -1) {
            alert('Akun yang diedit tidak ditemukan.');
            return;
        }
        userAccounts[index] = { name, type, initial: initBal };
        transactions = transactions.map(t => ({
            ...t,
            account: t.account === editId ? name : t.account,
            targetAccount: t.targetAccount === editId ? name : t.targetAccount
        }));
    } else {
        userAccounts.push({ name, type, initial: initBal });
    }

    closeSettingsModal('account');
    commitDataChange();
}

function editSetupAccount(name) {
    const acc = userAccounts.find(a => a.name === name);
    if(!acc) return;
    document.getElementById('setupAccTitle').innerHTML = `<i data-lucide="edit-2" class="text-blueSystem-500 w-4 h-4"></i> Edit Akun Keuangan`;
    document.getElementById('setup-acc-edit-id').value = acc.name;
    document.getElementById('setup-acc-name').value = acc.name;
    document.getElementById('setup-acc-type').value = acc.type;
    document.getElementById('setup-acc-balance').value = acc.initial;
    
    document.getElementById('setupAccountModal').classList.remove('hidden');
    document.getElementById('setupAccountModal').style.display = 'flex';
    lucide.createIcons();
}

function saveSetupCategory(e) {
    e.preventDefault();
    const name = normalizeText(document.getElementById('setup-cat-name').value);
    const type = document.getElementById('setup-cat-type').value;

    if (!name) {
        alert('Nama kategori wajib diisi.');
        return;
    }

    const allCategories = [
        ...userCategories.income,
        ...userCategories.expense,
        ...userCategories.neutral
    ];
    if (allCategories.some(category => category.toLocaleLowerCase('id-ID') === name.toLocaleLowerCase('id-ID'))) {
        alert('Kategori ini sudah terdaftar.');
        return;
    }

    if (!['income', 'expense', 'neutral'].includes(type)) {
        alert('Tipe kategori tidak valid.');
        return;
    }

    userCategories[type].push(name);
    closeSettingsModal('category');
    commitDataChange();
}

function setTransactionType(flowType, selectedCategory = '') {
    const typeInput =
        document.getElementById('form-type');

    if (!typeInput) return;

    typeInput.value = flowType;

    const activeColorClasses = [
        'bg-red-500',
        'bg-emerald-500',
        'bg-blueSystem-500',
        'text-white',
        'shadow-sm'
    ];

    const inactiveColorClasses = [
        'text-slate-500',
        'dark:text-slate-400'
    ];

    document
        .querySelectorAll('[data-transaction-type]')
        .forEach(button => {
            const isActive =
                button.dataset.transactionType === flowType;

            button.classList.remove(
                ...activeColorClasses,
                ...inactiveColorClasses
            );

            if (isActive) {
                if (flowType === 'Credit') {
                    button.classList.add(
                        'bg-red-500',
                        'text-white',
                        'shadow-sm'
                    );
                }

                if (flowType === 'Debit') {
                    button.classList.add(
                        'bg-emerald-500',
                        'text-white',
                        'shadow-sm'
                    );
                }

                if (flowType === 'Transfer') {
                    button.classList.add(
                        'bg-blueSystem-500',
                        'text-white',
                        'shadow-sm'
                    );
                }
            } else {
                button.classList.add(
                    'text-slate-500',
                    'dark:text-slate-400'
                );
            }

            button.setAttribute(
                'aria-pressed',
                String(isActive)
            );
        });

    adjustFormInputs();
    updateCategoryDropdown(selectedCategory);
}

function adjustFormInputs() {
    const flowType = document.getElementById('form-type').value;
    const catContainer = document.getElementById('categoryContainer');
    const targetAccContainer = document.getElementById('targetAccountContainer');
    const accLabel = document.getElementById('accountLabel');

    if (flowType === 'Transfer') {
        catContainer.classList.add('hidden');
        targetAccContainer.classList.remove('hidden');
        accLabel.innerText = 'Akun Asal';
    } else {
        catContainer.classList.remove('hidden');
        targetAccContainer.classList.add('hidden');
        accLabel.innerText = 'Akun Keuangan';
    }
}

function openTransactionModal() {
    if (userAccounts.length === 0) {
        openNoAccountModal();
        return;
    }

    const modal = document.getElementById('transactionModal');
    document.getElementById('modalTxTitle').innerHTML = `<i data-lucide="plus-circle" class="text-blueSystem-500 w-4 h-4"></i> Tambah Transaksi`;
    document.getElementById('form-edit-id').value = '';
    document.getElementById('form-name').value = '';
    document.getElementById('form-amount').value = '';
    document.getElementById('form-notes').value = '';
    setTransactionType('Credit');

    const now = new Date();
    document.getElementById('form-date').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    populateFormDropdowns();
    populateFormDropdowns();
    setTransactionType('Credit');

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    lucide.createIcons();
}

function closeTransactionModal() { 
    const modal = document.getElementById('transactionModal');
    modal.classList.add('hidden'); modal.style.display = ''; 
}

function validateLinkedLoanTransactionUpdate(
    transactionId,
    payload
) {
    const existingTransaction = transactions.find(
        transaction => transaction.id === String(transactionId)
    );

    if (!existingTransaction) {
        return {
            valid: true,
            message: ''
        };
    }

    const loanId = normalizeText(existingTransaction.loanId);
    const loanRole = normalizeText(existingTransaction.loanRole)
        .toLocaleLowerCase('id-ID');

    if (!loanId || !['principal', 'repayment'].includes(loanRole)) {
        return {
            valid: true,
            message: ''
        };
    }

    const loan = getLoanById(loanId);

    if (!loan) {
        return {
            valid: true,
            message: ''
        };
    }

    if (payload.isTransfer) {
        return {
            valid: false,
            message:
                'Transaksi ini terhubung dengan record pinjaman dan ' +
                'tidak dapat diubah menjadi transfer. Lepaskan tautannya ' +
                'dari Rincian Pinjaman terlebih dahulu.'
        };
    }

    if (
        normalizeText(payload.category)
            .toLocaleLowerCase('id-ID') !==
        loan.type.toLocaleLowerCase('id-ID')
    ) {
        return {
            valid: false,
            message:
                `Kategori transaksi harus tetap “${loan.type}” selama ` +
                'masih terhubung dengan record pinjaman.'
        };
    }

    const credit = Math.max(0, Number(payload.credit) || 0);
    const debit = Math.max(0, Number(payload.debit) || 0);

    const usesCorrectDirection = loanRole === 'principal'
        ? (
            loan.type === 'Piutang'
                ? credit > 0 && debit === 0
                : debit > 0 && credit === 0
        )
        : (
            loan.type === 'Piutang'
                ? debit > 0 && credit === 0
                : credit > 0 && debit === 0
        );

    if (!usesCorrectDirection) {
        const expectedDirection = loanRole === 'principal'
            ? (
                loan.type === 'Piutang'
                    ? 'Credit / uang keluar'
                    : 'Debit / uang masuk'
            )
            : (
                loan.type === 'Piutang'
                    ? 'Debit / uang masuk'
                    : 'Credit / uang keluar'
            );

        return {
            valid: false,
            message:
                `Transaksi ini terhubung sebagai ${
                    loanRole === 'principal'
                        ? 'transaksi awal'
                        : 'pelunasan'
                } ${loan.type}. Jenis alirannya harus tetap ` +
                `${expectedDirection}.`
        };
    }

    if (loanRole === 'repayment') {
        const newAmount = loan.type === 'Piutang'
            ? debit
            : credit;

        const otherRepaymentTotal = getLoanTransactions(
            loan.id,
            'repayment'
        )
            .filter(transaction => transaction.id !== String(transactionId))
            .reduce(
                (total, transaction) =>
                    total + getLoanRepaymentAmount(loan, transaction),
                0
            );

        const maximumAmount = Math.max(
            0,
            Number(loan.principal) - otherRepaymentTotal
        );

        if (newAmount > maximumAmount) {
            return {
                valid: false,
                message:
                    'Nominal pelunasan terlalu besar. Maksimal nominal ' +
                    `yang dapat digunakan adalah ${formatRupiah(
                        maximumAmount
                    )}.`
            };
        }
    }

    return {
        valid: true,
        message: ''
    };
}

function handleTransactionSubmit(e) {
    e.preventDefault();
    const editId = normalizeText(document.getElementById('form-edit-id').value);
    const flowType = document.getElementById('form-type').value;
    const amount = parseNominal(document.getElementById('form-amount').value);
    const sourceAccount = normalizeText(document.getElementById('form-account').value);
    const targetAccount = normalizeText(document.getElementById('form-target-account').value);
    const category = normalizeText(document.getElementById('form-category').value);
    const name = normalizeText(document.getElementById('form-name').value);
    const date = normalizeDateValue(document.getElementById('form-date').value);

    if (!date || !name || !sourceAccount) {
        alert('Tanggal, deskripsi, dan akun wajib diisi.');
        return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        alert('Nominal harus lebih besar dari 0.');
        return;
    }
    if (!userAccounts.some(account => account.name === sourceAccount)) {
        alert('Akun keuangan tidak valid.');
        return;
    }
    if (flowType === 'Transfer') {
        if (!targetAccount || !userAccounts.some(account => account.name === targetAccount)) {
            alert('Akun tujuan wajib dipilih.');
            return;
        }
        if (sourceAccount === targetAccount) {
            alert('Akun asal dan tujuan tidak boleh sama.');
            return;
        }
    } else if (!category) {
        alert('Kategori wajib dipilih.');
        return;
    }

    const payload = {
        date,
        name,
        notes: normalizeText(document.getElementById('form-notes').value),
        account: sourceAccount,
        isTransfer: flowType === 'Transfer',
        credit: flowType === 'Debit' ? 0 : amount,
        debit: flowType === 'Debit' ? amount : 0,
        category: flowType === 'Transfer' ? '' : category,
        targetAccount: flowType === 'Transfer' ? targetAccount : ''
    };

    if (editId) {
        const validation =
            validateLinkedLoanTransactionUpdate(
                editId,
                payload
            );

        if (!validation.valid) {
            alert(validation.message);
            return;
        }
    }

    if (editId) {
        const index = transactions.findIndex(transaction => transaction.id === editId);
        if (index === -1) {
            alert('Transaksi yang diedit tidak ditemukan.');
            return;
        }
        transactions[index] = { ...transactions[index], ...payload, id: editId };
    } else {
        transactions.push({ ...payload, id: createTransactionId() });
    }

    closeTransactionModal();
    commitDataChange();
}

function openTransactionDetailModal(id) {
    const transaction = transactions.find(
        item => item.id === String(id)
    );

    if (!transaction) {
        console.warn('Transaksi tidak ditemukan:', id);
        return;
    }

    detailTransactionId = transaction.id;

    const isTransfer = Boolean(transaction.isTransfer);
    const isIncome =
        !isTransfer &&
        Number(transaction.debit) > 0;

    const amount = isTransfer
        ? Number(transaction.credit || transaction.debit) || 0
        : isIncome
            ? Number(transaction.debit) || 0
            : Number(transaction.credit) || 0;

    let typeLabel;
    let amountPrefix;
    let iconName;
    let iconContainerClass;
    let badgeClass;
    let amountClass;

    if (isTransfer) {
        typeLabel = 'Transfer Dana';
        amountPrefix = '';
        iconName = 'arrow-right-left';

        iconContainerClass =
            'w-12 h-12 rounded-2xl flex items-center justify-center ' +
            'bg-blue-50 dark:bg-blue-950/40 ' +
            'text-blueSystem-500';

        badgeClass =
            'inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ' +
            'bg-blue-100 text-blue-700 ' +
            'dark:bg-blue-900/30 dark:text-blue-300';

        amountClass =
            'mt-0.5 text-xl font-bold ' +
            'text-blueSystem-500 dark:text-blue-300';
    } else if (isIncome) {
        typeLabel = 'Pendapatan';
        amountPrefix = '+';
        iconName = 'trending-up';

        iconContainerClass =
            'w-12 h-12 rounded-2xl flex items-center justify-center ' +
            'bg-emerald-50 dark:bg-emerald-950/40 ' +
            'text-emerald-600 dark:text-emerald-400';

        badgeClass =
            'inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ' +
            'bg-emerald-100 text-emerald-700 ' +
            'dark:bg-emerald-900/30 dark:text-emerald-400';

        amountClass =
            'mt-0.5 text-xl font-bold ' +
            'text-emerald-600 dark:text-emerald-400';
    } else {
        typeLabel = 'Pengeluaran';
        amountPrefix = '-';
        iconName = 'trending-down';

        iconContainerClass =
            'w-12 h-12 rounded-2xl flex items-center justify-center ' +
            'bg-rose-50 dark:bg-rose-950/40 ' +
            'text-rose-600 dark:text-rose-400';

        badgeClass =
            'inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ' +
            'bg-rose-100 text-rose-700 ' +
            'dark:bg-rose-900/30 dark:text-rose-400';

        amountClass =
            'mt-0.5 text-xl font-bold ' +
            'text-rose-600 dark:text-rose-400';
    }

    const iconContainer = document.getElementById(
        'detailTransactionIconContainer'
    );

    const icon = document.getElementById(
        'detailTransactionIcon'
    );

    const typeElement = document.getElementById(
        'detailTransactionType'
    );

    const amountElement = document.getElementById(
        'detailTransactionAmount'
    );

    iconContainer.className = iconContainerClass;
    icon.setAttribute('data-lucide', iconName);

    typeElement.className = badgeClass;
    typeElement.textContent = typeLabel;

    amountElement.className = amountClass;
    amountElement.textContent =
        `${amountPrefix}${formatRupiah(amount, true)}`;

    document.getElementById(
        'detailTransactionName'
    ).textContent = transaction.name || '-';

    document.getElementById(
        'detailTransactionDate'
    ).textContent = formatTanggalIndo(transaction.date);

    document.getElementById(
        'detailTransactionCategory'
    ).textContent = isTransfer
        ? 'Transfer Dana'
        : transaction.category || '-';

    document.getElementById(
        'detailTransactionAccountLabel'
    ).textContent = isTransfer
        ? 'Akun Asal'
        : 'Akun';

    document.getElementById(
        'detailTransactionAccount'
    ).textContent = transaction.account || '-';

    const targetRow = document.getElementById(
        'detailTransactionTargetRow'
    );

    if (isTransfer) {
        targetRow.classList.remove('hidden');

        document.getElementById(
            'detailTransactionTargetAccount'
        ).textContent = transaction.targetAccount || '-';
    } else {
        targetRow.classList.add('hidden');

        document.getElementById(
            'detailTransactionTargetAccount'
        ).textContent = '-';
    }

    document.getElementById(
        'detailTransactionNotes'
    ).textContent = transaction.notes || '-';

    const editButton = document.getElementById(
        'detailEditTransactionBtn'
    );

    editButton.onclick = function () {
        const transactionId = detailTransactionId;

        closeTransactionDetailModal();

        if (transactionId) {
            editTransaction(transactionId);
        }
    };

    const deleteButton = document.getElementById(
    'detailDeleteTransactionBtn'
    );

    deleteButton.onclick = function () {
        const transactionId = detailTransactionId;

        closeTransactionDetailModal();

        if (transactionId) {
            triggerDeleteConfirm(
                transactionId,
                'transaction'
            );
        }
    };

    const modal = document.getElementById(
        'transactionDetailModal'
    );

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    document.body.classList.add('overflow-hidden');

    lucide.createIcons();
}

function closeTransactionDetailModal() {
    const modal = document.getElementById(
        'transactionDetailModal'
    );

    if (!modal) return;

    modal.classList.add('hidden');
    modal.style.display = '';

    detailTransactionId = null;

    document.body.classList.remove('overflow-hidden');
}

function handleTransactionDetailBackdrop(event) {
    if (
        event.target &&
        event.target.id === 'transactionDetailModal'
    ) {
        closeTransactionDetailModal();
    }
}

function editTransaction(id) {
    const transaction = transactions.find(
        item => item.id === String(id)
    );

    if (!transaction) return;

    document.getElementById('modalTxTitle').innerHTML = `
        <i data-lucide="edit-2" class="text-blueSystem-500 w-4 h-4"></i>
        Edit Transaksi
    `;

    document.getElementById('form-edit-id').value = transaction.id;
    document.getElementById('form-date').value = transaction.date;

    let flowValue = 'Credit';

    if (transaction.isTransfer) {
        flowValue = 'Transfer';
    } else if (Number(transaction.debit) > 0) {
        flowValue = 'Debit';
    }

    populateFormDropdowns();

    setTransactionType(
    flowValue,
    transaction.category || ''
    );

    document.getElementById('form-name').value =
        transaction.name || '';

    const transactionAmount =
        Number(transaction.debit) > 0
            ? Number(transaction.debit)
            : Number(transaction.credit) || 0;

    document.getElementById('form-amount').value =
        new Intl.NumberFormat('id-ID', {
            minimumFractionDigits:
                Number.isInteger(transactionAmount) ? 0 : 2,
            maximumFractionDigits: 2
        }).format(transactionAmount);

    document.getElementById('form-account').value =
        transaction.account || '';

    if (transaction.isTransfer) {
        document.getElementById('form-target-account').value =
            transaction.targetAccount || '';
    }

    document.getElementById('form-notes').value =
        transaction.notes || '';

    const modal = document.getElementById('transactionModal');

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    lucide.createIcons();
}

function duplicateTransaction(id) {
    const transaction =
        transactions.find(
            item =>
                item.id === String(id)
        );

    if (!transaction) return;

    document.getElementById(
        'modalTxTitle'
    ).innerHTML = `
        <i
            data-lucide="copy"
            class="text-violet-500 w-4 h-4"
        ></i>

        Duplikat Transaksi
    `;

    /*
     * Kosongkan ID agar saat disimpan
     * menjadi transaksi baru.
     */
    document.getElementById(
        'form-edit-id'
    ).value = '';

    populateFormDropdowns();

    let flowValue = 'Credit';

    if (transaction.isTransfer) {
        flowValue = 'Transfer';
    } else if (
        Number(transaction.debit) > 0
    ) {
        flowValue = 'Debit';
    }

    if (
        typeof setTransactionType ===
        'function'
    ) {
        setTransactionType(
            flowValue,
            transaction.category || ''
        );
    } else {
        document.getElementById(
            'form-type'
        ).value = flowValue;

        adjustFormInputs();

        updateCategoryDropdown(
            transaction.category || ''
        );
    }

    document.getElementById(
        'form-date'
    ).value = transaction.date || '';

    document.getElementById(
        'form-name'
    ).value = transaction.name || '';

    const transactionAmount =
        Number(transaction.debit) > 0
            ? Number(transaction.debit)
            : Number(transaction.credit) || 0;

    document.getElementById(
        'form-amount'
    ).value = new Intl.NumberFormat(
        'id-ID',
        {
            minimumFractionDigits:
                Number.isInteger(
                    transactionAmount
                )
                    ? 0
                    : 2,

            maximumFractionDigits: 2
        }
    ).format(transactionAmount);

    document.getElementById(
        'form-account'
    ).value = transaction.account || '';

    if (transaction.isTransfer) {
        document.getElementById(
            'form-target-account'
        ).value =
            transaction.targetAccount || '';
    }

    document.getElementById(
        'form-notes'
    ).value = transaction.notes || '';

    const modal =
        document.getElementById(
            'transactionModal'
        );

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    lucide.createIcons();
}

function triggerDeleteConfirm(id, type) {
    deleteTargetId = id;
    deleteTypeContext = type;

    const titleElement = document.getElementById('deleteModalTitle');
    const messageElement = document.getElementById('deleteModalMessage');

    if (type === 'account') {
        titleElement.textContent = `Hapus Akun "${id}"?`;

        if (messageElement) {
            messageElement.textContent =
                'Akun hanya dapat dihapus jika tidak digunakan oleh transaksi.';
        }
    } else if (type.startsWith('category')) {
        titleElement.textContent = `Hapus Kategori "${id}"?`;

        if (messageElement) {
            messageElement.textContent =
                'Kategori hanya dapat dihapus jika tidak digunakan oleh transaksi.';
        }
    } else {
        const transaction = transactions.find(
            item => item.id === String(id)
        );

        const loanId = normalizeText(transaction?.loanId);
        const loanRole = normalizeText(transaction?.loanRole)
            .toLocaleLowerCase('id-ID');
        const loan = loanId ? getLoanById(loanId) : null;

        if (loan && loanRole === 'repayment') {
            titleElement.textContent = 'Hapus Transaksi Pelunasan?';

            if (messageElement) {
                messageElement.textContent =
                    `Transaksi akan dihapus permanen. Sisa dan status ${
                        loan.type.toLocaleLowerCase('id-ID')
                    } “${loan.name}” akan dihitung ulang.`;
            }
        } else if (loan && loanRole === 'principal') {
            const principalLabel = loan.type === 'Hutang'
                ? 'Dana Diterima'
                : 'Dana Diberikan';

            titleElement.textContent = `Hapus ${principalLabel}?`;

            if (messageElement) {
                messageElement.textContent =
                    'Transaksi akan dihapus permanen, tetapi record pinjaman ' +
                    'tetap tersimpan tanpa arus dana awal.';
            }
        } else {
            titleElement.textContent = 'Hapus Transaksi Ini?';

            if (messageElement) {
                messageElement.textContent =
                    'Tindakan ini bersifat permanen.';
            }
        }
    }

    document.getElementById('deleteConfirmModal')
        .classList.remove('hidden');

    lucide.createIcons();
}

function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').classList.add('hidden');
    deleteTargetId = null;
    deleteTypeContext = 'transaction';
}
function confirmDeleteTarget() {
    const targetId = normalizeText(deleteTargetId);

    if (!targetId) {
        closeDeleteModal();
        return;
    }

    if (deleteTypeContext === 'account') {
        const isUsed = transactions.some(transaction =>
            transaction.account === targetId ||
            transaction.targetAccount === targetId
        );

        if (isUsed) {
            alert(
                'Akun ini masih digunakan oleh transaksi. ' +
                'Hapus atau pindahkan transaksi tersebut terlebih dahulu.'
            );
            return;
        }

        userAccounts = userAccounts.filter(
            account => account.name !== targetId
        );
    } else if (deleteTypeContext.startsWith('category_')) {
        const typeMap = {
            category_in: 'income',
            category_out: 'expense',
            category_neutral: 'neutral'
        };

        const categoryType = typeMap[deleteTypeContext];

        if (!categoryType) {
            closeDeleteModal();
            return;
        }

        const isUsed = transactions.some(
            transaction => transaction.category === targetId
        );

        if (isUsed) {
            alert(
                'Kategori ini masih digunakan oleh transaksi. ' +
                'Ubah atau hapus transaksi tersebut terlebih dahulu.'
            );
            return;
        }

        userCategories[categoryType] =
            userCategories[categoryType].filter(
                category => category !== targetId
            );
    } else {
        const transactionExists = transactions.some(
            transaction => transaction.id === targetId
        );

        if (!transactionExists) {
            closeDeleteModal();
            return;
        }

        transactions = transactions.filter(
            transaction => transaction.id !== targetId
        );
    }

    closeDeleteModal();
    commitDataChange();
}


function executeWipeAllData() {
    userAccounts = [];
    transactions = [];
    userLoans = [];

    userCategories = {
        income: [],
        expense: [],
        neutral: []
    };

    closeWipeModal();
    commitDataChange({ sync: false, render: true });

    const { mode, url } = getCloudConfig();
    if (mode === 'sheets' && url) {
        setSyncStatus('🔄 Mengosongkan cloud...');
        triggerCloudPush({ immediate: true });
    }
}

function toggleSettingsModal() { document.getElementById('cloudModal').classList.toggle('hidden'); }
function changeDbMode() { document.getElementById('urlInputContainer').classList.toggle('hidden', document.getElementById('dbMode').value !== 'sheets'); }

function normalizeAppsScriptUrl(rawValue) {
    const value = normalizeText(rawValue);

    if (!value) {
        throw new Error(
            'Masukkan URL Web App Google Apps Script.'
        );
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(value);
    } catch {
        throw new Error(
            'Format URL tidak valid.'
        );
    }

    const validProtocol =
        parsedUrl.protocol === 'https:';

    const validHostname =
        parsedUrl.hostname === 'script.google.com';

    const validPath =
        /^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/
            .test(parsedUrl.pathname);

    if (
        !validProtocol ||
        !validHostname ||
        !validPath
    ) {
        throw new Error(
            'Gunakan URL Web App Apps Script yang ' +
            'berasal dari script.google.com dan ' +
            'berakhir dengan /exec.'
        );
    }

    parsedUrl.search = '';
    parsedUrl.hash = '';

    return parsedUrl
        .toString()
        .replace(/\/$/, '');
}

async function testAppsScriptConnection(url) {
    const separator =
        url.includes('?') ? '&' : '?';

    const response = await fetch(
        `${url}${separator}_=${Date.now()}`,
        {
            method: 'GET',
            cache: 'no-store'
        }
    );

    if (!response.ok) {
        throw new Error(
            `Apps Script merespons dengan HTTP ${response.status}.`
        );
    }

    const result = await response.json();

    if (
        !result ||
        result.status !== 'success' ||
        !Array.isArray(result.userAccounts) ||
        !Array.isArray(result.transactions)
    ) {
        throw new Error(
            result?.message ||
            'URL tersebut bukan database ARAH yang valid.'
        );
    }

    return result;
}

async function saveSettings() {
    const mode =
        document.getElementById('dbMode').value;

    let url =
        document.getElementById('sheetsUrl')
            .value
            .trim();

    try {
        url = normalizeAppsScriptUrl(url);

        setSyncStatus(
            '🔍 Memeriksa koneksi Apps Script...'
        );

        await testAppsScriptConnection(url);
    } catch (error) {
        console.error(
            'Pemeriksaan koneksi gagal:',
            error
        );

        setSyncStatus(
            '⚠️ URL tidak dapat digunakan.'
        );

        alert(
            error.message ||
            'Koneksi Apps Script gagal.'
        );

        return;
    }

    localStorage.setItem('dbMode', 'sheets');
    localStorage.setItem('sheetsUrl', url);

    document.getElementById('sheetsUrl').value =
        url;

    await fetchFromGoogleSheets();

    updateHeaderCloudIndicator();
    toggleSettingsModal();
}

function updateHeaderCloudIndicator() {
    const mode = localStorage.getItem('dbMode');
    const url = localStorage.getItem('sheetsUrl');
    const btn = document.getElementById('cloudIndicatorBtn');
    const dot = document.getElementById('cloudIndicatorDot');
    
    if(mode === 'sheets' && url) {
        btn.className = "p-2 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-xl transition-all relative";
        dot.className = "absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
    } else {
        btn.className = "p-2 bg-slate-100 dark:bg-slate-900 text-slate-400 rounded-xl transition-all relative";
        dot.className = "absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-slate-400";
    }
}

function triggerCloudPush({
    immediate = false
} = {}) {
    const { mode, url } = getCloudConfig();

    if (
    mode !== 'sheets' ||
    !url ||
    isInitialLoading ||
    cloudSyncBlocked
    ) {
        return;
    }

    clearTimeout(cloudSyncTimer);

    if (immediate) {
        cloudSyncTimer = null;

        void flushCloudPush();
        return;
    }

    cloudSyncTimer = setTimeout(() => {
        cloudSyncTimer = null;

        void flushCloudPush();
    }, CLOUD_SYNC_DELAY);
}


async function flushCloudPush() {
    const { mode, url } = getCloudConfig();
    if (mode !== 'sheets' || !url || isInitialLoading) return;

    if (cloudSyncInFlight) {
        cloudSyncQueued = true;
        return;
    }

    cloudSyncInFlight = true;
    cloudSyncQueued = false;
    const mutationVersionAtStart = localMutationVersion;
    const payload = buildCloudPayload();
    const expectedSignature = getWorkspaceSignature(payload);
    setSyncStatus('⬆️ Menyinkronkan...');

    try {
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            cache: 'no-store',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });

        const verified = await verifyCloudSnapshot(url, expectedSignature);
        if (verified) {
            setSyncStatus('✅ Tersinkron.');
        } else {
            setSyncStatus('⚠️ Data terkirim, tetapi verifikasi cloud belum cocok.');
        }
    } catch (error) {
    console.error(
        'Gagal menyinkronkan data:',
        error
    );

    setSyncStatus(
        '⚠️ Sinkronisasi gagal. Hubungkan ulang sebelum menutup halaman.'
    );
    } finally {
    cloudSyncInFlight = false;

    const hasNewerChanges =
        cloudSyncQueued ||
        mutationVersionAtStart !==
            localMutationVersion;

    cloudSyncQueued = false;

    if (hasNewerChanges) {
        triggerCloudPush();
        }
    }
}

async function verifyCloudSnapshot(url, expectedSignature) {
    try {
        const separator = url.includes('?') ? '&' : '?';
        const response = await fetch(`${url}${separator}_=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return false;
        const cloudData = await response.json();
        if (!cloudData || cloudData.status !== 'success') return false;

        const signature =
    getWorkspaceSignature({
        userAccounts:
            cloudData.userAccounts || [],

        userCategories:
            cloudData.userCategories ||
            userCategories,

        transactions:
            cloudData.transactions || [],

        userLoans:
            cloudData.userLoans || []
    });
        return signature === expectedSignature;
    } catch (error) {
        console.warn('Verifikasi cloud gagal:', error);
        return false;
    }
}

function fetchFromGoogleSheets({
    silent = false
} = {}) {
    isInitialLoading = true;
    cloudSyncBlocked = true;

    const url = localStorage.getItem('sheetsUrl');

    if (!url) {
        isInitialLoading = false;
        return;
    }

    if (!silent) {
    showLoader();
    }

    const statusEl = document.getElementById('syncStatus');

    if (statusEl && !silent) {
    statusEl.innerText =
        '🔄 Memuat cloud database...';
    }

    return fetch(url, {
    method: 'GET',
    cache: 'no-store'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(
                `HTTP error ${response.status}`
            );
        }

        return response.json();
    })
    .then(resData => {
        if (
            !resData ||
            resData.status !== 'success'
        ) {
            throw new Error(
                resData?.message ||
                'Respons cloud tidak valid.'
            );
        }

        if (resData.initialized === false) {
            if (statusEl) {
        statusEl.innerText =
            '⬆️ Menyiapkan database cloud...';
            }

            cloudSyncBlocked = false;
            isInitialLoading = false;

            triggerCloudPush({
                immediate: true
            });

            return;
        }

        cloudSyncBlocked = false;

        transactions =
    normalizeTransactions(
        Array.isArray(
            resData.transactions
        )
            ? resData.transactions
            : []
    );

userAccounts =
    normalizeAccounts(
        Array.isArray(
            resData.userAccounts
        )
            ? resData.userAccounts
            : []
    );

userLoans =
    normalizeLoans(
        Array.isArray(
            resData.userLoans
        )
            ? resData.userLoans
            : []
    );
        if (
            resData.userCategories &&
            typeof resData.userCategories === 'object'
        ) {
            userCategories = {
                income: Array.isArray(
                    resData.userCategories.income
                )
                    ? resData.userCategories.income
                        .map(category =>
                            String(category).trim()
                        )
                        .filter(Boolean)
                    : [],

                expense: Array.isArray(
                    resData.userCategories.expense
                )
                    ? resData.userCategories.expense
                        .map(category =>
                            String(category).trim()
                        )
                        .filter(Boolean)
                    : [],

                neutral: Array.isArray(
                    resData.userCategories.neutral
                )
                    ? resData.userCategories.neutral
                        .map(category =>
                            String(category).trim()
                        )
                        .filter(Boolean)
                    : []
            };
        }

        populateFormDropdowns();

        if (statusEl) {
            statusEl.innerText =
                "✅ Cloud database dimuat.";
        }
    })
    .catch(error => {
        console.error(
            'Gagal memuat cloud database:',
            error
        );

        cloudSyncBlocked = true;

        userAccounts = [];

        userCategories = {
            income: [],
            expense: [],
            neutral: []
        };

        transactions = [];
        userLoans = [];

        populateFormDropdowns();

        if (statusEl) {
            statusEl.innerText =
                '⚠️ Database cloud gagal dimuat. Data tidak dapat diubah sampai koneksi berhasil.';
        }
    })
    .finally(() => {
        isInitialLoading = false;

        if (!silent) {
        hideLoader();
        }

        if (!silent && !dashboardChartAnimationPlayed) {
            dashboardChartAnimationPending = true;
        }

        populateFormDropdowns();
        renderDashboard();
    });
}

function formatTanggalIndo(stringIso) {
    const value = normalizeDateValue(stringIso);
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value || '-';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getLocalMonth(dateStr) {
    const value = normalizeDateValue(dateStr);
    const match = value.match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}` : '';
}

function sortTransactionsNewestFirst(transactionList) {
    return transactionList
        .map((transaction, index) => ({
            transaction,
            index
        }))
        .sort((a, b) => {
            const dateComparison =
                String(b.transaction.date || '')
                    .localeCompare(
                        String(a.transaction.date || '')
                    );

            if (dateComparison !== 0) {
                return dateComparison;
            }

            return b.index - a.index;
        })
        .map(item => item.transaction);
}

function openNoAccountModal() {
    document.getElementById('noAccountModal').classList.remove('hidden');
    document.getElementById('noAccountModal').style.display = 'flex';
    lucide.createIcons();
}

function closeNoAccountModal() {
    const modal = document.getElementById('noAccountModal');
    modal.classList.add('hidden');
    modal.style.display = '';
}

function goToSettingsFromModal() {
    closeNoAccountModal();
    switchPage('settings-accounts');
}

/* ================= DEV ONLY: IMPORT CSV =================

document.getElementById('csvFileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function(event) {
        const text = event.target.result;
        processCSV(text);
    };

    reader.readAsText(file);
});

================= END DEV ONLY ================= */

function getTransactionContentSignature(transaction) {
    return simpleHash(JSON.stringify([
        normalizeDateValue(transaction.date),
        normalizeText(transaction.name).toLocaleLowerCase('id-ID'),
        normalizeMoney(transaction.credit),
        normalizeMoney(transaction.debit),
        normalizeText(transaction.category).toLocaleLowerCase('id-ID'),
        normalizeText(transaction.account).toLocaleLowerCase('id-ID'),
        normalizeText(transaction.targetAccount).toLocaleLowerCase('id-ID'),
        normalizeText(transaction.notes).toLocaleLowerCase('id-ID'),
        Boolean(transaction.isTransfer)
    ]));
}

function detectCSVDelimiter(csvText) {
    const firstLine = csvText
        .split(/\r?\n/)
        .find(line => line.trim() !== '') || '';

    let commaCount = 0;
    let semicolonCount = 0;
    let insideQuotes = false;

    for (let i = 0; i < firstLine.length; i++) {
        const char = firstLine[i];

        if (char === '"') {
            if (insideQuotes && firstLine[i + 1] === '"') {
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (!insideQuotes) {
            if (char === ',') commaCount++;
            if (char === ';') semicolonCount++;
        }
    }

    return semicolonCount > commaCount ? ';' : ',';
}

function parseCSVRows(csvText, delimiter) {
    const rows = [];
    let row = [];
    let value = '';
    let insideQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                value += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }

            continue;
        }

        if (char === delimiter && !insideQuotes) {
            row.push(value.trim());
            value = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++;
            }

            row.push(value.trim());

            if (row.some(cell => cell !== '')) {
                rows.push(row);
            }

            row = [];
            value = '';
            continue;
        }

        value += char;
    }

    row.push(value.trim());

    if (row.some(cell => cell !== '')) {
        rows.push(row);
    }

    return rows;
}

function normalizeCSVHeader(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^\uFEFF/, '')
        .replace(/[^a-z0-9]/g, '');
}

function parseCSVAmount(value) {
    if (value === null || value === undefined || value === '') {
        return 0;
    }

    let text = String(value)
        .trim()
        .replace(/\s/g, '')
        .replace(/rp/gi, '')
        .replace(/[^\d,.\-]/g, '');

    if (!text || text === '-') {
        return 0;
    }

    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');

    if (lastComma !== -1 && lastDot !== -1) {
        if (lastComma > lastDot) {
            text = text.replace(/\./g, '').replace(',', '.');
        } else {
            text = text.replace(/,/g, '');
        }
    } else if (lastComma !== -1) {
        const decimalLength = text.length - lastComma - 1;

        if (decimalLength === 1 || decimalLength === 2) {
            text = text.replace(/\./g, '').replace(',', '.');
        } else {
            text = text.replace(/,/g, '');
        }
    } else if (lastDot !== -1) {
        const dotParts = text.split('.');
        const decimalLength = text.length - lastDot - 1;

        if (dotParts.length > 2 || decimalLength === 3) {
            text = text.replace(/\./g, '');
        }
    }

    const amount = Number.parseFloat(text);

    return Number.isFinite(amount) ? amount : 0;
}

function processCSV(csvText) {
    try {
        const delimiter = detectCSVDelimiter(csvText);
        const rows = parseCSVRows(csvText, delimiter);

        if (rows.length === 0) {
            alert('File CSV kosong atau tidak dapat dibaca.');
            return;
        }

        const normalizedFirstRow = rows[0].map(normalizeCSVHeader);

        const hasHeader = normalizedFirstRow.some(header =>
            [
                'tanggal',
                'date',
                'nama',
                'name',
                'credit',
                'kredit',
                'debit',
                'kategori',
                'category',
                'akun',
                'account',
                'targetakun',
                'akuntujuan',
                'catatan',
                'notes'
            ].includes(header)
        );

        let columnMap = {
            date: 0,
            name: 1,
            credit: 2,
            debit: 3,
            category: 4,
            account: 5,
            targetAccount: 6,
            notes: 7
        };

        let startIndex = 0;

        if (hasHeader) {
            startIndex = 1;

            const findColumn = aliases => {
                return normalizedFirstRow.findIndex(header =>
                    aliases.includes(header)
                );
            };

            columnMap = {
                date: findColumn([
                    'tanggal',
                    'date',
                    'tgl'
                ]),
                name: findColumn([
                    'nama',
                    'name',
                    'deskripsi',
                    'description',
                    'item'
                ]),
                credit: findColumn([
                    'credit',
                    'kredit',
                    'uangkeluar',
                    'pengeluaran',
                    'keluar'
                ]),
                debit: findColumn([
                    'debit',
                    'uangmasuk',
                    'pendapatan',
                    'masuk'
                ]),
                category: findColumn([
                    'kategori',
                    'category'
                ]),
                account: findColumn([
                    'akun',
                    'account',
                    'akunasal'
                ]),
                targetAccount: findColumn([
                    'targetakun',
                    'targetaccount',
                    'akuntujuan',
                    'tujuanakun'
                ]),
                notes: findColumn([
                    'catatan',
                    'notes',
                    'note',
                    'keterangan'
                ])
            };
        }

        const getColumnValue = (row, index) => {
            if (index === -1 || index === undefined) return '';
            return String(row[index] || '').trim();
        };

        const importedTransactions = [];
        let skippedRows = 0;

        for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];

            let localMap = { ...columnMap };

            if (!hasHeader && row.length === 7) {
                const sourceAccount = normalizeText(row[5]);
                const lastColumnValue = normalizeText(row[6]);

                const targetAccountExists = userAccounts.some(account =>
                    normalizeText(account.name).toLocaleLowerCase('id-ID') ===
                    lastColumnValue.toLocaleLowerCase('id-ID')
                );

                const isDifferentAccount =
                    sourceAccount.toLocaleLowerCase('id-ID') !==
                    lastColumnValue.toLocaleLowerCase('id-ID');

                if (
                    lastColumnValue &&
                    targetAccountExists &&
                    isDifferentAccount
                ) {
                    localMap.targetAccount = 6;
                    localMap.notes = -1;
                } else {
                    localMap.targetAccount = -1;
                    localMap.notes = 6;
                }
            }
            const date = getColumnValue(row, localMap.date);
            const name = getColumnValue(row, localMap.name);
            const credit = parseCSVAmount(
                getColumnValue(row, localMap.credit)
            );
            const debit = parseCSVAmount(
                getColumnValue(row, localMap.debit)
            );
            const category = getColumnValue(row, localMap.category);
            const account = getColumnValue(row, localMap.account);
            const targetAccount = getColumnValue(
                row,
                localMap.targetAccount
            );
            const notes = getColumnValue(row, localMap.notes);

            if (!date || !name) {
                skippedRows++;
                continue;
            }

            const isTransfer =
                targetAccount !== '' &&
                account !== '' &&
                targetAccount !== account;

            importedTransactions.push({
                id: createTransactionId(i),
                date: date,
                name: name,
                credit: credit,
                debit: debit,
                category: isTransfer ? '' : category,
                account: account,
                targetAccount: isTransfer ? targetAccount : '',
                notes: notes,
                isTransfer: isTransfer
            });
        }

        if (importedTransactions.length === 0) {
            alert(
                'Tidak ada transaksi valid yang ditemukan di dalam file CSV.'
            );
            return;
        }

        transactions.push(...importedTransactions);

        document.getElementById('csvFileInput').value = '';

        let successMessage =
            `${importedTransactions.length} transaksi berhasil diimpor.`;

        if (skippedRows > 0) {
            successMessage +=
                ` ${skippedRows} baris dilewati karena tidak memiliki tanggal atau nama.`;
        }

        openSuccessModal(successMessage);

        commitDataChange();
    } catch (error) {
        console.error('Gagal mengimpor CSV:', error);

        alert(
            'CSV gagal diimpor. Pastikan format kolom dan isi file sudah benar.'
        );
    }
}

// ================= LOADING & SUCCESS MODAL =================
function showLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) loader.classList.remove('hidden');
}
function hideLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) loader.classList.add('hidden');
}

function openSuccessModal(message) {
    document.getElementById('successModalMessage').innerText = message;
    document.getElementById('successModal').classList.remove('hidden');
    document.getElementById('successModal').style.display = 'flex';
    lucide.createIcons();
}
function closeSuccessModal() {
    const modal = document.getElementById('successModal');
    modal.classList.add('hidden');
    modal.style.display = '';
}

let inlineAddTransactionButtonVisible = true;

function updateFloatingTransactionButton() {
    const floatingButton = document.getElementById(
        'floatingAddTransactionBtn'
    );

    if (!floatingButton) return;

    const isDesktop = window.matchMedia(
        '(min-width: 1024px)'
    ).matches;

    const shouldShow =
        activePage === 'transactions' &&
        isDesktop &&
        !inlineAddTransactionButtonVisible;

    if (shouldShow) {
        floatingButton.classList.remove(
            'opacity-0',
            'translate-y-3',
            'scale-95',
            'pointer-events-none'
        );

        floatingButton.classList.add(
            'opacity-100',
            'translate-y-0',
            'scale-100',
            'pointer-events-auto'
        );

        floatingButton.setAttribute(
            'aria-hidden',
            'false'
        );

        floatingButton.tabIndex = 0;
    } else {
        floatingButton.classList.remove(
            'opacity-100',
            'translate-y-0',
            'scale-100',
            'pointer-events-auto'
        );

        floatingButton.classList.add(
            'opacity-0',
            'translate-y-3',
            'scale-95',
            'pointer-events-none'
        );

        floatingButton.setAttribute(
            'aria-hidden',
            'true'
        );

        floatingButton.tabIndex = -1;
    }
}

function initializeFloatingTransactionButton() {
    const inlineButton =
        document.getElementById(
            'inlineAddTransactionBtn'
        );

    if (!inlineButton) return;

    if (!('IntersectionObserver' in window)) {
        return;
    }

    const observer = new IntersectionObserver(
        entries => {
            const entry = entries[0];

            inlineAddTransactionButtonVisible =
                entry.isIntersecting;

            updateFloatingTransactionButton();
        },
        {
            root: null,
            threshold: 0.15
        }
    );

    observer.observe(inlineButton);

    window.addEventListener(
        'resize',
        updateFloatingTransactionButton
    );
}

document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;

    const modal = document.getElementById(
        'transactionDetailModal'
    );

    if (
        modal &&
        !modal.classList.contains('hidden')
    ) {
        closeTransactionDetailModal();
    }
});