(function initializeARAHVault() {
    const client = window.arahSupabase;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const databaseName = 'arah-private-vault';
    const storeName = 'keys';
    let activeUserId = '';
    let encryptionKey = null;
    let tokenKey = null;
    let unlockPromise = null;

    if (!client || !window.crypto?.subtle) {
        console.error('Perangkat ini belum mendukung perlindungan data ARAH.');
        return;
    }

    function bytesToBase64Url(bytes) {
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function base64UrlToBytes(value) {
        const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function bytesToHex(bytes) {
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    function recoveryCodeFromBytes(bytes) {
        return bytesToHex(bytes).match(/.{1,4}/g).join('-');
    }

    function recoveryBytesFromCode(value) {
        const clean = String(value || '').replace(/[^0-9a-f]/gi, '');
        if (clean.length !== 64) throw new Error('Kunci Pemulihan harus berisi 64 karakter heksadesimal.');
        const bytes = new Uint8Array(32);
        for (let i = 0; i < 32; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
        return bytes;
    }

    function randomBytes(length) {
        return window.crypto.getRandomValues(new Uint8Array(length));
    }

    function openKeyDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, 1);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: 'userId' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Penyimpanan kunci perangkat tidak tersedia.'));
        });
    }

    async function readDeviceKeys(userId) {
        const database = await openKeyDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(storeName, 'readonly');
            const request = transaction.objectStore(storeName).get(userId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('Kunci perangkat tidak dapat dibaca.'));
            transaction.oncomplete = () => database.close();
        });
    }

    async function saveDeviceKeys(userId, aesKey, hmacKey) {
        const database = await openKeyDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(storeName, 'readwrite');
            transaction.objectStore(storeName).put({ userId, aesKey, hmacKey, savedAt: Date.now() });
            transaction.oncomplete = () => {
                database.close();
                resolve();
            };
            transaction.onerror = () => {
                database.close();
                reject(transaction.error || new Error('Kunci perangkat tidak dapat disimpan.'));
            };
        });
    }

    async function importMasterKeys(rawBytes) {
        const aesKey = await crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        const hmacKey = await crypto.subtle.importKey('raw', rawBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return { aesKey, hmacKey };
    }

    function getGate() {
        return document.getElementById('privacyVaultGate');
    }

    function setPanel(panelId) {
        ['privacyVaultBusy', 'privacyVaultCreated', 'privacyVaultUnlock'].forEach(id => {
            document.getElementById(id)?.classList.toggle('hidden', id !== panelId);
        });
        getGate()?.classList.remove('hidden');
    }

    function hideGate() {
        getGate()?.classList.add('hidden');
    }

    function waitForConfirmation() {
        return new Promise(resolve => {
            const button = document.getElementById('privacyVaultConfirmSaved');
            if (!button) return resolve();
            button.onclick = () => resolve();
        });
    }

    function waitForRecoveryCode() {
        return new Promise((resolve, reject) => {
            const form = document.getElementById('privacyVaultUnlockForm');
            const input = document.getElementById('privacyVaultRecoveryInput');
            const message = document.getElementById('privacyVaultMessage');
            if (!form || !input) return reject(new Error('Form Kunci Pemulihan tidak tersedia.'));
            input.value = '';
            if (message) {
                message.textContent = '';
                message.classList.add('hidden');
            }
            const handler = event => {
                event.preventDefault();
                try {
                    const bytes = recoveryBytesFromCode(input.value);
                    form.removeEventListener('submit', handler);
                    resolve(bytes);
                } catch (error) {
                    if (message) {
                        message.textContent = error.message;
                        message.classList.remove('hidden');
                    }
                }
            };
            form.addEventListener('submit', handler);
            input.focus();
        });
    }

    async function copyRecoveryCode() {
        const code = document.getElementById('privacyVaultRecoveryCode')?.textContent || '';
        if (!code) return;
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(code);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = code;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        const button = document.getElementById('privacyVaultCopy');
        if (button) {
            const original = button.textContent;
            button.textContent = 'Tersalin';
            setTimeout(() => { button.textContent = original; }, 1200);
        }
    }

    async function getAuthenticatedUser() {
        const sessionUser = window.ARAHAuth?.getUser?.();
        if (sessionUser?.id) return sessionUser;
        const { data, error } = await client.auth.getUser();
        if (error) throw error;
        if (!data?.user?.id) throw new Error('Sesi ARAH tidak ditemukan. Silakan masuk kembali.');
        return data.user;
    }

    async function readVaultProfile(userId) {
        const { data, error } = await client
            .from('vault_profiles')
            .select('user_id,key_version,wrapped_key,wrap_iv')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function createVault(user) {
        setPanel('privacyVaultBusy');
        const masterRaw = randomBytes(32);
        const recoveryRaw = randomBytes(32);
        const recoveryKey = await crypto.subtle.importKey('raw', recoveryRaw, { name: 'AES-GCM' }, false, ['encrypt']);
        const wrapIv = randomBytes(12);
        const additionalData = encoder.encode(`ARAH:recovery:v1:${user.id}`);
        const wrappedBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: wrapIv, additionalData, tagLength: 128 },
            recoveryKey,
            masterRaw
        );
        const imported = await importMasterKeys(masterRaw);
        const { error } = await client.from('vault_profiles').insert({
            user_id: user.id,
            key_version: 1,
            wrapped_key: bytesToBase64Url(new Uint8Array(wrappedBuffer)),
            wrap_iv: bytesToBase64Url(wrapIv)
        });
        if (error) throw error;
        await saveDeviceKeys(user.id, imported.aesKey, imported.hmacKey);
        activeUserId = user.id;
        encryptionKey = imported.aesKey;
        tokenKey = imported.hmacKey;
        const recoveryCode = recoveryCodeFromBytes(recoveryRaw);
        masterRaw.fill(0);
        recoveryRaw.fill(0);
        const codeElement = document.getElementById('privacyVaultRecoveryCode');
        if (codeElement) codeElement.textContent = recoveryCode;
        setPanel('privacyVaultCreated');
        await waitForConfirmation();
        hideGate();
    }

    async function unlockExistingVault(user, profile) {
        setPanel('privacyVaultUnlock');
        while (true) {
            const recoveryRaw = await waitForRecoveryCode();
            try {
                const recoveryKey = await crypto.subtle.importKey('raw', recoveryRaw, { name: 'AES-GCM' }, false, ['decrypt']);
                const additionalData = encoder.encode(`ARAH:recovery:v1:${user.id}`);
                const masterBuffer = await crypto.subtle.decrypt(
                    {
                        name: 'AES-GCM',
                        iv: base64UrlToBytes(profile.wrap_iv),
                        additionalData,
                        tagLength: 128
                    },
                    recoveryKey,
                    base64UrlToBytes(profile.wrapped_key)
                );
                const masterRaw = new Uint8Array(masterBuffer);
                const imported = await importMasterKeys(masterRaw);
                await saveDeviceKeys(user.id, imported.aesKey, imported.hmacKey);
                activeUserId = user.id;
                encryptionKey = imported.aesKey;
                tokenKey = imported.hmacKey;
                masterRaw.fill(0);
                recoveryRaw.fill(0);
                hideGate();
                return;
            } catch (error) {
                recoveryRaw.fill(0);
                const message = document.getElementById('privacyVaultMessage');
                if (message) {
                    message.textContent = 'Kunci Pemulihan tidak cocok. Periksa kembali lalu coba lagi.';
                    message.classList.remove('hidden');
                }
                setPanel('privacyVaultUnlock');
            }
        }
    }

    async function ensureUnlocked() {
        const user = await getAuthenticatedUser();
        if (activeUserId === user.id && encryptionKey && tokenKey) return user;
        if (unlockPromise) {
            await unlockPromise;
            return user;
        }
        unlockPromise = (async () => {
            const profile = await readVaultProfile(user.id);
            if (profile) {
                const stored = await readDeviceKeys(user.id).catch(() => null);
                if (stored?.aesKey && stored?.hmacKey) {
                    activeUserId = user.id;
                    encryptionKey = stored.aesKey;
                    tokenKey = stored.hmacKey;
                    hideGate();
                    return;
                }
                await unlockExistingVault(user, profile);
                return;
            }
            await createVault(user);
        })();
        try {
            await unlockPromise;
        } finally {
            unlockPromise = null;
        }
        return user;
    }

    async function token(value) {
        await ensureUnlocked();
        const signature = await crypto.subtle.sign('HMAC', tokenKey, encoder.encode(`ARAH:token:v1:${String(value)}`));
        return bytesToBase64Url(new Uint8Array(signature));
    }

    async function digest(value) {
        const result = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
        return bytesToBase64Url(new Uint8Array(result));
    }

    async function encryptPayload(itemId, payload) {
        const user = await ensureUnlocked();
        const iv = randomBytes(12);
        const additionalData = encoder.encode(`ARAH:item:v1:${user.id}:${itemId}`);
        const plaintext = encoder.encode(JSON.stringify(payload));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
            encryptionKey,
            plaintext
        );
        return {
            iv: bytesToBase64Url(iv),
            ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
            keyVersion: 1
        };
    }

    async function decryptPayload(row) {
        const user = await ensureUnlocked();
        const additionalData = encoder.encode(`ARAH:item:v1:${user.id}:${row.item_id}`);
        const decrypted = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: base64UrlToBytes(row.iv),
                additionalData,
                tagLength: 128
            },
            encryptionKey,
            base64UrlToBytes(row.ciphertext)
        );
        return JSON.parse(decoder.decode(decrypted));
    }

    window.ARAHVault = Object.freeze({
        ensureUnlocked,
        token,
        digest,
        encryptPayload,
        decryptPayload,
        copyRecoveryCode
    });
})();
