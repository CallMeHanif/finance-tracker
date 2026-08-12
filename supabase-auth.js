
(function initializeARAHAuthModule() {
    window.ARAH_BOOT_STARTED_AT = window.ARAH_BOOT_STARTED_AT || Date.now();
    const config = window.ARAH_SUPABASE_CONFIG;
    const supabaseLibrary = window.supabase;

    if (!config || !config.url || !config.publishableKey) {
        console.error('Konfigurasi ARAH tidak ditemukan.');
        return;
    }

    if (!supabaseLibrary || typeof supabaseLibrary.createClient !== 'function') {
        console.error('Library data ARAH gagal dimuat.');
        return;
    }

    const client = supabaseLibrary.createClient(
        config.url,
        config.publishableKey,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        }
    );

    window.arahSupabase = client;

    let currentSession = null;
    let currentMode = 'login';
    let authenticatedResolve = null;
    let authenticatedPromise = new Promise(resolve => {
        authenticatedResolve = resolve;
    });

    function getElement(id) {
        return document.getElementById(id);
    }

    function setButtonBusy(button, busy, busyLabel, idleLabel) {
        if (!button) return;
        button.disabled = Boolean(busy);
        button.classList.toggle('opacity-60', Boolean(busy));
        button.classList.toggle('cursor-not-allowed', Boolean(busy));
        button.textContent = busy ? busyLabel : idleLabel;
    }

    function showMessage(message, type = 'error') {
        const element = getElement('authMessage');
        if (!element) return;

        if (!message) {
            element.classList.add('hidden');
            element.textContent = '';
            return;
        }

        element.className = 'mb-4 rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed';

        if (type === 'success') {
            element.classList.add(
                'border-emerald-200',
                'bg-emerald-50',
                'text-emerald-700',
                'dark:border-emerald-900/50',
                'dark:bg-emerald-950/30',
                'dark:text-emerald-300'
            );
        } else if (type === 'info') {
            element.classList.add(
                'border-blue-200',
                'bg-blue-50',
                'text-blue-700',
                'dark:border-blue-900/50',
                'dark:bg-blue-950/30',
                'dark:text-blue-300'
            );
        } else {
            element.classList.add(
                'border-rose-200',
                'bg-rose-50',
                'text-rose-700',
                'dark:border-rose-900/50',
                'dark:bg-rose-950/30',
                'dark:text-rose-300'
            );
        }

        element.textContent = message;
        element.classList.remove('hidden');
    }

    function friendlyAuthError(error) {
        const message = String(error?.message || '').toLowerCase();

        if (message.includes('invalid login credentials')) {
            return 'Email atau password tidak cocok.';
        }

        if (message.includes('email not confirmed')) {
            return 'Email belum dikonfirmasi. Buka email verifikasi dari ARAH terlebih dahulu.';
        }

        if (message.includes('user already registered')) {
            return 'Email ini sudah terdaftar. Silakan masuk menggunakan akun tersebut.';
        }

        if (message.includes('password')) {
            return error?.message || 'Password belum memenuhi ketentuan keamanan.';
        }

        if (message.includes('rate limit')) {
            return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
        }

        return error?.message || 'Terjadi masalah saat menghubungkan akun ARAH.';
    }

    function updateAccountUI(session = currentSession) {
        const user = session?.user || null;
        const email = user?.email || '-';
        const name =
            user?.user_metadata?.full_name ||
            user?.user_metadata?.name ||
            (email !== '-' ? email.split('@')[0] : 'Pengguna ARAH');

        const emailElement = getElement('authUserEmail');
        const nameElement = getElement('authUserName');
        const greetingElement = getElement('dashboardGreeting');

        if (emailElement) emailElement.textContent = email;
        if (nameElement) nameElement.textContent = name;
        if (greetingElement) greetingElement.textContent = `Halo, ${name}`;
    }

    function hideStartupLoader() {
        const loader = getElement('globalLoader');
        if (!loader) return;

        const elapsed = Date.now() - window.ARAH_BOOT_STARTED_AT;
        const delay = Math.max(0, 850 - elapsed);
        window.setTimeout(() => loader.classList.add('hidden'), delay);
    }

    function showGate() {
        const gate = getElement('authGate');
        if (gate) gate.classList.remove('hidden');
    }

    function hideGate() {
        const gate = getElement('authGate');
        if (gate) gate.classList.add('hidden');
    }

    function resolveAuthenticated(session) {
        if (!session) return;
        currentSession = session;
        updateAccountUI(session);
        hideGate();

        if (authenticatedResolve) {
            authenticatedResolve(session);
            authenticatedResolve = null;
        }
    }

    function showMode(mode) {
        currentMode = mode === 'register' ? 'register' : 'login';

        const loginForm = getElement('authLoginForm');
        const registerForm = getElement('authRegisterForm');
        const loginTab = getElement('authTabLogin');
        const registerTab = getElement('authTabRegister');

        loginForm?.classList.toggle('hidden', currentMode !== 'login');
        registerForm?.classList.toggle('hidden', currentMode !== 'register');

        const activeClasses = ['bg-white', 'dark:bg-slate-800', 'text-blueSystem-500', 'shadow-sm'];
        const inactiveClasses = ['text-slate-500', 'dark:text-slate-400'];

        [loginTab, registerTab].forEach(tab => {
            if (!tab) return;
            tab.classList.remove(...activeClasses, ...inactiveClasses);
        });

        if (currentMode === 'login') {
            loginTab?.classList.add(...activeClasses);
            registerTab?.classList.add(...inactiveClasses);
        } else {
            registerTab?.classList.add(...activeClasses);
            loginTab?.classList.add(...inactiveClasses);
        }

        showMessage('');
    }

    async function signIn(email, password) {
        const { data, error } = await client.auth.signInWithPassword({
            email: String(email || '').trim(),
            password: String(password || '')
        });

        if (error) throw error;
        if (!data?.session) throw new Error('Session login tidak terbentuk.');

        resolveAuthenticated(data.session);
        return data.session;
    }

    async function signUp(name, email, password) {
        const currentPath = window.location.pathname || '/index.html';
        const emailRedirectTo = `${window.location.origin}${currentPath}`;

        const { data, error } = await client.auth.signUp({
            email: String(email || '').trim(),
            password: String(password || ''),
            options: {
                emailRedirectTo,
                data: {
                    full_name: String(name || '').trim()
                }
            }
        });

        if (error) throw error;

        if (data?.session) {
            resolveAuthenticated(data.session);
            return { requiresEmailConfirmation: false };
        }

        return { requiresEmailConfirmation: true };
    }

    async function signOut() {
        const { error } = await client.auth.signOut();
        if (error) {
            alert(friendlyAuthError(error));
            return;
        }

        currentSession = null;
        window.location.reload();
    }

    async function requireSession() {
        if (currentSession) return currentSession;
        showGate();
        return authenticatedPromise;
    }

    async function init() {
        showMode('login');
        showGate();

        const loginForm = getElement('authLoginForm');
        const registerForm = getElement('authRegisterForm');

        loginForm?.addEventListener('submit', async event => {
            event.preventDefault();
            showMessage('');

            const button = getElement('authLoginButton');
            setButtonBusy(button, true, 'Memproses...', 'Masuk');

            try {
                await signIn(
                    getElement('authLoginEmail')?.value,
                    getElement('authLoginPassword')?.value
                );
            } catch (error) {
                console.error('Login ARAH gagal:', error);
                showMessage(friendlyAuthError(error));
            } finally {
                setButtonBusy(button, false, 'Memproses...', 'Masuk');
            }
        });

        registerForm?.addEventListener('submit', async event => {
            event.preventDefault();
            showMessage('');

            const name = getElement('authRegisterName')?.value || '';
            const email = getElement('authRegisterEmail')?.value || '';
            const password = getElement('authRegisterPassword')?.value || '';
            const passwordConfirm = getElement('authRegisterPasswordConfirm')?.value || '';

            if (password.length < 8) {
                showMessage('Gunakan password minimal 8 karakter.');
                return;
            }

            if (password !== passwordConfirm) {
                showMessage('Konfirmasi password belum sama.');
                return;
            }

            const button = getElement('authRegisterButton');
            setButtonBusy(button, true, 'Membuat akun...', 'Buat Akun');

            try {
                const result = await signUp(name, email, password);

                if (result.requiresEmailConfirmation) {
                    showMode('login');
                    const loginEmail = getElement('authLoginEmail');
                    if (loginEmail) loginEmail.value = email.trim();
                    showMessage(
                        'Akun berhasil dibuat. Cek email verifikasi dari ARAH, klik tautannya, lalu masuk menggunakan email dan password tadi.',
                        'success'
                    );
                }
            } catch (error) {
                console.error('Pendaftaran ARAH gagal:', error);
                showMessage(friendlyAuthError(error));
            } finally {
                setButtonBusy(button, false, 'Membuat akun...', 'Buat Akun');
            }
        });

        const { data, error } = await client.auth.getSession();

        if (error) {
            console.error('Gagal membaca sesi ARAH:', error);
            showMessage(friendlyAuthError(error));
        }

        if (data?.session) {
            resolveAuthenticated(data.session);
        } else {
            hideStartupLoader();
        }

        client.auth.onAuthStateChange((event, session) => {
            currentSession = session || null;

            if (session) {
                resolveAuthenticated(session);
                return;
            }

            if (event === 'SIGNED_OUT') {
                updateAccountUI(null);
                showGate();
            }
        });
    }

    window.ARAHAuth = {
        client,
        init,
        requireSession,
        showMode,
        signOut,
        getSession: () => currentSession,
        getUser: () => currentSession?.user || null
    };

    window.ARAHAuth.ready = init();
})();
