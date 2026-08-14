(function initializeARAHActivity() {
    const client = window.arahSupabase;
    if (!client) return;

    let timer = null;
    let currentUserId = '';
    let sending = false;

    async function sendActivityUpdate() {
        if (sending || document.visibilityState === 'hidden') return;
        sending = true;

        try {
            const { data, error } = await client.auth.getSession();
            if (error) throw error;
            const user = data?.session?.user;
            if (!user?.id) return;

            currentUserId = user.id;
            const { error: upsertError } = await client
                .from('user_activity')
                .upsert(
                    {
                        user_id: user.id,
                        last_seen_at: new Date().toISOString(),
                        current_path: window.location.pathname || '/',
                        user_agent: String(navigator.userAgent || '').slice(0, 500)
                    },
                    { onConflict: 'user_id' }
                );

            if (upsertError) throw upsertError;
        } catch (error) {
            console.warn('Pembaruan aktivitas ARAH gagal:', error?.message || error);
        } finally {
            sending = false;
        }
    }

    function stop() {
        if (timer) window.clearInterval(timer);
        timer = null;
        currentUserId = '';
    }

    function start() {
        if (timer) return;
        sendActivityUpdate();
        timer = window.setInterval(sendActivityUpdate, 60_000);
    }

    client.auth.getSession().then(({ data }) => {
        if (data?.session?.user?.id) start();
    });

    client.auth.onAuthStateChange((_event, session) => {
        if (session?.user?.id) start();
        else stop();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && currentUserId) sendActivityUpdate();
    });
})();
