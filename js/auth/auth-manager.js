// js/auth/auth-manager.js
// UPDATED: Simplified auth manager using AWS Cognito instead of platform-specific flows

import { CognitoAuth } from './cognito-auth.js';
import { AuthUI } from './auth-ui.js';
import { AuthStorage } from './auth-storage.js';
import { GoogleAPIClient } from '../google-apis/google-api-client.js';

export class AuthManager {
  constructor() {
    this.currentUser = null;
    this.isSignedIn = false;
    this.googleAccessToken = null;
    this.googleAPI = null;
    
    // Initialize auth modules - much simpler now!
    this.cognitoAuth = new CognitoAuth();
    this.ui = new AuthUI();
    this.storage = new AuthStorage(); // Keep for compatibility
    
    // Centralized data cache (unchanged)
    this.dataCache = {
      calendar: {
        events: [],
        calendars: [],
        lastUpdated: null,
        refreshInterval: 5 * 60 * 1000, // 5 minutes
        isLoading: false
      },
      photos: {
        albums: [],
        recentPhotos: [],
        lastUpdated: null,
        refreshInterval: 30 * 60 * 1000, // 30 minutes
        isLoading: false
      }
    };
    
    this.refreshTimers = {};
    this.pendingWidgetRequests = [];
    
    this.init();
  }

  async init() {
    console.log('🔐 Initializing simplified AuthManager with Cognito...');
    
    // Set up widget request handler (unchanged)
    this.setupWidgetRequestHandler();
    
    try {
      // Initialize Cognito
      const result = await this.cognitoAuth.init();
      
      if (result.success && result.user) {
        console.log('🔐 ✅ Cognito authentication successful');
        this.setUserFromCognito(result.user);
        this.isSignedIn = true;
        this.ui.showSignedInState();
        await this.initializeGoogleAPIs();
        return;
      }
      
      // No existing auth found - show sign-in prompt
      console.log('🔐 No existing authentication, showing sign-in prompt');
      this.ui.showSignInPrompt(() => this.signIn(), () => this.exitApp());
      
    } catch (error) {
      console.error('🔐 ❌ Auth initialization failed:', error);
      this.handleAuthFailure(error);
    }
  }

  setUserFromCognito(userData) {
    this.currentUser = userData;
    this.googleAccessToken = userData.googleAccessToken;
    
    console.log('🔐 ✅ User set from Cognito:', {
      name: userData.name,
      email: userData.email,
      hasGoogleToken: !!this.googleAccessToken
    });
    
    // Save to legacy storage for compatibility
    this.storage.saveUser(userData);
  }

  async signIn() {
    try {
      console.log('🔐 Starting Cognito sign-in...');
      this.ui.hideSignInPrompt();
      
      // This will redirect to Cognito Hosted UI
      await this.cognitoAuth.signIn();
      
    } catch (error) {
      console.error('🔐 ❌ Sign-in failed:', error);
      this.ui.showAuthError('Sign-in failed. Please try again.');
    }
  }

  async signOut() {
    console.log('🔐 Signing out...');
    
    try {
      // Clear refresh timers
      Object.values(this.refreshTimers).forEach(timer => clearTimeout(timer));
      this.refreshTimers = {};
      
      // Clear data cache
      this.dataCache = {
        calendar: { events: [], calendars: [], lastUpdated: null, refreshInterval: 5 * 60 * 1000, isLoading: false },
        photos: { albums: [], recentPhotos: [], lastUpdated: null, refreshInterval: 30 * 60 * 1000, isLoading: false }
      };
      
      // Sign out from Cognito
      await this.cognitoAuth.signOut();
      
      // Clear local state
      this.currentUser = null;
      this.isSignedIn = false;
      this.googleAccessToken = null;
      this.googleAPI = null;
      
      // Clear legacy storage
      this.storage.clearSavedUser();
      
      // Show sign-in prompt
      this.ui.showSignInPrompt(() => this.signIn(), () => this.exitApp());
      
    } catch (error) {
      console.error('🔐 ❌ Sign-out failed:', error);
      // Still clear local state even if remote sign-out fails
      this.currentUser = null;
      this.isSignedIn = false;
      this.googleAccessToken = null;
      this.googleAPI = null;
      this.ui.showSignInPrompt(() => this.signIn(), () => this.exitApp());
    }
  }

  exitApp() {
    console.log('🚪 Exiting Dashie...');
    
    // Try platform-specific exit methods (legacy compatibility)
    if (window.DashieNative?.exitApp) {
      window.DashieNative.exitApp();
    } else if (window.close) {
      window.close();
    } else {
      window.location.href = 'about:blank';
    }
  }

  handleAuthFailure(error) {
    console.error('🔐 Auth initialization failed:', error);
    
    // Try to get saved user as fallback
    const savedUser = this.cognitoAuth.getSavedUser();
    if (savedUser) {
      console.log('🔐 Using saved user data as fallback');
      this.setUserFromCognito(savedUser);
      this.isSignedIn = true;
      this.ui.showSignedInState();
    } else {
      this.ui.showAuthError('Authentication service is currently unavailable. Please try again.');
    }
  }

  // API compatibility methods (unchanged from original)
  getUser() {
    return this.currentUser;
  }

  isAuthenticated() {
    return this.isSignedIn && !!this.currentUser;
  }

  getGoogleAccessToken() {
    return this.googleAccessToken;
  }

  // Google APIs initialization (unchanged)
  async initializeGoogleAPIs() {
    if (!this.googleAccessToken) {
      console.warn('🔐 ⚠️ No Google access token available for API initialization');
      return;
    }

    try {
      this.googleAPI = new GoogleAPIClient(this.googleAccessToken);
      const testResults = await this.googleAPI.testAccess();
      console.log('🌐 ✅ Google APIs initialized:', testResults);
      
      // Notify widgets (unchanged)
      this.notifyWidgetsOfAPIReadiness(testResults);
      
    } catch (error) {
      console.error('🌐 ❌ Google APIs initialization failed:', error);
      this.notifyWidgetsOfAPIReadiness({ calendar: false, photos: false });
    }
  }

  // Widget communication methods (unchanged from original)
  setupWidgetRequestHandler() {
    window.addEventListener('message', (event) => {
      if (event.data.type === 'widget-data-request') {
        this.handleWidgetDataRequest(event.data, event.source);
      }
    });
  }

  notifyWidgetsOfAPIReadiness(testResults) {
    setTimeout(() => {
      const allWidgetIframes = document.querySelectorAll('.widget-iframe, .widget iframe, .widget-iframe');
      
      if (allWidgetIframes.length === 0) {
        console.log('📡 🔄 No widget iframes found initially, retrying...');
        setTimeout(() => {
          const retryIframes = document.querySelectorAll('.widget-iframe, .widget iframe, .widget-iframe');
          if (retryIframes.length > 0) {
            console.log(`📡 🔄 Retry found ${retryIframes.length} widget iframe(s)`);
            this.sendGoogleAPIReadyMessage(retryIframes, testResults);
          }
        }, 2000);
      } else {
        this.sendGoogleAPIReadyMessage(allWidgetIframes, testResults);
      }
    }, 1000);
  }

  sendGoogleAPIReadyMessage(iframes, testResults) {
    iframes.forEach((iframe, index) => {
      if (iframe.contentWindow) {
        try {
          const message = {
            type: 'google-apis-ready',
            apiCapabilities: testResults,
            timestamp: Date.now(),
            authManager: this,
            googleAccessToken: this.googleAccessToken,
            debugInfo: {
              sentAt: new Date().toISOString(),
              widgetSrc: iframe.src,
              widgetIndex: index + 1
            }
          };
          
          iframe.contentWindow.postMessage(message, '*');
          console.log(`📡 ✅ Message sent to widget ${index + 1} (${iframe.src})`);
          
        } catch (error) {
          console.error(`📡 ❌ Failed to send message to widget ${index + 1}:`, error);
        }
      }
    });
  }

  // Data request handling (unchanged from original)
  async handleWidgetDataRequest(request, source) {
    console.log('📡 📨 Widget data request received:', request);
    
    try {
      let data;
      
      switch (request.dataType) {
        case 'calendar-events':
          data = await this.getCalendarData(request.params);
          break;
        case 'calendar-list':
          data = await this.getCalendarList();
          break;
        case 'photos-albums':
          data = await this.getPhotosData(request.params);
          break;
        default:
          throw new Error(`Unknown data type: ${request.dataType}`);
      }
      
      source.postMessage({
        type: 'widget-data-response',
        requestId: request.requestId,
        success: true,
        data: data
      }, '*');
      
    } catch (error) {
      console.error('📡 ❌ Widget data request failed:', error);
      source.postMessage({
        type: 'widget-data-response',
        requestId: request.requestId,
        success: false,
        error: error.message
      }, '*');
    }
  }

  // Data fetching methods (unchanged from original implementation)
  async getCalendarData(params = {}) {
    const cacheKey = 'calendar';
    const cache = this.dataCache[cacheKey];
    
    if (!this.googleAPI) {
      throw new Error('Google APIs not initialized');
    }
    
    const now = Date.now();
    const cacheValid = cache.lastUpdated && (now - cache.lastUpdated) < cache.refreshInterval;
    
    if (cacheValid && cache.events.length > 0) {
      console.log('📅 📋 Using cached calendar data');
      return cache.events;
    }
    
    if (cache.isLoading) {
      console.log('📅 ⏳ Calendar data already loading, waiting...');
      return new Promise((resolve) => {
        const checkCache = () => {
          if (!cache.isLoading) {
            resolve(cache.events);
          } else {
            setTimeout(checkCache, 100);
          }
        };
        checkCache();
      });
    }
    
    try {
      cache.isLoading = true;
      console.log('📅 🔄 Fetching fresh calendar data...');
      
      const events = await this.googleAPI.getAllCalendarEvents();
      
      cache.events = events;
      cache.lastUpdated = now;
      cache.isLoading = false;
      
      this.scheduleDataRefresh(cacheKey);
      
      console.log(`📅 ✅ Calendar data updated: ${events.length} events`);
      return events;
      
    } catch (error) {
      cache.isLoading = false;
      console.error('📅 ❌ Failed to fetch calendar data:', error);
      throw error;
    }
  }

  async getCalendarList() {
    if (!this.googleAPI) {
      throw new Error('Google APIs not initialized');
    }
    
    try {
      const calendars = await this.googleAPI.getCalendarList();
      console.log(`📅 ✅ Calendar list fetched: ${calendars.length} calendars`);
      return calendars;
    } catch (error) {
      console.error('📅 ❌ Failed to fetch calendar list:', error);
      throw error;
    }
  }

  async getPhotosData(params = {}) {
    // Implementation would be similar to calendar data
    // Placeholder for now
    throw new Error('Photos data not yet implemented');
  }

  scheduleDataRefresh(cacheKey) {
    if (this.refreshTimers[cacheKey]) {
      clearTimeout(this.refreshTimers[cacheKey]);
    }
    
    const cache = this.dataCache[cacheKey];
    this.refreshTimers[cacheKey] = setTimeout(() => {
      cache.lastUpdated = null; // Force refresh on next request
      console.log(`🔄 Scheduled refresh triggered for ${cacheKey}`);
    }, cache.refreshInterval);
  }
}
