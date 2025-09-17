// js/supabase/simple-supabase-storage.js
// UPDATED: Modified to work with Cognito JWT tokens instead of custom Edge Function

import { supabaseClient } from './supabase-config.js';

export class SimpleSupabaseStorage {
  constructor() {
    this.supabase = supabaseClient;
    this.isRLSMode = false;
    this.currentUser = null;
    this.fallbackStorage = {};
    this.pendingChanges = [];
    this.isOnline = navigator.onLine;
    this.retryTimeout = null;
    this.maxRetries = 3;
    this.syncInProgress = false;
    
    this.setupNetworkMonitoring();
    this.setupRealtimeSubscription();
  }

  // UPDATED: Get Cognito JWT token instead of Google access token
  getCognitoAuthToken() {
    // Try multiple sources for Cognito tokens
    if (window.authManager?.cognitoAuth?.getCognitoTokens) {
      const tokens = window.authManager.cognitoAuth.getCognitoTokens();
      return tokens?.idToken || tokens?.accessToken; // Use ID token for Supabase RLS
    }
    
    if (window.dashieAuth?.authManager?.cognitoAuth?.getCognitoTokens) {
      const tokens = window.dashieAuth.authManager.cognitoAuth.getCognitoTokens();
      return tokens?.idToken || tokens?.accessToken;
    }
    
    // Fallback: try to get from saved user data
    try {
      const savedUser = localStorage.getItem('dashie-cognito-user');
      if (savedUser) {
        const userData = JSON.parse(savedUser);
        return userData.cognitoTokens?.idToken || userData.cognitoTokens?.accessToken;
      }
    } catch (error) {
      console.warn('⚠️ Failed to get Cognito token from localStorage:', error);
    }
    
    return null;
  }

  getCurrentUser() {
    // Try multiple sources for current user
    if (window.authManager?.currentUser) {
      return window.authManager.currentUser;
    }
    
    if (window.dashieAuth?.authManager?.currentUser) {
      return window.dashieAuth.authManager.currentUser;
    }
    
    // Fallback to localStorage
    try {
      const savedUser = localStorage.getItem('dashie-cognito-user');
      if (savedUser) {
        return JSON.parse(savedUser);
      }
    } catch (error) {
      console.warn('⚠️ Failed to get user from localStorage:', error);
    }
    
    return null;
  }

  // UPDATED: Authenticate with Supabase using Cognito JWT token
  async authenticateWithSupabase() {
    const cognitoToken = this.getCognitoAuthToken();
    const user = this.getCurrentUser();
    
    if (!cognitoToken || !user) {
      console.log('🔒 No Cognito token or user available, using anonymous mode');
      this.isRLSMode = false;
      return false;
    }

    try {
      console.log('🔒 Attempting Supabase authentication with Cognito JWT...');
      
      // UPDATED: Use Cognito JWT token directly with Supabase
      // This requires Supabase to be configured to accept Cognito JWTs
      const { data, error } = await this.supabase.auth.setSession({
        access_token: cognitoToken,
        refresh_token: null // Cognito handles refresh
      });

      if (error) {
        console.warn('🔒 ⚠️ Supabase JWT auth failed, trying alternative method:', error.message);
        
        // Alternative: Use signInWithIdToken if available
        if (this.supabase.auth.signInWithIdToken) {
          const { data: altData, error: altError } = await this.supabase.auth.signInWithIdToken({
            provider: 'cognito',
            token: cognitoToken
          });
          
          if (altError) {
            throw altError;
          }
          
          console.log('🔒 ✅ Supabase authenticated via signInWithIdToken');
          this.isRLSMode = true;
          this.currentUser = user;
          return true;
        }
        
        throw error;
      }

      console.log('🔒 ✅ Supabase authenticated with Cognito JWT');
      this.isRLSMode = true;
      this.currentUser = user;
      return true;

    } catch (error) {
      console.warn('🔒 ⚠️ Supabase RLS authentication failed:', error.message);
      console.log('🔒 Falling back to anonymous mode');
      
      // Sign out any existing session
      try {
        await this.supabase.auth.signOut();
      } catch (signOutError) {
        console.warn('Failed to sign out during fallback:', signOutError);
      }
      
      this.isRLSMode = false;
      this.currentUser = user; // Still set user for non-RLS operations
      return false;
    }
  }

  // Rest of the class remains largely unchanged
  async loadSettings() {
    await this.authenticateWithSupabase();
    
    const user = this.getCurrentUser();
    if (!user) {
      console.warn('⚙️ No user available for settings load');
      return null;
    }

    try {
      let settings = null;
      
      if (this.isRLSMode) {
        settings = await this.loadSettingsFromRLS(user);
      }
      
      if (!settings) {
        settings = await this.loadSettingsFromNonRLS(user);
      }
      
      if (settings) {
        console.log('⚙️ ✅ Settings loaded successfully');
        this.syncPendingChanges();
        return settings;
      }
      
    } catch (error) {
      console.error('⚙️ ❌ Failed to load settings:', error);
    }
    
    // Fallback to localStorage
    const fallbackSettings = this.loadFromLocalStorage(user.email);
    if (fallbackSettings) {
      console.log('⚙️ 📱 Using localStorage fallback settings');
      return fallbackSettings;
    }
    
    return null;
  }

  async loadSettingsFromRLS(user) {
    try {
      console.log('⚙️ 🔒 Loading settings with RLS for user:', user.email);
      
      const { data, error } = await this.supabase
        .from('user_settings')
        .select('settings_data, updated_at')
        .eq('user_email', user.email)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log('⚙️ No RLS settings found for user');
          return null;
        }
        throw error;
      }

      if (data?.settings_data) {
        this.saveToLocalStorage(user.email, data.settings_data);
        return data.settings_data;
      }

    } catch (error) {
      console.error('⚙️ ❌ RLS settings load failed:', error);
      throw error;
    }
    
    return null;
  }

  async loadSettingsFromNonRLS(user) {
    try {
      console.log('⚙️ 🔓 Loading settings without RLS for user:', user.email);
      
      const { data, error } = await this.supabase
        .from('user_settings')
        .select('settings_data, updated_at')
        .eq('user_email', user.email)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log('⚙️ No settings found for user');
          return null;
        }
        throw error;
      }

      if (data?.settings_data) {
        this.saveToLocalStorage(user.email, data.settings_data);
        return data.settings_data;
      }

    } catch (error) {
      console.error('⚙️ ❌ Non-RLS settings load failed:', error);
    }
    
    return null;
  }

  async saveSettings(settings) {
    const user = this.getCurrentUser();
    if (!user) {
      console.warn('⚙️ No user available for settings save');
      return false;
    }

    // Always save to localStorage first
    this.saveToLocalStorage(user.email, settings);

    if (!this.isOnline) {
      console.log('⚙️ 📱 Offline: Settings saved locally, will sync when online');
      this.queuePendingChange('save', settings);
      return true;
    }

    try {
      const success = this.isRLSMode 
        ? await this.saveSettingsWithRLS(user, settings)
        : await this.saveSettingsWithoutRLS(user, settings);

      if (success) {
        console.log('⚙️ ✅ Settings saved to Supabase');
        this.removePendingChange('save');
        return true;
      }

    } catch (error) {
      console.error('⚙️ ❌ Failed to save settings to Supabase:', error);
      this.queuePendingChange('save', settings);
    }

    return false;
  }

  async saveSettingsWithRLS(user, settings) {
    try {
      const { data, error } = await this.supabase
        .from('user_settings')
        .upsert({
          user_email: user.email,
          settings_data: settings,
          updated_at: new Date().toISOString()
        }, { 
          onConflict: 'user_email'
        });

      if (error) throw error;
      return true;

    } catch (error) {
      console.error('⚙️ ❌ RLS settings save failed:', error);
      return false;
    }
  }

  async saveSettingsWithoutRLS(user, settings) {
    try {
      const { data, error } = await this.supabase
        .from('user_settings')
        .upsert({
          user_email: user.email,
          settings_data: settings,
          updated_at: new Date().toISOString()
        }, { 
          onConflict: 'user_email'
        });

      if (error) throw error;
      return true;

    } catch (error) {
      console.error('⚙️ ❌ Non-RLS settings save failed:', error);
      return false;
    }
  }

  // Local storage and utility methods remain unchanged
  saveToLocalStorage(userEmail, settings) {
    try {
      const storageKey = `dashie-settings-${userEmail}`;
      const storageData = {
        settings,
        lastSync: Date.now(),
        userEmail
      };
      localStorage.setItem(storageKey, JSON.stringify(storageData));
    } catch (error) {
      console.error('⚙️ ❌ Failed to save to localStorage:', error);
    }
  }

  loadFromLocalStorage(userEmail) {
    try {
      const storageKey = `dashie-settings-${userEmail}`;
      const stored = localStorage.getItem(storageKey);
      
      if (stored) {
        const { settings, lastSync } = JSON.parse(stored);
        
        // Check if data is not too old (7 days)
        if (lastSync && (Date.now() - lastSync < 7 * 24 * 60 * 60 * 1000)) {
          return settings;
        }
      }
    } catch (error) {
      console.error('⚙️ ❌ Failed to load from localStorage:', error);
    }
    
    return null;
  }

  // Network monitoring and offline sync methods remain unchanged
  setupNetworkMonitoring() {
    window.addEventListener('online', () => {
      console.log('🌐 Back online, syncing pending changes...');
      this.isOnline = true;
      this.syncPendingChanges();
    });

    window.addEventListener('offline', () => {
      console.log('📱 Gone offline, will queue changes');
      this.isOnline = false;
    });
  }

  queuePendingChange(operation, data) {
    const change = {
      operation,
      data,
      timestamp: Date.now(),
      retries: 0
    };
    
    this.pendingChanges.push(change);
    
    try {
      localStorage.setItem('dashie-pending-changes', JSON.stringify(this.pendingChanges));
    } catch (error) {
      console.error('Failed to save pending changes:', error);
    }
  }

  removePendingChange(operation) {
    this.pendingChanges = this.pendingChanges.filter(change => change.operation !== operation);
    
    try {
      localStorage.setItem('dashie-pending-changes', JSON.stringify(this.pendingChanges));
    } catch (error) {
      console.error('Failed to update pending changes:', error);
    }
  }

  async syncPendingChanges() {
    if (this.syncInProgress || !this.isOnline || this.pendingChanges.length === 0) {
      return;
    }

    this.syncInProgress = true;
    console.log(`⚙️ 🔄 Syncing ${this.pendingChanges.length} pending changes...`);

    const changesToSync = [...this.pendingChanges];

    for (const change of changesToSync) {
      try {
        if (change.operation === 'save') {
          const success = await this.saveSettings(change.data);
          if (success) {
            this.removePendingChange(change.operation);
          } else {
            change.retries++;
            if (change.retries >= this.maxRetries) {
              console.error('⚙️ ❌ Max retries exceeded for pending change:', change);
              this.removePendingChange(change.operation);
            }
          }
        }
      } catch (error) {
        console.error('⚙️ ❌ Failed to sync pending change:', error);
        change.retries++;
      }
    }

    this.syncInProgress = false;
    console.log('⚙️ ✅ Pending changes sync completed');
  }

  setupRealtimeSubscription() {
    // Realtime subscription setup would need to be updated for Cognito
    // This is a placeholder - the exact implementation depends on your Supabase RLS policies
    console.log('🔄 Realtime subscriptions setup (placeholder for Cognito integration)');
  }
}
