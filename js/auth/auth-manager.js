// js/auth/auth-manager.js
// CHANGE SUMMARY: Fixed widget postMessage error by removing non-cloneable objects from message

import { CognitoAuth } from './cognito-auth.js';
import { AuthUI } from './auth-ui.js';
import { AuthStorage } from './auth-storage.js';
import { GoogleAPIClient } from '../google-apis/google-api-client.js';
import { PickerSessionManager } from '../google-apis/picker-session-manager.js';


export class AuthManager {
  constructor() {
    this.currentUser = null;
    this.isSignedIn = false;
    this.googleAccessToken = null;
    this.googleAPI = null;
    this.pickerSessionManager = null;

    
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
      picture: userData.picture,
      firstname: userData.given_name,
      lastname: userData.family_name,
      id: userData.id,
      hasGoogleToken: !!this.googleAccessToken
    });
    
    // Save to legacy storage for compatibility
    this.storage.saveUser(userData);
  }

  async signIn() {
    try {
      console.log('🔐 Starting Cognito sign-in...');
      this.ui.hideSignInPrompt();
      
      // This will redirect to Google OAuth
      await this.cognitoAuth.signIn();
      
    } catch (error) {
      console.error('🔐 ❌ Sign-in failed:', error);
      this.ui.showAuthError('Sign-in failed. Please try again.');
    }
  }

 // Updated cleanup method
async signOut() {
  console.log('Signing out...');
  
  try {
    // Clear refresh timers
    Object.values(this.refreshTimers).forEach(timer => clearTimeout(timer));
    this.refreshTimers = {};
    
    // Clear data cache
    this.dataCache = {
      calendar: { events: [], calendars: [], lastUpdated: null, refreshInterval: 5 * 60 * 1000, isLoading: false },
      photos: { albums: [], recentPhotos: [], lastUpdated: null, refreshInterval: 30 * 60 * 1000, isLoading: false }
    };
    
    // Cleanup picker session manager
    if (this.pickerSessionManager) {
      this.pickerSessionManager.cleanup();
      this.pickerSessionManager = null;
    }
    
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
    console.error('Sign-out failed:', error);
    // Still clear local state even if remote sign-out fails
    this.currentUser = null;
    this.isSignedIn = false;
    this.googleAccessToken = null;
    this.googleAPI = null;
    if (this.pickerSessionManager) {
      this.pickerSessionManager.cleanup();
      this.pickerSessionManager = null;
    }
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

  // NEW: Method for token refresh (uses Cognito's built-in refresh)
  async refreshGoogleAccessToken() {
    try {
      console.log('🔄 Refreshing Google access token via Cognito...');
      const success = await this.cognitoAuth.refreshSession();
      
      if (success && this.cognitoAuth.getGoogleAccessToken()) {
        this.googleAccessToken = this.cognitoAuth.getGoogleAccessToken();
        
        // Update current user object
        if (this.currentUser) {
          this.currentUser.googleAccessToken = this.googleAccessToken;
          this.storage.saveUser(this.currentUser);
        }
        
        console.log('🔄 ✅ Google access token refreshed successfully');
        return this.googleAccessToken;
      } else {
        throw new Error('Cognito session refresh failed');
      }
    } catch (error) {
      console.error('🔄 ❌ Google access token refresh failed:', error);
      throw error;
    }
  }

  // Google APIs initialization (updated for Cognito)
async initializeGoogleAPIs() {
  if (!this.googleAccessToken) {
    console.warn('No Google access token available for API initialization');
    return;
  }

  try {
    // Initialize Google API client (for Calendar)
    this.googleAPI = new GoogleAPIClient(this);
    
    // Initialize Picker Session Manager (for Photos)
    this.pickerSessionManager = new PickerSessionManager(this);
    
    // Set up picker callbacks
    this.pickerSessionManager.setCallbacks({
      onSessionCreated: (session) => {
        console.log('Picker session created, notifying widgets...');
        this.notifyWidgetsOfPickerSession(session);
      },
      onPhotosSelected: (photos) => {
        console.log(`Photos selected (${photos.length}), updating widgets...`);
        this.notifyWidgetsOfPhotosUpdate(photos);
      },
      onSelectionComplete: (result) => {
        console.log('Album selection complete, refreshing photo widgets...');
        this.notifyWidgetsOfSelectionComplete(result);
      },
      onError: (error) => {
        console.error('Picker session error:', error);
        this.notifyWidgetsOfPickerError(error);
      }
    });
    
    // Test API access
    const testResults = await this.googleAPI.testAccess();
    const pickerTest = await this.pickerSessionManager.testAccess();
    
    // Combine test results
    const combinedResults = {
      ...testResults,
      picker: pickerTest.success,
      photos: pickerTest.success // For compatibility
    };
    
    console.log('Google APIs initialized:', combinedResults);
    
    // Notify widgets
    this.notifyWidgetsOfAPIReadiness(combinedResults);
    
  } catch (error) {
    console.error('Google APIs initialization failed:', error);
    this.notifyWidgetsOfAPIReadiness({ calendar: false, photos: false, picker: false });
  }
}

  // Widget communication methods (unchanged from original)
  setupWidgetRequestHandler() {
    
    window.addEventListener('message', (event) => {
        console.log('🔗 📨 PostMessages received:', {
            type: event.data?.type,
            origin: event.origin,
            data: event.data
          });
      
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
          // FIXED: Only send cloneable data - no Promise objects or functions
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
        const events = await this.googleAPI.getAllCalendarEvents(params?.timeRange);
        response.success = true;
        response.data = events;
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
  if (!this.pickerSessionManager) {
    throw new Error('Picker Session Manager not initialized');
  }
  
  console.log(`Handling photos request: ${requestType}`, params);
  
  switch (requestType) {
    case 'status':
      // Get current session and photo status
      const sessionInfo = this.pickerSessionManager.getSessionInfo();
      const sessionStatus = await this.pickerSessionManager.checkSessionStatus();
      
      response.success = true;
      response.data = {
        ...sessionInfo,
        currentStatus: sessionStatus.status,
        hasPhotos: sessionStatus.hasPhotos,
        photoCount: sessionStatus.photoCount || sessionInfo.photoCount
      };
      console.log(`Photos status: ${sessionStatus.status}, photos: ${sessionStatus.hasPhotos}`);
      break;
      
    case 'get-photos':
      // Get current photos for display
      if (this.pickerSessionManager.hasPhotos()) {
        const photos = this.pickerSessionManager.getPhotos();
        response.success = true;
        response.data = photos;
        console.log(`Retrieved ${photos.length} photos for display`);
      } else {
        response.success = false;
        response.error = 'No photos selected. User needs to select an album first.';
        response.needsSelection = true;
      }
      break;
      
    case 'start-selection':
      // Start new album selection flow
      const selectionResult = await this.pickerSessionManager.startAlbumSelection();
      
      if (selectionResult.success) {
        response.success = true;
        response.data = {
          sessionId: selectionResult.sessionId,
          pickerUri: selectionResult.pickerUri,
          qrCode: selectionResult.qrCode,
          message: 'Album selection session created'
        };
        console.log(`Album selection started: ${selectionResult.sessionId}`);
      } else {
        response.success = false;
        response.error = selectionResult.error;
      }
      break;
      
    case 'check-selection':
      // Check if user has completed album selection
      const checkResult = await this.pickerSessionManager.checkSessionStatus();
      
      response.success = true;
      response.data = {
        status: checkResult.status,
        hasPhotos: checkResult.hasPhotos,
        photoCount: checkResult.photoCount,
        albumInfo: checkResult.albumInfo,
        completed: checkResult.status === 'completed'
      };
      console.log(`Selection check: ${checkResult.status}`);
      break;
      
    case 'clear-selection':
      // Clear current selection and start fresh
      const clearResult = await this.pickerSessionManager.clearAndSelectNew();
      
      if (clearResult.success) {
        response.success = true;
        response.data = {
          sessionId: clearResult.sessionId,
          pickerUri: clearResult.pickerUri,
          qrCode: clearResult.qrCode,
          message: 'Previous selection cleared, new session created'
        };
        console.log('Photos cleared and new selection started');
      } else {
        response.success = false;
        response.error = clearResult.error;
      }
      break;
      
    case 'get-qr-code':
      // Get QR code for current session (if any)
      const qrCode = this.pickerSessionManager.getCurrentQRCode();
      
      if (qrCode) {
        response.success = true;
        response.data = qrCode;
      } else {
        response.success = false;
        response.error = 'No active selection session';
      }
      break;
      
    case 'get-album-info':
      // Get information about selected album
      const albumInfo = this.pickerSessionManager.getAlbumInfo();
      
      response.success = true;
      response.data = albumInfo;
      break;
      
    case 'get-stats':
      // Get stats for settings/debugging
      const stats = this.pickerSessionManager.getStats();
      
      response.success = true;
      response.data = stats;
      break;
      
    default:
      throw new Error(`Unknown photos request type: ${requestType}`);
  }
  
  return response;
}
  
async initializeGoogleAPIs() {
  if (!this.googleAccessToken) {
    console.warn('No Google access token available for API initialization');
    return;
  }

  try {
    // Initialize Google API client (for Calendar)
    this.googleAPI = new GoogleAPIClient(this);
    
    // Initialize Picker Session Manager (for Photos)
    this.pickerSessionManager = new PickerSessionManager(this);
    
    // Set up picker callbacks
    this.pickerSessionManager.setCallbacks({
      onSessionCreated: (session) => {
        console.log('Picker session created, notifying widgets...');
        this.notifyWidgetsOfPickerSession(session);
      },
      onPhotosSelected: (photos) => {
        console.log(`Photos selected (${photos.length}), updating widgets...`);
        this.notifyWidgetsOfPhotosUpdate(photos);
      },
      onSelectionComplete: (result) => {
        console.log('Album selection complete, refreshing photo widgets...');
        this.notifyWidgetsOfSelectionComplete(result);
      },
      onError: (error) => {
        console.error('Picker session error:', error);
        this.notifyWidgetsOfPickerError(error);
      }
    });
    
    // Test API access
    const testResults = await this.googleAPI.testAccess();
    const pickerTest = await this.pickerSessionManager.testAccess();
    
    // Combine test results
    const combinedResults = {
      ...testResults,
      picker: pickerTest.success,
      photos: pickerTest.success // For compatibility
    };
    
    console.log('Google APIs initialized:', combinedResults);
    
    // Notify widgets
    this.notifyWidgetsOfAPIReadiness(combinedResults);
    
  } catch (error) {
    console.error('Google APIs initialization failed:', error);
    this.notifyWidgetsOfAPIReadiness({ calendar: false, photos: false, picker: false });
  }
}

// Notify widgets when picker session is created
notifyWidgetsOfPickerSession(session) {
  const allWidgetIframes = document.querySelectorAll('.widget-iframe, .widget iframe');
  
  allWidgetIframes.forEach((iframe) => {
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({
          type: 'picker-session-created',
          sessionId: session.sessionId,
          pickerUri: session.pickerUri,
          qrCode: this.pickerSessionManager.getCurrentQRCode(),
          timestamp: Date.now()
        }, '*');
      } catch (error) {
        console.error('Failed to notify widget of picker session:', error);
      }
    }
  });
}

// Notify widgets when photos are updated
notifyWidgetsOfPhotosUpdate(photos) {
  const allWidgetIframes = document.querySelectorAll('.widget-iframe, .widget iframe');
  
  allWidgetIframes.forEach((iframe) => {
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({
          type: 'photos-updated',
          photos: photos,
          photoCount: photos.length,
          timestamp: Date.now()
        }, '*');
      } catch (error) {
        console.error('Failed to notify widget of photos update:', error);
      }
    }
  });
}

// Notify widgets when selection is complete
notifyWidgetsOfSelectionComplete(result) {
  const allWidgetIframes = document.querySelectorAll('.widget-iframe, .widget iframe');
  
  allWidgetIframes.forEach((iframe) => {
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({
          type: 'selection-complete',
          photos: result.photos,
          albumInfo: result.albumInfo,
          photoCount: result.photos.length,
          timestamp: Date.now()
        }, '*');
      } catch (error) {
        console.error('Failed to notify widget of selection complete:', error);
      }
    }
  });
}

// Notify widgets of picker errors
notifyWidgetsOfPickerError(error) {
  const allWidgetIframes = document.querySelectorAll('.widget-iframe, .widget iframe');
  
  allWidgetIframes.forEach((iframe) => {
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({
          type: 'picker-error',
          error: error.message,
          timestamp: Date.now()
        }, '*');
      } catch (error) {
        console.error('Failed to notify widget of picker error:', error);
      }
    }
  });
}
