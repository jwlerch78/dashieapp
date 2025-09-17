// js/auth/token-manager.js - Automatic Token Refresh Management
// CHANGE SUMMARY: Token manager without widget notifications (centralized data architecture)

export class TokenManager {
  constructor(authManager) {
    this.authManager = authManager;
    this.refreshTimer = null;
    this.isRefreshing = false;
    this.refreshPromise = null;
    
    // Refresh token 5 minutes before expiry
    this.refreshBufferMinutes = 5;
    
    console.log('🔄 Token Manager initialized');
  }

  // Start automatic token refresh cycle
  startTokenRefresh(user) {
    if (!user.googleRefreshToken) {
      console.warn('🔄 ⚠️ No refresh token available - cannot start automatic refresh');
      return;
    }

    if (!user.tokenExpiry) {
      console.warn('🔄 ⚠️ No token expiry time - cannot schedule refresh');
      return;
    }

    this.scheduleNextRefresh(user.tokenExpiry);
    console.log('🔄 ✅ Automatic token refresh started');
  }

  // Schedule the next token refresh
  scheduleNextRefresh(tokenExpiry) {
    // Clear any existing timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    const now = Date.now();
    const bufferMs = this.refreshBufferMinutes * 60 * 1000;
    const refreshTime = tokenExpiry - bufferMs;
    const timeUntilRefresh = refreshTime - now;

    if (timeUntilRefresh <= 0) {
      // Token is already expired or about to expire, refresh immediately
      console.log('🔄 ⚡ Token expired or about to expire, refreshing immediately');
      this.refreshToken();
      return;
    }

    console.log(`🔄 ⏰ Next token refresh scheduled in ${Math.round(timeUntilRefresh / 1000 / 60)} minutes`);
    console.log(`🔄 📅 Refresh time: ${new Date(refreshTime).toISOString()}`);

    this.refreshTimer = setTimeout(() => {
      this.refreshToken();
    }, timeUntilRefresh);
  }

  // Refresh the access token using the refresh token
  async refreshToken() {
    if (this.isRefreshing) {
      console.log('🔄 ⏳ Token refresh already in progress, waiting...');
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    console.log('🔄 🔄 Starting token refresh...');

    this.refreshPromise = this.performTokenRefresh();
    
    try {
      const result = await this.refreshPromise;
      return result;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  // Perform the actual token refresh
  async performTokenRefresh() {
    try {
      const user = this.authManager.getUser();
      
      if (!user || !user.googleRefreshToken) {
        throw new Error('No refresh token available');
      }

      console.log('🔄 📡 Calling refresh token endpoint...');

      const response = await fetch('/api/auth/refresh-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refresh_token: user.googleRefreshToken
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
      }

      const newTokens = await response.json();
      
      if (!newTokens.access_token) {
        throw new Error('No access token received from refresh');
      }

      console.log('🔄 ✅ Token refresh successful:', {
        hasAccessToken: !!newTokens.access_token,
        hasRefreshToken: !!newTokens.refresh_token,
        expiresIn: newTokens.expires_in
      });

      // Update user object with new tokens
      const updatedUser = {
        ...user,
        googleAccessToken: newTokens.access_token,
        tokenExpiry: Date.now() + (newTokens.expires_in * 1000)
      };

      // If we got a new refresh token, update it too
      if (newTokens.refresh_token) {
        updatedUser.googleRefreshToken = newTokens.refresh_token;
      }

      // Update auth manager with new tokens
      this.authManager.updateUserTokens(updatedUser);

      // Update the auth method's stored tokens
      if (user.authMethod === 'web' && this.authManager.webAuth) {
        this.authManager.webAuth.updateTokens(newTokens);
      }

      // Schedule next refresh
      this.scheduleNextRefresh(updatedUser.tokenExpiry);

      console.log('🔄 🎉 Token refresh completed successfully');
      return {
        success: true,
        tokens: newTokens,
        user: updatedUser
      };

    } catch (error) {
      console.error('🔄 ❌ Token refresh failed:', error);
      
      // If refresh fails, we need to re-authenticate
      this.handleRefreshFailure(error);
      
      throw error;
    }
  }

  // Handle refresh token failure
  async handleRefreshFailure(error) {
    console.log('🔄 💥 Token refresh failed, handling failure...');
    
    // Clear any scheduled refresh
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Determine the failure type
    if (error.message.includes('invalid_grant') || error.message.includes('401')) {
      // Refresh token is invalid or expired
      console.log('🔄 🔐 Refresh token invalid, requiring re-authentication');
      this.requireReAuthentication('Refresh token expired');
    } else {
      // Temporary failure, try again later
      console.log('🔄 ⏳ Temporary refresh failure, will retry in 1 minute');
      setTimeout(() => {
        if (!this.isRefreshing) {
          this.refreshToken();
        }
      }, 60000); // Retry in 1 minute
    }
  }

  // Require user to re-authenticate
  requireReAuthentication(reason) {
    console.log('🔄 🚪 Requiring re-authentication:', reason);
    
    // Clear current user data
    this.authManager.signOut();
    
    // Show re-authentication UI
    // The auth manager will handle showing the sign-in UI
    if (window.dashieApp && window.dashieApp.showReAuthRequired) {
      window.dashieApp.showReAuthRequired(reason);
    } else {
      // Fallback: reload the page to trigger sign-in
      console.log('🔄 🔄 Reloading page for re-authentication');
      window.location.reload();
    }
  }

  // Check if current token is expired or about to expire
  isTokenExpired(user = null) {
    const currentUser = user || this.authManager.getUser();
    
    if (!currentUser || !currentUser.tokenExpiry) {
      return true;
    }

    const bufferMs = this.refreshBufferMinutes * 60 * 1000;
    return Date.now() >= (currentUser.tokenExpiry - bufferMs);
  }

  // Get a valid access token (refresh if needed)
  async getValidAccessToken() {
    const user = this.authManager.getUser();
    
    if (!user || !user.googleAccessToken) {
      throw new Error('No access token available');
    }

    // If token is not expired, return it
    if (!this.isTokenExpired(user)) {
      return user.googleAccessToken;
    }

    // Token is expired, refresh it
    console.log('🔄 🔄 Access token expired, refreshing...');
    const refreshResult = await this.refreshToken();
    
    if (refreshResult.success) {
      return refreshResult.tokens.access_token;
    } else {
      throw new Error('Failed to refresh expired token');
    }
  }

  // Stop automatic token refresh
  stopTokenRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    
    this.isRefreshing = false;
    this.refreshPromise = null;
    
    console.log('🔄 🛑 Automatic token refresh stopped');
  }

  // Get time until next refresh
  getTimeUntilRefresh() {
    const user = this.authManager.getUser();
    
    if (!user || !user.tokenExpiry) {
      return null;
    }

    const bufferMs = this.refreshBufferMinutes * 60 * 1000;
    const refreshTime = user.tokenExpiry - bufferMs;
    const timeUntilRefresh = refreshTime - Date.now();

    return Math.max(0, timeUntilRefresh);
  }

  // Get refresh status for debugging
  getRefreshStatus() {
    const user = this.authManager.getUser();
    const timeUntilRefresh = this.getTimeUntilRefresh();
    
    return {
      hasRefreshToken: !!(user && user.googleRefreshToken),
      hasAccessToken: !!(user && user.googleAccessToken),
      tokenExpiry: user ? user.tokenExpiry : null,
      isExpired: this.isTokenExpired(user),
      timeUntilRefresh: timeUntilRefresh,
      timeUntilRefreshMinutes: timeUntilRefresh ? Math.round(timeUntilRefresh / 1000 / 60) : null,
      isRefreshing: this.isRefreshing,
      hasScheduledRefresh: !!this.refreshTimer
    };
  }
}
