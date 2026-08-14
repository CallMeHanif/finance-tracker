import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isAdminRole(role: unknown) {
  return ['admin', 'superadmin'].includes(String(role || ''));
}

function isSuperadmin(role: unknown) {
  return String(role || '') === 'superadmin';
}

async function listAllUsers(admin: any) {
  const users = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
}

async function audit(admin: any, adminUserId: string, action: string, targetUserId: string | null = null, ticketId: string | null = null, metadata: Record<string, unknown> = {}) {
  const { error } = await admin.from('admin_audit_logs').insert({
    admin_user_id: adminUserId,
    action,
    target_user_id: targetUserId,
    ticket_id: ticketId,
    metadata,
  });
  if (error) console.error('audit log gagal:', error.message);
}

async function getTargetUser(admin: any, body: any) {
  const userId = String(body?.userId || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();

  if (userId) {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) throw error;
    return data?.user || null;
  }

  if (email) {
    const users = await listAllUsers(admin);
    return users.find((user: any) => String(user.email || '').toLowerCase() === email) || null;
  }

  return null;
}

function assertCanTouchProtectedUser(callerRole: string, callerId: string, target: any) {
  const targetRole = String(target?.app_metadata?.role || 'user');
  if (target?.id === callerId && targetRole === 'superadmin') {
    throw new Error('Superadmin tidak dapat mengubah akses akun sendiri dari panel ini.');
  }
  if (targetRole === 'superadmin') {
    throw new Error('Akun Superadmin dilindungi dan tidak dapat diubah dari panel Admin.');
  }
  if (!isSuperadmin(callerRole) && isAdminRole(targetRole)) {
    throw new Error('Admin biasa tidak dapat mengubah akun Admin lain.');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method tidak didukung.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Konfigurasi server ARAH tidak tersedia.');

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ ok: false, error: 'Sesi Admin tidak ditemukan.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const adminUser = authData?.user;
    if (authError || !adminUser?.id) return json({ ok: false, error: 'Sesi Admin tidak valid.' }, 401);

    const callerRole = String(adminUser.app_metadata?.role || '');
    if (!isAdminRole(callerRole)) {
      return json({ ok: false, error: 'Akses Admin ARAH ditolak.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    if (action === 'bootstrap') {
      const users = await listAllUsers(admin);
      const [
        { data: activity, error: activityError },
        { data: entitlements, error: entitlementError },
        { data: tickets, error: ticketError },
        { data: settings, error: settingsError },
        { data: announcements, error: announcementError },
        { data: payments, error: paymentError },
      ] = await Promise.all([
        admin.from('user_activity').select('user_id,last_seen_at,current_path'),
        admin.from('entitlements').select('user_id,status,source,order_id,purchased_at,expires_at'),
        admin.from('support_tickets').select('id,ticket_number,user_id,name,email,whatsapp,category,order_id,message,status,priority,assigned_to,created_at,updated_at').order('created_at', { ascending: false }).limit(200),
        admin.from('app_settings').select('key,value'),
        admin.from('announcements').select('id,title,message,kind,is_published,created_by,created_at').order('created_at', { ascending: false }).limit(100),
        admin.from('payments').select('id,user_id,buyer_email,buyer_name,buyer_phone,provider,provider_order_id,provider_event_id,amount,currency,status,product_id,product_name,paid_at,claimed_at,created_at').order('created_at', { ascending: false }).limit(200),
      ]);
      if (activityError) throw activityError;
      if (entitlementError) throw entitlementError;
      if (ticketError) throw ticketError;
      if (settingsError) throw settingsError;
      if (announcementError) throw announcementError;
      if (paymentError) throw paymentError;

      const activityMap = new Map((activity || []).map((item: any) => [item.user_id, item]));
      const entitlementMap = new Map((entitlements || []).map((item: any) => [item.user_id, item]));
      const now = Date.now();
      const twoMinutes = 2 * 60 * 1000;
      const oneDay = 24 * 60 * 60 * 1000;
      const thirtyDays = 30 * oneDay;

      const safeUsers = users.map((user: any) => {
        const seen = activityMap.get(user.id) || {};
        const license = entitlementMap.get(user.id) || {};
        const lastSeenMs = seen.last_seen_at ? new Date(seen.last_seen_at).getTime() : 0;
        const bannedUntilMs = user.banned_until ? new Date(user.banned_until).getTime() : 0;
        return {
          id: user.id,
          email: user.email || '',
          name: user.user_metadata?.full_name || user.user_metadata?.name || (user.email ? user.email.split('@')[0] : 'Pengguna ARAH'),
          role: String(user.app_metadata?.role || 'user'),
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          email_confirmed_at: user.email_confirmed_at || null,
          last_seen_at: seen.last_seen_at || null,
          current_path: seen.current_path || null,
          online: Boolean(lastSeenMs && now - lastSeenMs < twoMinutes),
          suspended: Boolean(bannedUntilMs && bannedUntilMs > now),
          license_status: license.status || 'pending',
          license_source: license.source || 'manual',
          order_id: license.order_id || null,
        };
      });

      const paymentRows = payments || [];
      const paidRows = paymentRows.filter((payment: any) => String(payment.status || '') === 'paid');
      const totalRevenue = paidRows.reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);

      const summary = {
        totalUsers: safeUsers.length,
        onlineNow: safeUsers.filter((user: any) => user.online).length,
        activeToday: safeUsers.filter((user: any) => user.last_seen_at && now - new Date(user.last_seen_at).getTime() < oneDay).length,
        active30d: safeUsers.filter((user: any) => user.last_seen_at && now - new Date(user.last_seen_at).getTime() < thirtyDays).length,
        activeLicenses: safeUsers.filter((user: any) => user.license_status === 'active').length,
        newTickets: (tickets || []).filter((ticket: any) => ticket.status === 'new').length,
        paidPayments: paidRows.length,
        unclaimedPayments: paidRows.filter((payment: any) => !payment.user_id).length,
        totalRevenue,
      };

      const settingsMap = new Map((settings || []).map((item: any) => [String(item.key || ''), item.value]));
      const features = {
        importCsvEnabled: settingsMap.get('import_csv_enabled') === true,
        commercialModeEnabled: settingsMap.get('commercial_mode_enabled') === true,
        purchaseUrl: typeof settingsMap.get('purchase_url') === 'string'
          ? String(settingsMap.get('purchase_url') || '')
          : '',
      };

      return json({
        ok: true,
        users: safeUsers,
        tickets: tickets || [],
        announcements: announcements || [],
        payments: payments || [],
        summary,
        features,
        currentAdmin: {
          id: adminUser.id,
          email: adminUser.email || '',
          role: callerRole,
        },
      });
    }



    if (action === 'set-commercial-config') {
      if (!isSuperadmin(callerRole)) {
        return json({ ok: false, error: 'Hanya Superadmin yang dapat mengubah konfigurasi lisensi.' }, 403);
      }

      const hasEnabled = Object.prototype.hasOwnProperty.call(body || {}, 'enabled');
      const hasPurchaseUrl = Object.prototype.hasOwnProperty.call(body || {}, 'purchaseUrl');
      const rows: any[] = [];

      if (hasEnabled) {
        rows.push({
          key: 'commercial_mode_enabled',
          value: Boolean(body?.enabled),
          updated_at: new Date().toISOString(),
          updated_by: adminUser.id,
        });
      }

      if (hasPurchaseUrl) {
        const purchaseUrl = String(body?.purchaseUrl || '').trim();
        if (purchaseUrl && !/^https:\/\/.+/i.test(purchaseUrl)) {
          return json({ ok: false, error: 'URL pembelian harus menggunakan HTTPS.' }, 400);
        }
        rows.push({
          key: 'purchase_url',
          value: purchaseUrl,
          updated_at: new Date().toISOString(),
          updated_by: adminUser.id,
        });
      }

      if (!rows.length) return json({ ok: false, error: 'Tidak ada konfigurasi yang diubah.' }, 400);

      const { error } = await admin.from('app_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;

      await audit(admin, adminUser.id, 'commercial_config_updated', null, null, {
        enabled: hasEnabled ? Boolean(body?.enabled) : undefined,
        purchase_url_changed: hasPurchaseUrl,
      });

      return json({ ok: true });
    }

    if (action === 'set-feature-flag') {
      if (!isSuperadmin(callerRole)) {
        return json({ ok: false, error: 'Hanya Superadmin yang dapat mengubah fitur user.' }, 403);
      }

      const key = String(body?.key || '');
      if (key !== 'import_csv_enabled') {
        return json({ ok: false, error: 'Fitur tidak dikenal.' }, 400);
      }

      const enabled = Boolean(body?.enabled);
      const { error } = await admin.from('app_settings').upsert({
        key,
        value: enabled,
        updated_at: new Date().toISOString(),
        updated_by: adminUser.id,
      }, { onConflict: 'key' });

      if (error) throw error;

      await audit(admin, adminUser.id, 'feature_flag_updated', null, null, {
        key,
        enabled,
      });

      return json({ ok: true, key, enabled });
    }


    if (action === 'create-announcement') {
      if (!isSuperadmin(callerRole)) {
        return json({ ok: false, error: 'Hanya Superadmin yang dapat mengirim pesan global.' }, 403);
      }

      const kind = String(body?.kind || 'update').trim().toLowerCase();
      const title = String(body?.title || '').trim();
      const message = String(body?.message || '').trim();

      if (!['update', 'info', 'maintenance'].includes(kind)) {
        return json({ ok: false, error: 'Jenis pesan tidak valid.' }, 400);
      }
      if (!title || title.length > 120) {
        return json({ ok: false, error: 'Judul pesan wajib diisi dan maksimal 120 karakter.' }, 400);
      }
      if (!message || message.length > 3000) {
        return json({ ok: false, error: 'Isi pesan wajib diisi dan maksimal 3000 karakter.' }, 400);
      }

      const { data: created, error } = await admin
        .from('announcements')
        .insert({
          title,
          message,
          kind,
          is_published: true,
          created_by: adminUser.id,
        })
        .select('id,title,message,kind,is_published,created_by,created_at')
        .single();

      if (error) throw error;

      await audit(admin, adminUser.id, 'announcement_created', null, null, {
        announcement_id: created?.id || null,
        kind,
        title,
      });

      return json({ ok: true, announcement: created });
    }

    if (action === 'delete-announcement') {
      if (!isSuperadmin(callerRole)) {
        return json({ ok: false, error: 'Hanya Superadmin yang dapat menghapus pesan global.' }, 403);
      }

      const messageId = String(body?.messageId || '').trim();
      if (!messageId) {
        return json({ ok: false, error: 'Pesan tidak valid.' }, 400);
      }

      const { data: existing, error: findError } = await admin
        .from('announcements')
        .select('id,title,kind')
        .eq('id', messageId)
        .maybeSingle();

      if (findError) throw findError;
      if (!existing) return json({ ok: false, error: 'Pesan tidak ditemukan.' }, 404);

      const { error } = await admin
        .from('announcements')
        .delete()
        .eq('id', messageId);

      if (error) throw error;

      await audit(admin, adminUser.id, 'announcement_deleted', null, null, {
        announcement_id: messageId,
        title: existing.title || '',
        kind: existing.kind || '',
      });

      return json({ ok: true });
    }

    if (action === 'transfer-superadmin') {
      if (!isSuperadmin(callerRole)) {
        return json({ ok: false, error: 'Hanya Superadmin yang dapat melakukan transfer Superadmin.' }, 403);
      }

      const target = await getTargetUser(admin, body);
      if (!target?.id) {
        return json({ ok: false, error: 'Admin tujuan tidak ditemukan.' }, 404);
      }

      if (target.id === adminUser.id) {
        return json({ ok: false, error: 'Pilih Administrator lain sebagai Superadmin baru.' }, 400);
      }

      const targetRole = String(target.app_metadata?.role || 'user');
      if (targetRole !== 'admin') {
        return json({ ok: false, error: 'Superadmin hanya dapat ditransfer ke akun yang sudah berstatus Admin.' }, 409);
      }

      const targetMetadata =
        target.app_metadata && typeof target.app_metadata === 'object'
          ? target.app_metadata
          : {};

      const callerMetadata =
        adminUser.app_metadata && typeof adminUser.app_metadata === 'object'
          ? adminUser.app_metadata
          : {};

      // Promote the target first so there is never a moment with zero Superadmin.
      const { error: promoteError } = await admin.auth.admin.updateUserById(target.id, {
        app_metadata: { ...targetMetadata, role: 'superadmin' },
      });

      if (promoteError) throw promoteError;

      // Demote the old Superadmin to normal Admin.
      const { error: demoteError } = await admin.auth.admin.updateUserById(adminUser.id, {
        app_metadata: { ...callerMetadata, role: 'admin' },
      });

      if (demoteError) {
        // Roll back the target if the second write fails.
        const { error: rollbackError } = await admin.auth.admin.updateUserById(target.id, {
          app_metadata: { ...targetMetadata, role: 'admin' },
        });

        if (rollbackError) {
          console.error('Rollback transfer Superadmin gagal:', rollbackError.message);
        }

        throw new Error('Transfer Superadmin gagal diselesaikan. Tidak ada perubahan final yang diterapkan.');
      }

      await audit(
        admin,
        adminUser.id,
        'superadmin_transferred',
        target.id,
        null,
        {
          previous_superadmin_email: adminUser.email || '',
          new_superadmin_email: target.email || '',
          previous_role: 'superadmin',
          new_target_role: 'superadmin',
          previous_superadmin_new_role: 'admin',
        },
      );

      return json({
        ok: true,
        targetUserId: target.id,
        targetEmail: target.email || '',
        previousSuperadminRole: 'admin',
        newSuperadminRole: 'superadmin',
      });
    }


    if (action === 'set-admin-role') {
      if (!isSuperadmin(callerRole)) {
        return json({ ok: false, error: 'Hanya Superadmin yang dapat mengubah akses Admin.' }, 403);
      }

      const role = String(body?.role || '');
      if (!['admin', 'user'].includes(role)) {
        return json({ ok: false, error: 'Role Admin tidak valid.' }, 400);
      }

      const target = await getTargetUser(admin, body);
      if (!target?.id) return json({ ok: false, error: 'User dengan email tersebut tidak ditemukan.' }, 404);
      assertCanTouchProtectedUser(callerRole, adminUser.id, target);

      const currentMetadata = target.app_metadata && typeof target.app_metadata === 'object' ? target.app_metadata : {};
      const { error } = await admin.auth.admin.updateUserById(target.id, {
        app_metadata: { ...currentMetadata, role },
      });
      if (error) throw error;

      await audit(admin, adminUser.id, role === 'admin' ? 'admin_access_granted' : 'admin_access_revoked', target.id, null, { role, email: target.email || '' });
      return json({ ok: true });
    }

    if (action === 'set-ticket-status') {
      const ticketId = String(body?.ticketId || '');
      const status = String(body?.status || '');
      if (!['new', 'in_progress', 'waiting_user', 'resolved', 'closed'].includes(status)) {
        return json({ ok: false, error: 'Status tiket tidak valid.' }, 400);
      }
      const { data: ticket, error } = await admin.from('support_tickets').update({ status, assigned_to: adminUser.id }).eq('id', ticketId).select('id,user_id').single();
      if (error) throw error;
      await audit(admin, adminUser.id, 'ticket_status_updated', ticket?.user_id || null, ticketId, { status });
      return json({ ok: true });
    }

    if (action === 'change-email') {
      const userId = String(body?.userId || '');
      const email = String(body?.email || '').trim().toLowerCase();
      if (!userId || !email.includes('@')) return json({ ok: false, error: 'Email baru tidak valid.' }, 400);

      const target = await getTargetUser(admin, { userId });
      if (!target) return json({ ok: false, error: 'User tidak ditemukan.' }, 404);
      assertCanTouchProtectedUser(callerRole, adminUser.id, target);

      const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
      if (error) throw error;
      await audit(admin, adminUser.id, 'user_email_changed', userId, null, { email });
      return json({ ok: true });
    }

    if (action === 'set-license') {
      const userId = String(body?.userId || '');
      const status = String(body?.status || '');
      if (!['pending', 'active', 'inactive', 'suspended'].includes(status)) {
        return json({ ok: false, error: 'Status lisensi tidak valid.' }, 400);
      }
      const { error } = await admin.from('entitlements').upsert({ user_id: userId, status, source: 'manual', updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw error;
      await audit(admin, adminUser.id, 'license_status_changed', userId, null, { status });
      return json({ ok: true });
    }

    if (action === 'set-suspended') {
      const userId = String(body?.userId || '');
      const suspended = Boolean(body?.suspended);
      const target = await getTargetUser(admin, { userId });
      if (!target) return json({ ok: false, error: 'User tidak ditemukan.' }, 404);
      assertCanTouchProtectedUser(callerRole, adminUser.id, target);

      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: suspended ? '876000h' : 'none',
      });
      if (error) throw error;
      if (suspended) {
        await admin.from('entitlements').update({ status: 'suspended' }).eq('user_id', userId);
      }
      await audit(admin, adminUser.id, suspended ? 'user_suspended' : 'user_unsuspended', userId);
      return json({ ok: true });
    }

    if (action === 'delete-user') {
      const userId = String(body?.userId || '');
      if (!userId) return json({ ok: false, error: 'User tidak valid.' }, 400);
      if (userId === adminUser.id) return json({ ok: false, error: 'Admin tidak boleh menghapus akun sendiri dari panel ini.' }, 409);

      const target = await getTargetUser(admin, { userId });
      if (!target) return json({ ok: false, error: 'User tidak ditemukan.' }, 404);
      assertCanTouchProtectedUser(callerRole, adminUser.id, target);

      await audit(admin, adminUser.id, 'user_deleted', userId);
      const { error } = await admin.auth.admin.deleteUser(userId, false);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Aksi Admin tidak dikenal.' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Admin API sedang bermasalah.');
    console.error('admin-api error:', message);
    return json({ ok: false, error: message || 'Admin API sedang bermasalah.' }, 500);
  }
});
