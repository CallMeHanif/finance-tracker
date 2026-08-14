(function initializeARAHAdmin() {
    const adminStartupShownAt = performance.now();
    const adminStartupMinimumMs = 1000;

    const config = window.ARAH_SUPABASE_CONFIG;
    const supabaseLibrary = window.supabase;
    if (!config || !supabaseLibrary?.createClient) return;

    const client = supabaseLibrary.createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    let state = { users: [], tickets: [], announcements: [], payments: [], summary: {}, currentAdmin: null, features: { importCsvEnabled: false, commercialModeEnabled: false, purchaseUrl: '' } };
    let autoRefreshTimer = null;
    let resizeTimer = null;
    let activeAdminView = 'dashboard';
    const adminViewTitles = {
        dashboard: 'Dashboard',
        users: 'Pengguna',
        administrators: 'Administrator',
        licenses: 'Lisensi ARAH',
        messages: 'Update ARAH',
        helpdesk: 'Help Desk'
    };

    const $ = id => document.getElementById(id);
    const escapeHtml = value => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    function isSuperadmin() {
        return String(state.currentAdmin?.role || '') === 'superadmin';
    }

    function isAdminRole(role) {
        return ['admin', 'superadmin'].includes(String(role || ''));
    }

    function requestedAdminView() {
        const raw = String(window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(adminViewTitles, raw) ? raw : 'dashboard';
    }

    function renderAdminNavigation() {
        const adminNav = $('adminAdministratorsNav');
        if (adminNav) adminNav.classList.toggle('hidden', !isSuperadmin());

        const messagesNav = $('adminMessagesNav');
        if (messagesNav) messagesNav.classList.toggle('hidden', !isSuperadmin());

        const badgeEl = $('adminHelpdeskBadge');
        if (badgeEl) {
            const count = Number(state.summary?.newTickets || 0);
            badgeEl.textContent = count > 99 ? '99+' : String(count);
            badgeEl.classList.toggle('hidden', count <= 0);
        }

        document.querySelectorAll('[data-admin-route]').forEach(button => {
            const active = button.dataset.adminRoute === activeAdminView;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-current', active ? 'page' : 'false');
        });
    }

    function setAdminView(view, { updateHash = true } = {}) {
        let next = Object.prototype.hasOwnProperty.call(adminViewTitles, view) ? view : 'dashboard';

        if (['administrators', 'messages'].includes(next) && !isSuperadmin()) {
            next = 'dashboard';
        }

        activeAdminView = next;

        document.querySelectorAll('[data-admin-view]').forEach(section => {
            section.classList.toggle('hidden', section.dataset.adminView !== next);
        });

        renderAdminNavigation();

        document.title = `${adminViewTitles[next]} | Admin ARAH`;

        if (updateHash && window.location.hash !== `#${next}`) {
            history.pushState(null, '', `#${next}`);
        }

        if (next === 'dashboard') {
            if (activeAdminView === 'dashboard') window.setTimeout(renderCharts, 30);
        }

        window.scrollTo({ top: 0, behavior: 'auto' });
        window.lucide?.createIcons?.();
    }

    function applyTheme(theme) {
        const dark = theme === 'dark';
        document.documentElement.classList.toggle('dark', dark);
        localStorage.setItem('theme', dark ? 'dark' : 'light');
        updateThemeButtons();
        window.setTimeout(renderCharts, 30);
    }

    function toggleTheme() {
        applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
    }

    function updateThemeButtons() {
        const dark = document.documentElement.classList.contains('dark');
        ['adminTheme', 'adminLoginTheme'].forEach(id => {
            const button = $(id);
            if (!button) return;
            button.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}" class="w-4 h-4"></i>`;
            button.setAttribute('aria-label', dark ? 'Gunakan mode terang' : 'Gunakan mode gelap');
        });
        window.lucide?.createIcons?.();
    }

    if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.classList.add('dark');
    }

    function showLoginMessage(message, type = 'error') {
        const el = $('adminLoginMessage');
        if (!message) return el?.classList.add('hidden');
        el.className = 'rounded-xl border px-3 py-2.5 text-[11px]';
        if (type === 'error') {
            el.classList.add('border-rose-200', 'bg-rose-50', 'text-rose-700', 'dark:border-rose-900/60', 'dark:bg-rose-950/20', 'dark:text-rose-300');
        } else {
            el.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-700', 'dark:border-emerald-900/60', 'dark:bg-emerald-950/20', 'dark:text-emerald-300');
        }
        el.textContent = message;
        el.classList.remove('hidden');
    }

    function showMessage(message, type = 'success') {
        const el = $('adminMessage');
        if (!el) return;
        if (!message) return el.classList.add('hidden');
        el.className = 'rounded-xl border px-3 py-2.5 text-xs';
        if (type === 'error') {
            el.classList.add('border-rose-200', 'bg-rose-50', 'text-rose-700', 'dark:border-rose-900/60', 'dark:bg-rose-950/20', 'dark:text-rose-300');
        } else {
            el.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-700', 'dark:border-emerald-900/60', 'dark:bg-emerald-950/20', 'dark:text-emerald-300');
        }
        el.textContent = message;
        el.classList.remove('hidden');
    }

    async function invoke(action, payload = {}) {
        const { data, error } = await client.functions.invoke('admin-api', {
            body: { action, ...payload }
        });

        if (error) {
            let serverPayload = null;
            try {
                if (error?.context?.json) serverPayload = await error.context.json();
            } catch (_) {}
            throw new Error(serverPayload?.error || error.message || 'Admin API tidak dapat dihubungi.');
        }

        if (!data?.ok) throw new Error(data?.error || 'Admin API menolak permintaan.');
        return data;
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return new Intl.DateTimeFormat('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }).format(date);
    }

    function relativeTime(value) {
        if (!value) return 'Belum aktif';
        const time = new Date(value).getTime();
        if (!Number.isFinite(time)) return 'Belum aktif';
        const diff = Math.max(0, Date.now() - time);
        if (diff < 120000) return 'Online';
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${Math.max(1, mins)} menit lalu`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours} jam lalu`;
        const days = Math.floor(hours / 24);
        return `${days} hari lalu`;
    }

    function statCard(label, value, note = '') {
        return `
            <div class="admin-neon-card rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4">
                <p class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">${escapeHtml(label)}</p>
                <p class="mt-2 text-2xl font-bold">${escapeHtml(value)}</p>
                <p class="mt-1 text-[10px] text-slate-400">${escapeHtml(note)}</p>
            </div>`;
    }

    function renderStats() {
        const s = state.summary || {};
        $('adminStats').innerHTML = [
            statCard('Total User', s.totalUsers ?? 0, 'Semua akun'),
            statCard('Online', s.onlineNow ?? 0, 'Aktif < 2 menit'),
            statCard('Aktif Hari Ini', s.activeToday ?? 0, 'Aktivitas terakhir'),
            statCard('Aktif 30 Hari', s.active30d ?? 0, 'Aktivitas terakhir'),
            statCard('Lisensi Aktif', s.activeLicenses ?? 0, 'ARAH'),
            statCard('Tiket Baru', s.newTickets ?? 0, 'Butuh perhatian')
        ].join('');
    }

    function badge(label, tone = 'slate') {
        const tones = {
            green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
            blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
            amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
            rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
            violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300',
            slate: 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300'
        };
        return `<span class="admin-badge admin-badge-${escapeHtml(tone)} inline-flex rounded-full px-2 py-1 text-[9px] font-bold ${tones[tone] || tones.slate}">${escapeHtml(label)}</span>`;
    }

    function getUserStatusBadge(user) {
        if (user.suspended) return badge('SUSPENDED', 'rose');
        if (user.role === 'superadmin') return badge('SUPERADMIN', 'violet');
        if (user.role === 'admin') return badge('ADMIN', 'blue');
        return badge('ACTIVE', 'green');
    }

    function renderUsers() {
        const query = String($('adminUserSearch')?.value || '').trim().toLowerCase();
        const users = state.users.filter(user => {
            if (!query) return true;
            return `${user.name || ''} ${user.email || ''}`.toLowerCase().includes(query);
        });

        $('adminUsersBody').innerHTML = users.length ? users.map(user => {
            const activity = user.online
                ? badge('ONLINE', 'green')
                : `<span class="text-slate-500 dark:text-slate-400">${escapeHtml(relativeTime(user.last_seen_at))}</span>`;
            const licenseTone = user.license_status === 'active' ? 'blue' : user.license_status === 'suspended' ? 'rose' : user.license_status === 'pending' ? 'amber' : 'slate';
            const license = badge((user.license_status || 'pending').toUpperCase(), licenseTone);
            return `
                <tr class="admin-clickable-row" data-user-row="${escapeHtml(user.id)}" tabindex="0">
                    <td class="px-4 py-3">
                        <div class="font-semibold text-slate-900 dark:text-white">${escapeHtml(user.name || 'Pengguna ARAH')}</div>
                        <div class="mt-0.5 text-[10px] text-slate-400">${escapeHtml(user.email || '-')}</div>
                    </td>
                    <td class="px-4 py-3">${getUserStatusBadge(user)}</td>
                    <td class="px-4 py-3">${activity}</td>
                    <td class="px-4 py-3">${license}</td>
                    <td class="px-4 py-3 text-slate-500 dark:text-slate-400">${escapeHtml(formatDate(user.created_at))}</td>
                </tr>`;
        }).join('') : `<tr><td colspan="5" class="px-4 py-10 text-center text-xs text-slate-400">Tidak ada pengguna.</td></tr>`;
    }

    function renderManagers() {
        const section = $('adminManagersSection');
        if (!section) return;
        if (!isSuperadmin()) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        const admins = state.users.filter(user => isAdminRole(user.role));
        $('adminManagers').innerHTML = admins.length ? admins.map(user => `
            <button type="button" data-admin-user-id="${escapeHtml(user.id)}" class="w-full p-4 text-left flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
                <div class="min-w-0">
                    <div class="font-semibold text-xs text-slate-900 dark:text-white truncate">${escapeHtml(user.name || 'Administrator')}</div>
                    <div class="mt-0.5 text-[10px] text-slate-400 truncate">${escapeHtml(user.email || '-')}</div>
                </div>
                <div class="shrink-0">${user.role === 'superadmin' ? badge('SUPERADMIN', 'violet') : badge('ADMIN', 'blue')}</div>
            </button>`).join('') : `<div class="p-8 text-center text-xs text-slate-400">Belum ada administrator.</div>`;
    }


    function renderFeatureControls() {
        const section = $('adminFeatureSection');
        const button = $('adminImportCsvToggle');
        if (!section || !button) return;

        if (!isSuperadmin()) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');

        const enabled = Boolean(state.features?.importCsvEnabled);
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        button.dataset.enabled = enabled ? '1' : '0';
        button.setAttribute(
            'aria-label',
            enabled ? 'Sembunyikan Import CSV dari user' : 'Tampilkan Import CSV pada user'
        );
    }

    const ticketLabels = {
        forgot_password: 'Lupa password (lama)', lost_email: 'Email tidak bisa diakses', account_problem: 'Masalah akun',
        payment: 'Pembelian / lisensi', other: 'Lainnya'
    };

    const statusLabels = {
        new: ['BARU', 'blue'], in_progress: ['DIPROSES', 'amber'], waiting_user: ['MENUNGGU USER', 'amber'],
        resolved: ['SELESAI', 'green'], closed: ['DITUTUP', 'slate']
    };


    function announcementKindLabel(kind) {
        const labels = {
            update: 'UPDATE',
            info: 'INFORMASI',
            maintenance: 'MAINTENANCE'
        };
        return labels[String(kind || '')] || 'UPDATE';
    }

    function renderAnnouncements() {
        const container = $('adminAnnouncements');
        if (!container) return;

        if (!isSuperadmin()) {
            container.innerHTML = '';
            return;
        }

        const items = Array.isArray(state.announcements) ? state.announcements : [];

        if (!items.length) {
            container.innerHTML = '<div class="p-8 text-center text-[11px] text-slate-400">Belum ada update yang dikirim.</div>';
            return;
        }

        container.innerHTML = items.map(item => `
            <div class="p-4 sm:p-5 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        ${badge(announcementKindLabel(item.kind), item.kind === 'maintenance' ? 'amber' : 'blue')}
                        <span class="text-[9px] text-slate-400">${escapeHtml(formatDate(item.created_at))}</span>
                    </div>
                    <h3 class="mt-2 text-xs font-bold text-slate-900 dark:text-white">${escapeHtml(item.title || '')}</h3>
                    <p class="mt-1 max-w-3xl whitespace-pre-line text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">${escapeHtml(item.message || '')}</p>
                </div>
                <button type="button"
                    data-announcement-delete="${escapeHtml(item.id)}"
                    class="shrink-0 rounded-xl border border-rose-200 dark:border-rose-900/50 px-3 py-2 text-[10px] font-bold text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/20">
                    Hapus
                </button>
            </div>
        `).join('');
    }

    function renderTickets() {
        const filter = $('adminTicketFilter')?.value || 'all';
        const tickets = state.tickets.filter(ticket => filter === 'all' || ticket.status === filter);
        $('adminTickets').innerHTML = tickets.length ? tickets.map(ticket => {
            const statusMeta = statusLabels[ticket.status] || [ticket.status, 'slate'];
            const ticketId = `ARAH-${String(ticket.ticket_number).padStart(6, '0')}`;
            return `
                <article class="p-4 sm:p-5">
                    <div class="flex flex-col lg:flex-row lg:items-start gap-4 lg:justify-between">
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-bold text-xs">${escapeHtml(ticketId)}</span>
                                ${badge(statusMeta[0], statusMeta[1])}
                                ${badge(ticketLabels[ticket.category] || ticket.category, 'slate')}
                            </div>
                            <h3 class="mt-2 text-sm font-bold">${escapeHtml(ticket.name)}</h3>
                            <p class="mt-0.5 text-[11px] text-slate-400">${escapeHtml(ticket.email)} · ${escapeHtml(ticket.whatsapp)}</p>
                            ${ticket.order_id ? `<p class="mt-1 text-[10px] text-slate-400">Order: ${escapeHtml(ticket.order_id)}</p>` : ''}
                            <p class="mt-3 max-w-3xl text-xs leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap">${escapeHtml(ticket.message)}</p>
                            <p class="mt-2 text-[10px] text-slate-400">Dibuat ${escapeHtml(formatDate(ticket.created_at))}</p>
                        </div>
                        <div class="flex flex-wrap gap-2 lg:justify-end shrink-0">
                            <button data-ticket-action="progress" data-ticket-id="${escapeHtml(ticket.id)}" class="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-[10px] font-bold">Proses</button>
                            <button data-ticket-action="resolve" data-ticket-id="${escapeHtml(ticket.id)}" class="rounded-lg border border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 px-3 py-2 text-[10px] font-bold">Selesai</button>
                        </div>
                    </div>
                </article>`;
        }).join('') : `<div class="p-10 text-center text-xs text-slate-400">Tidak ada tiket pada filter ini.</div>`;
    }

    function canvasSetup(canvas) {
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const width = Math.max(280, Math.floor(rect.width || 600));
        const height = 220;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        return { ctx, width, height };
    }

    function chartColors() {
        const dark = document.documentElement.classList.contains('dark');
        return {
            text: dark ? '#91a8bd' : '#64748b',
            grid: dark ? 'rgba(56,189,248,.10)' : 'rgba(14,165,233,.10)',
            primary: dark ? '#22d3ee' : '#087fd7',
            secondary: dark ? '#60a5fa' : '#0ea5e9',
            glow: dark ? 'rgba(34,211,238,.55)' : 'rgba(14,165,233,.28)',
            glowSecondary: dark ? 'rgba(96,165,250,.45)' : 'rgba(14,165,233,.22)',
            muted: dark ? '#24364c' : '#e2e8f0'
        };
    }

    function getLastSixMonths() {
        const months = [];
        const now = new Date();
        for (let offset = 5; offset >= 0; offset -= 1) {
            const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
            months.push({
                year: date.getFullYear(),
                month: date.getMonth(),
                key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
                label: new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(date)
            });
        }
        return months;
    }

    function drawGrowthChart() {
        const setup = canvasSetup($('adminGrowthChart'));
        if (!setup) return;
        const { ctx, width, height } = setup;
        const colors = chartColors();
        const months = getLastSixMonths();
        const counts = months.map(item => state.users.filter(user => {
            const date = new Date(user.created_at);
            return date.getFullYear() === item.year && date.getMonth() === item.month;
        }).length);

        const left = 38, right = 14, top = 18, bottom = 34;
        const chartW = width - left - right;
        const chartH = height - top - bottom;
        const max = Math.max(1, ...counts);

        ctx.font = '10px Plus Jakarta Sans, sans-serif';
        ctx.fillStyle = colors.text;
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;

        for (let i = 0; i <= 4; i += 1) {
            const y = top + chartH * (i / 4);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(width - right, y);
            ctx.stroke();
            const value = Math.round(max * (1 - i / 4));
            ctx.fillText(String(value), 6, y + 3);
        }

        const points = counts.map((value, index) => ({
            x: left + (months.length === 1 ? chartW / 2 : chartW * index / (months.length - 1)),
            y: top + chartH - (value / max) * chartH
        }));

        ctx.beginPath();
        points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = colors.glow;
        ctx.shadowBlur = document.documentElement.classList.contains('dark') ? 11 : 5;
        ctx.stroke();
        ctx.shadowBlur = 0;

        points.forEach((point, index) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = colors.primary;
            ctx.shadowColor = colors.glow;
            ctx.shadowBlur = document.documentElement.classList.contains('dark') ? 9 : 4;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = colors.text;
            ctx.textAlign = 'center';
            ctx.fillText(months[index].label, point.x, height - 10);
            ctx.fillText(String(counts[index]), point.x, Math.max(11, point.y - 9));
        });
        ctx.textAlign = 'left';
    }

    function drawActivityChart() {
        const setup = canvasSetup($('adminActivityChart'));
        if (!setup) return;
        const { ctx, width, height } = setup;
        const colors = chartColors();
        const now = Date.now();
        const buckets = [
            { label: 'Online', value: state.users.filter(u => u.online).length },
            { label: 'Hari ini', value: state.users.filter(u => !u.online && u.last_seen_at && now - new Date(u.last_seen_at).getTime() < 86400000).length },
            { label: '7 hari', value: state.users.filter(u => u.last_seen_at && now - new Date(u.last_seen_at).getTime() >= 86400000 && now - new Date(u.last_seen_at).getTime() < 7 * 86400000).length },
            { label: '30 hari', value: state.users.filter(u => u.last_seen_at && now - new Date(u.last_seen_at).getTime() >= 7 * 86400000 && now - new Date(u.last_seen_at).getTime() < 30 * 86400000).length },
            { label: 'Lama', value: state.users.filter(u => !u.last_seen_at || now - new Date(u.last_seen_at).getTime() >= 30 * 86400000).length }
        ];

        const left = 42, right = 12, top = 18, bottom = 42;
        const chartW = width - left - right;
        const chartH = height - top - bottom;
        const max = Math.max(1, ...buckets.map(b => b.value));
        const slot = chartW / buckets.length;
        const barW = Math.min(44, slot * .56);

        ctx.font = '10px Plus Jakarta Sans, sans-serif';
        ctx.fillStyle = colors.text;
        ctx.strokeStyle = colors.grid;
        for (let i = 0; i <= 4; i += 1) {
            const y = top + chartH * (i / 4);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(width - right, y);
            ctx.stroke();
        }

        buckets.forEach((bucket, index) => {
            const x = left + slot * index + (slot - barW) / 2;
            const barH = (bucket.value / max) * chartH;
            const y = top + chartH - barH;
            ctx.fillStyle = index === 0 ? colors.secondary : colors.primary;
            ctx.shadowColor = index === 0 ? colors.glowSecondary : colors.glow;
            ctx.shadowBlur = document.documentElement.classList.contains('dark') ? 10 : 4;
            ctx.fillRect(x, y, barW, Math.max(2, barH));
            ctx.shadowBlur = 0;
            ctx.fillStyle = colors.text;
            ctx.textAlign = 'center';
            ctx.fillText(String(bucket.value), x + barW / 2, Math.max(11, y - 7));
            ctx.fillText(bucket.label, x + barW / 2, height - 12);
        });
        ctx.textAlign = 'left';
    }

    function renderCharts() {
        if ($('adminApp')?.classList.contains('hidden')) return;
        drawGrowthChart();
        drawActivityChart();
    }


    function formatIDR(value) {
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
    }

    function renderLicenseStats() {
        const container = $('adminLicenseStats');
        if (!container) return;
        const summary = state.summary || {};
        container.innerHTML = [
            ['Lisensi Aktif', summary.activeLicenses || 0],
            ['Pembayaran', summary.paidPayments || 0],
            ['Belum Diklaim', summary.unclaimedPayments || 0],
            ['Pendapatan', formatIDR(summary.totalRevenue || 0)]
        ].map(([label, value]) => `
            <div class="admin-neon-card rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4">
                <div class="text-[9px] font-bold uppercase tracking-wide text-slate-400">${escapeHtml(label)}</div>
                <div class="mt-2 text-lg font-bold text-slate-900 dark:text-white">${escapeHtml(value)}</div>
            </div>
        `).join('');
    }

    function renderCommercialConfig() {
        const section = $('adminCommercialConfigSection');
        const toggle = $('adminCommercialModeToggle');
        const input = $('adminPurchaseUrl');
        if (!section) return;
        if (!isSuperadmin()) {
            section.classList.add('hidden');
            return;
        }
        section.classList.remove('hidden');
        const enabled = Boolean(state.features?.commercialModeEnabled);
        toggle?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        if (input && document.activeElement !== input) input.value = String(state.features?.purchaseUrl || '');
    }

    function renderPayments() {
        const body = $('adminPaymentsBody');
        if (!body) return;
        const rows = Array.isArray(state.payments) ? state.payments : [];
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-[11px] text-slate-400">Belum ada pembayaran Lynk.</td></tr>';
            return;
        }
        body.innerHTML = rows.map(payment => {
            const claimed = Boolean(payment.user_id);
            return `
                <tr>
                    <td class="px-4 py-3"><div class="font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(payment.buyer_name || 'Pembeli')}</div><div class="mt-0.5 text-[10px] text-slate-400">${escapeHtml(payment.buyer_email || '-')}</div></td>
                    <td class="px-4 py-3"><div class="font-medium">${escapeHtml(payment.product_name || 'ARAH')}</div></td>
                    <td class="px-4 py-3 font-semibold">${escapeHtml(formatIDR(payment.amount || 0))}</td>
                    <td class="px-4 py-3 font-mono text-[10px] text-slate-400">${escapeHtml(payment.provider_order_id || '-')}</td>
                    <td class="px-4 py-3">${badge(claimed ? 'AKTIF' : 'MENUNGGU AKUN', claimed ? 'green' : 'amber')}</td>
                    <td class="px-4 py-3 text-[10px] text-slate-400">${escapeHtml(formatDate(payment.paid_at || payment.created_at))}</td>
                </tr>`;
        }).join('');
    }

    function renderAll() {
        renderStats();
        renderUsers();
        renderManagers();
        renderFeatureControls();
        renderLicenseStats();
        renderCommercialConfig();
        renderPayments();
        renderAnnouncements();
        renderTickets();

        const desiredView = activeAdminView || requestedAdminView();
        setAdminView(desiredView, { updateHash: false });

        window.lucide?.createIcons?.();
        if (activeAdminView === 'dashboard') window.setTimeout(renderCharts, 10);
    }

    async function loadDashboard({ silent = false } = {}) {
        if (!silent) showMessage('');
        const result = await invoke('bootstrap');
        state = {
            users: Array.isArray(result.users) ? result.users : [],
            tickets: Array.isArray(result.tickets) ? result.tickets : [],
            announcements: Array.isArray(result.announcements) ? result.announcements : [],
            payments: Array.isArray(result.payments) ? result.payments : [],
            summary: result.summary || {},
            currentAdmin: result.currentAdmin || null,
            features: result.features || { importCsvEnabled: false, commercialModeEnabled: false, purchaseUrl: '' }
        };
        renderAll();
    }

    function openModal(title, description, bodyHtml) {
        $('adminModalTitle').textContent = title;
        $('adminModalDescription').textContent = description || '';
        $('adminModalBody').innerHTML = bodyHtml;
        const modal = $('adminModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        window.lucide?.createIcons?.();
    }

    function closeModal() {
        const modal = $('adminModal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        $('adminModalBody').innerHTML = '';
    }

    function openResultModal(title, message, tone = 'success') {
        const success = tone !== 'error';
        const icon = success ? 'check-circle' : 'circle-alert';
        const iconClass = success
            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300';
        openModal(title, '', `
            <div class="text-center space-y-4">
                <div class="mx-auto w-12 h-12 rounded-full ${iconClass} flex items-center justify-center"><i data-lucide="${icon}" class="w-6 h-6"></i></div>
                <p class="text-xs leading-relaxed text-slate-600 dark:text-slate-300">${escapeHtml(message)}</p>
                <button type="button" data-modal-close class="w-full rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-2.5 text-xs font-bold">Tutup</button>
            </div>`);
    }

    function userInfoHtml(user) {
        return `
            <div class="rounded-xl bg-slate-50 dark:bg-slate-900 p-3 space-y-2 text-[11px]">
                <div class="flex justify-between gap-3"><span class="text-slate-400">Email</span><span class="font-semibold text-right break-all">${escapeHtml(user.email || '-')}</span></div>
                <div class="flex justify-between gap-3"><span class="text-slate-400">Status</span><span>${user.suspended ? 'Suspended' : 'Aktif'}</span></div>
                <div class="flex justify-between gap-3"><span class="text-slate-400">Aktivitas terakhir</span><span>${escapeHtml(relativeTime(user.last_seen_at))}</span></div>
                <div class="flex justify-between gap-3"><span class="text-slate-400">Lisensi</span><span>${escapeHtml(user.license_status || 'pending')}</span></div>
                <div class="flex justify-between gap-3"><span class="text-slate-400">Role</span><span>${escapeHtml(user.role || 'user')}</span></div>
                <div class="flex justify-between gap-3"><span class="text-slate-400">Dibuat</span><span>${escapeHtml(formatDate(user.created_at))}</span></div>
            </div>`;
    }

    function showUserManager(user) {
        const canManageAdmin = isSuperadmin() && user.id !== state.currentAdmin?.id && user.role !== 'superadmin';
        openModal(
            user.name || 'Pengguna ARAH',
            user.email || '',
            `<div class="space-y-3">
                ${userInfoHtml(user)}
                <div class="grid grid-cols-1 gap-2 pt-1">
                    <button data-modal-action="email" data-user-id="${escapeHtml(user.id)}" class="w-full rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2.5 text-left text-xs font-semibold">Ganti Email</button>
                    <button data-modal-action="license" data-user-id="${escapeHtml(user.id)}" class="w-full rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2.5 text-left text-xs font-semibold">Ubah Status Lisensi</button>
                    ${canManageAdmin && user.role !== 'admin' ? `<button data-modal-action="make-admin" data-user-id="${escapeHtml(user.id)}" class="w-full rounded-xl border border-blue-200 dark:border-blue-900/60 text-blue-700 dark:text-blue-300 px-3 py-2.5 text-left text-xs font-semibold">Jadikan Admin</button>` : ''}
                    ${canManageAdmin && user.role === 'admin' ? `<button data-modal-action="remove-admin" data-user-id="${escapeHtml(user.id)}" class="w-full rounded-xl border border-violet-200 dark:border-violet-900/60 text-violet-700 dark:text-violet-300 px-3 py-2.5 text-left text-xs font-semibold">Cabut Akses Admin</button>` : ''}
                    <button data-modal-action="suspend" data-user-id="${escapeHtml(user.id)}" data-suspended="${user.suspended ? '1' : '0'}" class="w-full rounded-xl border border-amber-200 dark:border-amber-900/60 text-amber-700 dark:text-amber-300 px-3 py-2.5 text-left text-xs font-semibold">${user.suspended ? 'Aktifkan Kembali User' : 'Suspend User'}</button>
                    <button data-modal-action="delete" data-user-id="${escapeHtml(user.id)}" class="w-full rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 px-3 py-2.5 text-left text-xs font-semibold">Hapus User</button>
                </div>
            </div>`
        );
    }

    function openEmailModal(user) {
        openModal('Ganti Email', user.name || 'Pengguna ARAH', `
            <form id="adminEmailForm" class="space-y-4">
                <div>
                    <label class="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Email baru</label>
                    <input id="adminEmailNew" type="email" required value="${escapeHtml(user.email || '')}" class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-blueSystem-500">
                </div>
                <div class="flex gap-2">
                    <button type="button" data-modal-close class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-semibold">Batal</button>
                    <button type="submit" class="flex-1 rounded-xl bg-blueSystem-500 text-white py-2.5 text-xs font-bold">Simpan</button>
                </div>
            </form>`);
        $('adminEmailForm')?.addEventListener('submit', async event => {
            event.preventDefault();
            const email = $('adminEmailNew').value.trim();
            if (!email || email === user.email) return closeModal();
            try {
                await invoke('change-email', { userId: user.id, email });
                await loadDashboard({ silent: true });
                openResultModal('Email Diperbarui', 'Email pengguna berhasil diperbarui.');
            } catch (error) {
                openResultModal('Gagal Mengubah Email', error.message, 'error');
            }
        });
    }

    function openLicenseModal(user) {
        const current = user.license_status || 'pending';
        openModal('Status Lisensi', user.name || 'Pengguna ARAH', `
            <form id="adminLicenseForm" class="space-y-4">
                <div>
                    <label class="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Status</label>
                    <select id="adminLicenseSelect" class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-blueSystem-500">
                        <option value="pending" ${current === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="active" ${current === 'active' ? 'selected' : ''}>Aktif</option>
                        <option value="inactive" ${current === 'inactive' ? 'selected' : ''}>Tidak Aktif</option>
                        <option value="suspended" ${current === 'suspended' ? 'selected' : ''}>Suspended</option>
                    </select>
                </div>
                <div class="flex gap-2">
                    <button type="button" data-modal-close class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-semibold">Batal</button>
                    <button type="submit" class="flex-1 rounded-xl bg-blueSystem-500 text-white py-2.5 text-xs font-bold">Simpan</button>
                </div>
            </form>`);
        $('adminLicenseForm')?.addEventListener('submit', async event => {
            event.preventDefault();
            try {
                await invoke('set-license', { userId: user.id, status: $('adminLicenseSelect').value });
                await loadDashboard({ silent: true });
                openResultModal('Lisensi Diperbarui', 'Status lisensi pengguna berhasil diperbarui.');
            } catch (error) {
                openResultModal('Gagal Mengubah Lisensi', error.message, 'error');
            }
        });
    }

    function openSuspendModal(user) {
        const suspended = Boolean(user.suspended);
        openModal(suspended ? 'Aktifkan Pengguna' : 'Suspend Pengguna', user.email || '', `
            <div class="space-y-4">
                <p class="text-xs leading-relaxed text-slate-600 dark:text-slate-300">${suspended ? 'Pengguna akan dapat login dan menggunakan ARAH kembali.' : 'Pengguna tidak dapat menggunakan akun ARAH sampai kamu mengaktifkannya kembali.'}</p>
                <div class="flex gap-2">
                    <button type="button" data-modal-close class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-semibold">Batal</button>
                    <button id="confirmSuspendUser" type="button" class="flex-1 rounded-xl ${suspended ? 'bg-emerald-600' : 'bg-amber-500'} text-white py-2.5 text-xs font-bold">${suspended ? 'Aktifkan' : 'Suspend'}</button>
                </div>
            </div>`);
        $('confirmSuspendUser')?.addEventListener('click', async () => {
            try {
                await invoke('set-suspended', { userId: user.id, suspended: !suspended });
                await loadDashboard({ silent: true });
                openResultModal(suspended ? 'Pengguna Diaktifkan' : 'Pengguna Disuspend', suspended ? 'Akun pengguna kembali aktif.' : 'Akun pengguna berhasil disuspend.');
            } catch (error) {
                openResultModal('Tindakan Gagal', error.message, 'error');
            }
        });
    }

    function openDeleteModal(user) {
        openModal('Hapus User', user.email || '', `
            <form id="adminDeleteForm" class="space-y-4">
                <div class="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/20 p-3 text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">Penghapusan bersifat permanen dan data Vault milik user akan ikut terhapus melalui cascade.</div>
                <div>
                    <label class="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Ketik <strong>HAPUS</strong> untuk melanjutkan</label>
                    <input id="adminDeleteConfirm" type="text" autocomplete="off" required class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-rose-500">
                </div>
                <div class="flex gap-2">
                    <button type="button" data-modal-close class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-semibold">Batal</button>
                    <button type="submit" class="flex-1 rounded-xl bg-rose-600 text-white py-2.5 text-xs font-bold">Hapus Permanen</button>
                </div>
            </form>`);
        $('adminDeleteForm')?.addEventListener('submit', async event => {
            event.preventDefault();
            if ($('adminDeleteConfirm').value.trim() !== 'HAPUS') {
                openResultModal('Konfirmasi Tidak Sesuai', 'Ketik HAPUS dengan huruf kapital untuk melanjutkan.', 'error');
                return;
            }
            try {
                await invoke('delete-user', { userId: user.id });
                await loadDashboard({ silent: true });
                openResultModal('User Dihapus', 'Pengguna berhasil dihapus secara permanen.');
            } catch (error) {
                openResultModal('Gagal Menghapus User', error.message, 'error');
            }
        });
    }

    function openAdminRoleConfirmation(user, role) {
        const promoting = role === 'admin';
        openModal(promoting ? 'Jadikan Admin' : 'Cabut Akses Admin', user.email || '', `
            <div class="space-y-4">
                <p class="text-xs leading-relaxed text-slate-600 dark:text-slate-300">${promoting ? 'User ini akan mendapatkan akses ke Admin Console ARAH.' : 'User ini akan kembali menjadi pengguna biasa dan kehilangan akses Admin Console.'}</p>
                <div class="flex gap-2">
                    <button type="button" data-modal-close class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-semibold">Batal</button>
                    <button id="confirmAdminRole" type="button" class="flex-1 rounded-xl ${promoting ? 'bg-blueSystem-500' : 'bg-violet-600'} text-white py-2.5 text-xs font-bold">${promoting ? 'Jadikan Admin' : 'Cabut Akses'}</button>
                </div>
            </div>`);
        $('confirmAdminRole')?.addEventListener('click', async () => {
            try {
                await invoke('set-admin-role', { userId: user.id, role });
                await loadDashboard({ silent: true });
                openResultModal('Akses Diperbarui', promoting ? 'User sekarang menjadi Admin ARAH.' : 'Akses Admin berhasil dicabut.');
            } catch (error) {
                openResultModal('Gagal Mengubah Akses', error.message, 'error');
            }
        });
    }

    function openAddAdminModal() {
        openModal('Tambah Admin', 'User harus sudah memiliki akun ARAH.', `
            <form id="adminAddManagerForm" class="space-y-4">
                <div>
                    <label class="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Email user</label>
                    <input id="adminManagerEmail" type="email" required placeholder="nama@email.com" class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-blueSystem-500">
                </div>
                <div class="rounded-xl bg-slate-50 dark:bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">Superadmin tetap hanya dapat ditetapkan lewat server/SQL. Dari halaman ini kamu dapat menambah atau mencabut akses Admin biasa.</div>
                <div class="flex gap-2">
                    <button type="button" data-modal-close class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-semibold">Batal</button>
                    <button type="submit" class="flex-1 rounded-xl bg-blueSystem-500 text-white py-2.5 text-xs font-bold">Tambah Admin</button>
                </div>
            </form>`);
        $('adminAddManagerForm')?.addEventListener('submit', async event => {
            event.preventDefault();
            try {
                await invoke('set-admin-role', { email: $('adminManagerEmail').value.trim(), role: 'admin' });
                await loadDashboard({ silent: true });
                openResultModal('Admin Ditambahkan', 'Akses Admin berhasil diberikan.');
            } catch (error) {
                openResultModal('Gagal Menambah Admin', error.message, 'error');
            }
        });
    }

    function showAdminManager(user) {
        if (user.role === 'superadmin') {
            openModal('Superadmin', user.email || '', `${userInfoHtml(user)}<p class="mt-3 text-[10px] leading-relaxed text-slate-400">Akses Superadmin dilindungi dan tidak dapat diubah dari halaman ini.</p>`);
            return;
        }
        openModal('Administrator', user.email || '', `
            <div class="space-y-3">
                ${userInfoHtml(user)}
                <button data-modal-action="transfer-superadmin" data-user-id="${escapeHtml(user.id)}" class="w-full rounded-xl border border-cyan-200 dark:border-cyan-900/60 text-cyan-700 dark:text-cyan-300 px-3 py-2.5 text-left text-xs font-semibold">Transfer Superadmin</button>
                <button data-modal-action="remove-admin" data-user-id="${escapeHtml(user.id)}" class="w-full rounded-xl border border-violet-200 dark:border-violet-900/60 text-violet-700 dark:text-violet-300 px-3 py-2.5 text-left text-xs font-semibold">Cabut Akses Admin</button>
                <button data-modal-action="email" data-user-id="${escapeHtml(user.id)}" class="w-full rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2.5 text-left text-xs font-semibold">Ganti Email</button>
            </div>`);
    }

    function openTransferSuperadminModal(user) {
        if (!isSuperadmin() || String(user?.role || '') !== 'admin') return;

        openModal('Transfer Superadmin', user.email || '', `
            <div class="space-y-4">
                <div class="rounded-xl border border-cyan-200 dark:border-cyan-900/60 bg-cyan-50 dark:bg-cyan-950/20 p-3 text-[11px] leading-relaxed text-cyan-800 dark:text-cyan-200">
                    Akun ini akan menjadi Superadmin ARAH. Akun Superadmin yang sedang kamu gunakan akan otomatis turun menjadi Admin.
                </div>
                <p class="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Setelah transfer berhasil, kamu akan keluar dari Admin Console dan perlu login kembali menggunakan akun Superadmin baru.
                </p>
                <div>
                    <label class="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Ketik <strong>TRANSFER</strong> untuk melanjutkan</label>
                    <input id="adminTransferSuperadminConfirm" type="text" autocomplete="off" class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500">
                </div>
                <div class="flex gap-2">
                    <button type="button" data-modal-close class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-semibold">Batal</button>
                    <button id="confirmTransferSuperadmin" type="button" class="flex-1 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white py-2.5 text-xs font-bold">Transfer</button>
                </div>
            </div>
        `);

        $('confirmTransferSuperadmin')?.addEventListener('click', async () => {
            if ($('adminTransferSuperadminConfirm')?.value?.trim() !== 'TRANSFER') {
                openResultModal('Konfirmasi Tidak Sesuai', 'Ketik TRANSFER dengan huruf kapital untuk melanjutkan.', 'error');
                return;
            }

            const button = $('confirmTransferSuperadmin');
            if (button) {
                button.disabled = true;
                button.textContent = 'Memindahkan...';
            }

            try {
                await invoke('transfer-superadmin', { userId: user.id });

                // Current account is no longer Superadmin. End this session so
                // stale role claims cannot keep the old Admin Console open.
                await client.auth.signOut();
                window.location.reload();
            } catch (error) {
                if (button) {
                    button.disabled = false;
                    button.textContent = 'Transfer';
                }
                openResultModal('Transfer Superadmin Gagal', error.message, 'error');
            }
        });
    }


    async function updateTicket(ticketId, status) {
        try {
            await invoke('set-ticket-status', { ticketId, status });
            await loadDashboard({ silent: true });
            openResultModal('Tiket Diperbarui', 'Status tiket berhasil diperbarui.');
        } catch (error) {
            openResultModal('Gagal Memperbarui Tiket', error.message, 'error');
        }
    }


    async function toggleImportCsvFeature(button) {
        if (!isSuperadmin() || !button || button.dataset.busy === '1') return;

        const previousEnabled = Boolean(state.features?.importCsvEnabled);
        const nextEnabled = !previousEnabled;

        button.dataset.busy = '1';
        button.disabled = true;

        state.features = {
            ...(state.features || {}),
            importCsvEnabled: nextEnabled
        };
        renderFeatureControls();

        try {
            await invoke('set-feature-flag', {
                key: 'import_csv_enabled',
                enabled: nextEnabled
            });
        } catch (error) {
            state.features = {
                ...(state.features || {}),
                importCsvEnabled: previousEnabled
            };
            renderFeatureControls();
            openResultModal('Gagal Memperbarui Fitur', error.message, 'error');
        } finally {
            button.dataset.busy = '0';
            button.disabled = false;
        }
    }


    function openCreateAnnouncementModal() {
        if (!isSuperadmin()) return;

        openModal('Kirim Update', 'Update akan muncul untuk seluruh user ARAH.', `
            <form id="adminAnnouncementForm" class="space-y-4">
                <div>
                    <label class="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Jenis</label>
                    <select id="adminAnnouncementKind" class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-xs focus:outline-none focus:border-blueSystem-500">
                        <option value="update">Update</option>
                        <option value="info">Informasi</option>
                        <option value="maintenance">Maintenance</option>
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Judul</label>
                    <input id="adminAnnouncementTitle" type="text" maxlength="120" required placeholder="Contoh: ARAH v1.2 sudah tersedia" class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-xs focus:outline-none focus:border-blueSystem-500">
                </div>
                <div>
                    <label class="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Isi Update</label>
                    <textarea id="adminAnnouncementMessage" maxlength="3000" rows="6" required placeholder="Tulis informasi update untuk user..." class="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 text-xs leading-relaxed focus:outline-none focus:border-blueSystem-500"></textarea>
                </div>
                <button id="adminAnnouncementSubmit" type="submit" class="w-full rounded-xl bg-blueSystem-500 py-2.5 text-xs font-bold text-white">Kirim Update</button>
            </form>
        `);

        $('adminAnnouncementForm')?.addEventListener('submit', async event => {
            event.preventDefault();

            const button = $('adminAnnouncementSubmit');
            if (button) {
                button.disabled = true;
                button.textContent = 'Mengirim...';
            }

            try {
                await invoke('create-announcement', {
                    kind: $('adminAnnouncementKind')?.value || 'update',
                    title: $('adminAnnouncementTitle')?.value?.trim() || '',
                    message: $('adminAnnouncementMessage')?.value?.trim() || ''
                });

                closeModal();
                await loadDashboard({ silent: true });
            } catch (error) {
                if (button) {
                    button.disabled = false;
                    button.textContent = 'Kirim Update';
                }
                openResultModal('Update Gagal Dikirim', error.message, 'error');
            }
        });
    }

    function openDeleteAnnouncementModal(messageId) {
        if (!isSuperadmin()) return;
        const item = state.announcements.find(message => message.id === messageId);
        if (!item) return;

        openModal('Hapus Update', item.title || 'Update ARAH', `
            <div class="space-y-4">
                <p class="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">Update akan hilang dari aplikasi seluruh user.</p>
                <div class="flex gap-2">
                    <button type="button" data-modal-close class="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-semibold">Batal</button>
                    <button id="adminAnnouncementDeleteConfirm" type="button" class="flex-1 rounded-xl bg-rose-600 py-2.5 text-xs font-bold text-white">Hapus</button>
                </div>
            </div>
        `);

        $('adminAnnouncementDeleteConfirm')?.addEventListener('click', async () => {
            const button = $('adminAnnouncementDeleteConfirm');
            if (button) {
                button.disabled = true;
                button.textContent = 'Menghapus...';
            }

            try {
                await invoke('delete-announcement', { messageId });
                closeModal();
                await loadDashboard({ silent: true });
            } catch (error) {
                openResultModal('Gagal Menghapus Update', error.message, 'error');
            }
        });
    }

    function togglePassword(button) {
        const input = $(button.dataset.passwordToggle);
        if (!input) return;
        const revealing = input.type === 'password';
        input.type = revealing ? 'text' : 'password';
        button.innerHTML = `<i data-lucide="${revealing ? 'eye-off' : 'eye'}" class="w-4 h-4"></i>`;
        button.setAttribute('aria-label', revealing ? 'Sembunyikan password' : 'Tampilkan password');
        window.lucide?.createIcons?.();
    }

    document.addEventListener('click', async event => {
        const routeButton = event.target.closest('[data-admin-route]');
        if (routeButton) {
            setAdminView(routeButton.dataset.adminRoute);
            return;
        }

        const deleteAnnouncementButton = event.target.closest('[data-announcement-delete]');
        if (deleteAnnouncementButton) {
            openDeleteAnnouncementModal(deleteAnnouncementButton.dataset.announcementDelete);
            return;
        }

        const commercialToggle = event.target.closest('#adminCommercialModeToggle');
        if (commercialToggle) {
            if (!isSuperadmin() || commercialToggle.dataset.busy === '1') return;
            const previous = Boolean(state.features?.commercialModeEnabled);
            const next = !previous;
            commercialToggle.dataset.busy = '1';
            commercialToggle.disabled = true;
            state.features = { ...(state.features || {}), commercialModeEnabled: next };
            renderCommercialConfig();
            try {
                await invoke('set-commercial-config', { enabled: next });
            } catch (error) {
                state.features = { ...(state.features || {}), commercialModeEnabled: previous };
                renderCommercialConfig();
                openResultModal('Gagal Memperbarui Lisensi', error.message, 'error');
            } finally {
                commercialToggle.dataset.busy = '0';
                commercialToggle.disabled = false;
            }
            return;
        }

        const featureToggle = event.target.closest('[data-feature-toggle="import_csv_enabled"]');
        if (featureToggle) {
            toggleImportCsvFeature(featureToggle);
            return;
        }

        const passwordButton = event.target.closest('[data-password-toggle]');
        if (passwordButton) {
            togglePassword(passwordButton);
            return;
        }

        if (event.target.closest('[data-modal-close]')) {
            closeModal();
            return;
        }

        const userRow = event.target.closest('[data-user-row]');
        if (userRow) {
            const user = state.users.find(item => item.id === userRow.dataset.userRow);
            if (user) showUserManager(user);
            return;
        }

        const adminUserButton = event.target.closest('[data-admin-user-id]');
        if (adminUserButton) {
            const user = state.users.find(item => item.id === adminUserButton.dataset.adminUserId);
            if (user) showAdminManager(user);
            return;
        }

        const ticketButton = event.target.closest('[data-ticket-action]');
        if (ticketButton) {
            if (ticketButton.dataset.ticketAction === 'progress') {
                await updateTicket(ticketButton.dataset.ticketId, 'in_progress');
            } else if (ticketButton.dataset.ticketAction === 'resolve') {
                await updateTicket(ticketButton.dataset.ticketId, 'resolved');
            }
            return;
        }

        const modalButton = event.target.closest('[data-modal-action]');
        if (!modalButton) return;
        const user = state.users.find(item => item.id === modalButton.dataset.userId);
        if (!user) return;

        if (modalButton.dataset.modalAction === 'email') openEmailModal(user);
        if (modalButton.dataset.modalAction === 'license') openLicenseModal(user);
        if (modalButton.dataset.modalAction === 'suspend') openSuspendModal(user);
        if (modalButton.dataset.modalAction === 'delete') openDeleteModal(user);
        if (modalButton.dataset.modalAction === 'make-admin') openAdminRoleConfirmation(user, 'admin');
        if (modalButton.dataset.modalAction === 'remove-admin') openAdminRoleConfirmation(user, 'user');
        if (modalButton.dataset.modalAction === 'transfer-superadmin') openTransferSuperadminModal(user);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !$('adminModal')?.classList.contains('hidden')) closeModal();
        const row = event.target.closest?.('[data-user-row]');
        if (row && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            const user = state.users.find(item => item.id === row.dataset.userRow);
            if (user) showUserManager(user);
        }
    });

    $('adminModalClose')?.addEventListener('click', closeModal);
    $('adminModal')?.addEventListener('click', event => {
        if (event.target === $('adminModal')) closeModal();
    });
    $('adminUserSearch')?.addEventListener('input', renderUsers);
    $('adminTicketFilter')?.addEventListener('change', renderTickets);
    $('adminAddManager')?.addEventListener('click', openAddAdminModal);
    $('adminCreateMessage')?.addEventListener('click', openCreateAnnouncementModal);
    $('adminTheme')?.addEventListener('click', toggleTheme);
    $('adminLoginTheme')?.addEventListener('click', toggleTheme);
    $('adminLogout')?.addEventListener('click', async () => {
        if (autoRefreshTimer) window.clearInterval(autoRefreshTimer);
        await client.auth.signOut();
        window.location.reload();
    });

    $('adminLoginForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        showLoginMessage('');
        const button = $('adminLoginButton');
        button.disabled = true;
        button.textContent = 'Memproses...';
        try {
            const { data, error } = await client.auth.signInWithPassword({
                email: $('adminEmail').value.trim(),
                password: $('adminPassword').value
            });
            if (error) throw error;
            if (!data?.session) throw new Error('Sesi admin tidak terbentuk.');
            await enterAdmin();
        } catch (error) {
            showLoginMessage(error.message || 'Login admin gagal.');
        } finally {
            button.disabled = false;
            button.textContent = 'Masuk Admin';
        }
    });

    function showAdminLogin() {
        $('adminApp')?.classList.add('hidden');
        $('adminLogin')?.classList.remove('hidden');
        $('adminLoginTheme')?.classList.remove('hidden');
        window.lucide?.createIcons?.();
    }

    function hideAdminStartupLoader() {
        const loader = $('adminStartupLoader');
        if (!loader || loader.dataset.closed === '1') return;

        loader.dataset.closed = '1';

        const elapsed = performance.now() - adminStartupShownAt;
        const remaining = Math.max(0, adminStartupMinimumMs - elapsed);

        window.setTimeout(() => {
            loader.classList.add('is-leaving');
            window.setTimeout(() => loader.classList.add('hidden'), 240);
        }, remaining);
    }

    function startAutoRefresh() {
        if (autoRefreshTimer) window.clearInterval(autoRefreshTimer);
        autoRefreshTimer = window.setInterval(async () => {
            if (document.visibilityState !== 'visible') return;
            if (!$('adminModal')?.classList.contains('hidden')) return;
            try { await loadDashboard({ silent: true }); } catch (_) {}
        }, 60_000);
    }

    async function enterAdmin() {
        try {
            await loadDashboard();
            $('adminLogin').classList.add('hidden');
            $('adminLoginTheme')?.classList.add('hidden');
            $('adminApp').classList.remove('hidden');

            activeAdminView = requestedAdminView();
            if (activeAdminView === 'administrators' && !isSuperadmin()) {
                activeAdminView = 'dashboard';
            }

            renderAll();
            startAutoRefresh();
        } catch (error) {
            if (/admin|forbidden|akses/i.test(error.message || '')) {
                await client.auth.signOut().catch(() => {});
                throw new Error('Akun ini tidak memiliki akses Admin ARAH.');
            }
            throw error;
        }
    }

    window.addEventListener('hashchange', () => {
        if ($('adminApp')?.classList.contains('hidden')) return;
        setAdminView(requestedAdminView(), { updateHash: false });
    });

    window.addEventListener('resize', () => {
        if (resizeTimer) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(renderCharts, 150);
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !$('adminApp')?.classList.contains('hidden')) {
            loadDashboard({ silent: true }).catch(() => {});
        }
    });

    updateThemeButtons();
    window.lucide?.createIcons?.();


    $('adminPurchaseUrlForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        if (!isSuperadmin()) return;
        const input = $('adminPurchaseUrl');
        const button = $('adminSavePurchaseUrl');
        const status = $('adminPurchaseUrlStatus');
        const purchaseUrl = String(input?.value || '').trim();
        if (purchaseUrl && !/^https:\/\/.+/i.test(purchaseUrl)) {
            openResultModal('URL Tidak Valid', 'URL pembelian harus menggunakan HTTPS.', 'error');
            return;
        }
        if (button) { button.disabled = true; button.textContent = 'Menyimpan...'; }
        try {
            await invoke('set-commercial-config', { purchaseUrl });
            state.features = { ...(state.features || {}), purchaseUrl };
            if (status) {
                status.classList.remove('hidden');
                window.setTimeout(() => status.classList.add('hidden'), 1600);
            }
        } catch (error) {
            openResultModal('Gagal Menyimpan URL', error.message, 'error');
        } finally {
            if (button) { button.disabled = false; button.textContent = 'Simpan'; }
        }
    });

    client.auth.getSession()
        .then(async ({ data, error }) => {
            if (error) throw error;

            if (data?.session) {
                try {
                    await enterAdmin();
                } catch (adminError) {
                    showAdminLogin();
                    showLoginMessage(adminError.message || 'Akses Admin tidak dapat dimuat.');
                }
            } else {
                showAdminLogin();
            }
        })
        .catch(error => {
            showAdminLogin();
            showLoginMessage(error?.message || 'Sesi Admin tidak dapat diperiksa.');
        })
        .finally(() => {
            hideAdminStartupLoader();
        });
})();
