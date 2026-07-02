// app.js - Logika Finansial, Grafik, dan Sinkronisasi Cloud
let userAccounts = [
    { name: "Cash", type: "Cash", initial: 1200500 },
    { name: "BCA", type: "Bank", initial: 2200100 },
    { name: "BSI", type: "Bank", initial: 60000 },
    { name: "Bank Jago", type: "Bank", initial: 1000000 },
    { name: "Gopay", type: "E Wallet", initial: 55499 },
    { name: "Bibit", type: "Tabungan", initial: 545898 },
];

let transactions = [
    { id: "1", date: "2026-06-15", name: "Gaji", credit: 0, debit: 6500000, category: "Gaji", account: "BCA", notes: "Transfer Bulanan" },
    { id: "2", date: "2026-06-18", name: "Makan Siang", credit: 45000, debit: 0, category: "Makan", account: "Cash", notes: "" },
    { id: "3", date: "2026-07-02", name: "Belanja", credit: 52600, debit: 0, category: "Belanja", account: "Cash", notes: "" },
    { id: "4", date: "2026-07-03", name: "BPJS", credit: 152500, debit: 0, category: "Langganan", account: "BCA", notes: "" }
];

let activePage = 'dashboard';
let deleteTargetId = null;
let deleteTypeContext = 'transaction';
let chartIncExpInstance = null;
let chartCatInstance = null;

window.addEventListener('DOMContentLoaded', () => {
    if(localStorage.getItem('userAccounts')) userAccounts = JSON.parse(localStorage.getItem('userAccounts'));
    if(localStorage.getItem('transactions')) transactions = JSON.parse(localStorage.getItem('transactions'));
    if(localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');

    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('dashboardMonthFilter').value = currentYearMonth;

    document.getElementById('dbMode').value = localStorage.getItem('dbMode') || 'local';
    document.getElementById('sheetsUrl').value = localStorage.getItem('sheetsUrl') || '';
    changeDbMode();
    updateHeaderCloudIndicator();

    if (localStorage.getItem('dbMode') === 'sheets') {
        fetchFromGoogleSheets();
    } else {
        switchPage('dashboard');
        populateFormDropdowns();
        renderDashboard();
    }
    lucide.createIcons();
});

function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    if (activePage === 'reports') renderReportsPage();
}

function toggleSettingsModal() { document.getElementById('settingsModal').classList.toggle('hidden'); }
function changeDbMode() { document.getElementById('urlInputContainer').classList.toggle('hidden', document.getElementById('dbMode').value !== 'sheets'); }

function saveSettings() {
    localStorage.setItem('dbMode', document.getElementById('dbMode').value);
    localStorage.setItem('sheetsUrl', document.getElementById('sheetsUrl').value);
    updateHeaderCloudIndicator();
    toggleSettingsModal();
    if(localStorage.getItem('dbMode') === 'sheets') triggerCloudPush();
    else renderDashboard();
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

function switchPage(pageId) {
    activePage = pageId;
    document.querySelectorAll('.page-content').forEach(el => el.classList.add('hidden'));
    document.getElementById('page-' + pageId).classList.remove('hidden');
    document.querySelectorAll('nav button').forEach(btn => {
        btn.className = "px-4 py-1.5 rounded-lg transition-all text-slate-500 dark:text-slate-400 hover:text-slate-900";
    });
    const activeBtn = document.getElementById('nav-' + pageId);
    if(activeBtn) activeBtn.className = "px-4 py-1.5 rounded-lg transition-all bg-white dark:bg-slate-800 text-bca-500 dark:text-white shadow-sm";
    renderDashboard();
}

function populateFormDropdowns() {
    const optionsHtml = userAccounts.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
    document.getElementById('form-account').innerHTML = optionsHtml;
    document.getElementById('form-target-account').innerHTML = optionsHtml;
    document.getElementById('txFilterAccount').innerHTML = `<option value="">Semua Akun</option>` + optionsHtml;
}

function formatRupiah(amount) {
    if (amount === 0 || isNaN(amount)) return "Rp -";
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Math.abs(amount)).replace(/,00$/, "");
}

function calculateBalancesUntil(selectedMonth = null) {
    const balances = {};
    userAccounts.forEach(a => balances[a.name] = a.initial);

    transactions.forEach(t => {
        if (selectedMonth && t.date && t.date.substring(0, 7) > selectedMonth) return;
        if (balances[t.account] !== undefined) {
            balances[t.account] += (Number(t.debit) || 0) - (Number(t.credit) || 0);
        }
        if (t.isTransfer && t.targetAccount && balances[t.targetAccount] !== undefined) {
            balances[t.targetAccount] += (Number(t.credit) || Number(t.debit) || 0);
        }
    });
    return balances;
}

function renderDashboard() {
    const selectedMonth = document.getElementById('dashboardMonthFilter').value;
    const balances = calculateBalancesUntil(selectedMonth);

    if (activePage === 'dashboard') { renderDashboardPage(balances, selectedMonth); } 
    else if (activePage === 'transactions') { renderTransactionsPage(); } 
    else if (activePage === 'reports') { renderReportsPage(); }
    else if (activePage === 'setup') { renderSetupPage(); }
    lucide.createIcons();
}

function renderDashboardPage(balances, selectedMonth) {
    let netWorth = 0, totalBank = 0, totalWallet = 0, totalCash = 0, totalSaving = 0;
    
    userAccounts.forEach(a => {
        const bal = balances[a.name] || 0;
        netWorth += bal;
        if (a.type === 'Bank') totalBank += bal;
        else if (a.type === 'E Wallet') totalWallet += bal;
        else if (a.type === 'Cash') totalCash += bal;
        else if (a.type === 'Tabungan') totalSaving += bal;
    });

    document.getElementById('dash-net-worth').innerText = formatRupiah(netWorth);
    document.getElementById('dash-type-bank').innerText = formatRupiah(totalBank);
    document.getElementById('dash-type-wallet').innerText = formatRupiah(totalWallet);
    document.getElementById('dash-type-cash').innerText = formatRupiah(totalCash);
    document.getElementById('dash-type-saving').innerText = formatRupiah(totalSaving);

    let overallIncome = 0, overallExpense = 0;
    const categorySums = {};

    transactions.forEach(t => {
        if (t.date && t.date.startsWith(selectedMonth)) {
            overallIncome += (Number(t.debit) || 0);
            overallExpense += (Number(t.credit) || 0);
            if (t.category && t.credit > 0) {
                categorySums[t.category] = (categorySums[t.category] || 0) + Number(t.credit);
            }
        }
    });

    document.getElementById('dash-inc-month').innerText = formatRupiah(overallIncome);
    document.getElementById('dash-exp-month').innerText = formatRupiah(overallExpense);

    document.getElementById('dashAccountsContainer').innerHTML = userAccounts.map(a => `
        <div class="flex items-center justify-between py-2.5">
            <div>
                <p class="text-xs font-semibold text-slate-900 dark:text-white">${a.name}</p>
                <p class="text-[10px] text-slate-400 font-medium">${a.type}</p>
            </div>
            <span class="text-xs font-bold text-slate-900 dark:text-slate-100">${formatRupiah(balances[a.name] || 0)}</span>
        </div>`).join('');

    const categories = Object.keys(categorySums).sort((a,b) => categorySums[b] - categorySums[a]);
    if (categories.length === 0) {
        document.getElementById('dashCategoriesContainer').innerHTML = `<p class="text-xs text-slate-400 italic text-center py-8">Tidak ada data pengeluaran untuk bulan ini.</p>`;
    } else {
        document.getElementById('dashCategoriesContainer').innerHTML = categories.map(cat => {
            const amt = categorySums[cat];
            const pct = overallExpense > 0 ? Math.round((amt / overallExpense) * 100) : 0;
            return `
                <div class="space-y-1">
                    <div class="flex justify-between text-xs">
                        <span class="font-medium text-slate-600 dark:text-slate-300">${cat}</span>
                        <span class="font-bold text-slate-900 dark:text-white">${formatRupiah(amt)} <span class="text-[10px] text-slate-400 font-normal">(${pct}%)</span></span>
                    </div>
                    <div class="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div class="bg-bca-500 h-full rounded-full" style="width: ${pct}%"></div>
                    </div>
                </div>`;
        }).join('');
    }
}

function renderTransactionsPage() {
    const liveBalances = calculateBalancesUntil(null);
    
    document.getElementById('txAccountBalancesContainer').innerHTML = userAccounts.map(a => `
        <div class="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl">
            <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">${a.name}</span>
            <span class="text-[11px] font-bold text-slate-900 dark:text-slate-200">${formatRupiah(liveBalances[a.name] || 0)}</span>
        </div>`).join('');

    const kw = document.getElementById('txSearchBar').value.toLowerCase();
    const filterAcc = document.getElementById('txFilterAccount').value;
    const filterCat = document.getElementById('txFilterCategory').value;

    const tableBody = document.getElementById('txTableBody');
    tableBody.innerHTML = '';

    let filteredIncomeTotal = 0, filteredExpenseTotal = 0;

    const filtered = transactions.filter(t => {
        const matchKw = t.name.toLowerCase().includes(kw) || (t.notes && t.notes.toLowerCase().includes(kw));
        const matchAcc = filterAcc === "" ? true : (t.account === filterAcc || (t.isTransfer && t.targetAccount === filterAcc));
        const matchCat = filterCat === "" ? true : (filterCat === "Transfer" ? t.isTransfer === true : t.category === filterCat);
        return matchKw && matchAcc && matchCat;
    });

    filtered.forEach(t => {
        if (t.isTransfer) return;
        filteredIncomeTotal += (Number(t.debit) || 0);
        filteredExpenseTotal += (Number(t.credit) || 0);
    });

    document.getElementById('tx-summary-Income').innerText = formatRupiah(filteredIncomeTotal);
    document.getElementById('tx-summary-Expenses').innerText = formatRupiah(filteredExpenseTotal);

    filtered.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        let colorClass = 'text-rose-600 dark:text-rose-400 font-bold';
        let amt = t.credit;
        let displayCategory = t.category || '-';
        let displayAccount = t.account;

        if (t.isTransfer) {
            colorClass = 'text-bca-500 dark:text-bca-100 font-bold';
            amt = t.credit || t.debit;
            displayCategory = 'Transfer Dana';
            displayAccount = `${t.account} ➔ ${t.targetAccount}`;
        } else if (t.debit > 0) {
            colorClass = 'text-emerald-600 dark:text-emerald-400 font-bold';
            amt = t.debit;
        }

        tableBody.innerHTML += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
                <td class="py-2.5 px-4 text-slate-500 whitespace-nowrap">${formatTanggalIndo(t.date)}</td>
                <td class="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">${t.name}</td>
                <td class="py-2.5 px-4 ${colorClass}">${formatRupiah(amt)}</td>
                <td class="py-2.5 px-4 text-slate-500">${displayCategory}</td>
                <td class="py-2.5 px-4"><span class="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300 font-medium">${displayAccount}</span></td>
                <td class="py-2.5 px-4 text-slate-400 max-w-[120px] truncate" title="${t.notes || ''}">${t.notes || '-'}</td>
                <td class="py-2.5 px-4 text-center space-x-2 whitespace-nowrap">
                    <button onclick="editTransaction('${t.id}')" class="text-slate-400 hover:text-bca-500 inline-block"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
                    <button onclick="duplicateTransaction('${t.id}')" class="text-slate-400 hover:text-indigo-500 inline-block"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>
                    <button onclick="triggerDeleteConfirm('${t.id}', 'transaction')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </td>
            </tr>`;
    });
}

function renderReportsPage() {
    const monthlyTotals = {};
    const monthlyCategories = {};
    const uniqueCategories = new Set();

    transactions.forEach(t => {
        if (!t.date || t.isTransfer) return;
        const month = t.date.substring(0, 7);
        if (!monthlyTotals[month]) monthlyTotals[month] = { income: 0, expense: 0 };
        monthlyTotals[month].income += (Number(t.debit) || 0);
        monthlyTotals[month].expense += (Number(t.credit) || 0);

        if (t.category && t.credit > 0) {
            uniqueCategories.add(t.category);
            if (!monthlyCategories[month]) monthlyCategories[month] = {};
            monthlyCategories[month][t.category] = (monthlyCategories[month][t.category] || 0) + Number(t.credit);
        }
    });

    const sortedMonths = Object.keys(monthlyTotals).sort();
    const tableBody = document.getElementById('reportsTableBody');
    tableBody.innerHTML = '';

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
        const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
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
                <td class="py-3 px-4 text-emerald-600 font-medium">${formatRupiah(inc)}</td>
                <td class="py-3 px-4 text-rose-600 font-medium">${formatRupiah(exp)}</td>
                <td class="py-3 px-4 ${net >= 0 ? 'text-emerald-600 font-bold':'text-rose-600 font-bold'}">${formatRupiah(net)}</td>
            </tr>`;
    });

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#334155' : '#f1f5f9';
    const textColor = isDark ? '#f8fafc' : '#1e293b';
    const subTextColor = isDark ? '#94a3b8' : '#64748b';

    if (chartIncExpInstance) chartIncExpInstance.destroy();
    chartIncExpInstance = new Chart(document.getElementById('chartIncomeExpense').getContext('2d'), {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [
                { label: 'Total Pemasukan', data: incomeDataset, borderColor: '#10b981', backgroundColor: 'transparent', borderWidth: 3, tension: 0.2 },
                { label: 'Total Pengeluaran', data: expenseDataset, borderColor: '#ef4444', backgroundColor: 'transparent', borderWidth: 3, tension: 0.2 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: textColor } } },
            scales: { x: { ticks: { color: subTextColor }, grid: { color: gridColor } }, y: { ticks: { color: subTextColor }, grid: { color: gridColor } } }
        }
    });

    if (chartCatInstance) chartCatInstance.destroy();
    const catDatasets = [];
    const colors = ['#f59e0b', '#a855f7', '#3b82f6', '#ec4899', '#64748b', '#06b6d4'];
    let colorIdx = 0;
    uniqueCategories.forEach(c => {
        catDatasets.push({ label: c, data: categoryDatasetsInfo[c], borderColor: colors[colorIdx % colors.length], backgroundColor: 'transparent', borderWidth: 2, tension: 0.2 });
        colorIdx++;
    });

    chartCatInstance = new Chart(document.getElementById('chartCategoriesTrend').getContext('2d'), {
        type: 'line',
        data: { labels: chartLabels, datasets: catDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: textColor } } },
            scales: { x: { ticks: { color: subTextColor }, grid: { color: gridColor } }, y: { ticks: { color: subTextColor }, grid: { color: gridColor } } }
        }
    });
}

function renderSetupPage() {
    const tableBody = document.getElementById('setupAccountsTableBody');
    tableBody.innerHTML = '';

    userAccounts.forEach((a, index) => {
        tableBody.innerHTML += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 draggable-row transition-colors" 
                draggable="true" 
                ondragstart="handleDragStart(event, ${index})" 
                ondragover="handleDragOver(event)" 
                ondragleave="handleDragLeave(event)" 
                ondrop="handleDrop(event, ${index})">
                <td class="py-2.5 px-4 text-slate-300 dark:text-slate-600 font-bold select-none text-center">⋮⋮</td>
                <td class="py-2.5 px-4 font-semibold text-slate-950 dark:text-white">${a.name}</td>
                <td class="py-2.5 px-4 text-slate-500"><span class="border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full text-[10px] font-medium">${a.type}</span></td>
                <td class="py-2.5 px-4 font-medium">${formatRupiah(a.initial)}</td>
                <td class="py-2.5 px-4 text-center space-x-2.5 whitespace-nowrap">
                    <button onclick="editSetupAccount('${a.name}')" class="text-slate-400 hover:text-bca-500 inline-block"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
                    <button onclick="triggerDeleteConfirm('${a.name}', 'account')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </td>
            </tr>`;
    });
    lucide.createIcons();
}

let dragSourceIndex = null;
function handleDragStart(e, index) { dragSourceIndex = index; e.dataTransfer.effectAllowed = 'move'; }
function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function handleDrop(e, targetIndex) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if(dragSourceIndex === null || dragSourceIndex === targetIndex) return;

    const movedItem = userAccounts.splice(dragSourceIndex, 1)[0];
    userAccounts.splice(targetIndex, 0, movedItem);
    
    localStorage.setItem('userAccounts', JSON.stringify(userAccounts));
    populateFormDropdowns();
    triggerCloudPush();
}

function saveNewSetupAccount(e) {
    e.preventDefault();
    const editId = document.getElementById('setup-acc-edit-id').value;
    const name = document.getElementById('setup-acc-name').value.trim();
    const type = document.getElementById('setup-acc-type').value;
    const initBal = Number(document.getElementById('setup-acc-balance').value);

    if (!editId && userAccounts.some(a => a.name.toLowerCase() === name.toLowerCase())) {
        alert('Nama akun ini sudah terdaftar.');
        return;
    }

    if (editId) {
        transactions.forEach(t => {
            if(t.account === editId) t.account = name;
            if(t.targetAccount === editId) t.targetAccount = name;
        });
        localStorage.setItem('transactions', JSON.stringify(transactions));

        const idx = userAccounts.findIndex(a => a.name === editId);
        if(idx !== -1) userAccounts[idx] = { name, type, initial: initBal };
    } else {
        userAccounts.push({ name, type, initial: initBal });
    }

    localStorage.setItem('userAccounts', JSON.stringify(userAccounts));
    resetSetupForm();
    populateFormDropdowns();
    triggerCloudPush();
}

function editSetupAccount(name) {
    const acc = userAccounts.find(a => a.name === name);
    if(!acc) return;

    document.getElementById('setupFormTitle').innerHTML = `<i data-lucide="edit-2" class="w-4 h-4 text-bca-500"></i> Edit Akun Keuangan`;
    document.getElementById('setup-acc-edit-id').value = acc.name;
    document.getElementById('setup-acc-name').value = acc.name;
    document.getElementById('setup-acc-type').value = acc.type;
    document.getElementById('setup-acc-balance').value = acc.initial;
    document.getElementById('setupCancelBtn').classList.remove('hidden');
    lucide.createIcons();
}

function resetSetupForm() {
    document.getElementById('setupFormTitle').innerHTML = `<i data-lucide="plus-circle" class="w-4 h-4"></i> Tambah Akun Keuangan`;
    document.getElementById('setup-acc-edit-id').value = '';
    document.getElementById('setup-acc-name').value = '';
    document.getElementById('setup-acc-balance').value = '';
    document.getElementById('setupCancelBtn').classList.add('hidden');
    lucide.createIcons();
}

function adjustFormInputs() {
    const flowType = document.getElementById('form-type').value;
    const catSelect = document.getElementById('form-category');
    const catContainer = document.getElementById('categoryContainer');
    const targetAccContainer = document.getElementById('targetAccountContainer');
    const accLabel = document.getElementById('accountLabel');

    if (flowType === 'Transfer') {
        catContainer.classList.add('hidden');
        targetAccContainer.classList.remove('hidden');
        accLabel.innerText = "Akun Asal";
        catSelect.innerHTML = ""; 
    } else {
        catContainer.classList.remove('hidden');
        targetAccContainer.classList.add('hidden');
        accLabel.innerText = "Akun Keuangan";

        if (flowType === 'Debit') {
            catSelect.innerHTML = `<option value="Gaji">Gaji</option><option value="Hadiah">Hadiah</option><option value="Profit">Profit</option>`;
        } else {
            catSelect.innerHTML = `<option value="Makan">Makan</option><option value="Kebutuhan">Kebutuhan</option><option value="Belanja">Belanja</option><option value="Langganan">Langganan</option><option value="Donasi">Donasi</option><option value="Otomotif">Otomotif</option>`;
        }
    }
}

function handleTransactionSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('form-edit-id').value;
    const flowType = document.getElementById('form-type').value;
    const amt = Number(document.getElementById('form-amount').value);
    const srcAcc = document.getElementById('form-account').value;

    if (flowType === 'Transfer' && srcAcc === document.getElementById('form-target-account').value) {
        alert('Akun asal dan tujuan tidak boleh sama.');
        return;
    }

    const payload = {
        date: document.getElementById('form-date').value,
        name: document.getElementById('form-name').value,
        notes: document.getElementById('form-notes').value,
        account: srcAcc,
        isTransfer: flowType === 'Transfer',
        credit: flowType === 'Debit' ? 0 : amt,
        debit: flowType === 'Debit' ? amt : 0,
        category: flowType === 'Transfer' ? "" : document.getElementById('form-category').value,
        targetAccount: flowType === 'Transfer' ? document.getElementById('form-target-account').value : ""
    };

    if (editId) {
        const idx = transactions.findIndex(t => t.id === editId);
        if (idx !== -1) transactions[idx] = { ...transactions[idx], ...payload };
    } else {
        payload.id = Date.now().toString();
        transactions.push(payload);
    }

    localStorage.setItem('transactions', JSON.stringify(transactions));
    closeModal();
    triggerCloudPush();
}

function editTransaction(id) {
    const t = transactions.find(tx => tx.id === id);
    if (!t) return;

    document.getElementById('modalTitle').innerHTML = `<i data-lucide="edit-2" class="text-bca-500 w-4 h-4"></i> Edit Transaksi`;
    document.getElementById('form-edit-id').value = t.id;
    document.getElementById('form-date').value = t.date;
    
    let flowValue = 'Credit';
    if (t.isTransfer) flowValue = 'Transfer';
    else if (t.debit > 0) flowValue = 'Debit';

    document.getElementById('form-type').value = flowValue;
    adjustFormInputs();

    document.getElementById('form-name').value = t.name;
    document.getElementById('form-amount').value = t.debit > 0 ? t.debit : t.credit;
    document.getElementById('form-account').value = t.account;
    
    if (t.isTransfer) document.getElementById('form-target-account').value = t.targetAccount;
    else document.getElementById('form-category').value = t.category || '';
    
    document.getElementById('form-notes').value = t.notes || '';
    document.getElementById('transactionModal').classList.remove('hidden');
    lucide.createIcons();
}

function duplicateTransaction(id) {
    const t = transactions.find(tx => tx.id === id);
    if (!t) return;
    const dup = { ...t, id: Date.now().toString(), date: new Date().toISOString().split('T')[0] };
    transactions.push(dup);
    localStorage.setItem('transactions', JSON.stringify(transactions));
    triggerCloudPush();
}

function openModal() {
    document.getElementById('modalTitle').innerHTML = `<i data-lucide="plus-circle" class="text-bca-500 w-4 h-4"></i> Tambah Transaksi`;
    document.getElementById('form-edit-id').value = '';
    document.getElementById('form-name').value = '';
    document.getElementById('form-amount').value = '';
    document.getElementById('form-notes').value = '';
    document.getElementById('form-type').value = 'Credit';
    document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
    adjustFormInputs();
    document.getElementById('transactionModal').classList.remove('hidden');
    lucide.createIcons();
}
function closeModal() { document.getElementById('transactionModal').classList.add('hidden'); }

function triggerDeleteConfirm(id, type) {
    deleteTargetId = id;
    deleteTypeContext = type;
    
    const titleEl = document.getElementById('deleteModalTitle');
    if(type === 'account') {
        titleEl.innerText = `Hapus Akun Keuangan "${id}"?`;
    } else {
        titleEl.innerText = "Hapus Transaksi Ini?";
    }
    
    document.getElementById('deleteConfirmModal').classList.remove('hidden');
    document.getElementById('confirmDeleteBtn').onclick = executeDelete;
}
function closeDeleteModal() {
    document.getElementById('deleteConfirmModal').classList.add('hidden');
    deleteTargetId = null;
}
function executeDelete() {
    if (!deleteTargetId) return;

    if (deleteTypeContext === 'account') {
        userAccounts = userAccounts.filter(a => a.name !== deleteTargetId);
        localStorage.setItem('userAccounts', JSON.stringify(userAccounts));
        populateFormDropdowns();
    } else {
        transactions = transactions.filter(t => t.id !== deleteTargetId);
        localStorage.setItem('transactions', JSON.stringify(transactions));
    }
    closeDeleteModal();
    triggerCloudPush();
}

function clearTransactions() {
    if(confirm('Reset semua data riwayat kembali ke data awal?')) {
        localStorage.removeItem('transactions');
        window.location.reload();
    }
}

function triggerCloudPush() {
    renderDashboard();
    const mode = localStorage.getItem('dbMode');
    const url = localStorage.getItem('sheetsUrl');
    if (mode !== 'sheets' || !url) return;

    const statusEl = document.getElementById('syncStatus');
    if(statusEl) statusEl.innerText = "🔄 Menyimpan data ke Google Sheets...";

    fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: "syncAll",
            userAccounts: userAccounts,
            transactions: transactions
        })
    })
    .then(() => {
        if(statusEl) statusEl.innerText = "✅ Berhasil disimpan.";
    })
    .catch(err => {
        if(statusEl) statusEl.innerText = "❌ Gagal sinkronisasi: " + err.toString();
    });
}

function fetchFromGoogleSheets() {
    const url = localStorage.getItem('sheetsUrl');
    if (!url) return;
    const statusEl = document.getElementById('syncStatus');
    if(statusEl) statusEl.innerText = "🔄 Memuat cloud database...";

    fetch(url)
    .then(res => res.json())
    .then(resData => {
        if (resData && resData.status === "success") {
            if(resData.userAccounts && resData.userAccounts.length > 0) {
                userAccounts = resData.userAccounts;
                localStorage.setItem('userAccounts', JSON.stringify(userAccounts));
            }
            if(resData.transactions) {
                transactions = resData.transactions;
                localStorage.setItem('transactions', JSON.stringify(transactions));
            }
            if(statusEl) statusEl.innerText = "✅ Cloud database berhasil dimuat.";
        }
        switchPage('dashboard');
        populateFormDropdowns();
        renderDashboard();
    })
    .catch(err => {
        console.error(err);
        if(statusEl) statusEl.innerText = "⚠️ Gagal sinkronisasi. Menggunakan data lokal.";
        switchPage('dashboard');
        populateFormDropdowns();
        renderDashboard();
    });
}

// ==========================================
// FUNGSI BARU UNTUK FORMAT TANGGAL DI FRONTEND
// ==========================================
function formatTanggalIndo(stringIso) {
    if (!stringIso) return "-";
    
    // Keamanan tambahan: Jika formatnya sudah string pendek "YYYY-MM-DD", 
    // ubah manual agar tidak terkena pergeseran timezone oleh object Date.
    if (stringIso.includes('T')) {
        const date = new Date(stringIso);
        return date.toLocaleDateString('id-ID', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } else {
        // Jika format string biasa "2026-07-02" dari local storage
        const parts = stringIso.split('-');
        if(parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`; // Hasil: DD/MM/YYYY
        }
        return stringIso;
    }
}