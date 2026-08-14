import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const encoder = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getRecoveryKey() {
  const secret = Deno.env.get('ARAH_VAULT_RECOVERY_SECRET');
  if (!secret || secret.length < 32) throw new Error('Recovery secret belum dikonfigurasi.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptMasterKey(userId: string, masterRaw: Uint8Array) {
  const key = await getRecoveryKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = encoder.encode(`ARAH:server-recovery:v1:${userId}`);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
    key,
    masterRaw,
  );
  return {
    recovery_wrap_version: 1,
    recovery_wrap_iv: bytesToBase64Url(iv),
    recovery_wrapped_key: bytesToBase64Url(new Uint8Array(encrypted)),
  };
}

async function decryptMasterKey(userId: string, ivText: string, wrappedText: string) {
  const key = await getRecoveryKey();
  const additionalData = encoder.encode(`ARAH:server-recovery:v1:${userId}`);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(ivText),
      additionalData,
      tagLength: 128,
    },
    key,
    base64UrlToBytes(wrappedText),
  );
  return new Uint8Array(decrypted);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method tidak didukung.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Konfigurasi Supabase server belum tersedia.');

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ ok: false, error: 'Sesi pengguna tidak ditemukan.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user?.id) return json({ ok: false, error: 'Sesi pengguna tidak valid.' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    if (action === 'setup') {
      const masterRaw = base64UrlToBytes(String(body?.masterKey || ''));
      if (masterRaw.length !== 32) return json({ ok: false, error: 'Master key tidak valid.' }, 400);

      const profile = body?.profile || {};
      const iterations = Number(profile.kdf_iterations || 0);
      if (
        Number(profile.vault_version) !== 4 ||
        !Number.isInteger(Number(profile.key_version)) ||
        Number(profile.key_version) < 1 ||
        String(profile.kdf_algorithm || '') !== 'PBKDF2-SHA256' ||
        !Number.isInteger(iterations) ||
        iterations < 100000 ||
        !profile.password_salt ||
        !profile.password_wrap_iv ||
        !profile.password_wrapped_key
      ) {
        masterRaw.fill(0);
        return json({ ok: false, error: 'Profil Vault tidak valid.' }, 400);
      }

      const recovery = await encryptMasterKey(user.id, masterRaw);
      masterRaw.fill(0);

      const { error: upsertError } = await admin
        .from('vault_profiles')
        .upsert(
          {
            user_id: user.id,
            key_version: Number(profile.key_version),
            vault_version: 4,
            kdf_algorithm: 'PBKDF2-SHA256',
            kdf_iterations: iterations,
            password_salt: String(profile.password_salt),
            password_wrap_iv: String(profile.password_wrap_iv),
            password_wrapped_key: String(profile.password_wrapped_key),
            wrapped_key: null,
            wrap_iv: null,
            ...recovery,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );

      if (upsertError) throw upsertError;
      return json({ ok: true });
    }

    if (action === 'recover') {
      const { data: profile, error: profileError } = await admin
        .from('vault_profiles')
        .select('vault_version,recovery_wrap_version,recovery_wrap_iv,recovery_wrapped_key')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) throw profileError;
      if (
        !profile ||
        Number(profile.vault_version) < 4 ||
        Number(profile.recovery_wrap_version) !== 1 ||
        !profile.recovery_wrap_iv ||
        !profile.recovery_wrapped_key
      ) {
        return json({ ok: false, error: 'Vault belum memiliki pemulihan server.' }, 409);
      }

      const masterRaw = await decryptMasterKey(
        user.id,
        profile.recovery_wrap_iv,
        profile.recovery_wrapped_key,
      );

      const masterKey = bytesToBase64Url(masterRaw);
      masterRaw.fill(0);
      return json({ ok: true, masterKey });
    }

    return json({ ok: false, error: 'Aksi tidak dikenal.' }, 400);
  } catch (error) {
    console.error('vault-recovery error:', error instanceof Error ? error.message : 'unknown');
    return json({ ok: false, error: 'Layanan pemulihan Vault sedang bermasalah.' }, 500);
  }
});
