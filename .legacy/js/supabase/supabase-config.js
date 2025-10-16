// js/supabase/supabase-config.js - Supabase Configuration
// CHANGE SUMMARY: Exposed supabase client globally as window.supabase for real-time subscriptions to work

import { createClient } from 'https://cdn.skypack.dev/@supabase/supabase-js@2';

// Get config from parent window if in iframe, otherwise from current window
function getSupabaseConfig() {
  const config = window.parent?.currentDbConfig || window.currentDbConfig;
  
  if (!config) {
    console.error('❌ Supabase config not available in window or parent window!');
    throw new Error('Database configuration not initialized. Check load order.');
  }
  
  return config;
}

// Get database config based on environment (prod vs dev)
const config = getSupabaseConfig();
const supabaseUrl = config.supabaseUrl;
const supabaseAnonKey = config.supabaseKey;

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Don't persist session in localStorage since we handle auth ourselves
    persistSession: false,
    // Don't auto-refresh tokens
    autoRefreshToken: false,
    // Don't detect session from URL
    detectSessionInUrl: false
  }
});

// CRITICAL: Expose globally for real-time subscriptions
window.supabase = supabase;

console.log('📊 Supabase client initialized:', supabaseUrl);
console.log('📊 Supabase client exposed globally as window.supabase');