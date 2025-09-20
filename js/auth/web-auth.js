// js/auth/web-auth.js - Single OAuth-Only Web Auth (Complete Rewrite)
// CHANGE SUMMARY: Fixed init() method to properly initialize web auth instead of containing AuthManager code

export class WebAuth {
  constructor() {
    this.config = {
      client_id: '221142210647-58t8hr48rk7nlgl56j969himso1qjjoo.apps.googleusercontent.com',
      // Updated: Add Google Photos and Calendar scopes
      scope: 'profile email https://www.googleapis.com/auth/photoslibrary.readonly https://www.googleapis.com/auth/calendar.readonly',
      redirect_uri: window.location.origin + window.location.pathname
    };
    this.isInitialized = false;
    this.accessToken = null;
  }

  async init() {
    console.log('🔐 Initializing Web Auth...');
    
    try {
      // Set initialized flag
      this.isInitialized = true;
      
      // Check if we're returning from OAuth callback
      const callbackHandled = await this.handleOAuthCallback();
      
      if (callbackHandled) {
        console.log('🔐 OAuth callback was handled during init');
        return;
      }
      
      console.log('🔐 ✅ Web auth initialized successfully');
      
    } catch (error) {
      console.error('🔐 ❌ Web auth initialization failed:', error);
      this.isInitialized = true; // Still mark as initialized even if callback failed
      throw error;
    }
  }

  // CORE METHOD: Single OAuth flow - no Google ID Services
  async signIn() {
    if (!this.isInitialized) {
      throw new Error('Web auth not initialized');
    }

    try {
      console.log('🔐 ⚡ Starting SINGLE OAuth flow - no double login!');
      
      // Go directly to OAuth - skip all Google API loading
      this.startDirectOAuth();
      
    } catch (error) {
      console.error('🔐 Single OAuth sign-in failed:', error);
      throw error;
    }
  }

  // DIRECT OAuth - gets everything in one step
  startDirectOAuth() {
    console.log('🔐 🚀 Redirecting to Google OAuth (single step)...');
    
    const params = new URLSearchParams({
      client_id: this.config.client_id,
      redirect_uri: this.config.redirect_uri,
      response_type: 'token', // Get access token directly
      scope: this.config.scope,
      state: 'dashie-single-oauth',
      include_granted_scopes: 'true'
    });

    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    console.log('🔐 📍 OAuth URL:', oauthUrl);
    
    // Direct redirect - no popups, no additional APIs
    window.location.href = oauthUrl;
  }

  // Handle the single OAuth callback
  async handleOAuthCallback() {
    const urlFragment = window.location.hash;
    const urlParams = new URLSearchParams(window.location.search);
    
    console.log('🔐 🔍 Checking for OAuth callback...');
    console.log('🔐 URL fragment:', urlFragment);
    console.log('🔐 URL params state:', urlParams.get('state'));
    
    // Check for errors first
    if (urlFragment.includes('error=') || urlParams.get('error')) {
      console.log('🔐 ❌ OAuth error detected');
      this.handleOAuthError(urlFragment, urlParams);
      return true;
    }
    
    // Check if this is our OAuth callback
    const isOurCallback = urlFragment.includes('access_token') && 
                         (urlParams.get('state') === 'dashie-single-oauth' || 
                          urlFragment.includes('state=dashie-single-oauth'));
    
    if (isOurCallback) {
      console.log('🔐 ✅ OAuth callback detected! Processing...');
      
      try {
        // Extract access token from URL fragment
        const fragmentParams = new URLSearchParams(urlFragment.substring(1)); // Remove #
        const accessToken = fragmentParams.get('access_token');
        const tokenType = fragmentParams.get('token_type');
        const expiresIn = fragmentParams.get('expires_in');
        
        console.log('🔐 🎫 Token extracted:', {
          hasToken: !!accessToken,
          tokenType: tokenType,
          expiresIn: expiresIn,
          tokenPreview: accessToken ? accessToken.substring(0, 20) + '...' : 'NONE'
        });
        
        if (!accessToken) {
          throw new Error('No access token found in OAuth callback');
        }
        
        this.accessToken = accessToken;
        
        // Get user info using the access token
        console.log('🔐 👤 Fetching user info from Google...');
        const userInfo = await this.fetchUserInfo(accessToken);
        
        const completeUserData = {
          id: userInfo.id,
          name: userInfo.name,
          email: userInfo.email,
          picture: userInfo.picture,
          authMethod: 'web',
          googleAccessToken: accessToken
        };
        
        console.log('🔐 🎉 Single OAuth SUCCESS:', completeUserData.name);
        
        // Clean up the URL
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Notify the auth manager
        this.notifyAuthSuccess(completeUserData, accessToken);
        
        return true; // Successfully handled callback
        
      } catch (error) {
        console.error('🔐 ❌ OAuth callback processing failed:', error);
        this.notifyAuthFailure('Authentication failed: ' + error.message);
        return true; // We handled the callback (even though it failed)
      }
    }
    
    console.log('🔐 ℹ️ Not an OAuth callback, continuing normal flow');
    return false; // Not our callback
  }

  // Fetch user info from Google using access token
  async fetchUserInfo(accessToken) {
    try {
      console.log('🔐 📡 Calling Google userinfo API...');
      
      const response = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Google API error: ${response.status} ${response.statusText}`);
      }
      
      const userInfo = await response.json();
      console.log('🔐 👤 User info received:', {
        id: userInfo.id,
        name: userInfo.name,
        email: userInfo.email,
        hasPicture: !!userInfo.picture
      });
      
      return userInfo;
      
    } catch (error) {
      console.error('🔐 ❌ Failed to fetch user info:', error);
      throw new Error(`Failed to get user information: ${error.message}`);
    }
  }

  // Handle OAuth errors
  handleOAuthError(urlFragment, urlParams) {
    let errorInfo = {};
    
    if (urlFragment.includes('error=')) {
      const fragmentParams = new URLSearchParams(urlFragment.substring(1));
      errorInfo.error = fragmentParams.get('error');
      errorInfo.error_description = fragmentParams.get('error_description');
      errorInfo.error_uri = fragmentParams.get('error_uri');
    } else {
      errorInfo.error = urlParams.get('error');
      errorInfo.error_description = urlParams.get('error_description');
    }
    
    console.error('🔐 OAuth error details:', errorInfo);
    
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
    
    const errorMessage = `OAuth error: ${errorInfo.error}${errorInfo.error_description ? ' - ' + errorInfo.error_description : ''}`;
    this.notifyAuthFailure(errorMessage);
  }

  // Notify auth manager of successful authentication
  notifyAuthSuccess(userData, accessToken) {
    console.log('🔐 📢 Notifying auth manager of success');
    if (window.handleWebAuth) {
      window.handleWebAuth({
        success: true,
        user: userData,
        tokens: { access_token: accessToken }
      });
    } else {
      console.warn('🔐 ⚠️ window.handleWebAuth not available');
    }
  }

  // Notify auth manager of authentication failure
  notifyAuthFailure(error) {
    console.error('🔐 📢 Notifying auth manager of failure:', error);
    if (window.handleWebAuth) {
      window.handleWebAuth({
        success: false,
        error: error
      });
    } else {
      console.warn('🔐 ⚠️ window.handleWebAuth not available');
    }
  }

  // Get stored access token
  getAccessToken() {
    return this.accessToken;
  }

  // Sign out
  signOut() {
    try {
      console.log('🔐 🚪 Web auth sign out');
      this.accessToken = null;
      
      // Note: We don't use Google ID Services anymore, so no need to disable it
      
    } catch (error) {
      console.error('🔐 ❌ Error during web sign-out:', error);
    }
  }
}
