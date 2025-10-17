// ============================================================================
// JWT Auth Edge Function - Phase 3 v2
// ============================================================================
// Handles authentication, access control, and token management
//
// CHANGES FROM PREVIOUS VERSION:
// - Added beta_whitelist access control
// - Creates user_profiles on first login
// - Stores tokens in user_auth_tokens (not user_settings)
// - Keeps general settings in user_settings (backward compatible)
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create, verify } from 'https://deno.land/x/djwt@v2.8/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Environment variables
const JWT_SECRET = Deno.env.get('JWT_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Google OAuth credentials
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');
const GOOGLE_DEVICE_CLIENT_ID = Deno.env.get('GOOGLE_DEVICE_CLIENT_ID');
const GOOGLE_DEVICE_CLIENT_SECRET = Deno.env.get('GOOGLE_DEVICE_CLIENT_SECRET');

if (!JWT_SECRET || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required environment variables');
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { googleAccessToken, operation, data, settings, provider, account_type } = await req.json();

    // ==================== STANDALONE OPERATIONS ====================

    if (operation === 'refresh_token') {
      return handleRefreshTokenStandalone(data);
    }

    // ==================== JWT-AUTHENTICATED OPERATIONS ====================

    if (operation === 'load' || operation === 'save' || operation === 'get_valid_token' ||
        operation === 'refresh_jwt' || operation === 'list_accounts' ||
        operation === 'remove_account' || operation === 'store_tokens') {

      const authHeader = req.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return jsonResponse({ error: 'Missing Supabase JWT in Authorization header' }, 401);
      }

      const supabaseJWT = authHeader.replace('Bearer ', '');
      const userId = await verifySupabaseJWT(supabaseJWT);

      if (!userId) {
        return jsonResponse({ error: 'Invalid Supabase JWT' }, 401);
      }

      console.log(`🔐 ${operation} authenticated via JWT for user: ${userId}`);

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      let result;
      if (operation === 'load') {
        result = await handleLoadOperation(supabaseAdmin, userId);
      } else if (operation === 'save') {
        const userEmail = await getUserEmailFromJWT(supabaseJWT);
        result = await handleSaveOperation(supabaseAdmin, userId, userEmail, settings || data);
      } else if (operation === 'get_valid_token') {
        result = await handleGetValidTokenOperation(supabaseAdmin, userId, provider || 'google', account_type || 'primary');
      } else if (operation === 'refresh_jwt') {
        const userEmail = await getUserEmailFromJWT(supabaseJWT);
        const newJwtToken = await generateSupabaseJWT(userId, userEmail);
        result = { jwtToken: newJwtToken, user: { id: userId, email: userEmail } };
      } else if (operation === 'list_accounts') {
        result = await handleListAccountsOperation(supabaseAdmin, userId);
      } else if (operation === 'remove_account') {
        result = await handleRemoveAccountOperation(supabaseAdmin, userId, provider || 'google', account_type || 'primary');
      } else if (operation === 'store_tokens') {
        const userEmail = await getUserEmailFromJWT(supabaseJWT);
        result = await handleStoreTokensOperation(supabaseAdmin, userId, userEmail, data, provider || 'google', account_type || 'primary');
      }

      return jsonResponse({ success: true, ...result }, 200);
    }

    // ==================== GOOGLE-TOKEN-AUTHENTICATED OPERATIONS ====================

    if (!googleAccessToken) {
      return jsonResponse({ error: 'Google access token required' }, 400);
    }

    // Verify Google token
    const googleUser = await verifyGoogleToken(googleAccessToken);
    if (!googleUser || !googleUser.verified_email) {
      return jsonResponse({ error: 'Invalid or unverified Google token' }, 401);
    }

    console.log(`🔐 Google token verified for: ${googleUser.email}`);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ==================== ACCESS CONTROL CHECK ====================

    // Check if user has access (beta whitelist, tier, etc.)
    const accessCheck = await checkUserAccess(supabaseAdmin, googleUser.email);

    if (!accessCheck.allowed) {
      console.log(`❌ Access denied for ${googleUser.email}: ${accessCheck.reason}`);
      return jsonResponse({
        error: 'access_denied',
        reason: accessCheck.reason,
        message: getAccessDeniedMessage(accessCheck.reason)
      }, 403);
    }

    console.log(`✅ Access granted for ${googleUser.email} (${accessCheck.tier})`);

    // Get or create auth user
    const authUserId = await getOrCreateAuthUser(supabaseAdmin, googleUser);
    console.log(`👤 Auth user ID: ${authUserId}`);

    // Ensure user profile exists
    await ensureUserProfile(supabaseAdmin, authUserId, googleUser.email, accessCheck.tier);

    // Generate JWT
    const jwtToken = await generateSupabaseJWT(authUserId, googleUser.email);

    // Handle get_jwt_from_google
    if (operation === 'get_jwt_from_google') {
      return jsonResponse({
        success: true,
        user: {
          id: authUserId,
          email: googleUser.email,
          name: googleUser.name,
          picture: googleUser.picture,
          provider: 'google'
        },
        jwtToken,
        access: {
          tier: accessCheck.tier,
          trial_days_left: accessCheck.trial_days_left,
          max_dashboards: accessCheck.max_dashboards,
          max_calendars: accessCheck.max_calendars
        }
      }, 200);
    }

    // Handle other operations (store_tokens, list_accounts, remove_account)
    let result;
    if (operation === 'store_tokens') {
      result = await handleStoreTokensOperation(supabaseAdmin, authUserId, googleUser.email, data, provider, account_type);
    } else if (operation === 'list_accounts') {
      result = await handleListAccountsOperation(supabaseAdmin, authUserId);
    } else if (operation === 'remove_account') {
      result = await handleRemoveAccountOperation(supabaseAdmin, authUserId, provider, account_type);
    } else {
      return jsonResponse({ error: 'Invalid operation' }, 400);
    }

    return jsonResponse({
      success: true,
      user: {
        id: authUserId,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        provider: 'google'
      },
      jwtToken,
      ...result
    }, 200);

  } catch (error) {
    console.error('🚨 JWT Auth error:', error);
    return jsonResponse({ error: 'Internal server error', details: error.message }, 500);
  }
});

// ============================================================================
// ACCESS CONTROL
// ============================================================================

async function checkUserAccess(supabase: any, email: string) {
  try {
    // Get access control config
    const { data: configData } = await supabase
      .from('access_control_config')
      .select('key, value');

    const config: Record<string, string> = {};
    configData?.forEach((item: any) => {
      config[item.key] = item.value;
    });

    // Check maintenance mode
    if (config.maintenance_mode === 'true') {
      return { allowed: false, reason: 'maintenance_mode' };
    }

    // BETA MODE - Check whitelist
    if (config.beta_mode_enabled === 'true') {
      const { data: whitelist } = await supabase
        .from('beta_whitelist')
        .select('email, access_granted_at')
        .eq('email', email)
        .maybeSingle();

      if (!whitelist) {
        return { allowed: false, reason: 'beta_not_whitelisted' };
      }

      // Update access_granted_at on first login
      if (!whitelist.access_granted_at) {
        await supabase
          .from('beta_whitelist')
          .update({ access_granted_at: new Date().toISOString() })
          .eq('email', email);
      }

      return {
        allowed: true,
        tier: 'beta',
        max_dashboards: 999,
        max_calendars: 999
      };
    }

    // TRIAL MODE (for future use)
    if (config.trial_enabled === 'true') {
      // TODO: Implement trial logic when beta ends
      const trialDays = parseInt(config.trial_duration_days || '14');
      return {
        allowed: true,
        tier: 'trial',
        trial_days_left: trialDays,
        max_dashboards: 1,
        max_calendars: 2
      };
    }

    // Default: no access
    return { allowed: false, reason: 'access_disabled' };
  } catch (error) {
    console.error('🚨 Access check failed:', error);
    return { allowed: false, reason: 'error' };
  }
}

function getAccessDeniedMessage(reason: string): string {
  switch (reason) {
    case 'beta_not_whitelisted':
      return 'Dashie is currently in private beta. Access is by invitation only.';
    case 'trial_expired':
      return 'Your trial has expired. Upgrade to continue using Dashie.';
    case 'subscription_inactive':
      return 'Your subscription is inactive. Please update your billing information.';
    case 'maintenance_mode':
      return 'Dashie is currently undergoing maintenance. Please try again later.';
    default:
      return 'Access denied. Please contact support.';
  }
}

// ============================================================================
// USER PROFILE MANAGEMENT
// ============================================================================

async function ensureUserProfile(supabase: any, userId: string, email: string, tier: string) {
  try {
    // Check if profile exists
    const { data: existing } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (existing) {
      // Update last_sign_in_at
      await supabase
        .from('user_profiles')
        .update({
          last_sign_in_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString()
        })
        .eq('auth_user_id', userId);
      return;
    }

    // Create profile
    const maxDashboards = tier === 'beta' ? 999 : 1;
    const maxCalendars = tier === 'beta' ? 999 : 2;

    await supabase
      .from('user_profiles')
      .insert({
        auth_user_id: userId,
        email,
        tier,
        tier_started_at: new Date().toISOString(),
        max_dashboards: maxDashboards,
        max_calendars: maxCalendars,
        first_sign_in_at: new Date().toISOString(),
        last_sign_in_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        current_app_version: '0.3.0'
      });

    console.log(`✅ Created user_profile for ${email} with tier: ${tier}`);
  } catch (error) {
    console.error('🚨 Failed to ensure user profile:', error);
    throw error;
  }
}

// ============================================================================
// TOKEN MANAGEMENT (NEW: Uses user_auth_tokens table)
// ============================================================================

async function handleStoreTokensOperation(
  supabase: any,
  authUserId: string,
  email: string,
  tokenData: any,
  provider = 'google',
  accountType = 'primary'
) {
  try {
    console.log(`🔐 Storing tokens for ${provider}:${accountType} - ${email}`);

    const { access_token, refresh_token, expires_in, scope, display_name, provider_info } = tokenData;

    if (!access_token || !refresh_token) {
      throw new Error('Missing required token data: access_token, refresh_token');
    }

    // Get existing tokens
    const { data: existingData } = await supabase
      .from('user_auth_tokens')
      .select('tokens')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    const existingTokens = existingData?.tokens || {};
    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

    const accountData = {
      email: tokenData.email || email,
      access_token,
      refresh_token,
      expires_at: expiresAt.toISOString(),
      scopes: scope ? scope.split(' ') : [],
      display_name: display_name || `${tokenData.email || email} (${accountType})`,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (provider_info) {
      accountData.provider_info = provider_info;
    }

    const updatedTokens = {
      ...existingTokens,
      [provider]: {
        ...existingTokens[provider] || {},
        [accountType]: accountData
      }
    };

    // Upsert to user_auth_tokens
    await supabase
      .from('user_auth_tokens')
      .upsert({
        auth_user_id: authUserId,
        tokens: updatedTokens,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'auth_user_id'
      });

    console.log(`✅ Tokens stored in user_auth_tokens for ${provider}:${accountType}`);

    return {
      stored: true,
      account: {
        provider,
        account_type: accountType,
        email: tokenData.email || email,
        display_name: accountData.display_name,
        expires_at: expiresAt.toISOString(),
        scopes: accountData.scopes
      }
    };
  } catch (error) {
    console.error('🚨 Store tokens operation failed:', error);
    throw error;
  }
}

async function handleGetValidTokenOperation(
  supabase: any,
  authUserId: string,
  provider = 'google',
  accountType = 'primary'
) {
  try {
    console.log(`🎫 Getting valid token for ${provider}:${accountType} - user: ${authUserId}`);

    // Get tokens from user_auth_tokens
    const { data: tokenData } = await supabase
      .from('user_auth_tokens')
      .select('tokens')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    const account = tokenData?.tokens?.[provider]?.[accountType];

    if (!account) {
      console.log(`❌ No account found for ${provider}:${accountType}`);
      return {
        error: `No account found for ${provider}:${accountType}`,
        account_found: false
      };
    }

    // Check if token is expired (with 5 minute buffer)
    const now = new Date();
    const expiresAt = new Date(account.expires_at);
    const bufferTime = 5 * 60 * 1000;

    if (now.getTime() >= expiresAt.getTime() - bufferTime) {
      console.log(`🔄 Token expired, refreshing for ${provider}:${accountType}`);

      const { clientId, clientSecret } = getOAuthCredentials(account.provider_info);
      const refreshResult = await refreshGoogleToken(account.refresh_token, clientId, clientSecret);

      if (!refreshResult.success) {
        console.error(`❌ Token refresh failed:`, refreshResult.error);
        return {
          error: 'Failed to refresh token',
          refresh_failed: true,
          details: refreshResult.error
        };
      }

      // Update stored token
      const updatedAccount = {
        ...account,
        access_token: refreshResult.access_token,
        expires_at: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString()
      };

      const updatedTokens = {
        ...tokenData.tokens,
        [provider]: {
          ...tokenData.tokens[provider],
          [accountType]: updatedAccount
        }
      };

      await supabase
        .from('user_auth_tokens')
        .update({
          tokens: updatedTokens,
          updated_at: new Date().toISOString()
        })
        .eq('auth_user_id', authUserId);

      console.log(`✅ Token refreshed for ${provider}:${accountType}`);

      return {
        access_token: refreshResult.access_token,
        expires_at: updatedAccount.expires_at,
        scopes: updatedAccount.scopes,
        refreshed: true
      };
    }

    console.log(`✅ Token still valid for ${provider}:${accountType}`);
    return {
      access_token: account.access_token,
      expires_at: account.expires_at,
      scopes: account.scopes,
      refreshed: false
    };
  } catch (error) {
    console.error('🚨 Get valid token operation failed:', error);
    throw error;
  }
}

async function handleListAccountsOperation(supabase: any, authUserId: string) {
  try {
    console.log(`📋 Listing accounts for user: ${authUserId}`);

    const { data: tokenData } = await supabase
      .from('user_auth_tokens')
      .select('tokens')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    const tokens = tokenData?.tokens || {};
    const accountList = [];

    for (const [provider, providerAccounts] of Object.entries(tokens)) {
      for (const [accountType, accountData] of Object.entries(providerAccounts as any)) {
        accountList.push({
          provider,
          account_type: accountType,
          email: accountData.email,
          display_name: accountData.display_name,
          expires_at: accountData.expires_at,
          scopes: accountData.scopes,
          is_active: accountData.is_active
        });
      }
    }

    console.log(`✅ Found ${accountList.length} accounts`);
    return { accounts: accountList };
  } catch (error) {
    console.error('🚨 List accounts operation failed:', error);
    throw error;
  }
}

async function handleRemoveAccountOperation(
  supabase: any,
  authUserId: string,
  provider = 'google',
  accountType = 'primary'
) {
  try {
    console.log(`🗑️ Removing account ${provider}:${accountType}`);

    const { data: tokenData } = await supabase
      .from('user_auth_tokens')
      .select('tokens')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    const tokens = tokenData?.tokens || {};

    if (!tokens[provider]?.[accountType]) {
      return {
        removed: false,
        error: `Account ${provider}:${accountType} not found`
      };
    }

    const updatedProviderAccounts = { ...tokens[provider] };
    delete updatedProviderAccounts[accountType];

    const updatedTokens = { ...tokens };
    if (Object.keys(updatedProviderAccounts).length === 0) {
      delete updatedTokens[provider];
    } else {
      updatedTokens[provider] = updatedProviderAccounts;
    }

    await supabase
      .from('user_auth_tokens')
      .update({
        tokens: updatedTokens,
        updated_at: new Date().toISOString()
      })
      .eq('auth_user_id', authUserId);

    console.log(`✅ Account ${provider}:${accountType} removed`);
    return { removed: true };
  } catch (error) {
    console.error('🚨 Remove account operation failed:', error);
    throw error;
  }
}

// ============================================================================
// SETTINGS OPERATIONS (Still uses user_settings table)
// ============================================================================

async function handleLoadOperation(supabase: any, authUserId: string) {
  try {
    console.log(`📊 Loading settings for user: ${authUserId}`);

    const { data, error } = await supabase
      .from('user_settings')
      .select('settings, updated_at')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    console.log(`📊 ✅ Settings loaded for user: ${authUserId}`);
    return { settings: data?.settings || null };
  } catch (error) {
    console.error('📊 ❌ Load operation failed:', error);
    throw error;
  }
}

async function handleSaveOperation(
  supabase: any,
  authUserId: string,
  email: string,
  settings: any
) {
  try {
    console.log(`📊 Saving settings for user: ${authUserId}`);

    // Remove tokenAccounts if accidentally included (should use user_auth_tokens)
    const safeSettings = { ...settings };
    delete safeSettings.tokenAccounts;

    const { error } = await supabase
      .from('user_settings')
      .upsert({
        auth_user_id: authUserId,
        email: email,
        settings: safeSettings,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'auth_user_id'
      });

    if (error) throw error;

    console.log(`📊 ✅ Settings saved for user: ${authUserId}`);
    return { saved: true };
  } catch (error) {
    console.error('📊 ❌ Save operation failed:', error);
    throw error;
  }
}

// ============================================================================
// AUTHENTICATION HELPERS
// ============================================================================

async function verifySupabaseJWT(token: string): Promise<string | null> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(JWT_SECRET);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const payload = await verify(token, key) as any;
    return payload?.sub || null;
  } catch (error) {
    console.error('🚨 JWT verification failed:', error);
    return null;
  }
}

async function getUserEmailFromJWT(token: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(JWT_SECRET);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const payload = await verify(token, key) as any;
    return payload.email || '';
  } catch (error) {
    console.error('🚨 Failed to extract email from JWT:', error);
    return '';
  }
}

async function verifyGoogleToken(accessToken: string) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
    );

    if (!response.ok) {
      console.error('🚨 Google token verification failed:', response.status);
      return null;
    }

    const userInfo = await response.json();
    if (!userInfo.id || !userInfo.email || !userInfo.verified_email) {
      console.error('🚨 Invalid Google user info:', userInfo);
      return null;
    }

    return userInfo;
  } catch (error) {
    console.error('🚨 Error verifying Google token:', error);
    return null;
  }
}

async function getOrCreateAuthUser(supabaseAdmin: any, googleUser: any) {
  try {
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers.users?.find((user: any) => user.email === googleUser.email);

    if (existingUser) {
      console.log(`✅ Found existing user: ${existingUser.id}`);
      return existingUser.id;
    }

    const { data: newUserData, error } = await supabaseAdmin.auth.admin.createUser({
      email: googleUser.email,
      email_confirm: true,
      user_metadata: {
        name: googleUser.name || '',
        picture: googleUser.picture || '',
        provider: 'google',
        provider_id: googleUser.id
      }
    });

    if (error || !newUserData?.user) {
      throw new Error(`Failed to create user: ${error?.message}`);
    }

    console.log(`✅ Created new user: ${newUserData.user.id}`);
    return newUserData.user.id;
  } catch (error) {
    console.error('🚨 Auth user creation failed:', error);
    throw error;
  }
}

async function generateSupabaseJWT(userId: string, email: string) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 60 * 60 * 72; // 72 hours

    const payload = {
      aud: 'authenticated',
      exp: exp,
      iat: now,
      iss: 'supabase',
      sub: userId,
      email: email,
      role: 'authenticated',
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { email: email }
    };

    const encoder = new TextEncoder();
    const keyData = encoder.encode(JWT_SECRET);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const jwt = await create({ alg: 'HS256', typ: 'JWT' }, payload, key);
    return jwt;
  } catch (error) {
    console.error('🚨 JWT generation failed:', error);
    throw error;
  }
}

// ============================================================================
// TOKEN REFRESH
// ============================================================================

async function handleRefreshTokenStandalone(data: any) {
  try {
    const { refresh_token, provider_info } = data;
    if (!refresh_token) {
      throw new Error('Refresh token required');
    }

    const { clientId, clientSecret } = getOAuthCredentials(provider_info);
    const refreshResult = await refreshGoogleToken(refresh_token, clientId, clientSecret);

    if (!refreshResult.success) {
      throw new Error(`Token refresh failed: ${refreshResult.error}`);
    }

    return jsonResponse({
      success: true,
      access_token: refreshResult.access_token,
      expires_in: refreshResult.expires_in,
      expires_at: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString()
    }, 200);
  } catch (error) {
    console.error('🚨 Refresh token operation failed:', error);
    return jsonResponse({
      error: 'Token refresh failed',
      details: error.message
    }, 500);
  }
}

function getOAuthCredentials(providerInfo: any) {
  if (providerInfo?.type === 'device_flow' ||
      providerInfo?.client_id?.includes('m9vf7t0qgm6nlc6gggfsqefmjrak1mo9')) {
    return {
      clientId: GOOGLE_DEVICE_CLIENT_ID || GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_DEVICE_CLIENT_SECRET || GOOGLE_CLIENT_SECRET
    };
  }
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET
  };
}

async function refreshGoogleToken(refreshToken: string, clientId: string, clientSecret: string) {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorData}` };
    }

    const tokenData = await response.json();
    return {
      success: true,
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in || 3600
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function jsonResponse(data: any, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
