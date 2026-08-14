import { createClient } from 'npm:@supabase/supabase-js@2';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSignature(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function sha256Hex(value: string) {
  const input = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeHexEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

async function listAllUsers(admin: any) {
  const users: any[] = [];
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

async function findVerifiedUserByEmail(admin: any, email: string) {
  if (!email) return null;
  const users = await listAllUsers(admin);
  const user = users.find((item) => normalizeEmail(item?.email) === email) || null;
  return user?.email_confirmed_at ? user : null;
}

async function audit(admin: any, action: string, targetUserId: string | null, metadata: Record<string, unknown>) {
  const { error } = await admin.from('admin_audit_logs').insert({
    admin_user_id: null,
    action,
    target_user_id: targetUserId,
    ticket_id: null,
    metadata,
  });
  if (error) console.error('Audit webhook gagal:', error.message);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method tidak didukung.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const merchantKey = Deno.env.get('LYNK_MERCHANT_KEY') || '';
  const arahProductUuid = String(Deno.env.get('LYNK_ARAH_PRODUCT_UUID') || '').trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: 'Konfigurasi server belum lengkap.' }, 500);
  }

  // URL can be saved in Lynk first. Merchant Key appears after that step.
  if (!merchantKey) {
    return json({ ok: false, error: 'LYNK_MERCHANT_KEY belum dikonfigurasi.' }, 503);
  }

  const receivedSignature = normalizeSignature(req.headers.get('x-lynk-signature'));

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    // Lynk Test URL can send a lightweight connectivity probe.
    // Nothing is processed, stored, or licensed here.
    return json({
      ok: true,
      test: true,
      ignored: true,
      reason: 'Payload test diterima.'
    });
  }

  const event = String(payload?.event || '');
  const data = payload?.data || {};
  const messageData = data?.message_data || {};
  const refId = String(messageData?.refId || '').trim();
  const messageId = String(data?.message_id || '').trim();
  const amountRaw = messageData?.totals?.grandTotal;

  const hasPaymentFields =
    Boolean(refId) &&
    Boolean(messageId) &&
    amountRaw !== null &&
    amountRaw !== undefined;

  // Acknowledge Lynk's Test URL / non-payment probes with HTTP 200.
  // No payment or entitlement is created in this branch.
  if (event !== 'payment.received' || !hasPaymentFields) {
    return json({
      ok: true,
      test: true,
      ignored: true,
      event: event || null,
      reason: 'Webhook test/non-payment diterima.'
    });
  }

  // From this point onward the request looks like a real payment.
  // Signature is mandatory.
  if (!receivedSignature) {
    return json({ ok: false, error: 'X-Lynk-Signature tidak ditemukan.' }, 401);
  }

  // Exact Lynk.id documentation:
  // SHA256(amount + ref_id + message_id + merchant_key).digest('hex')
  const signatureString = `${String(amountRaw)}${refId}${messageId}${merchantKey}`;
  const calculatedSignature = normalizeSignature(await sha256Hex(signatureString));

  if (!timingSafeHexEqual(calculatedSignature, receivedSignature)) {
    return json({ ok: false, error: 'Signature webhook tidak valid.' }, 401);
  }

  // Signature is valid. Only successful payments may continue.
  if (
    String(data?.message_action || '').toUpperCase() !== 'SUCCESS' ||
    String(data?.message_code || '') !== '0'
  ) {
    return json({ ok: true, ignored: true, reason: 'Pembayaran belum sukses.' });
  }

  // Product UUID is mandatory before licensing can activate.
  if (!arahProductUuid) {
    return json({ ok: true, ignored: true, configured: false, reason: 'LYNK_ARAH_PRODUCT_UUID belum dikonfigurasi.' });
  }

  const items = Array.isArray(messageData?.items) ? messageData.items : [];
  const arahItem = items.find((item: any) => String(item?.uuid || '').trim() === arahProductUuid);

  // Lynk account can sell other products; acknowledge them without granting ARAH.
  if (!arahItem) {
    return json({ ok: true, ignored: true, reason: 'Produk bukan ARAH.' });
  }

  const buyerEmail = normalizeEmail(messageData?.customer?.email);
  const buyerName = String(messageData?.customer?.name || '').trim();
  const buyerPhone = String(messageData?.customer?.phone || '').trim();
  const amount = Number(amountRaw);

  if (!buyerEmail || !Number.isFinite(amount) || amount < 0) {
    return json({ ok: false, error: 'Data pembeli atau nominal tidak valid.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // provider_order_id/refId is already UNIQUE in ARAH payments.
  const { data: existing, error: existingError } = await admin
    .from('payments')
    .select('id,user_id,provider_order_id')
    .eq('provider_order_id', refId)
    .maybeSingle();

  if (existingError) {
    console.error('Cek idempotency payment gagal:', existingError);
    return json({ ok: false, error: 'Pengecekan transaksi gagal.' }, 500);
  }

  if (existing) {
    return json({ ok: true, duplicate: true, paymentId: existing.id, refId });
  }

  let verifiedUser: any = null;
  try {
    verifiedUser = await findVerifiedUserByEmail(admin, buyerEmail);
  } catch (error) {
    console.error('Lookup Auth user gagal; payment tetap disimpan pending claim:', error);
  }

  const paidAt = new Date().toISOString();

  const { data: payment, error: paymentError } = await admin
    .from('payments')
    .insert({
      user_id: verifiedUser?.id || null,
      buyer_email: buyerEmail,
      buyer_name: buyerName || null,
      buyer_phone: buyerPhone || null,
      provider: 'lynk',
      provider_order_id: refId,
      provider_event_id: messageId,
      amount,
      currency: 'IDR',
      status: 'paid',
      product_id: String(arahItem?.uuid || ''),
      product_name: String(arahItem?.title || 'ARAH'),
      provider_created_at: String(messageData?.createdAt || ''),
      paid_at: paidAt,
      claimed_at: verifiedUser?.id ? paidAt : null,
      raw_payload: payload,
    })
    .select('id')
    .single();

  if (paymentError) {
    if (String(paymentError?.code || '') === '23505') {
      return json({ ok: true, duplicate: true, refId });
    }
    console.error('Insert payment gagal:', paymentError);
    return json({ ok: false, error: 'Pembayaran tidak dapat disimpan.' }, 500);
  }

  let licenseActivated = false;

  if (verifiedUser?.id) {
    const { data: existingEntitlement, error: entitlementReadError } = await admin
      .from('entitlements')
      .select('status')
      .eq('user_id', verifiedUser.id)
      .maybeSingle();

    if (entitlementReadError) console.error('Read entitlement gagal:', entitlementReadError);

    // Never bypass an explicit Admin suspension with a payment webhook.
    if (String(existingEntitlement?.status || '') !== 'suspended') {
      const { error: entitlementError } = await admin
        .from('entitlements')
        .upsert({
          user_id: verifiedUser.id,
          product: 'arah',
          status: 'active',
          source: 'lynk',
          order_id: refId,
          purchased_at: paidAt,
          expires_at: null,
          updated_at: paidAt,
        }, { onConflict: 'user_id' });

      if (entitlementError) {
        console.error('Aktivasi entitlement gagal:', entitlementError);
      } else {
        licenseActivated = true;
      }
    }
  }

  await audit(admin, 'lynk_payment_received', verifiedUser?.id || null, {
    payment_id: payment?.id || null,
    ref_id: refId,
    message_id: messageId,
    buyer_email: buyerEmail,
    amount,
    product_id: arahProductUuid,
    license_activated: licenseActivated,
  });

  return json({
    ok: true,
    paymentId: payment?.id || null,
    refId,
    matchedUser: Boolean(verifiedUser?.id),
    licenseActivated,
    pendingClaim: !verifiedUser?.id,
  });
});
