// js/auth/auth-manager.js - UPDATED: Complete auth manager with all missing functions restored
// CHANGE SUMMARY: Restored all missing functions from working version including handleWebAuthResult, proper checkExistingAuth, centralized data system

import { NativeAuth } from './native-auth.js';
import { WebAuth } from './web-auth.js';
import { AuthUI } from './auth-ui.js';
import { AuthStorage } from './auth-storage.js';
import { DeviceFlowAuth } from './device-flow-auth.js';
import { GoogleAPIClient } from '../google-apis/google-api-client.js';

export class AuthManager {
  constructor() {
    this.currentUser = null;
    this.isSignedIn = false;
    this.isWebView = this.detectWebView();
    this.hasNativeAuth = this.detectNativeAuth();
    this.isFireTV = this.detectFireTV();
    
    // Initialize auth modules
    this.storage = new AuthStorage();
    this.ui = new AuthUI();
    this.nativeAuth = this.hasNativeAuth ? new NativeAuth() : null;
    this.webAuth = new WebAuth();
    this.deviceFlowAuth = new DeviceFlowAuth();
    
    this.nativeAuthFailed = false;

    this.googleAccessToken = null;
    this.googleAPI = null;
    
    // Centralized data cache and refresh system
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

  detectWebView() {
    const userAgent = navigator.userAgent;
    const isAndroidWebView = /wv/.test(userAgent) || 
                           /Android.*AppleWebKit(?!.*Chrome)/.test(userAgent) ||
                           userAgent.includes('DashieApp');
    const isIOSWebView = /(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/.test(userAgent);
    
    console.log('🔐 Environment detection:', {
      userAgent: userAgent,
      isAndroidWebView: isAndroidWebView,
      isIOSWebView: isIOSWebView,
      isWebView: isAndroidWebView || isIOSWebView
    });
    
    return isAndroidWebView || isIOSWebView;
  }

  detectNativeAuth() {
    const hasNative = window.DashieNative && 
                     typeof window.DashieNative.signIn === 'function';
    console.log('🔐 Native auth available:', hasNative);
    return !!hasNative;
  }

  detectFireTV() {
    const userAgent = navigator.userAgent;
    const isFireTV = userAgent.includes('AFTS') || userAgent.includes('FireTV') || 
                    userAgent.includes('AFT') || userAgent.includes('AFTMM') ||
                    userAgent.includes('AFTRS') || userAgent.includes('AFTSS');
    console.log('🔥 Fire TV detected:', isFireTV);
    return isFireTV;
  }

  async init() {
    console.log('🔐 Initializing AuthManager...');
    console.log('🔐 Environment:', {
      isWebView: this.isWebView,
      hasNativeAuth: this.hasNativeAuth,
      isFireTV: this.isFireTV
    });

    // Set up auth result handlers
    window.handleNativeAuth = (result) => this.handleNativeAuthResult(result);
    window.handleWebAuth = (result) => this.handleWebAuthResult(result);
    
    // Set up widget request handler
    this.setupWidgetRequestHandler();
    
    // Check for existing authentication first
    this.checkExistingAuth();
    
    // If already signed in, we're done
    if (this.isSignedIn) {
      console.log('🔐 ✅ Already authenticated, initializing data services');
      await this.initializeGoogleAPIs();
      return;
    }

    // Initialize appropriate auth method based on platform
    if (this.hasNativeAuth) {
      console.log('🔐 Using native Android authentication');
      await this.nativeAuth.init();
      this.checkNativeUser();
      
    } else if (this.isWebView) {
      console.log('🔐 WebView without native auth - showing WebView prompt');
      this.ui.showWebViewAuthPrompt(() => this.createWebViewUser(), () => this.exitApp());
      
    } else {
      console.log('🔐 Browser environment - initializing web auth');
      try {
        await this.webAuth.init();
        
        if (this.isSignedIn) {
          console.log('🔐 ✅ OAuth callback handled during init, user is now signed in');
          return;
        }
        
        console.log('🔐 No existing auth found, showing sign-in prompt');
        this.ui.showSignInPrompt(() => this.signIn(), () => this.exitApp());
        
      } catch (error) {
        console.error('🔐 Web auth initialization failed:', error);
        this.handleAuthFailure(error);
      }
    }
  }

  checkExistingAuth() {
    const savedUser = this.storage.getSavedUser();
    if (savedUser) {
      console.log('🔐 Found saved user:', savedUser.name);
      this.currentUser = savedUser;
      this.isSignedIn = true;
      
      if (savedUser.googleAccessToken) {
        this.googleAccessToken = savedUser.googleAccessToken;
        console.log('🔐 ✅ Restored Google access token from saved user');
      } else {
        console.warn('🔐 ⚠️ No Google access token in saved user data');
      }
      
      this.ui.showSignedInState();
    }
  }

  // Widget request handler for centralized data
  setupWidgetRequestHandler() {
    window.addEventListener('message', (event) => {
      if (!event.data || !event.data.type) return;
      
      switch (event.data.type) {
        case 'request-calendar-data':
          console.log('📅 Widget requesting calendar data:', event.data.widget);
          this.handleCalendarDataRequest(event.source, event.data);
          break;
          
        case 'request-photos-data':
          console.log('📸 Widget requesting photos data:', event.data.widget);
          this.handlePhotosDataRequest(event.source, event.data);
          break;
          
        case 'refresh-calendar-data':
          console.log('📅 Widget requesting calendar refresh:', event.data.widget);
          this.refreshCalendarData(true);
          break;
          
        case 'refresh-photos-data':
          console.log('📸 Widget requesting photos refresh:', event.data.widget);
          this.refreshPhotosData(true);
          break;

        case 'widget-data-request':
          this.handleWidgetDataRequest(event.data, event.source);
          break;
      }
    });
  }

  // Handle calendar data requests
  async handleCalendarDataRequest(widgetWindow, requestData) {
    const cacheData = this.dataCache.calendar;
    
    // Check if we have fresh data
    const now = Date.now();
    const isDataFresh = cacheData.lastUpdated && 
                       (now - cacheData.lastUpdated) < cacheData.refreshInterval;
    
    if (isDataFresh && cacheData.events.length > 0) {
      console.log('📅 Sending cached calendar data to widget');
      this.sendCalendarDataToWidget(widgetWindow, cacheData);
      return;
    }
    
    // If data is stale or missing, queue the request and fetch fresh data
    this.pendingWidgetRequests.push({
      type: 'calendar',
      window: widgetWindow,
      requestData: requestData,
      timestamp: now
    });
    
    await this.refreshCalendarData();
  }

  // Handle photos data requests
  async handlePhotosDataRequest(widgetWindow, requestData) {
    const cacheData = this.dataCache.photos;
    
    // Check if we have fresh data
    const now = Date.now();
    const isDataFresh = cacheData.lastUpdated && 
                       (now - cacheData.lastUpdated) < cacheData.refreshInterval;
    
    if (isDataFresh && (cacheData.albums.length > 0 || cacheData.recentPhotos.length > 0)) {
      console.log('📸 Sending cached photos data to widget');
      this.sendPhotosDataToWidget(widgetWindow, cacheData);
      return;
    }
    
    // If data is stale or missing, queue the request and fetch fresh data
    this.pendingWidgetRequests.push({
      type: 'photos',
      window: widgetWindow,
      requestData: requestData,
      timestamp: now
    });
    
    await this.refreshPhotosData();
  }

  // Refresh calendar data
  async refreshCalendarData(forceRefresh = false) {
    if (!this.googleAPI) {
      console.warn('📅 ❌ No Google API client available for calendar refresh');
      return;
    }
    
    const cacheData = this.dataCache.calendar;
    
    // Prevent multiple simultaneous refreshes
    if (cacheData.isLoading && !forceRefresh) {
      console.log('📅 Calendar refresh already in progress');
      return;
    }
    
    cacheData.isLoading = true;
    console.log('📅 🔄 Refreshing calendar data...');
    
    try {
      const calendarData = await this.googleAPI.getAllCalendarEvents();
      
      // Update cache
      cacheData.events = calendarData.events || [];
      cacheData.calendars = calendarData.calendars || [];
      cacheData.lastUpdated = Date.now();
      cacheData.isLoading = false;
      
      console.log(`📅 ✅ Calendar data refreshed: ${cacheData.events.length} events, ${cacheData.calendars.length} calendars`);
      
      // Send data to pending widgets
      this.processPendingRequests('calendar');
      
      // Set up auto-refresh
      this.scheduleDataRefresh('calendar');
      
    } catch (error) {
      console.error('📅 ❌ Calendar data refresh failed:', error);
      cacheData.isLoading = false;
      
      // Send error to pending widgets
      this.sendErrorToPendingWidgets('calendar', error.message);
    }
  }

  // Refresh photos data
  async refreshPhotosData(forceRefresh = false) {
    if (!this.googleAPI) {
      console.warn('📸 ❌ No Google API client available for photos refresh');
      return;
    }
    
    const cacheData = this.dataCache.photos;
    
    // Prevent multiple simultaneous refreshes
    if (cacheData.isLoading && !forceRefresh) {
      console.log('📸 Photos refresh already in progress');
      return;
    }
    
    cacheData.isLoading = true;
    console.log('📸 🔄 Refreshing photos data...');
    
    try {
      // Fetch both albums and recent photos
      const [albums, recentPhotos] = await Promise.all([
        this.googleAPI.getPhotoAlbums(),
        this.googleAPI.getRecentPhotos(50)
      ]);
      
      // Update cache
      cacheData.albums = albums || [];
      cacheData.recentPhotos = recentPhotos.photos || [];
      cacheData.lastUpdated = Date.now();
      cacheData.isLoading = false;
      
      console.log(`📸 ✅ Photos data refreshed: ${cacheData.albums.length} albums, ${cacheData.recentPhotos.length} recent photos`);
      
      // Send data to pending widgets
      this.processPendingRequests('photos');
      
      // Set up auto-refresh
      this.scheduleDataRefresh('photos');
      
    } catch (error) {
      console.error('📸 ❌ Photos data refresh failed:', error);
      cacheData.isLoading = false;
      
      // Send error to pending widgets
      this.sendErrorToPendingWidgets('photos', error.message);
    }
  }

  // Process pending widget requests
  processPendingRequests(dataType) {
    const pendingRequests = this.pendingWidgetRequests.filter(req => req.type === dataType);
    
    if (pendingRequests.length === 0) return;
    
    console.log(`📊 Processing ${pendingRequests.length} pending ${dataType} requests`);
    
    pendingRequests.forEach(request => {
      if (dataType === 'calendar') {
        this.sendCalendarDataToWidget(request.window, this.dataCache.calendar);
      } else if (dataType === 'photos') {
        this.sendPhotosDataToWidget(request.window, this.dataCache.photos);
      }
    });
    
    // Remove processed requests
    this.pendingWidgetRequests = this.pendingWidgetRequests.filter(req => req.type !== dataType);
  }

  // Send calendar data to widget
  sendCalendarDataToWidget(widgetWindow, cacheData) {
    if (!widgetWindow) return;
    
    try {
      widgetWindow.postMessage({
        type: 'calendar-data-ready',
        data: {
          events: cacheData.events,
          calendars: cacheData.calendars,
          lastUpdated: cacheData.lastUpdated,
          status: 'success'
        },
        timestamp: Date.now()
      }, '*');
      
      console.log('📅 📤 Calendar data sent to widget');
    } catch (error) {
      console.error('📅 ❌ Failed to send calendar data to widget:', error);
    }
  }

  // Send photos data to widget
  sendPhotosDataToWidget(widgetWindow, cacheData) {
    if (!widgetWindow) return;
    
    try {
      widgetWindow.postMessage({
        type: 'photos-data-ready',
        data: {
          albums: cacheData.albums,
          recentPhotos: cacheData.recentPhotos,
          lastUpdated: cacheData.lastUpdated,
          status: 'success'
        },
        timestamp: Date.now()
      }, '*');
      
      console.log('📸 📤 Photos data sent to widget');
    } catch (error) {
      console.error('📸 ❌ Failed to send photos data to widget:', error);
    }
  }

  // Send errors to pending widgets
  sendErrorToPendingWidgets(dataType, errorMessage) {
    const pendingRequests = this.pendingWidgetRequests.filter(req => req.type === dataType);
    
    pendingRequests.forEach(request => {
      try {
        request.window.postMessage({
          type: `${dataType}-data-ready`,
          data: {
            events: dataType === 'calendar' ? [] : undefined,
            calendars: dataType === 'calendar' ? [] : undefined,
            albums: dataType === 'photos' ? [] : undefined,
            recentPhotos: dataType === 'photos' ? [] : undefined,
            status: 'error',
            error: errorMessage
          },
          timestamp: Date.now()
        }, '*');
      } catch (error) {
        console.error(`Failed to send error to ${dataType} widget:`, error);
      }
    });
    
    // Remove error requests
    this.pendingWidgetRequests = this.pendingWidgetRequests.filter(req => req.type !== dataType);
  }

  // Schedule automatic data refresh
  scheduleDataRefresh(dataType) {
    // Clear existing timer
    if (this.refreshTimers[dataType]) {
      clearTimeout(this.refreshTimers[dataType]);
    }
    
    const refreshInterval = this.dataCache[dataType].refreshInterval;
    
    this.refreshTimers[dataType] = setTimeout(() => {
      console.log(`⏰ Auto-refreshing ${dataType} data`);
      if (dataType === 'calendar') {
        this.refreshCalendarData();
      } else if (dataType === 'photos') {
        this.refreshPhotosData();
      }
    }, refreshInterval);
    
    console.log(`⏰ Scheduled ${dataType} refresh in ${Math.round(refreshInterval / 1000 / 60)} minutes`);
  }

  // Initialize Google APIs with immediate data fetching
  async initializeGoogleAPIs() {
    if (!this.googleAccessToken) {
      console.warn('🔧 ⚠️ No Google access token available for API initialization');
      return;
    }

    try {
      console.log('🔧 Initializing Google API client...');
      this.googleAPI = new GoogleAPIClient(this);
      console.log('🔧 ✅ Google API client initialized');
      
      // Test API access first
      setTimeout(async () => {
        try {
          console.log('🧪 Testing Google API access...');
          const testResults = await this.googleAPI.testAccess();
          console.log('🧪 ✅ Google API access test results:', testResults);
          
          // If calendar access is available, start fetching data
          if (testResults.calendar) {
            console.log('📅 🚀 Starting initial calendar data fetch...');
            await this.refreshCalendarData();
          }
          
          // If photos access is available, start fetching data
          if (testResults.photos) {
            console.log('📸 🚀 Starting initial photos data fetch...');
            await this.refreshPhotosData();
          }
          
          // Send capabilities to widgets (for backward compatibility)
          this.notifyAllWidgets(testResults);
          
        } catch (error) {
          console.warn('🧪 ❌ Google API access test failed:', error);
          this.notifyAllWidgets({ 
            calendar: false, 
            photos: false, 
            errors: [error.message],
            tokenStatus: 'error'
          });
        }
      }, 1000);
      
    } catch (error) {
      console.error('🔧 ❌ Failed to initialize Google API client:', error);
    }
  }

  // Send postMessage to ALL widget iframes (existing method - kept for compatibility)
  notifyAllWidgets(testResults) {
    const allWidgetIframes = document.querySelectorAll('.widget iframe, .widget-iframe');
    
    console.log(`📡 🖼️ Found ${allWidgetIframes.length} widget iframe(s) to notify`);
    
    if (allWidgetIframes.length === 0) {
      console.warn('📡 ⚠️ No widget iframes found - they may not be loaded yet');
      setTimeout(() => {
        const retryIframes = document.querySelectorAll('.widget iframe, .widget-iframe');
        if (retryIframes.length > 0) {
          console.log(`📡 🔄 Retry found ${retryIframes.length} widget iframe(s)`);
          this.sendGoogleAPIReadyMessage(retryIframes, testResults);
        }
      }, 2000);
    } else {
      this.sendGoogleAPIReadyMessage(allWidgetIframes, testResults);
    }
  }

  // Helper method to send the actual postMessage (existing method - kept for compatibility)
  sendGoogleAPIReadyMessage(iframes, testResults) {
    iframes.forEach((iframe, index) => {
      if (iframe.contentWindow) {
        try {
          // Only send cloneable data - no Promise objects or functions
          const message = {
            type: 'google-apis-ready',
            apiCapabilities: testResults,
            timestamp: Date.now(),
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

  // Existing auth methods continue...
  checkNativeUser() {
    if (this.nativeAuth) {
      const userData = this.nativeAuth.getCurrentUser();
      if (userData) {
        this.setUserFromAuth(userData, 'native');
        this.ui.showSignedInState();
        console.log('🔐 Found native user:', this.currentUser.name);
        return;
      }
    }
    
    this.ui.showSignInPrompt(() => this.signIn(), () => this.exitApp());
  }

  handleNativeAuthResult(result) {
    console.log('🔐 Native auth result received:', result);
    
    if (result.success && result.user) {
      this.setUserFromAuth(result.user, 'native', result.tokens);
      this.isSignedIn = true;
      this.storage.saveUser(this.currentUser);
      this.ui.showSignedInState();
      console.log('🔐 ✅ Native auth successful:', this.currentUser.name);
    } else {
      console.error('🔐 ❌ Native auth failed:', result.error);
      this.nativeAuthFailed = true;
      
      if (this.isFireTV) {
        console.log('🔥 Native auth failed on Fire TV, switching to Device Flow...');
        this.startDeviceFlow();
      } else if (result.error && result.error !== 'Sign-in was cancelled') {
        this.ui.showAuthError(result.error || 'Native authentication failed');
      }
    }
  }

  async startDeviceFlow() {
    try {
      console.log('🔥 Starting Device Flow authentication...');
      
      this.ui.hideSignInPrompt();
      
      const result = await this.deviceFlowAuth.startDeviceFlow();
      
      if (result.success && result.user) {
        this.setUserFromAuth(result.user, 'device_flow', result.tokens);
        this.isSignedIn = true;
        this.storage.saveUser(this.currentUser);
        this.ui.showSignedInState();
        console.log('🔥 ✅ Device Flow successful:', this.currentUser.name);
      } else {
        throw new Error('Device Flow was cancelled or failed');
      }
      
    } catch (error) {
      console.error('🔥 Device Flow failed:', error);
      this.ui.showAuthError(`Authentication failed: ${error.message}. Please try again.`);
    }
  }

  handleWebAuthResult(result) {
    console.log('🔐 Web auth result received:', result);
    
    if (result.success && result.user) {
      this.setUserFromAuth(result.user, 'web', result.tokens);
      this.isSignedIn = true;
      this.storage.saveUser(this.currentUser);
      
      console.log('🔐 🎯 Hiding sign-in UI and showing dashboard...');
      this.ui.hideSignInPrompt();
      this.ui.showSignedInState();
      
      console.log('🔐 ✅ Web auth successful:', this.currentUser.name);
    } else {
      console.error('🔐 ❌ Web auth failed:', result.error);
      this.ui.showAuthError(result.error || 'Web authentication failed');
    }
  }
  
  async setUserFromAuth(userData, authMethod, tokens = null) {
    let googleAccessToken = null;
    
    if (tokens && tokens.access_token) {
      googleAccessToken = tokens.access_token;
      console.log('🔐 ✅ Found Google access token from tokens object (', authMethod, ')');
    } else if (userData.googleAccessToken) {
      googleAccessToken = userData.googleAccessToken;
      console.log('🔐 ✅ Found Google access token from user data (', authMethod, ')');
    } else if (authMethod === 'web' && this.webAuth?.accessToken) {
      googleAccessToken = this.webAuth.accessToken;
      console.log('🔐 ✅ Found Google access token from web auth (', authMethod, ')');
    } else {
      console.warn('🔐 ⚠️ No Google access token found for', authMethod);
    }

    this.currentUser = {
      id: userData.id,
      name: userData.name,
      email: userData.email,
      picture: userData.picture,
      signedInAt: Date.now(),
      authMethod: authMethod,
      googleAccessToken: googleAccessToken
    };

    this.googleAccessToken = googleAccessToken;

    if (this.googleAccessToken) {
      await this.initializeGoogleAPIs();
    }

    document.dispatchEvent(new CustomEvent('dashie-auth-ready'));
  }
  
  createWebViewUser() {
    console.log('🔐 Creating WebView user');
    
    this.currentUser = {
      id: 'webview-user-' + Date.now(),
      name: 'Dashie User',
      email: 'user@dashie.app',
      picture: 'icons/icon-profile-round.svg',
      signedInAt: Date.now(),
      authMethod: 'webview'
    };
    
    this.isSignedIn = true;
    this.storage.saveUser(this.currentUser);
    this.ui.showSignedInState();
    
    console.log('🔐 WebView user created:', this.currentUser.name);
  }

  async signIn() {
    console.log('🔐 Starting sign-in process...');
    
    if (this.isFireTV) {
      if (this.hasNativeAuth && !this.nativeAuthFailed) {
        console.log('🔥 Fire TV: Trying native auth first...');
        this.nativeAuth.signIn();
        
        setTimeout(() => {
          if (!this.isSignedIn && !this.nativeAuthFailed) {
            console.log('🔥 Native auth timeout, switching to Device Flow...');
            this.nativeAuthFailed = true;
            this.startDeviceFlow();
          }
        }, 3000);
      } else {
        console.log('🔥 Fire TV: Using Device Flow directly...');
        this.startDeviceFlow();
      }
      
    } else if (this.hasNativeAuth && this.nativeAuth) {
      console.log('🔐 Using native sign-in');
      this.nativeAuth.signIn();
      
    } else if (this.webAuth) {
      console.log('🔐 Using web sign-in');
      try {
        await this.webAuth.signIn();
      } catch (error) {
        console.error('🔐 Web sign-in failed:', error);
        this.ui.showAuthError('Sign-in failed. Please try again.');
      }
    } else {
      this.ui.showAuthError('No authentication method available.');
    }
  }

  getGoogleAccessToken() {
    return this.googleAccessToken;
  }

  signOut() {
    console.log('🔐 Signing out...');
    
    // Clear refresh timers
    Object.values(this.refreshTimers).forEach(timer => clearTimeout(timer));
    this.refreshTimers = {};
    
    // Clear data cache
    this.dataCache = {
      calendar: { events: [], calendars: [], lastUpdated: null, refreshInterval: 5 * 60 * 1000, isLoading: false },
      photos: { albums: [], recentPhotos: [], lastUpdated: null, refreshInterval: 30 * 60 * 1000, isLoading: false }
    };
    
    if (this.hasNativeAuth && this.nativeAuth) {
      this.nativeAuth.signOut();
    }
    
    if (this.webAuth) {
      this.webAuth.signOut();
    }
    
    this.currentUser = null;
    this.isSignedIn = false;
    this.nativeAuthFailed = false;
    this.googleAccessToken = null;
    this.googleAPI = null;
    this.storage.clearSavedUser();
    
    if (this.isWebView && !this.hasNativeAuth) {
      this.ui.showWebViewAuthPrompt(() => this.createWebViewUser(), () => this.exitApp());
    } else {
      this.ui.showSignInPrompt(() => this.signIn(), () => this.exitApp());
    }
  }

  exitApp() {
    console.log('🚪 Exiting Dashie...');
    
    if (this.hasNativeAuth && window.DashieNative?.exitApp) {
      window.DashieNative.exitApp();
    } else if (window.close) {
      window.close();
    } else {
      window.location.href = 'about:blank';
    }
  }

  handleAuthFailure(error) {
    console.error('🔐 Auth initialization failed:', error);
    
    const savedUser = this.storage.getSavedUser();
    if (savedUser) {
      console.log('🔐 Using saved authentication as fallback');
      this.currentUser = savedUser;
      this.isSignedIn = true;
      this.ui.showSignedInState();
    } else {
      if (this.isFireTV) {
        console.log('🔥 Auth failure on Fire TV, trying Device Flow...');
        this.startDeviceFlow();
      } else if (this.isWebView) {
        this.ui.showWebViewAuthPrompt(() => this.createWebViewUser(), () => this.exitApp());
      } else {
        this.ui.showAuthError('Authentication service is currently unavailable.', true);
      }
    }
  }
  
  // Widget data request handler (for backward compatibility)
  async handleWidgetDataRequest(requestData, sourceWindow) {
    console.log('📡 📨 Received widget data request:', requestData);
    
    try {
      let response = { 
        type: 'widget-data-response',
        requestId: requestData.requestId,
        success: false,
        timestamp: Date.now()
      };
      
      const { dataType, requestType, params } = requestData;
      
      if (dataType === 'calendar') {
        response = await this.handleCalendarRequest(requestType, params, response);
      } else if (dataType === 'photos') {
        response = await this.handlePhotosRequest(requestType, params, response);
      } else {
        response.error = 'Unknown data type requested';
      }
      
      sourceWindow.postMessage(response, '*');
      console.log('📡 ✅ Widget data response sent');
      
    } catch (error) {
      console.error('📡 ❌ Widget data request failed:', error);
      sourceWindow.postMessage({
        type: 'widget-data-response',
        requestId: requestData.requestId,
        success: false,
        error: error.message,
        timestamp: Date.now()
      }, '*');
    }
  }

  async handleCalendarRequest(requestType, params, response) {
    if (!this.googleAPI) {
      throw new Error('Google APIs not initialized');
    }
    
    switch (requestType) {
      case 'events':
        // Fetch both events and calendar metadata for color information
        const [events, calendarList] = await Promise.all([
          this.googleAPI.getAllCalendarEvents(params?.timeRange),
          this.googleAPI.getCalendarList()
        ]);
        
        response.success = true;
        response.data = events;
        response.calendars = calendarList; // Include calendar metadata with colors
        break;
        
      case 'calendars':
        const calendars = await this.googleAPI.getCalendarList();
        response.success = true;
        response.data = calendars;
        break;
        
      default:
        throw new Error(`Unknown calendar request type: ${requestType}`);
    }
    
    return response;
  }
  
  async handlePhotosRequest(requestType, params, response) {
    if (!this.googleAPI) {
      throw new Error('Google APIs not initialized');
    }
    
    switch (requestType) {
      case 'albums':
        const albums = await this.googleAPI.getPhotoAlbums();
        response.success = true;
        response.data = albums;
        break;
        
      case 'recent':
        const photos = await this.googleAPI.getRecentPhotos(params?.count || 10);
        response.success = true;
        response.data = photos;
        break;
        
      default:
        throw new Error(`Unknown photos request type: ${requestType}`);
    }
    
    return response;
  }

  // Public API
  getUser() {
    return this.currentUser;
  }

  isAuthenticated() {
    return this.isSignedIn && this.currentUser !== null;
  }

  // Public methods for manual data refresh
  async refreshData(dataType = 'all') {
    if (dataType === 'all' || dataType === 'calendar') {
      await this.refreshCalendarData(true);
    }
    if (dataType === 'all' || dataType === 'photos') {
      await this.refreshPhotosData(true);
    }
  }

  // Get cached data
  getCachedData(dataType) {
    if (dataType === 'calendar') {
      return {
        ...this.dataCache.calendar,
        isStale: this.isDataStale('calendar')
      };
    } else if (dataType === 'photos') {
      return {
        ...this.dataCache.photos,
        isStale: this.isDataStale('photos')
      };
    }
    return null;
  }

  // Check if data is stale
  isDataStale(dataType) {
    const cacheData = this.dataCache[dataType];
    if (!cacheData.lastUpdated) return true;
    
    const now = Date.now();
    return (now - cacheData.lastUpdated) > cacheData.refreshInterval;
  }
}
