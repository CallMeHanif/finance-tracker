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

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function settingBoolean(value: unknown) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

function settingString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method tidak didukung.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const productUuid = String(Deno.env.get('LYNK_ARAH_PRODUCT_UUID') || '').trim();
  const token = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'Konfigurasi server belum lengkap.' }, 500);
  if (!token) return json({ ok: false, error: 'Sesi tidak ditemukan.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user?.id) return json({ ok: false, error: 'Sesi tidak valid.' }, 401);

  const role = String(user.app_metadata?.role || '');

  const [{ data: settings, error: settingsError }, { data: entitlement, error: entitlementError }] = await Promise.all([
    admin.from('app_settings').select('key,value').in('key', ['commercial_mode_enabled', 'purchase_url']),
    admin.from('entitlements').select('user_id,status,source,order_id,purchased_at,expires_at,updated_at').eq('user_id', user.id).maybeSingle(),
  ]);

  if (settingsError) return json({ ok: false, error: 'Pengaturan lisensi tidak dapat dibaca.' }, 500);
  if (entitlementError) return json({ ok: false, error: 'Lisensi tidak dapat dibaca.' }, 500);

  const settingsMap = new Map((settings || []).map((item: any) => [String(item.key || ''), item.value]));
  const commercialModeEnabled = settingBoolean(settingsMap.get('commercial_mode_enabled'));
  const purchaseUrl = settingString(settingsMap.get('purchase_url'));

  // Admin/Superadmin always has access.
  if (['admin', 'superadmin'].includes(role)) {
    return json({ ok: true, commercialModeEnabled, purchaseUrl, access: true, license: entitlement || null });
  }

  if (!commercialModeEnabled) {
    return json({ ok: true, commercialModeEnabled: false, purchaseUrl, access: true, license: entitlement || null });
  }

  const expiresAt = entitlement?.expires_at ? new Date(entitlement.expires_at).getTime() : 0;
  const active = String(entitlement?.status || '') === 'active' && (!expiresAt || expiresAt > Date.now());

  if (active) {
    return json({ ok: true, commercialModeEnabled: true, purchaseUrl, access: true, license: entitlement });
  }

  // Explicit lock states are never auto-claimed over.
  if (['suspended', 'inactive'].includes(String(entitlement?.status || ''))) {
    return json({
      ok: true,
      commercialModeEnabled: true,
      purchaseUrl,
      access: false,
      reason: String(entitlement.status),
      license: entitlement,
    });
  }

  const email = normalizeEmail(user.email);
  const verified = Boolean(user.email_confirmed_at);

  if (email && verified && productUuid) {
    const { data: payments, error: paymentError } = await admin
      .from('payments')
      .select('id,user_id,buyer_email,provider_order_id,paid_at,created_at,status,product_id')
      .eq('provider', 'lynk')
      .eq('status', 'paid')
      .eq('product_id', productUuid)
      .ilike('buyer_email', email)
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(10);

    if (!paymentError) {
      const claimable = (payments || []).find((payment: any) => !payment?.user_id || payment.user_id === user.id);

      if (claimable) {
        const now = new Date().toISOString();
        const { error: paymentClaimError } = await admin
          .from('payments')
          .update({ user_id: user.id, claimed_at: now })
          .eq('id', claimable.id);

        if (!paymentClaimError) {
          const { data: claimed, error: claimError } = await admin
            .from('entitlements')
            .upsert({
              user_id: user.id,
              product: 'arah',
              status: 'active',
              source: 'lynk',
              order_id: claimable.provider_order_id,
              purchased_at: claimable.paid_at || claimable.created_at || now,
              expires_at: null,
              updated_at: now,
            }, { onConflict: 'user_id' })
            .select('user_id,status,source,order_id,purchased_at,expires_at,updated_at')
            .single();

          if (!claimError) {
            const { error: auditError } = await admin.from('admin_audit_logs').insert({
              admin_user_id: null,
              action: 'lynk_license_claimed',
              target_user_id: user.id,
              ticket_id: null,
              metadata: { payment_id: claimable.id, order_id: claimable.provider_order_id, buyer_email: email },
            });
            if (auditError) console.error('Audit claim lisensi gagal:', auditError.message);

            return json({
              ok: true,
              commercialModeEnabled: true,
              purchaseUrl,
              access: true,
              claimed: true,
              license: claimed,
            });
          }
        }
      }
    } else {
      console.error('Payment claim query gagal:', paymentError);
    }
  }

  return json({
    ok: true,
    commercialModeEnabled: true,
    purchaseUrl,
    access: false,
    reason: String(entitlement?.status || 'pending'),
    license: entitlement || null,
  });
});
