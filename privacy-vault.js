(function initializeARAHVault() {
    const client = window.arahSupabase;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const databaseName = 'arah-private-vault';
    const storeName = 'keys';
    const vaultVersion = 4;
    const kdfIterations = 600000;
    const kdfAlgorithm = 'PBKDF2-SHA256';
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

    function randomBytes(length) {
        return window.crypto.getRandomValues(new Uint8Array(length));
    }

    function openKeyDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, 1);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(storeName)) {
                    database.createObjectStore(storeName, { keyPath: 'userId' });
                }
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
            transaction.objectStore(storeName).put({
                userId,
                vaultVersion,
                aesKey,
                hmacKey,
                savedAt: Date.now()
            });
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
        const aesKey = await crypto.subtle.importKey(
            'raw',
            rawBytes,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
        );
        const hmacKey = await crypto.subtle.importKey(
            'raw',
            rawBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        return { aesKey, hmacKey };
    }

    async function derivePasswordKey(password, salt, iterations = kdfIterations) {
        const material = await crypto.subtle.importKey(
            'raw',
            encoder.encode(String(password || '')),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt,
                iterations: Number(iterations) || kdfIterations,
                hash: 'SHA-256'
            },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function buildPasswordWrap(userId, keyVersion, masterRaw, password) {
        const salt = randomBytes(16);
        const iv = randomBytes(12);
        const passwordKey = await derivePasswordKey(password, salt, kdfIterations);
        const additionalData = encoder.encode(`ARAH:password-wrap:v4:${userId}:${keyVersion}`);
        const wrapped = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
            passwordKey,
            masterRaw
        );

        return {
            vault_version: vaultVersion,
            key_version: keyVersion,
            kdf_algorithm: kdfAlgorithm,
            kdf_iterations: kdfIterations,
            password_salt: bytesToBase64Url(salt),
            password_wrap_iv: bytesToBase64Url(iv),
            password_wrapped_key: bytesToBase64Url(new Uint8Array(wrapped))
        };
    }

    async function unwrapMasterWithPassword(userId, profile, password) {
        const salt = base64UrlToBytes(profile.password_salt);
        const iv = base64UrlToBytes(profile.password_wrap_iv);
        const passwordKey = await derivePasswordKey(password, salt, profile.kdf_iterations);
        const additionalData = encoder.encode(`ARAH:password-wrap:v4:${userId}:${profile.key_version}`);
        const master = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
            passwordKey,
            base64UrlToBytes(profile.password_wrapped_key)
        );
        return new Uint8Array(master);
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
            .select('user_id,key_version,vault_version,kdf_algorithm,kdf_iterations,password_salt,password_wrap_iv,password_wrapped_key,created_at,updated_at')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function requireVaultPassword(message) {
        const current = window.ARAHAuth?.getVaultPassword?.();
        if (current) return current;
        if (!window.ARAHAuth?.waitForVaultPassword) {
            throw new Error('Password diperlukan untuk membuka data ARAH di perangkat ini.');
        }
        return window.ARAHAuth.waitForVaultPassword(message);
    }

    async function activateMasterKey(userId, masterRaw) {
        const imported = await importMasterKeys(masterRaw);
        await saveDeviceKeys(userId, imported.aesKey, imported.hmacKey);
        activeUserId = userId;
        encryptionKey = imported.aesKey;
        tokenKey = imported.hmacKey;
    }

    async function invokeRecoveryServer(body) {
        const { data, error } = await client.functions.invoke('vault-recovery', { body });

        if (error) {
            let payload = null;

            try {
                if (error?.context?.json) {
                    payload = await error.context.json();
                }
            } catch (_) {}

            const stage = payload?.stage ? ` [${payload.stage}]` : '';
            const message =
                payload?.error ||
                payload?.message ||
                error?.message ||
                'Layanan pemulihan Vault belum tersedia.';

            const details = [
                payload?.code ? `Kode: ${payload.code}` : '',
                payload?.details ? `Detail: ${payload.details}` : '',
                payload?.hint ? `Hint: ${payload.hint}` : ''
            ].filter(Boolean).join('\n');

            const uiMessage = String(message || '').replace(/supabase/gi, 'ARAH');
            throw new Error(`${uiMessage}${stage}${details ? `\n${details}` : ''}`);
        }

        if (!data?.ok) {
            const stage = data?.stage ? ` [${data.stage}]` : '';
            throw new Error(`${data?.error || 'Layanan pemulihan Vault gagal memproses permintaan.'}${stage}`);
        }

        return data;
    }

    async function createVaultV4(user, password, legacyProfile = null) {
        if (legacyProfile && Number(legacyProfile.vault_version || 3) < vaultVersion) {
            const { error: deleteError } = await client
                .from('vault_items')
                .delete()
                .eq('user_id', user.id);
            if (deleteError) throw deleteError;
        }

        const masterRaw = randomBytes(32);
        const keyVersion = 1;

        try {
            const profile = await buildPasswordWrap(user.id, keyVersion, masterRaw, password);
            await invokeRecoveryServer({
                action: 'setup',
                masterKey: bytesToBase64Url(masterRaw),
                profile
            });
            await activateMasterKey(user.id, masterRaw);
        } finally {
            masterRaw.fill(0);
            window.ARAHAuth?.clearVaultPassword?.();
        }
    }

    async function unlockVaultV4(user, profile, password) {
        let masterRaw;
        try {
            try {
                masterRaw = await unwrapMasterWithPassword(user.id, profile, password);
            } catch (passwordWrapError) {
                const recovered = await invokeRecoveryServer({ action: 'recover' });
                masterRaw = base64UrlToBytes(String(recovered?.masterKey || ''));

                if (masterRaw.length !== 32) throw passwordWrapError;

                const repairedProfile = await buildPasswordWrap(
                    user.id,
                    Number(profile.key_version || 1),
                    masterRaw,
                    password
                );

                await invokeRecoveryServer({
                    action: 'setup',
                    masterKey: bytesToBase64Url(masterRaw),
                    profile: repairedProfile
                });
            }

            await activateMasterKey(user.id, masterRaw);
        } catch (error) {
            const wrapped = new Error('Data terenkripsi ARAH tidak dapat dibuka. Coba atur ulang password melalui email.');
            wrapped.cause = error;
            throw wrapped;
        } finally {
            masterRaw?.fill?.(0);
            window.ARAHAuth?.clearVaultPassword?.();
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

            if (profile && Number(profile.vault_version || 3) >= vaultVersion && profile.password_wrapped_key) {
                const stored = await readDeviceKeys(user.id).catch(() => null);
                if (stored?.vaultVersion === vaultVersion && stored?.aesKey && stored?.hmacKey) {
                    activeUserId = user.id;
                    encryptionKey = stored.aesKey;
                    tokenKey = stored.hmacKey;
                    window.ARAHAuth?.clearVaultPassword?.();
                    return;
                }

                const password = await requireVaultPassword('Masukkan password untuk membuka data ARAH di perangkat ini.');
                await unlockVaultV4(user, profile, password);
                return;
            }

            const password = await requireVaultPassword(
                profile
                    ? 'Masukkan password untuk memperbarui Vault ARAH ke sistem keamanan terbaru.'
                    : 'Masukkan password untuk menyiapkan Vault ARAH.'
            );
            await createVaultV4(user, password, profile);
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
        const signature = await crypto.subtle.sign(
            'HMAC',
            tokenKey,
            encoder.encode(`ARAH:token:v1:${String(value)}`)
        );
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
        decryptPayload
    });
})();
