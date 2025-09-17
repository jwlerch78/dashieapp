// js/auth/cognito-auth.js
// UPDATED: AWS Cognito authentication replacing custom Google OAuth flows

import { COGNITO_CONFIG, AMPLIFY_CONFIG } from './cognito-config.js';

export class CognitoAuth {
  constructor() {
    this.amplify = null;
    this.currentUser = null;
    this.isInitialized = false;
    this.googleAccessToken = null;
    this.cognitoTokens = null;
  }

  async init() {
    console.log('🔐 Initializing AWS Cognito authentication...');
    
    try {
      // Wait for Amplify to be loaded
      await this.waitForAmplify();
      
      // Configure Amplify
      this.amplify.Amplify.configure(AMPLIFY_CONFIG);
      console.log('🔐 ✅ Amplify configured successfully');
      
      // Check for existing session
      const existingUser = await this.getCurrentSession();
      if (existingUser) {
        console.log('🔐 ✅ Found existing Cognito session:', existingUser.username);
        this.currentUser = existingUser;
        return { success: true, user: existingUser };
      }
      
      // Check for OAuth callback
      const callbackResult = await this.handleOAuthCallback();
      if (callbackResult.success) {
        console.log('🔐 ✅ OAuth callback handled successfully');
        return callbackResult;
      }
      
      console.log('🔐 No existing authentication found');
      this.isInitialized = true;
      return { success: false, reason: 'no_existing_auth' };
      
    } catch (error) {
      console.error('🔐 ❌ Cognito initialization failed:', error);
      this.isInitialized = true;
      return { success: false, error: error.message };
    }
  }

  async waitForAmplify(maxAttempts = 50) {
    for (let i = 0; i < maxAttempts; i++) {
      if (window.aws && window.aws.amplifyAuth) {
        this.amplify = window.aws.amplifyAuth;
        console.log('🔐 ✅ Amplify loaded successfully');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('AWS Amplify failed to load');
  }

  async getCurrentSession() {
    try {
      const user = await this.amplify.Auth.currentAuthenticatedUser();
      if (user) {
        // Get current session to access tokens
        const session = await this.amplify.Auth.currentSession();
        this.cognitoTokens = {
          idToken: session.getIdToken().getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
          refreshToken: session.getRefreshToken().getToken()
        };
        
        // Extract Google access token if available
        await this.extractGoogleAccessToken(session);
        
        const userData = this.formatUserData(user);
        this.currentUser = userData;
        this.saveUserToStorage(userData);
        
        return userData;
      }
    } catch (error) {
      if (error.message !== 'The user is not authenticated') {
        console.error('🔐 Error getting current session:', error);
      }
    }
    return null;
  }

  async handleOAuthCallback() {
    try {
      // Check if we're on the callback URL
      const urlParams = new URLSearchParams(window.location.search);
      const authCode = urlParams.get('code');
      
      if (!authCode) {
        return { success: false, reason: 'no_callback' };
      }

      console.log('🔐 Processing OAuth callback...');
      
      // Amplify should automatically handle the callback
      // We just need to get the user after the redirect
      const user = await this.amplify.Auth.currentAuthenticatedUser();
      
      if (user) {
        const session = await this.amplify.Auth.currentSession();
        this.cognitoTokens = {
          idToken: session.getIdToken().getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
          refreshToken: session.getRefreshToken().getToken()
        };
        
        // Extract Google access token
        await this.extractGoogleAccessToken(session);
        
        const userData = this.formatUserData(user);
        this.currentUser = userData;
        this.saveUserToStorage(userData);
        
        // Clean up URL
        this.cleanupCallbackUrl();
        
        console.log('🔐 ✅ OAuth callback processed successfully');
        return { success: true, user: userData };
      }
      
    } catch (error) {
      console.error('🔐 ❌ OAuth callback handling failed:', error);
      return { success: false, error: error.message };
    }
    
    return { success: false, reason: 'callback_processing_failed' };
  }

  async extractGoogleAccessToken(session) {
    try {
      // Try to get Google access token from Cognito Identity Pool
      // This requires proper Identity Pool configuration
      const credentials = await this.amplify.Auth.currentCredentials();
      
      if (credentials && credentials.params && credentials.params.google_access_token) {
        this.googleAccessToken = credentials.params.google_access_token;
        console.log('🔐 ✅ Google access token extracted from Cognito');
      } else {
        console.warn('🔐 ⚠️ Google access token not available in credentials');
        // Fallback: try to extract from ID token if available
        const idToken = session.getIdToken();
        const payload = idToken.payload;
        
        if (payload && payload.identities) {
          // Look for Google provider data in the token
          const googleIdentity = payload.identities.find(id => id.providerName === 'Google');
          if (googleIdentity && googleIdentity.access_token) {
            this.googleAccessToken = googleIdentity.access_token;
            console.log('🔐 ✅ Google access token extracted from ID token');
          }
        }
      }
    } catch (error) {
      console.error('🔐 ❌ Failed to extract Google access token:', error);
    }
  }

  formatUserData(cognitoUser) {
    const attributes = cognitoUser.attributes || {};
    
    return {
      id: cognitoUser.username,
      email: attributes.email,
      name: attributes.name || attributes.email,
      picture: attributes.picture,
      given_name: attributes.given_name,
      family_name: attributes.family_name,
      
      // Cognito specific fields
      username: cognitoUser.username,
      sub: attributes.sub,
      
      // Authentication metadata
      authMethod: 'cognito',
      provider: 'google',
      googleAccessToken: this.googleAccessToken,
      cognitoTokens: this.cognitoTokens,
      
      // Timestamps
      savedAt: Date.now(),
      lastSignIn: Date.now()
    };
  }

  saveUserToStorage(userData) {
    try {
      localStorage.setItem(COGNITO_CONFIG.storage.userDataKey, JSON.stringify(userData));
      console.log('🔐 ✅ User data saved to localStorage');
    } catch (error) {
      console.error('🔐 ❌ Failed to save user data:', error);
    }
  }

  getSavedUser() {
    try {
      const saved = localStorage.getItem(COGNITO_CONFIG.storage.userDataKey);
      if (saved) {
        const userData = JSON.parse(saved);
        // Check if saved data is not too old (30 days)
        if (userData.savedAt && (Date.now() - userData.savedAt < 30 * 24 * 60 * 60 * 1000)) {
          return userData;
        }
      }
    } catch (error) {
      console.error('🔐 ❌ Failed to get saved user:', error);
    }
    return null;
  }

  cleanupCallbackUrl() {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  async signIn() {
    try {
      console.log('🔐 Starting Cognito sign-in...');
      
      // Use Cognito Hosted UI for sign-in
      await this.amplify.Auth.federatedSignIn({ provider: 'Google' });
      
    } catch (error) {
      console.error('🔐 ❌ Sign-in failed:', error);
      throw error;
    }
  }

  async signOut() {
    try {
      console.log('🔐 Signing out from Cognito...');
      
      await this.amplify.Auth.signOut({ global: true });
      
      // Clear local data
      this.currentUser = null;
      this.googleAccessToken = null;
      this.cognitoTokens = null;
      
      // Clear localStorage
      localStorage.removeItem(COGNITO_CONFIG.storage.userDataKey);
      localStorage.removeItem(COGNITO_CONFIG.storage.sessionKey);
      
      console.log('🔐 ✅ Sign-out completed');
      
    } catch (error) {
      console.error('🔐 ❌ Sign-out failed:', error);
      throw error;
    }
  }

  getUser() {
    return this.currentUser;
  }

  isAuthenticated() {
    return !!this.currentUser;
  }

  getGoogleAccessToken() {
    return this.googleAccessToken;
  }

  getCognitoTokens() {
    return this.cognitoTokens;
  }

  // Method to refresh tokens
  async refreshSession() {
    try {
      const session = await this.amplify.Auth.currentSession();
      
      this.cognitoTokens = {
        idToken: session.getIdToken().getJwtToken(),
        accessToken: session.getAccessToken().getJwtToken(),
        refreshToken: session.getRefreshToken().getToken()
      };
      
      await this.extractGoogleAccessToken(session);
      
      if (this.currentUser) {
        this.currentUser.cognitoTokens = this.cognitoTokens;
        this.currentUser.googleAccessToken = this.googleAccessToken;
        this.saveUserToStorage(this.currentUser);
      }
      
      console.log('🔐 ✅ Session refreshed successfully');
      return true;
      
    } catch (error) {
      console.error('🔐 ❌ Session refresh failed:', error);
      return false;
    }
  }
}
