(function initializeARAHDataModule() {
    const client = window.arahSupabase;
    const vault = window.ARAHVault;
    const pageSize = 500;
    const writeBatchSize = 100;
    let realtimeChannel = null;
    let currentUserId = '';
    let remoteIndex = new Map();

    if (!client || !vault) {
        console.error('Penyimpanan data ARAH belum tersedia.');
        return;
    }

    async function getAuthenticatedUser() {
        const sessionUser = window.ARAHAuth?.getUser?.();
        if (sessionUser?.id) return sessionUser;
        const { data, error } = await client.auth.getUser();
        if (error) throw error;
        if (!data?.user?.id) throw new Error('Sesi ARAH tidak ditemukan. Silakan masuk kembali.');
        return data.user;
    }

    function normalizeWorkspace(data) {
        const source = data && typeof data === 'object' ? data : {};
        const categories = source.userCategories && typeof source.userCategories === 'object' ? source.userCategories : {};
        return {
            status: 'success',
            userAccounts: Array.isArray(source.userAccounts) ? source.userAccounts : [],
            userCategories: {
                income: Array.isArray(categories.income) ? categories.income : [],
                expense: Array.isArray(categories.expense) ? categories.expense : [],
                neutral: Array.isArray(categories.neutral) ? categories.neutral : []
            },
            transactions: Array.isArray(source.transactions) ? source.transactions : [],
            userLoans: Array.isArray(source.userLoans) ? source.userLoans : []
        };
    }

    function friendlyDataError(error) {
        const message = String(error?.message || '')
            .replace(/supabase/gi, 'ARAH')
            .trim();
        const lower = message.toLowerCase();
        if (lower.includes('vault_profiles') || lower.includes('vault_items') || lower.includes('schema cache')) return 'Penyimpanan privat ARAH belum siap digunakan.';
        if (lower.includes('operationerror') || lower.includes('decrypt')) return 'Data terenkripsi tidak dapat dibuka. Coba masuk ulang atau gunakan Bantuan Admin.';
        if (lower.includes('jwt') || lower.includes('session')) return 'Sesi ARAH sudah tidak valid. Silakan masuk kembali.';
        if (lower.includes('failed to fetch') || lower.includes('network')) return 'Koneksi data terputus. Periksa internet lalu coba lagi.';
        return message || 'Terjadi masalah saat mengakses data ARAH.';
    }

    async function mapLimited(items, limit, mapper) {
        const result = new Array(items.length);
        let cursor = 0;
        async function worker() {
            while (true) {
                const index = cursor;
                cursor += 1;
                if (index >= items.length) return;
                result[index] = await mapper(items[index], index);
            }
        }
        const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker);
        await Promise.all(workers);
        return result;
    }

    async function fetchEncryptedRows(userId) {
        const rows = [];
        let from = 0;
        while (true) {
            const { data, error } = await client
                .from('vault_items')
                .select('id,user_id,item_id,bucket_token,month_token,key_version,iv,ciphertext,updated_at')
                .eq('user_id', userId)
                .order('id', { ascending: true })
                .range(from, from + pageSize - 1);
            if (error) throw error;
            const batch = Array.isArray(data) ? data : [];
            rows.push(...batch);
            if (batch.length < pageSize) break;
            from += pageSize;
        }
        return rows;
    }

    function emptyWorkspace() {
        return {
            status: 'success',
            userAccounts: [],
            userCategories: { income: [], expense: [], neutral: [] },
            transactions: [],
            userLoans: []
        };
    }

    async function loadWorkspace() {
        const user = await vault.ensureUnlocked();
        const rows = await fetchEncryptedRows(user.id);
        const decrypted = await mapLimited(rows, 24, async row => {
            try {
                const payload = await vault.decryptPayload(row);
                const signature = await vault.digest(JSON.stringify(payload));
                return { row, payload, signature };
            } catch (error) {
                const wrapped = new Error('Satu atau lebih data terenkripsi tidak dapat dibuka.');
                wrapped.cause = error;
                throw wrapped;
            }
        });
        const workspace = emptyWorkspace();
        const nextIndex = new Map();
        const accounts = [];
        const categories = [];
        const transactions = [];
        const loans = [];

        decrypted.forEach(item => {
            const payload = item.payload || {};
            nextIndex.set(item.row.item_id, {
                signature: item.signature,
                bucketToken: item.row.bucket_token,
                monthToken: item.row.month_token || null
            });
            if (payload.kind === 'account') accounts.push(payload);
            if (payload.kind === 'category') categories.push(payload);
            if (payload.kind === 'transaction') transactions.push(payload);
            if (payload.kind === 'loan') loans.push(payload);
        });

        accounts.sort((a, b) => (a.order || 0) - (b.order || 0));
        categories.sort((a, b) => (a.order || 0) - (b.order || 0));
        transactions.sort((a, b) => (a.order || 0) - (b.order || 0));
        loans.sort((a, b) => (a.order || 0) - (b.order || 0));

        workspace.userAccounts = accounts.map(item => item.data);
        categories.forEach(item => {
            if (workspace.userCategories[item.categoryType]) workspace.userCategories[item.categoryType].push(item.data);
        });
        workspace.transactions = transactions.map(item => item.data);
        workspace.userLoans = loans.map(item => item.data);
        remoteIndex = nextIndex;
        currentUserId = user.id;
        return normalizeWorkspace(workspace);
    }

    async function makeItem(kind, stableKey, order, data, extra = {}) {
        const itemId = await vault.token(`item:${kind}:${stableKey}`);
        const bucketToken = await vault.token(`bucket:${kind}`);
        const monthToken = extra.month ? await vault.token(`month:${extra.month}`) : null;
        const payload = {
            kind,
            order,
            data,
            ...(extra.categoryType ? { categoryType: extra.categoryType } : {})
        };
        const signature = await vault.digest(JSON.stringify(payload));
        return { itemId, bucketToken, monthToken, payload, signature };
    }

    async function flattenWorkspace(workspace) {
        const source = normalizeWorkspace(workspace);
        const pending = [];
        source.userAccounts.forEach((account, index) => {
            const stableKey = String(account?.name || '').trim().toLocaleLowerCase('id-ID');
            if (stableKey) pending.push(makeItem('account', stableKey, index, account));
        });
        ['income', 'expense', 'neutral'].forEach(categoryType => {
            source.userCategories[categoryType].forEach((name, index) => {
                const stableKey = `${categoryType}:${String(name || '').trim().toLocaleLowerCase('id-ID')}`;
                if (String(name || '').trim()) pending.push(makeItem('category', stableKey, index, name, { categoryType }));
            });
        });
        source.userLoans.forEach((loan, index) => {
            const stableKey = String(loan?.id || '').trim();
            if (stableKey) pending.push(makeItem('loan', stableKey, index, loan));
        });
        source.transactions.forEach((transaction, index) => {
            const stableKey = String(transaction?.id || '').trim();
            const date = String(transaction?.date || '');
            const month = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : 'unknown';
            if (stableKey) pending.push(makeItem('transaction', stableKey, index, transaction, { month }));
        });
        return Promise.all(pending);
    }

    async function upsertChangedItems(userId, items) {
        for (let offset = 0; offset < items.length; offset += writeBatchSize) {
            const batch = items.slice(offset, offset + writeBatchSize);
            const rows = await mapLimited(batch, 16, async item => {
                const encrypted = await vault.encryptPayload(item.itemId, item.payload);
                return {
                    user_id: userId,
                    item_id: item.itemId,
                    bucket_token: item.bucketToken,
                    month_token: item.monthToken,
                    key_version: encrypted.keyVersion,
                    iv: encrypted.iv,
                    ciphertext: encrypted.ciphertext,
                    updated_at: new Date().toISOString()
                };
            });
            const { error } = await client.from('vault_items').upsert(rows, { onConflict: 'user_id,item_id' });
            if (error) throw error;
        }
    }

    async function deleteRemovedItems(userId, itemIds) {
        for (let offset = 0; offset < itemIds.length; offset += writeBatchSize) {
            const batch = itemIds.slice(offset, offset + writeBatchSize);
            const { error } = await client.from('vault_items').delete().eq('user_id', userId).in('item_id', batch);
            if (error) throw error;
        }
    }

    async function saveWorkspace(workspace) {
        const user = await vault.ensureUnlocked();
        const normalized = normalizeWorkspace(workspace);
        const items = await flattenWorkspace(normalized);
        const localById = new Map(items.map(item => [item.itemId, item]));
        const changed = items.filter(item => remoteIndex.get(item.itemId)?.signature !== item.signature);
        const removed = Array.from(remoteIndex.keys()).filter(itemId => !localById.has(itemId));
        if (changed.length) await upsertChangedItems(user.id, changed);
        if (removed.length) await deleteRemovedItems(user.id, removed);
        changed.forEach(item => {
            remoteIndex.set(item.itemId, {
                signature: item.signature,
                bucketToken: item.bucketToken,
                monthToken: item.monthToken
            });
        });
        removed.forEach(itemId => remoteIndex.delete(itemId));
        currentUserId = user.id;
        return normalized;
    }

    async function unsubscribeRealtime() {
        if (!realtimeChannel) return;
        const channel = realtimeChannel;
        realtimeChannel = null;
        await client.removeChannel(channel).catch(() => {});
    }

    async function subscribeRealtime(onChange) {
        const user = await getAuthenticatedUser();
        if (realtimeChannel && currentUserId === user.id) return realtimeChannel;
        await unsubscribeRealtime();
        currentUserId = user.id;
        realtimeChannel = client
            .channel(`arah-private-${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'vault_items',
                    filter: `user_id=eq.${user.id}`
                },
                payload => {
                    if (typeof onChange === 'function') onChange({ payload });
                }
            );
        realtimeChannel.subscribe();
        return realtimeChannel;
    }

    window.ARAHData = Object.freeze({
        loadWorkspace,
        saveWorkspace,
        subscribeRealtime,
        unsubscribeRealtime,
        friendlyDataError
    });
})();
