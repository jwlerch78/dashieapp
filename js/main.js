// js/main.js
// CHANGE SUMMARY: Added comprehensive startup orchestration with dependency validation gates to prevent premature data loading

import { initializeEvents } from './core/events.js';
import { updateFocus, initializeHighlightTimeout } from './core/navigation.js';
import { renderGrid, renderSidebar } from './ui/grid.js';
import { autoInitialize } from './settings/settings-main.js';
import { initializeJWTService } from './apis/api-auth/jwt-token-operations.js';
import { processPendingRefreshTokens } from './apis/api-auth/providers/web-oauth.js';
import { PhotoUploadManager } from '../widgets/photos/photo-upload-manager.js';
import { showLoadingOverlay, updateLoadingProgress, hideLoadingOverlay, isLoadingOverlayVisible } from './ui/loading-overlay.js';

// Initialization state tracker
const initState = {
  auth: 'pending',
  jwt: 'pending',
  tokens: 'pending',
  settings: 'pending',
  widgets: 'pending',
  servicesReady: 'pending' // NEW: Track overall service readiness
};

// Global photo upload manager instance
let photoUploadManager = null;

/**
 * Wait for authentication to complete before proceeding
 * FIXED: No timeout - device flow can take minutes to complete
 * Does NOT show loading overlay - that happens after auth completes
 */
async function waitForAuthentication() {
  const checkInterval = 500; // Check every 500ms
  let elapsedSeconds = 0;
  
  console.log('🔐 Waiting for authentication to complete...');
  initState.auth = 'pending';

  while (true) {
    const authSystem = window.dashieAuth || window.authManager;
    
    if (authSystem && authSystem.isAuthenticated && authSystem.isAuthenticated()) {
      const hasGoogleToken = authSystem.getGoogleAccessToken && authSystem.getGoogleAccessToken();
      
      if (hasGoogleToken) {
        console.log('✅ Authentication complete with Google token');
        initState.auth = 'ready';
        return true;
      }
    }
    
    // Log progress every 60 seconds (no UI update - device flow has its own UI)
    if (elapsedSeconds % 60 === 0 && elapsedSeconds > 0) {
      const minutes = Math.floor(elapsedSeconds / 60);
      const timeStr = minutes > 1 ? `${minutes} minutes` : `${minutes} minute`;
      console.log(`⏳ Still waiting for authentication (${timeStr} elapsed)...`);
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    elapsedSeconds += checkInterval / 1000;
  }
}

/**
 * NEW: Comprehensive service readiness validation
 * Ensures all dependencies are ready before attempting data load
 * @returns {Promise<boolean>} True if all services ready, false otherwise
 */
async function ensureServicesReady() {
  console.log('🔍 Validating service readiness before data load...');
  updateLoadingProgress(90, 'Validating services...');
  
  const checks = {
    auth: false,
    jwt: false,
    token: false,
    dataManager: false
  };
  
  try {
    // Check 1: Auth system ready
    const authSystem = window.dashieAuth || window.authManager;
    if (!authSystem || !authSystem.isAuthenticated()) {
      console.error('❌ Auth system not authenticated');
      return false;
    }
    checks.auth = true;
    console.log('✅ Auth system ready');
    
    // Check 2: JWT service ready (with wait)
    if (!window.jwtAuth || !window.jwtAuth.isServiceReady()) {
      console.warn('⚠️ JWT service not immediately ready, waiting up to 10 seconds...');
      
      const startTime = Date.now();
      const timeout = 10000; // 10 seconds
      
      while (Date.now() - startTime < timeout) {
        if (window.jwtAuth?.isServiceReady()) {
          console.log('✅ JWT service became ready');
          checks.jwt = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (!checks.jwt) {
        console.error('❌ JWT service failed to become ready after 10 seconds');
        initState.servicesReady = 'failed';
        return false;
      }
    } else {
      checks.jwt = true;
      console.log('✅ JWT service ready');
    }
    
    // Check 3: Valid token available
    console.log('🔑 Validating token availability...');
    try {
      const tokenResult = await window.jwtAuth.getValidToken('google', 'personal');
      
      if (!tokenResult) {
        throw new Error('JWT service returned null/undefined');
      }
      
      if (!tokenResult.success) {
        throw new Error(`JWT service reported failure: ${tokenResult.error || 'Unknown error'}`);
      }
      
      if (!tokenResult.access_token) {
        throw new Error('No access_token in successful response');
      }
      
      checks.token = true;
      console.log('✅ Valid token confirmed', {
        tokenEnding: tokenResult.access_token.slice(-10),
        refreshed: tokenResult.refreshed
      });
      
    } catch (error) {
      console.error('❌ Token validation failed:', error.message);
      initState.servicesReady = 'failed';
      return false;
    }
    
    // Check 4: DataManager initialized
    if (!window.dataManager) {
      console.error('❌ DataManager not initialized');
      initState.servicesReady = 'failed';
      return false;
    }
    checks.dataManager = true;
    console.log('✅ DataManager ready');
    
    // All checks passed
    console.log('🎯 All service readiness checks passed:', checks);
    initState.servicesReady = 'ready';
    return true;
    
  } catch (error) {
    console.error('❌ Service readiness validation failed:', error);
    initState.servicesReady = 'failed';
    return false;
  }
}

/**
 * Process queued refresh tokens with proper error handling
 */
async function processQueuedRefreshTokens() {
  console.log('🔄 Processing queued refresh tokens...');
  
  try {
    if (!window.pendingRefreshTokens || window.pendingRefreshTokens.length === 0) {
      console.log('⏭️ No pending refresh tokens to process');
      initState.tokens = 'skipped';
      return false;
    }
    
    const results = await processPendingRefreshTokens();
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    if (successful > 0) {
      console.log(`✅ Processed ${successful} refresh token(s) successfully`);
      initState.tokens = 'ready';
      return true;
    } else if (failed > 0) {
      console.error(`❌ Failed to process ${failed} refresh token(s)`);
      initState.tokens = 'failed';
      return false;
    }
    
    initState.tokens = 'skipped';
    return false;
    
  } catch (error) {
    console.error('❌ Refresh token processing error:', error);
    initState.tokens = 'failed';
    return false;
  }
}

/**
 * Initialize Photo Upload Manager
 * Called after data manager and JWT are ready
 */
function initializePhotoUploadManager() {
  try {
    if (window.dataManager?.photoService?.isReady()) {
      photoUploadManager = new PhotoUploadManager(window.dataManager.photoService);
      window.photoUploadManager = photoUploadManager;
      console.log('📸 Photo upload manager initialized');
      return true;
    } else {
      console.warn('⚠️ Photo service not ready, upload manager not initialized');
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to initialize photo upload manager:', error);
    return false;
  }
}

/**
 * Main initialization sequence
 */
async function initializeApp() {
  console.log('🚀 Starting Dashie initialization sequence...');
  
  // Initialize events and navigation
  initializeEvents();
  initializeHighlightTimeout();
  
  // Render UI immediately (auth handles visibility)
  renderGrid();
  renderSidebar();
  updateFocus(0, 0);
  
  console.log('✅ UI rendered, waiting for authentication...');
  
  // Wait for authentication without timeout (device flow needs time)
  // Device flow shows its own UI, so no loading overlay yet
  const authSuccessful = await waitForAuthentication();
  
  if (!authSuccessful) {
    // This should never happen now since we removed the timeout
    console.error('❌ Authentication failed unexpectedly');
    return;
  }
  
  // Show loading overlay AFTER authentication completes
  showLoadingOverlay();
  updateLoadingProgress(10, 'Authentication complete');
  
  // Initialize JWT service
  console.log('🔐 Initializing JWT service after authentication...');
  updateLoadingProgress(25, 'Establishing secure connection...');
  
  try {
    const jwtReady = await initializeJWTService();
    
    if (jwtReady) {
      console.log('✅ JWT service ready - RLS mode available');
      initState.jwt = 'ready';
      updateLoadingProgress(40, 'Secure connection established');
      
      // Initialize SimpleAuth services now that JWT is ready
      if (window.dashieAuth && window.dashieAuth.authenticated) {
        console.log('🔧 Initializing services now that JWT is ready...');
        updateLoadingProgress(45, 'Initializing services...');
        
        try {
          await window.dashieAuth.initializeServices();
          console.log('✅ Services initialized with valid JWT token');
          updateLoadingProgress(50, 'Services ready');
        } catch (error) {
          console.error('❌ Failed to initialize services:', error);
          updateLoadingProgress(50, 'Service initialization failed');
          // Don't continue - services must be initialized
          initState.servicesReady = 'failed';
          
          // Show error to user
          updateLoadingProgress(100, 'Initialization failed - please refresh');
          await new Promise(resolve => setTimeout(resolve, 3000));
          hideLoadingOverlay();
          return;
        }
      }
    } else {
      console.warn('⚠️ JWT service not ready - will use direct mode');
      initState.jwt = 'failed';
      updateLoadingProgress(40, 'Secure connection unavailable');
    }
  } catch (error) {
    console.error('❌ JWT service initialization failed:', error);
    initState.jwt = 'failed';
    updateLoadingProgress(40, 'Secure connection failed');
  }
  
  // Process refresh tokens if JWT is ready
  updateLoadingProgress(52, 'Processing tokens...');
  
  if (initState.jwt === 'ready') {
    updateLoadingProgress(55, 'Processing refresh tokens...');
    const tokensProcessed = await processQueuedRefreshTokens();
    
    if (tokensProcessed && initState.tokens === 'ready') {
      updateLoadingProgress(60, 'Refresh tokens stored successfully');
    } else if (initState.tokens === 'skipped') {
      updateLoadingProgress(60, 'No refresh tokens to process');
    } else {
      updateLoadingProgress(60, 'Refresh token processing failed');
    }
  } else {
    console.log('⏭️ Skipping refresh token processing (JWT not ready)');
    initState.tokens = 'skipped';
    updateLoadingProgress(60, 'Skipping token processing');
  }
  
  // Initialize settings system
  console.log(`⚙️ Initializing settings system with JWT status: ${initState.jwt}`);
  updateLoadingProgress(65, 'Loading your settings...');
  
  try {
    await autoInitialize(initState.jwt);
    console.log('✅ Settings system ready');
    initState.settings = 'ready';
    updateLoadingProgress(75, 'Settings loaded successfully');
  } catch (error) {
    console.error('❌ Settings system failed:', error);
    initState.settings = 'degraded';
    updateLoadingProgress(75, 'Settings degraded');
  }
  
  // Initialize theme system
  console.log('🎨 Initializing theme system...');
  updateLoadingProgress(80, 'Applying your theme...');
  
  // Wait for widgets to register before triggering data
  console.log('🎨 Waiting for widgets to register...');
  updateLoadingProgress(85, 'Preparing widgets...');
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // NEW: Validate all services are ready before data loading
  updateLoadingProgress(90, 'Validating services...');
  console.log('🔍 Ensuring all services ready before data load...');
  
  const servicesReady = await ensureServicesReady();
  
  if (!servicesReady) {
    console.error('❌ Service readiness validation failed - cannot proceed with data loading');
    updateLoadingProgress(100, 'Initialization incomplete - some features may not work');
    await new Promise(resolve => setTimeout(resolve, 3000));
    hideLoadingOverlay();
    
    // Still mark as authenticated so UI is visible, but with degraded functionality
    document.body.classList.add('authenticated');
    console.log('⚠️ App started in degraded mode');
    return;
  }
  
  // Services are ready - proceed with data loading
  updateLoadingProgress(92, 'Loading your data...');
  console.log('📊 All services validated - triggering data loading...');
  
  try {
    await window.dashieAuth.triggerDataLoading();
    console.log('✅ Data loading completed successfully');
  } catch (error) {
    console.error('❌ Data loading failed:', error);
    // Continue anyway - user can manually refresh
  }
  
  // Initialize Photo Upload Manager AFTER data manager is ready
  initializePhotoUploadManager();
  
  // Complete initialization
  const loadingMessage = initState.tokens === 'ready' 
    ? 'Welcome to Dashie! (Long-term access enabled)'
    : 'Welcome to Dashie!';
    
  updateLoadingProgress(100, loadingMessage);
  
  await new Promise(resolve => setTimeout(resolve, 500));
  hideLoadingOverlay();
  
  initState.widgets = 'ready';
  
  console.log('🎯 Dashie initialization complete:', {
    auth: initState.auth,
    jwt: initState.jwt,
    tokens: initState.tokens,
    settings: initState.settings,
    servicesReady: initState.servicesReady,
    widgets: initState.widgets
  });
  
  // Mark app as authenticated for CSS styling
  document.body.classList.add('authenticated');
  console.log('🔐 App marked as authenticated');
}

// Listen for upload modal requests from widgets
window.addEventListener('message', (event) => {
  if (event.data?.type === 'request-upload-modal') {
    console.log('📸 Upload modal requested by widget:', event.data.widget);
    
    if (photoUploadManager) {
      photoUploadManager.open();
    } else {
      console.error('❌ Photo upload manager not initialized');
    }
  }
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}