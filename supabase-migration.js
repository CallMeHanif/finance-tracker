// ==========================================
// ARAH - One-time Google Sheets -> Supabase migration
// Step 5: copy and verify. Google Sheets remains untouched.
// ==========================================

(function initializeARAHMigrationModule() {
    const BATCH_SIZE = 400;
    let migrationRunning = false;

    function getElement(id) {
        return document.getElementById(id);
    }

    function setStatus(message, type = 'info') {
        const element = getElement('supabaseMigrationStatus');
        if (!element) return;

        const tone = {
            info: 'text-slate-500 dark:text-slate-400',
            success: 'text-emerald-600 dark:text-emerald-400',
            warning: 'text-amber-600 dark:text-amber-400',
            error: 'text-rose-600 dark:text-rose-400'
        }[type] || 'text-slate-500 dark:text-slate-400';

        element.className = `text-[11px] leading-relaxed ${tone}`;
        element.textContent = message || '';
    }

    function setButtonBusy(busy) {
        const button = getElement('supabaseMigrationButton');
        if (!button) return;
        button.disabled = Boolean(busy);
        button.classList.toggle('opacity-60', Boolean(busy));
        button.classList.toggle('cursor-not-allowed', Boolean(busy));
        button.textContent = busy ? 'Memindahkan...' : 'Salin Data ke Supabase';
    }

    function createUuid() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }

        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;

        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
        return [
            hex.slice(0, 4).join(''),
            hex.slice(4, 6).join(''),
            hex.slice(6, 8).join(''),
            hex.slice(8, 10).join(''),
            hex.slice(10, 16).join('')
        ].join('-');
    }

    function currentSnapshot() {
        return {
            userAccounts: normalizeAccounts(userAccounts),
            userCategories: normalizeCategories(userCategories),
            transactions: normalizeTransactions(transactions),
            userLoans: normalizeLoans(userLoans)
        };
    }

    function flattenCategories(categories) {
        const rows = [];
        ['income', 'expense', 'neutral'].forEach(type => {
            (categories[type] || []).forEach((name, index) => {
                rows.push({ name, type, sortOrder: index });
            });
        });
        return rows;
    }

    function formatCounts(snapshot) {
        const categoryCount = flattenCategories(snapshot.userCategories).length;
        return `${snapshot.userAccounts.length} akun • ${categoryCount} kategori • ${snapshot.transactions.length} transaksi • ${snapshot.userLoans.length} pinjaman`;
    }

    function validateSnapshot(snapshot) {
        const errors = [];
        const accountNames = new Set(snapshot.userAccounts.map(account => account.name));
        const categoryNames = new Set(flattenCategories(snapshot.userCategories).map(category => category.name));
        const loanIds = new Set(snapshot.userLoans.map(loan => loan.id));

        snapshot.transactions.forEach((transaction, index) => {
            const label = transaction.name || `Transaksi #${index + 1}`;

            if (!transaction.date) errors.push(`${label}: tanggal kosong.`);
            if (!transaction.name) errors.push(`Transaksi #${index + 1}: nama kosong.`);
            if (!accountNames.has(transaction.account)) {
                errors.push(`${label}: akun “${transaction.account || '-'}” tidak ditemukan.`);
            }

            if (transaction.isTransfer) {
                if (!transaction.targetAccount || !accountNames.has(transaction.targetAccount)) {
                    errors.push(`${label}: akun tujuan transfer tidak ditemukan.`);
                }
                if (transaction.targetAccount === transaction.account) {
                    errors.push(`${label}: akun asal dan tujuan transfer sama.`);
                }
            }

            if (transaction.category && !categoryNames.has(transaction.category)) {
                errors.push(`${label}: kategori “${transaction.category}” tidak ditemukan.`);
            }

            if (transaction.loanId && !loanIds.has(transaction.loanId)) {
                errors.push(`${label}: relasi pinjaman tidak ditemukan.`);
            }

            const credit = Number(transaction.credit) || 0;
            const debit = Number(transaction.debit) || 0;
            if (credit <= 0 && debit <= 0) errors.push(`${label}: nominal transaksi kosong.`);
            if (credit > 0 && debit > 0) errors.push(`${label}: debit dan credit terisi bersamaan.`);
        });

        snapshot.userLoans.forEach(loan => {
            if (!loan.date) errors.push(`Pinjaman “${loan.name}”: tanggal kosong.`);
            if (loan.dueDate && loan.date && loan.dueDate < loan.date) {
                errors.push(`Pinjaman “${loan.name}”: jatuh tempo lebih awal dari tanggal pencatatan.`);
            }
        });

        return errors;
    }

    async function getOwnCount(client, table, userId) {
        const { count, error } = await client
            .from(table)
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (error) throw error;
        return count || 0;
    }

    async function getTargetCounts(client, userId) {
        const [accounts, categories, transactionsCount, loans] = await Promise.all([
            getOwnCount(client, 'accounts', userId),
            getOwnCount(client, 'categories', userId),
            getOwnCount(client, 'transactions', userId),
            getOwnCount(client, 'loans', userId)
        ]);

        return { accounts, categories, transactions: transactionsCount, loans };
    }

    function targetIsEmpty(counts) {
        return Object.values(counts).every(value => Number(value) === 0);
    }

    async function insertBatches(client, table, rows) {
        for (let start = 0; start < rows.length; start += BATCH_SIZE) {
            const batch = rows.slice(start, start + BATCH_SIZE);
            if (!batch.length) continue;
            const { error } = await client.from(table).insert(batch);
            if (error) throw error;
        }
    }

    async function cleanupOwnRows(client, userId) {
        const tables = ['transactions', 'loans', 'categories', 'accounts'];
        for (const table of tables) {
            const { error } = await client
                .from(table)
                .delete()
                .eq('user_id', userId);
            if (error) console.warn(`Cleanup ${table} gagal:`, error);
        }
    }

    async function fetchAllOwnRows(client, table, columns, userId) {
        const rows = [];
        const pageSize = 1000;

        for (let start = 0; ; start += pageSize) {
            const { data, error } = await client
                .from(table)
                .select(columns)
                .eq('user_id', userId)
                .range(start, start + pageSize - 1);

            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < pageSize) break;
        }

        return rows;
    }

    async function verifyMigration(client, userId, snapshot) {
        const expected = {
            accounts: snapshot.userAccounts.length,
            categories: flattenCategories(snapshot.userCategories).length,
            transactions: snapshot.transactions.length,
            loans: snapshot.userLoans.length
        };

        const actual = await getTargetCounts(client, userId);
        const countOk = Object.keys(expected).every(key => expected[key] === actual[key]);

        const remoteTransactions = await fetchAllOwnRows(
            client,
            'transactions',
            'credit,debit',
            userId
        );

        const localMoney = snapshot.transactions.reduce(
            (total, item) => {
                total.credit += Number(item.credit) || 0;
                total.debit += Number(item.debit) || 0;
                return total;
            },
            { credit: 0, debit: 0 }
        );

        const remoteMoney = remoteTransactions.reduce(
            (total, item) => {
                total.credit += Number(item.credit) || 0;
                total.debit += Number(item.debit) || 0;
                return total;
            },
            { credit: 0, debit: 0 }
        );

        const moneyOk =
            Math.abs(localMoney.credit - remoteMoney.credit) < 0.01 &&
            Math.abs(localMoney.debit - remoteMoney.debit) < 0.01;

        return { expected, actual, countOk, moneyOk, localMoney, remoteMoney };
    }

    async function refreshSummary() {
        const client = window.arahSupabase;
        const user = window.ARAHAuth?.getUser?.();
        const sourceElement = getElement('supabaseMigrationSourceSummary');
        const targetElement = getElement('supabaseMigrationTargetSummary');
        const button = getElement('supabaseMigrationButton');

        if (!client || !user) {
            if (sourceElement) sourceElement.textContent = 'Login diperlukan.';
            if (targetElement) targetElement.textContent = '-';
            if (button) button.disabled = true;
            return;
        }

        const snapshot = currentSnapshot();
        if (sourceElement) sourceElement.textContent = formatCounts(snapshot);

        try {
            const counts = await getTargetCounts(client, user.id);
            if (targetElement) {
                targetElement.textContent = `${counts.accounts} akun • ${counts.categories} kategori • ${counts.transactions} transaksi • ${counts.loans} pinjaman`;
            }

            if (button && !migrationRunning) {
                button.disabled = !targetIsEmpty(counts);
                button.classList.toggle('opacity-60', !targetIsEmpty(counts));
                button.classList.toggle('cursor-not-allowed', !targetIsEmpty(counts));
            }

            if (!targetIsEmpty(counts)) {
                setStatus('Supabase akun ini sudah berisi data. Migrasi satu kali dikunci agar tidak membuat data ganda.', 'warning');
            } else {
                setStatus('Siap disalin. Google Sheets tidak akan dihapus atau diubah.', 'info');
            }
        } catch (error) {
            console.error('Gagal membaca status migrasi:', error);
            setStatus(`Tidak bisa membaca Supabase: ${error.message || error}`, 'error');
        }
    }

    async function migrate() {
        if (migrationRunning) return;

        const client = window.arahSupabase;
        const user = window.ARAHAuth?.getUser?.();
        if (!client || !user) {
            setStatus('Login Supabase diperlukan sebelum migrasi.', 'error');
            return;
        }

        const snapshot = currentSnapshot();
        const validationErrors = validateSnapshot(snapshot);

        if (validationErrors.length) {
            console.error('Validasi migrasi gagal:', validationErrors);
            const firstErrors = validationErrors.slice(0, 3).join(' ');
            setStatus(`Data lama belum aman dimigrasikan. ${firstErrors}${validationErrors.length > 3 ? ` (+${validationErrors.length - 3} masalah lain)` : ''}`, 'error');
            return;
        }

        const existing = await getTargetCounts(client, user.id);
        if (!targetIsEmpty(existing)) {
            setStatus('Supabase akun ini tidak kosong. Migrasi dihentikan untuk mencegah duplikasi.', 'warning');
            await refreshSummary();
            return;
        }

        const approved = window.confirm(
            `Salin ${snapshot.transactions.length} transaksi beserta akun, kategori, dan pinjaman dari Google Sheets ke Supabase?\n\nGoogle Sheets tetap aman dan tidak akan dihapus.`
        );
        if (!approved) return;

        migrationRunning = true;
        setButtonBusy(true);

        try {
            setStatus('Menyiapkan relasi akun dan kategori...', 'info');

            const accountIdByName = new Map();
            const accountRows = snapshot.userAccounts.map((account, index) => {
                const id = createUuid();
                accountIdByName.set(account.name, id);
                return {
                    id,
                    user_id: user.id,
                    name: account.name,
                    type: account.type || 'Cash',
                    anchor_balance: Number(account.initial) || 0,
                    anchor_date: account.initialDate || null,
                    sort_order: index
                };
            });

            const categoryIdByName = new Map();
            const categoryRows = flattenCategories(snapshot.userCategories).map(category => {
                const id = createUuid();
                categoryIdByName.set(category.name, id);
                return {
                    id,
                    user_id: user.id,
                    name: category.name,
                    type: category.type,
                    sort_order: category.sortOrder
                };
            });

            const loanIdByLegacyId = new Map();
            const loanRows = snapshot.userLoans.map(loan => {
                const id = createUuid();
                loanIdByLegacyId.set(loan.id, id);
                return {
                    id,
                    user_id: user.id,
                    date: loan.date,
                    name: loan.name,
                    type: loan.type,
                    principal: Number(loan.principal) || 0,
                    party: loan.party || '',
                    notes: loan.notes || '',
                    due_date: loan.dueDate || null
                };
            });

            const transactionRows = snapshot.transactions.map(transaction => ({
                id: createUuid(),
                user_id: user.id,
                date: transaction.date,
                name: transaction.name,
                credit: Number(transaction.credit) || 0,
                debit: Number(transaction.debit) || 0,
                account_id: accountIdByName.get(transaction.account),
                target_account_id: transaction.targetAccount
                    ? accountIdByName.get(transaction.targetAccount) || null
                    : null,
                category_id: transaction.category
                    ? categoryIdByName.get(transaction.category) || null
                    : null,
                notes: transaction.notes || '',
                loan_id: transaction.loanId
                    ? loanIdByLegacyId.get(transaction.loanId) || null
                    : null,
                loan_role: transaction.loanRole || null,
                is_transfer: Boolean(transaction.isTransfer)
            }));

            setStatus('Menyalin akun dan kategori...', 'info');
            await insertBatches(client, 'accounts', accountRows);
            await insertBatches(client, 'categories', categoryRows);

            setStatus('Menyalin pinjaman...', 'info');
            await insertBatches(client, 'loans', loanRows);

            setStatus(`Menyalin ${transactionRows.length} transaksi...`, 'info');
            await insertBatches(client, 'transactions', transactionRows);

            setStatus('Memverifikasi hasil migrasi...', 'info');
            const verification = await verifyMigration(client, user.id, snapshot);

            if (!verification.countOk || !verification.moneyOk) {
                throw new Error('Verifikasi jumlah data atau total nominal tidak cocok.');
            }

            localStorage.setItem('arahSupabaseMigrationCompletedAt', new Date().toISOString());
            setStatus('Migrasi berhasil dan terverifikasi. Google Sheets masih menjadi sumber data aktif sampai Step 6.', 'success');
            await refreshSummary();

            const successMessage = document.getElementById('successModalMessage');
            if (successMessage) {
                successMessage.textContent = 'Seluruh data berhasil disalin dan diverifikasi di Supabase. Google Sheets belum dihapus.';
                document.getElementById('successModal')?.classList.remove('hidden');
                lucide.createIcons();
            }
        } catch (error) {
            console.error('Migrasi Supabase gagal:', error);
            setStatus('Migrasi gagal. Membersihkan data Supabase hasil percobaan agar aman untuk dicoba ulang...', 'error');
            await cleanupOwnRows(client, user.id);
            setStatus(`Migrasi gagal dan perubahan Supabase sudah dibatalkan. ${error.message || error}`, 'error');
            await refreshSummary();
        } finally {
            migrationRunning = false;
            setButtonBusy(false);
            await refreshSummary();
        }
    }

    window.ARAHMigration = {
        refreshSummary,
        migrate
    };
})();
