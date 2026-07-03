// ==========================================
// app.js - Logika Finansial, Grafik, & Cloud
// Developed by Hanif Alkhairi
// ==========================================

let userAccounts = [
    { name: "Cash", type: "Cash", initial: 1200500 },
    { name: "BCA", type: "Bank", initial: 2200100 },
    { name: "Bank Jago", type: "Bank", initial: 1000000 },
    { name: "Gopay", type: "E Wallet", initial: 55499 },
];

let userCategories = {
    income: ['Gaji', 'Hadiah', 'Profit', 'Hutang'],
    expense: ['Makan', 'Kebutuhan', 'Belanja', 'Langganan', 'Donasi', 'Otomotif', 'Piutang']
};

let transactions = [
    { id: "1", date: "2026-06-15", name: "Gaji", credit: 0, debit: 6500000, category: "Gaji", account: "BCA", notes: "Transfer Bulanan" },
    { id: "2", date: "2026-06-18", name: "Makan Siang", credit: 45000, debit: 0, category: "Makan", account: "Cash", notes: "" },
    { id: "3", date: "2026-07-02", name: "Belanja", credit: 52600, debit: 0, category: "Belanja", account: "Cash", notes: "" }
];

let activePage = 'dashboard';
let deleteTargetId = null;
let deleteTypeContext = 'transaction';
let chartIncExpInstance = null;
let chartCatInstance = null;
let chartSaldoInstance = null;
let isBalanceObscured = false;

const emptyStateHTML = `<div class="p-6 flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 w-full col-span-full">
    <i data-lucide="inbox" class="w-10 h-10 mb-2 stroke-[1.5]"></i>
    <span class="text-xs text-slate-400 italic">Data Tidak Tersedia</span>
</div>`;

const emptyTableRowHTML = (colspan) => `<tr><td colspan="${colspan}" class="py-8 text-center text-xs text-slate-400 italic"><i data-lucide="inbox" class="w-6 h-6 mx-auto mb-2 stroke-[1.5] text-slate-300 dark:text-slate-700"></i>Data Tidak Tersedia</td></tr>`;

window.addEventListener('DOMContentLoaded', () => {
    if(localStorage.getItem('userAccounts')) userAccounts = JSON.parse(localStorage.getItem('userAccounts'));
    if(localStorage.getItem('userCategories')) userCategories = JSON.parse(localStorage.getItem('userCategories'));
    if(localStorage.getItem('transactions')) transactions = JSON.parse(localStorage.getItem('transactions'));
    if(localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
    if(localStorage.getItem('isBalanceObscured') === 'true') isBalanceObscured = true;

    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    document.getElementById('dashboardMonthFilter').value = currentYearMonth;
    document.getElementById('txMonthFilter').value = currentYearMonth;

    document.getElementById('dbMode').value = localStorage.getItem('dbMode') || 'local';
    document.getElementById('sheetsUrl').value = localStorage.getItem('sheetsUrl') || '';
    
    changeDbMode();
    updateHeaderCloudIndicator();
    updateObscureUI();

    if (localStorage.getItem('dbMode') === 'sheets') {
        fetchFromGoogleSheets();
    } else {
        switchPage('dashboard');
        populateFormDropdowns();
        renderDashboard();
    }
    lucide.createIcons();
});

function toggleObscure() {
    isBalanceObscured = !isBalanceObscured;
    localStorage.setItem('isBalanceObscured', isBalanceObscured);
    updateObscureUI();
    renderDashboard();
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

function populateFormDropdowns() {
    const accountHtml = userAccounts.length > 0 
        ? userAccounts.map(a => `<option value="${a.name}">${a.name}</option>`).join('')
        : `<option value="">-- Buat Akun Dulu --</option>`;
        
    document.getElementById('form-account').innerHTML = accountHtml;
    document.getElementById('form-target-account').innerHTML = accountHtml;
    document.getElementById('txFilterAccount').innerHTML = `<option value="">Semua Akun</option>` + accountHtml;

    const allCategories = [...userCategories.income, ...userCategories.expense];
    document.getElementById('txFilterCategory').innerHTML = `<option value="">Semua Kategori</option>` + 
        [...new Set(allCategories)].map(c => `<option value="${c}">${c}</option>`).join('');
}

function formatRupiah(amount, forceShow = false) {
    if (!forceShow && isBalanceObscured) return "Rp •••••••";
    if (amount === 0 || isNaN(amount)) return "Rp 0,00";
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 2 }).format(amount);
}

function formatInputNominal(input) {
    let value = input.value.replace(/[^0-9]/g, '');
    if (value === "") { input.value = ""; return; }
    input.value = new Intl.NumberFormat('id-ID').format(value);
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
    if(!categoryName) return false;
    const catL = categoryName.toLowerCase();
    if (catL === 'hutang' || catL === 'piutang') return false;
    return true;
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
        const bal = balances[a.name] || 0;
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
        { label: 'Total Saldo', amount: netWorth, color: 'bg-blueSystem-500' },
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
                <div class="space-y-1.5 py-2">
                    <div class="flex justify-between text-[11px]">
                        <span class="font-medium text-slate-600 dark:text-slate-300">${cat}</span>
                        <span class="font-bold text-slate-900 dark:text-white">${formatRupiah(amt, true)} <span class="text-[10px] text-slate-400 font-normal">(${pct}%)</span></span>
                    </div>
                    <div class="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div class="bg-blueSystem-500 h-full rounded-full" style="width: ${pct}%"></div>
                    </div>
                </div>`;
        }).join('');
    }

    const recentTx = [...transactions].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
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
                    <td class="py-3 px-4 whitespace-nowrap text-slate-500">${formatTanggalIndo(t.date)}</td>
                    <td class="py-3 px-4 font-semibold text-slate-900 dark:text-white">${t.name}</td>
                    <td class="py-3 px-4"><span class="px-2 py-0.5 rounded text-[10px] font-semibold ${bgPill}">${t.category || 'Transfer'}</span></td>
                    <td class="py-3 px-4 ${jenisColor} font-bold">${amtStr}</td>
                    <td class="py-3 px-4 text-slate-500">${t.isTransfer ? `${t.account} ➔ ${t.targetAccount}` : t.account}</td>
                    <td class="py-3 px-4 text-slate-400 truncate max-w-[120px]" title="${t.notes||''}">${t.notes || '-'}</td>
                </tr>`;
        });
    }
}

function renderTransactionsPage(selectedMonth) {
    const liveBalances = calculateBalancesUntil(selectedMonth);
    
    const balContainer = document.getElementById('txAccountBalancesContainer');
    if(userAccounts.length === 0) balContainer.innerHTML = emptyStateHTML;
    else {
        balContainer.innerHTML = userAccounts.map(a => `
            <div class="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl">
                <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">${a.name}</span>
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
        filtered.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(t => {
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
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
                    <td class="py-2.5 px-4 text-slate-500 whitespace-nowrap">${formatTanggalIndo(t.date)}</td>
                    <td class="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">${t.name}</td>
                    <td class="py-2.5 px-4 ${colorClass}">${formatRupiah(amt, true)}</td>
                    <td class="py-2.5 px-4 text-slate-500">${displayCategory}</td>
                    <td class="py-2.5 px-4"><span class="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300 font-medium">${displayAccount}</span></td>
                    <td class="py-2.5 px-4 text-slate-400 max-w-[120px] truncate" title="${t.notes || ''}">${t.notes || '-'}</td>
                    <td class="py-2.5 px-4 text-center space-x-2 whitespace-nowrap">
                        <button onclick="editTransaction('${t.id}')" class="text-slate-400 hover:text-blueSystem-500 inline-block"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
                        <button onclick="triggerDeleteConfirm('${t.id}', 'transaction')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                    </td>
                </tr>`;
        });
    }
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
                // Ubah backgroundColor dari 'transparent' menjadi '#10b981'
                { label: 'Total Pemasukan', data: incomeDataset, borderColor: '#10b981', backgroundColor: '#10b981', borderWidth: 3, tension: 0.2 },
                // Ubah backgroundColor dari 'transparent' menjadi '#ef4444'
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
                        boxWidth: 6,   // <-- Perkecil nilainya (misal 5 atau 6)
                        boxHeight: 6   // <-- Tambahkan boxHeight agar bulat sempurna
                    } 
                } 
            }, 
            scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor } } } 
        }
    });

    if (chartCatInstance) chartCatInstance.destroy();
    const catDatasets = [];
    const colors = ['#f59e0b', '#a855f7', '#0056a3', '#ec4899', '#64748b', '#06b6d4'];
    let colorIdx = 0;
    uniqueCategories.forEach(c => {
        catDatasets.push({ 
            label: c, 
            data: categoryDatasetsInfo[c], 
            borderColor: colors[colorIdx % colors.length], 
            backgroundColor: colors[colorIdx % colors.length], // <-- Ubah 'transparent' jadi ini
            borderWidth: 2, 
            tension: 0.2 
        });
        colorIdx++;
    });

    chartCatInstance = new Chart(document.getElementById('chartCategoriesTrend').getContext('2d'), {
        type: 'line',
        data: { labels: chartLabels, datasets: catDatasets },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { 
                    labels: { 
                        color: textColor, 
                        usePointStyle: true, 
                        boxWidth: 6,   // <-- Samakan nilainya
                        boxHeight: 6   // <-- Samakan nilainya
                    } 
                } 
            }, 
            scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor } } } 
        }
    });
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
                <td class="py-2.5 px-3 font-semibold text-slate-950 dark:text-white">${a.name}</td>
                <td class="py-2.5 px-3 text-slate-500"><span class="border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full text-[10px] font-medium">${a.type}</span></td>
                <td class="py-2.5 px-3 text-center space-x-2.5 whitespace-nowrap">
                    <button onclick="editSetupAccount('${a.name}')" class="text-slate-400 hover:text-blueSystem-500 inline-block"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
                    <button onclick="triggerDeleteConfirm('${a.name}', 'account')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </td>
            </tr>`).join('');
    }

    const catBody = document.getElementById('setupCategoriesTableBody');
    let catHtml = '';
    
    userCategories.income.forEach(cat => {
        let isSystem = (cat.toLowerCase() === 'hutang');
        catHtml += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
                <td class="py-2.5 px-3 font-semibold text-slate-950 dark:text-white">${cat}</td>
                <td class="py-2.5 px-3 text-slate-500"><span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Masuk</span></td>
                <td class="py-2.5 px-3 text-center whitespace-nowrap">
                    ${isSystem ? `<span class="text-[10px] text-slate-400 italic">Sistem</span>` : `<button onclick="triggerDeleteConfirm('${cat}', 'category_in')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>`}
                </td>
            </tr>`;
    });
    
    userCategories.expense.forEach(cat => {
        let isSystem = (cat.toLowerCase() === 'piutang');
        catHtml += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
                <td class="py-2.5 px-3 font-semibold text-slate-950 dark:text-white">${cat}</td>
                <td class="py-2.5 px-3 text-slate-500"><span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">Keluar</span></td>
                <td class="py-2.5 px-3 text-center whitespace-nowrap">
                    ${isSystem ? `<span class="text-[10px] text-slate-400 italic">Sistem</span>` : `<button onclick="triggerDeleteConfirm('${cat}', 'category_out')" class="text-slate-400 hover:text-rose-600 inline-block"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>`}
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
    if(dragSourceIndex === null || dragSourceIndex === targetIndex) return;

    const movedItem = userAccounts.splice(dragSourceIndex, 1)[0];
    userAccounts.splice(targetIndex, 0, movedItem);
    
    localStorage.setItem('userAccounts', JSON.stringify(userAccounts));
    populateFormDropdowns();
    triggerCloudPush();
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
    const editId = document.getElementById('setup-acc-edit-id').value;
    const name = document.getElementById('setup-acc-name').value.trim();
    const type = document.getElementById('setup-acc-type').value;
    const initBal = Number(document.getElementById('setup-acc-balance').value);

    if (!editId && userAccounts.some(a => a.name.toLowerCase() === name.toLowerCase())) {
        alert('Nama akun ini sudah terdaftar.'); return;
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
    closeSettingsModal('account');
    populateFormDropdowns();
    triggerCloudPush();
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
    const name = document.getElementById('setup-cat-name').value.trim();
    const type = document.getElementById('setup-cat-type').value;

    if (userCategories.income.includes(name) || userCategories.expense.includes(name)) {
        alert('Kategori ini sudah terdaftar.'); return;
    }

    if (type === 'income') userCategories.income.push(name);
    else userCategories.expense.push(name);

    localStorage.setItem('userCategories', JSON.stringify(userCategories));
    closeSettingsModal('category');
    populateFormDropdowns();
    triggerCloudPush();
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

        const allAvailableCategories = [...userCategories.income, ...userCategories.expense];
        catSelect.innerHTML = [...new Set(allAvailableCategories)]
            .map(c => `<option value="${c}">${c}</option>`).join('');
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
    
    document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
    
    adjustFormInputs();
    modal.classList.remove('hidden'); modal.style.display = 'flex';
    lucide.createIcons();
}

function closeTransactionModal() { 
    const modal = document.getElementById('transactionModal');
    modal.classList.add('hidden'); modal.style.display = ''; 
}

function handleTransactionSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('form-edit-id').value;
    const flowType = document.getElementById('form-type').value;
    
    const rawAmount = document.getElementById('form-amount').value.replace(/\./g, '');
    const amt = Number(rawAmount);
    
    const srcAcc = document.getElementById('form-account').value;

    if (flowType === 'Transfer' && srcAcc === document.getElementById('form-target-account').value) {
        alert('Akun asal dan tujuan tidak boleh sama.'); return;
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
    closeTransactionModal();
    triggerCloudPush();
}

function editTransaction(id) {
    const t = transactions.find(tx => tx.id === id);
    if (!t) return;
    document.getElementById('modalTxTitle').innerHTML = `<i data-lucide="edit-2" class="text-blueSystem-500 w-4 h-4"></i> Edit Transaksi`;
    document.getElementById('form-edit-id').value = t.id;
    document.getElementById('form-date').value = t.date;
    
    let flowValue = 'Credit';
    if (t.isTransfer) flowValue = 'Transfer';
    else if (t.debit > 0) flowValue = 'Debit';

    document.getElementById('form-type').value = flowValue;
    adjustFormInputs();

    document.getElementById('form-name').value = t.name;
    document.getElementById('form-amount').value = new Intl.NumberFormat('id-ID').format(t.debit > 0 ? t.debit : t.credit);
    document.getElementById('form-account').value = t.account;
    if (t.isTransfer) document.getElementById('form-target-account').value = t.targetAccount;
    else document.getElementById('form-category').value = t.category || '';
    document.getElementById('form-notes').value = t.notes || '';
    
    const modal = document.getElementById('transactionModal');
    modal.classList.remove('hidden'); modal.style.display = 'flex';
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
}
document.getElementById('confirmDeleteBtn').onclick = () => {
    if (!deleteTargetId) return;

    if (deleteTypeContext === 'account') {
        userAccounts = userAccounts.filter(a => a.name !== deleteTargetId);
        localStorage.setItem('userAccounts', JSON.stringify(userAccounts));
        populateFormDropdowns();
    } else if (deleteTypeContext === 'category_in') {
        userCategories.income = userCategories.income.filter(c => c !== deleteTargetId);
        localStorage.setItem('userCategories', JSON.stringify(userCategories));
        populateFormDropdowns();
    } else if (deleteTypeContext === 'category_out') {
        userCategories.expense = userCategories.expense.filter(c => c !== deleteTargetId);
        localStorage.setItem('userCategories', JSON.stringify(userCategories));
        populateFormDropdowns();
    } else {
        transactions = transactions.filter(t => t.id !== deleteTargetId);
        localStorage.setItem('transactions', JSON.stringify(transactions));
    }
    closeDeleteModal();
    triggerCloudPush();
};

function executeWipeAllData() {
    userAccounts = [];
    transactions = [];
    userCategories = {
        income: ['Gaji', 'Hadiah', 'Profit', 'Hutang'],
        expense: ['Makan', 'Kebutuhan', 'Belanja', 'Langganan', 'Donasi', 'Otomotif', 'Piutang']
    };
    
    localStorage.removeItem('userAccounts');
    localStorage.removeItem('transactions');
    localStorage.removeItem('userCategories');
    populateFormDropdowns();
    closeWipeModal();

    const mode = localStorage.getItem('dbMode');
    const url = localStorage.getItem('sheetsUrl');
    if (mode === 'sheets' && url) {
        const statusEl = document.getElementById('syncStatus');
        if(statusEl) statusEl.innerText = "🔄 Mengosongkan cloud...";

        fetch(url, {
            method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: "syncAll", userAccounts: [], transactions: [] })
        }).then(() => {
            if(statusEl) statusEl.innerText = "🗑️ Cloud dikosongkan.";
            renderDashboard();
        }).catch(() => { renderDashboard(); });
    } else {
        renderDashboard();
    }
}

function toggleSettingsModal() { document.getElementById('cloudModal').classList.toggle('hidden'); }
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

function triggerCloudPush() {
    renderDashboard();
    const mode = localStorage.getItem('dbMode');
    const url = localStorage.getItem('sheetsUrl');
    if (mode !== 'sheets' || !url) return;

    const statusEl = document.getElementById('syncStatus');
    if(statusEl) statusEl.innerText = "🔄 Menyimpan data ke Google Sheets...";

    fetch(url, {
        method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: "syncAll", userAccounts, transactions })
    }).then(() => { if(statusEl) statusEl.innerText = "✅ Berhasil disimpan."; })
      .catch(err => { if(statusEl) statusEl.innerText = "❌ Gagal: " + err.toString(); });
}

function fetchFromGoogleSheets() {
    const url = localStorage.getItem('sheetsUrl');
    if (!url) return;
    const statusEl = document.getElementById('syncStatus');
    if(statusEl) statusEl.innerText = "🔄 Memuat cloud database...";

    fetch(url).then(res => res.json()).then(resData => {
        if (resData && resData.status === "success") {
            if(resData.userAccounts) { userAccounts = resData.userAccounts; localStorage.setItem('userAccounts', JSON.stringify(userAccounts)); }
            if(resData.transactions) { transactions = resData.transactions; localStorage.setItem('transactions', JSON.stringify(transactions)); }
            if(statusEl) statusEl.innerText = "✅ Cloud database dimuat.";
        }
        switchPage('dashboard'); populateFormDropdowns(); renderDashboard();
    }).catch(err => {
        if(statusEl) statusEl.innerText = "⚠️ Gagal tersinkron.";
        switchPage('dashboard'); populateFormDropdowns(); renderDashboard();
    });
}

function formatTanggalIndo(stringIso) {
    if (!stringIso) return "-";
    if (stringIso.includes('T') || stringIso.includes('-')) {
        const date = new Date(stringIso);
        return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return stringIso;
}

function getLocalMonth(dateStr) {
    if (!dateStr) return "";
    if (dateStr.includes('T')) {
        const d = new Date(dateStr);
        if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    return dateStr.substring(0, 7);
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

function processCSV(csvText) {
    const lines = csvText.split('\n');
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const cols = line.split(',');
        const newTx = {
            id: Date.now().toString() + i,
            date: cols[0],
            name: cols[1],
            credit: Number(cols[2]) || 0,
            debit: Number(cols[3]) || 0,
            category: cols[4] || '',
            account: cols[5] || '',
            notes: cols[6] || '',
            isTransfer: false
        };
        transactions.push(newTx);
    }
    
    localStorage.setItem('transactions', JSON.stringify(transactions));
    alert("Berhasil mengimpor data transaksi!");
    triggerCloudPush();
    renderDashboard();
}