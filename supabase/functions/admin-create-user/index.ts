import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type CreateUserBody = {
  firstName?: string;
  lastName?: string;
  email?: string;
  mobile?: string;
  emergencyContact?: string;
  role?: 'MEMBER' | 'INSTRUCTOR';
  status?: 'PENDING_APPROVAL' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  contractSignedOffline?: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

function temporaryPassword() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(18))).map((value) => alphabet[value % alphabet.length]);
  return `${chars.join('')}!`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Supabase function environment is not configured' }, 500);
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user: actor },
    error: actorError,
  } = await userClient.auth.getUser();

  if (actorError || !actor) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const { data: actorProfile, error: profileError } = await serviceClient
    .from('User')
    .select('role,status')
    .eq('id', actor.id)
    .single();

  if (profileError || actorProfile?.role !== 'ADMIN' || actorProfile?.status !== 'ACTIVE') {
    return json({ error: 'Only active admins can create members' }, 403);
  }

  const body = (await request.json()) as CreateUserBody;
  const role = body.role === 'INSTRUCTOR' ? 'INSTRUCTOR' : 'MEMBER';
  const status = body.status ?? 'ACTIVE';
  const password = temporaryPassword();
  const now = new Date().toISOString();

  if (!body.email || !body.firstName || !body.lastName || !body.mobile || !body.emergencyContact) {
    return json({ error: 'Missing required member fields' }, 400);
  }

  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email: body.email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: {
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      mobile: body.mobile.trim(),
      emergencyContact: body.emergencyContact.trim(),
      role,
      status,
      contractSignedOffline: Boolean(body.contractSignedOffline),
      acceptedAgreementVersion: body.contractSignedOffline ? 'offline-v1' : undefined,
      agreementAcceptedAt: body.contractSignedOffline ? now : undefined,
      signatureSignedAt: body.contractSignedOffline ? now : undefined,
    },
  });

  if (createError || !created.user) {
    return json({ error: createError?.message ?? 'Could not create auth user' }, 400);
  }

  const { data: profile, error: upsertError } = await serviceClient
    .from('User')
    .upsert(
      {
        id: created.user.id,
        email: body.email.trim().toLowerCase(),
        passwordHash: '',
        role,
        status,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        mobile: body.mobile.trim(),
        emergencyContact: body.emergencyContact.trim(),
        emailVerifiedAt: now,
        acceptedAgreementVersion: body.contractSignedOffline ? 'offline-v1' : null,
        agreementAcceptedAt: body.contractSignedOffline ? now : null,
        signatureSignedAt: body.contractSignedOffline ? now : null,
        contractSignedOffline: Boolean(body.contractSignedOffline),
      },
      { onConflict: 'email' },
    )
    .select()
    .single();

  if (upsertError) {
    return json({ error: upsertError.message }, 400);
  }

  return json({
    user: profile,
    temporaryPassword: password,
  });
});
