(function initializeARAHEmailRecovery() {
    const config = window.ARAH_SUPABASE_CONFIG;
    const supabaseLibrary = window.supabase;
    if (!config || !supabaseLibrary?.createClient || !window.crypto?.subtle) return;

    const initialRecoveryMarker = `${window.location.hash} ${window.location.search}`;

    const client = supabaseLibrary.createClient(config.url, config.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true, flowType: 'implicit' }
    });

    const encoder = new TextEncoder();
    const kdfIterations = 600000;
    const form = document.getElementById('recoveryForm');
    const message = document.getElementById('recoveryMessage');
    const button = document.getElementById('recoveryButton');
    let recoverySession = null;
    let recoveryContextConfirmed = false;

    function showMessage(text, type = 'error') {
        if (!message) return;
        message.className = 'rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed';
        if (type === 'success') {
            message.classList.add('border-emerald-200','bg-emerald-50','text-emerald-700','dark:border-emerald-900/50','dark:bg-emerald-950/30','dark:text-emerald-300');
        } else {
            message.classList.add('border-rose-200','bg-rose-50','text-rose-700','dark:border-rose-900/50','dark:bg-rose-950/30','dark:text-rose-300');
        }
        message.textContent = text;
        message.classList.remove('hidden');
    }

    function setBusy(busy) {
        if (!button) return;
        button.disabled = Boolean(busy);
        button.classList.toggle('opacity-60', Boolean(busy));
        button.classList.toggle('cursor-not-allowed', Boolean(busy));
        button.textContent = busy ? 'Menyimpan...' : 'Simpan Password Baru';
    }

    function bytesToBase64Url(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
    }

    function base64UrlToBytes(value) {
        const normalized = String(value || '').replace(/-/g,'+').replace(/_/g,'/');
        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    async function derivePasswordKey(password, salt) {
        const material = await crypto.subtle.importKey('raw', encoder.encode(String(password || '')), { name: 'PBKDF2' }, false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: kdfIterations, hash: 'SHA-256' },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );
    }

    async function buildPasswordWrap(userId, keyVersion, masterRaw, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const passwordKey = await derivePasswordKey(password, salt);
        const additionalData = encoder.encode(`ARAH:password-wrap:v4:${userId}:${keyVersion}`);
        const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, passwordKey, masterRaw);
        return {
            vault_version: 4,
            key_version: keyVersion,
            kdf_algorithm: 'PBKDF2-SHA256',
            kdf_iterations: kdfIterations,
            password_salt: bytesToBase64Url(salt),
            password_wrap_iv: bytesToBase64Url(iv),
            password_wrapped_key: bytesToBase64Url(new Uint8Array(wrapped))
        };
    }

    async function invokeVault(body) {
        const { data, error } = await client.functions.invoke('vault-recovery', { body });
        if (error) {
            let payload = null;
            try { if (error?.context?.json) payload = await error.context.json(); } catch (_) {}
            throw new Error(payload?.error || payload?.message || error?.message || 'Pemulihan data ARAH gagal.');
        }
        if (!data?.ok) throw new Error(data?.error || 'Pemulihan data ARAH gagal.');
        return data;
    }

    document.addEventListener('click', event => {
        const toggle = event.target.closest('[data-password-toggle]');
        if (!toggle) return;
        const input = document.getElementById(toggle.dataset.passwordToggle);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');

        const eyeOpen = toggle.querySelector('[data-eye-open]');
        const eyeOff = toggle.querySelector('[data-eye-off]');
        eyeOpen?.classList.toggle('hidden', show);
        eyeOff?.classList.toggle('hidden', !show);
    });

    client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session) {
            recoveryContextConfirmed = true;
            recoverySession = session;
            document.getElementById('recoveryPassword')?.focus();
        }
    });

    window.setTimeout(async () => {
        if (recoverySession) return;
        const { data } = await client.auth.getSession();
        if (data?.session && initialRecoveryMarker.includes('type=recovery')) {
            recoveryContextConfirmed = true;
            recoverySession = data.session;
            document.getElementById('recoveryPassword')?.focus();
            return;
        }
        showMessage('Link reset password tidak valid atau sudah kedaluwarsa. Kembali ke halaman masuk dan minta link baru.');
        setBusy(true);
        if (button) button.textContent = 'Link Tidak Valid';
    }, 700);

    form?.addEventListener('submit', async event => {
        event.preventDefault();

        if (!recoveryContextConfirmed || !recoverySession) {
            showMessage('Link reset password tidak valid atau sudah kedaluwarsa.');
            return;
        }

        const password = String(document.getElementById('recoveryPassword')?.value || '');
        const confirmation = String(document.getElementById('recoveryPasswordConfirm')?.value || '');
        if (password.length < 8) return showMessage('Gunakan password minimal 8 karakter.');
        if (password !== confirmation) return showMessage('Konfirmasi password belum sama.');

        setBusy(true);
        let masterRaw = null;

        try {
            const userId = recoverySession.user?.id;
            if (!userId) throw new Error('Sesi pemulihan akun tidak valid.');

            const { data: profile, error: profileError } = await client
                .from('vault_profiles')
                .select('key_version,vault_version,recovery_wrapped_key')
                .eq('user_id', userId)
                .maybeSingle();

            if (profileError) throw profileError;
            if (!profile || Number(profile.vault_version) < 4 || !profile.recovery_wrapped_key) {
                throw new Error('Data terenkripsi akun ini belum mendukung pemulihan password.');
            }

            const recovered = await invokeVault({ action: 'recover' });
            masterRaw = base64UrlToBytes(recovered.masterKey);
            if (masterRaw.length !== 32) throw new Error('Kunci data ARAH tidak valid.');

            const newProfile = await buildPasswordWrap(userId, Number(profile.key_version || 1), masterRaw, password);

            const { error: passwordError } = await client.auth.updateUser({ password });
            if (passwordError) throw passwordError;

            await invokeVault({
                action: 'setup',
                masterKey: bytesToBase64Url(masterRaw),
                profile: newProfile
            });

            masterRaw.fill(0);
            masterRaw = null;
            await client.auth.signOut().catch(() => {});
            form.reset();
            showMessage('Password berhasil diperbarui. Kamu bisa masuk kembali menggunakan password baru.', 'success');
            if (button) {
                button.disabled = true;
                button.textContent = 'Berhasil';
            }
            window.setTimeout(() => window.location.replace('./index.html'), 1400);
        } catch (error) {
            if (masterRaw) masterRaw.fill(0);
            console.error('Reset password ARAH gagal:', error);
            showMessage(String(error?.message || 'Reset password gagal.').replace(/supabase/gi, 'ARAH'));
            setBusy(false);
        }
    });
})();
