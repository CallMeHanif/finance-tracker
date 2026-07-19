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

let activePage = 'dashboard';
let deleteTargetId = null;
let deleteTypeContext = 'transaction';
let detailTransactionId = null;
let chartIncExpInstance = null;
let chartCatInstance = null;
let chartSaldoInstance = null;
let isBalanceObscured = false;
let isInitialLoading = false;
let cloudSyncTimer = null;
let cloudSyncInFlight = false;
let cloudSyncQueued = false;
let cloudFetchInFlight = false;
let localMutationVersion = 0;
let transactionSearchTimer = null;

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

function normalizeTransactions(input) {
    if (!Array.isArray(input)) return [];
    const byId = new Map();

    input.forEach((transaction, index) => {
        if (!transaction || typeof transaction !== 'object') return;
        const normalized = {
            id: normalizeText(transaction.id),
            date: normalizeDateValue(transaction.date),
            name: normalizeText(transaction.name),
            credit: Math.max(0, normalizeMoney(transaction.credit)),
            debit: Math.max(0, normalizeMoney(transaction.debit)),
            category: normalizeText(transaction.category),
            account: normalizeText(transaction.account),
            targetAccount: normalizeText(transaction.targetAccount),
            notes: normalizeText(transaction.notes),
            isTransfer: Boolean(transaction.isTransfer || normalizeText(transaction.targetAccount))
        };

        if (!normalized.id) {
            const legacySignature = JSON.stringify([
                normalized.date, normalized.name, normalized.credit, normalized.debit,
                normalized.category, normalized.account, normalized.targetAccount,
                normalized.notes, index
            ]);
            normalized.id = `legacy-${simpleHash(legacySignature)}`;
        }

        if (normalized.isTransfer) {
            normalized.category = '';
            const amount = normalized.credit || normalized.debit;
            normalized.credit = amount;
            normalized.debit = 0;
        }

        byId.set(normalized.id, normalized);
    });

    return Array.from(byId.values());
}

function commitDataChange({
    sync = true,
    render = true
} = {}) {
    userAccounts = normalizeAccounts(userAccounts);
    userCategories = normalizeCategories(userCategories);
    transactions = normalizeTransactions(transactions);

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
        userAccounts: normalizeAccounts(userAccounts),
        userCategories: normalizeCategories(userCategories),
        transactions: normalizeTransactions(transactions),
        clientUpdatedAt: new Date().toISOString()
    };
}

function getWorkspaceSignature(data = null) {
    const source = data || {
        userAccounts,
        userCategories,
        transactions
    };
    return simpleHash(JSON.stringify({
        userAccounts: normalizeAccounts(source.userAccounts || []),
        userCategories: normalizeCategories(source.userCategories || {}),
        transactions: normalizeTransactions(source.transactions || [])
    }));
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
    document.getElementById('dashboardMonthFilter').value = currentYearMonth;
    document.getElementById('txMonthFilter').value = currentYearMonth;

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
    switchPage('dashboard');
    initializeFloatingTransactionButton();

    const { mode, url } = getCloudConfig();
    if (mode === 'sheets' && url) {
        await fetchFromGoogleSheets();
    }

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
    const textBtn = document.getElementById('obscureTextBtn');
    if (isBalanceObscured) {
        iconBtn.setAttribute('data-lucide', 'eye-off');
        textBtn.innerText = "Tampilkan Saldo";
    } else {
        iconBtn.setAttribute('data-lucide', 'eye');
        textBtn.innerText = "Sembunyikan Saldo";
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
    document.querySelectorAll('.page-content').forEach(el => el.classList.add('hidden'));
    document.getElementById('page-' + pageId).classList.remove('hidden');
    
    document.querySelectorAll('header nav button').forEach(btn => {
        btn.className = "px-4 py-1.5 rounded-lg transition-all text-slate-500 dark:text-slate-400 hover:text-slate-900";
    });
    document.querySelectorAll('#mobileMenu nav button').forEach(btn => {
        btn.className = "w-full text-left px-4 py-2.5 rounded-xl transition-all hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300";
    });
    
    const activeBtn = document.getElementById('nav-' + pageId);
    if(activeBtn) activeBtn.className = "px-4 py-1.5 rounded-lg transition-all bg-white dark:bg-slate-800 text-blueSystem-500 dark:text-white shadow-sm";
    
    const activeMobBtn = document.getElementById('nav-mob-' + pageId);
    if(activeMobBtn) activeMobBtn.className = "w-full text-left px-4 py-2.5 rounded-xl transition-all bg-slate-100 dark:bg-slate-900 text-blueSystem-500 dark:text-white font-bold";

    renderDashboard();
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

function populateFormDropdowns() {
    userAccounts = normalizeAccounts(userAccounts);
    userCategories = normalizeCategories(userCategories);

    const accountHtml = userAccounts.length > 0
        ? userAccounts.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('')
        : `<option value="">-- Buat Akun Dulu --</option>`;

    const accountSelect = document.getElementById('form-account');
    const targetAccountSelect = document.getElementById('form-target-account');
    const filterAccountSelect = document.getElementById('txFilterAccount');
    if (accountSelect) accountSelect.innerHTML = accountHtml;
    if (targetAccountSelect) targetAccountSelect.innerHTML = accountHtml;
    if (filterAccountSelect) filterAccountSelect.innerHTML = `<option value="">Semua Akun</option>` + accountHtml;

    const allCategories = [
        ...userCategories.income,
        ...userCategories.expense,
        ...userCategories.neutral
    ];
    const filterCategorySelect = document.getElementById('txFilterCategory');
    if (filterCategorySelect) {
        filterCategorySelect.innerHTML = `<option value="">Semua Kategori</option>` +
            [...new Set(allCategories)].map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }
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

function isCategoryCalculatedToIncomeExpense(categoryName) {
    const category = normalizeText(categoryName);
    if (!category) return false;
    const neutralCategories = userCategories.neutral || [];
    return !neutralCategories.some(item => item.toLocaleLowerCase('id-ID') === category.toLocaleLowerCase('id-ID'));
}

function renderDashboard() {
    const dashMonth = document.getElementById('dashboardMonthFilter').value;
    const txMonth = document.getElementById('txMonthFilter').value;

    if (activePage === 'dashboard') { renderDashboardPage(dashMonth); } 
    else if (activePage === 'transactions') { renderTransactionsPage(txMonth); } 
    else if (activePage === 'reports') { renderReportsPage(); }
    else if (activePage === 'settings') { renderSettingsPage(); }
    lucide.createIcons();
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

    const ctx = document.getElementById('chartSaldoDonut');
    if(ctx) {
        if (chartSaldoInstance) chartSaldoInstance.destroy();
        const dataSaldo = [totalBank, totalSaving, totalCash, totalWallet];
        
        if (netWorth === 0 && userAccounts.length === 0) {
             chartSaldoInstance = new Chart(ctx.getContext('2d'), { type: 'doughnut', data: { datasets: [{ data: [1], backgroundColor: ['#e2e8f0'] }] }, options: { cutout: '75%', responsive: true, maintainAspectRatio: false, plugins: { tooltip: { enabled: false } } } });
        } else {
            chartSaldoInstance = new Chart(ctx.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Dana di Bank', 'Dana Tabungan', 'Dana Cash', 'Dana E Wallet'],
                    datasets: [{ data: dataSaldo, backgroundColor: ['#3b82f6', '#10b981', '#ef4444', '#a855f7'], borderWidth: 2, borderColor: document.documentElement.classList.contains('dark') ? '#020617' : '#ffffff', hoverOffset: 4 }]
                },
                options: { cutout: '75%', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: true } } }
            });
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

    const recentTx = sortTransactionsNewestFirst(transactions)
    .slice(0, 5);
    const tableBody = document.getElementById('dashRecentTxTable');
    
    if (recentTx.length === 0) {
        tableBody.innerHTML = emptyTableRowHTML(6);
    } else {
        tableBody.innerHTML = '';
        recentTx.forEach(t => {
            let jenisColor = 'text-rose-600';
            let bgPill = 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
            let amtStr = `-${formatRupiah(t.credit, true)}`;
            
            if (t.isTransfer) {
                jenisColor = 'text-blueSystem-500';
                bgPill = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
                amtStr = formatRupiah(t.credit || t.debit, true);
            } else if (t.debit > 0) {
                jenisColor = 'text-emerald-600';
                bgPill = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
                amtStr = `+${formatRupiah(t.debit, true)}`;
            }

            tableBody.innerHTML += `
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
                    <td class="py-3 px-4 whitespace-nowrap text-slate-500">${escapeHtml(formatTanggalIndo(t.date))}</td>
                    <td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">${escapeHtml(t.name)}</td>
                    <td class="py-3 px-4"><span class="px-2 py-0.5 rounded text-[10px] font-semibold ${bgPill}">${escapeHtml(t.category || 'Transfer')}</span></td>
                    <td class="py-3 px-4 ${jenisColor} font-bold">${amtStr}</td>
                    <td class="py-3 px-4 text-slate-500">${escapeHtml(t.isTransfer ? `${t.account} ➔ ${t.targetAccount}` : t.account)}</td>
                    <td class="py-3 px-4 text-slate-400 truncate max-w-[120px]" title="${escapeHtml(t.notes || '')}">${escapeHtml(t.notes || '-')}</td>
                </tr>`;
        });
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
    const liveBalances = calculateBalancesUntil(selectedMonth);
    
    const balContainer = document.getElementById('txAccountBalancesContainer');
    if(userAccounts.length === 0) balContainer.innerHTML = emptyStateHTML;
    else {
        balContainer.innerHTML = userAccounts.map(a => `
            <div class="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl">
                <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">${escapeHtml(a.name)}</span>
                <span class="text-[11px] font-bold text-slate-900 dark:text-slate-200">${formatRupiah(liveBalances[a.name] || 0)}</span>
            </div>`).join('');
    }

    const kw = document.getElementById('txSearchBar').value.toLowerCase();
    const filterAcc = document.getElementById('txFilterAccount').value;
    const filterCat = document.getElementById('txFilterCategory').value;

    const tableBody = document.getElementById('txTableBody');
    tableBody.innerHTML = '';

    let filteredIncomeTotal = 0, filteredExpenseTotal = 0;

    const filtered = transactions.filter(t => {
        const matchMonth = selectedMonth ? getLocalMonth(t.date) === selectedMonth : true;
        const matchKw = t.name.toLowerCase().includes(kw) || (t.notes && t.notes.toLowerCase().includes(kw));
        const matchAcc = filterAcc === "" ? true : (t.account === filterAcc || (t.isTransfer && t.targetAccount === filterAcc));
        const matchCat = filterCat === "" ? true : (t.category === filterCat);
        return matchMonth && matchKw && matchAcc && matchCat;
    });

    filtered.forEach(t => {
        if (!t.isTransfer && isCategoryCalculatedToIncomeExpense(t.category)) {
            filteredIncomeTotal += (Number(t.debit) || 0);
            filteredExpenseTotal += (Number(t.credit) || 0);
        }
    });

    document.getElementById('tx-summary-Income').innerText = formatRupiah(filteredIncomeTotal, true);
    document.getElementById('tx-summary-Expenses').innerText = formatRupiah(filteredExpenseTotal, true);

    if(filtered.length === 0) {
        tableBody.innerHTML = emptyTableRowHTML(7);
    } else {
        sortTransactionsNewestFirst(filtered).forEach(t => {
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
                        <button onclick="event.stopPropagation(); editTransaction(decodeActionValue('${encodeActionValue(t.id)}'))" class="text-slate-400 hover:text-blueSystem-500 inline-block"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
                        <button onclick="event.stopPropagation(); triggerDeleteConfirm(decodeActionValue('${encodeActionValue(t.id)}'), 'transaction')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                    </td>
                </tr>`;
        });
    }
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
    const tableBody = document.getElementById('reportsTableBody');
    tableBody.innerHTML = '';

    if (sortedMonths.length === 0) {
        tableBody.innerHTML = emptyTableRowHTML(4);
    }

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

        tableBody.innerHTML += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
                <td class="py-3 px-4 font-bold text-slate-900 dark:text-white">${readableLabel}</td>
                <td class="py-3 px-4 text-emerald-600 font-medium">${formatRupiah(inc, true)}</td>
                <td class="py-3 px-4 text-rose-600 font-medium">${formatRupiah(exp, true)}</td>
                <td class="py-3 px-4 ${net >= 0 ? 'text-emerald-600 font-bold':'text-rose-600 font-bold'}">${formatRupiah(net, true)}</td>
            </tr>`;
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
    if (userAccounts.length === 0) {
        accBody.innerHTML = emptyTableRowHTML(4);
    } else {
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

    catBody.innerHTML = catHtml === '' ? emptyTableRowHTML(3) : catHtml;
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
    document.getElementById('form-type').value = 'Credit';

    const now = new Date();
    document.getElementById('form-date').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    populateFormDropdowns();
    adjustFormInputs();
    updateCategoryDropdown();
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    lucide.createIcons();
}

function closeTransactionModal() { 
    const modal = document.getElementById('transactionModal');
    modal.classList.add('hidden'); modal.style.display = ''; 
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

    document.getElementById('form-type').value = flowValue;

    adjustFormInputs();
    updateCategoryDropdown(transaction.category || '');

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

function triggerDeleteConfirm(id, type) {
    deleteTargetId = id;
    deleteTypeContext = type;
    
    const titleEl = document.getElementById('deleteModalTitle');
    if(type === 'account') titleEl.innerText = `Hapus Akun "${id}"?`;
    else if(type.startsWith('category')) titleEl.innerText = `Hapus Kategori "${id}"?`;
    else titleEl.innerText = "Hapus Transaksi Ini?";
    
    document.getElementById('deleteConfirmModal').classList.remove('hidden');
}
function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').classList.add('hidden');
    deleteTargetId = null;
    deleteTypeContext = 'transaction';
}
document.getElementById('confirmDeleteBtn').onclick = () => {
    if (!deleteTargetId) return;

    if (deleteTypeContext === 'account') {
        const isUsed = transactions.some(transaction =>
            transaction.account === deleteTargetId || transaction.targetAccount === deleteTargetId
        );
        if (isUsed) {
            alert('Akun ini masih digunakan oleh transaksi. Hapus atau pindahkan transaksi tersebut terlebih dahulu.');
            return;
        }
        userAccounts = userAccounts.filter(account => account.name !== deleteTargetId);
    } else if (deleteTypeContext.startsWith('category_')) {
        const typeMap = {
            category_in: 'income',
            category_out: 'expense',
            category_neutral: 'neutral'
        };
        const categoryType = typeMap[deleteTypeContext];
        if (!categoryType) return;

        const isUsed = transactions.some(transaction => transaction.category === deleteTargetId);
        if (isUsed) {
            alert('Kategori ini masih digunakan oleh transaksi. Ubah atau hapus transaksi tersebut terlebih dahulu.');
            return;
        }
        userCategories[categoryType] = userCategories[categoryType].filter(category => category !== deleteTargetId);
    } else {
        transactions = transactions.filter(transaction => transaction.id !== String(deleteTargetId));
    }

    closeDeleteModal();
    commitDataChange();
};

function executeWipeAllData() {
    userAccounts = [];
    transactions = [];
    userCategories = { income: [], expense: [], neutral: [] };

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

        const signature = getWorkspaceSignature({
            userAccounts: cloudData.userAccounts || [],
            userCategories: cloudData.userCategories || userCategories,
            transactions: cloudData.transactions || []
        });
        return signature === expectedSignature;
    } catch (error) {
        console.warn('Verifikasi cloud gagal:', error);
        return false;
    }
}

function fetchFromGoogleSheets() {
    isInitialLoading = true;
    cloudSyncBlocked = true;

    const url = localStorage.getItem('sheetsUrl');

    if (!url) {
        isInitialLoading = false;
        return;
    }

    showLoader();

    const statusEl = document.getElementById('syncStatus');

    if (statusEl) {
        statusEl.innerText = "🔄 Memuat cloud database...";
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

        transactions = Array.isArray(resData.transactions)
            ? resData.transactions.map((transaction, index) => ({
                ...transaction,
                id: String(
                    transaction.id ||
                    `${Date.now()}-${index}`
                ),
                credit:
                    Number(transaction.credit) || 0,
                debit:
                    Number(transaction.debit) || 0,
                isTransfer:
                    Boolean(
                        transaction.isTransfer ||
                        transaction.targetAccount
                    ),
                targetAccount:
                    transaction.targetAccount || '',
                notes:
                    transaction.notes || ''
            }))
            : [];

        userAccounts = Array.isArray(resData.userAccounts)
            ? resData.userAccounts.map(account => ({
                name:
                    String(account.name || '').trim(),
                type:
                    String(account.type || '').trim(),
                initial:
                    Number(account.initial) || 0
            }))
            : [];

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

        populateFormDropdowns();

        if (statusEl) {
            statusEl.innerText =
                '⚠️ Database cloud gagal dimuat. Data tidak dapat diubah sampai koneksi berhasil.';
        }
    })
    .finally(() => {
        isInitialLoading = false;

        hideLoader();

        switchPage('dashboard');
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
    switchPage('settings');
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