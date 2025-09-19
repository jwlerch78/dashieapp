// js/google-apis/picker-session-manager.js
// CHANGE SUMMARY: Manages picker sessions, photo storage, and state persistence for dashboard photos

import { GooglePhotosPickerClient } from './google-picker-client.js';

// ==================== SESSION STORAGE KEYS ====================

const STORAGE_KEYS = {
  currentSession: 'dashie-picker-current-session',
  selectedPhotos: 'dashie-picker-selected-photos',
  albumInfo: 'dashie-picker-album-info',
  lastSelection: 'dashie-picker-last-selection',
  sessionHistory: 'dashie-picker-session-history'
};

// ==================== PICKER SESSION MANAGER ====================

export class PickerSessionManager {
  constructor(authManager) {
    this.authManager = authManager;
    this.pickerClient = new GooglePhotosPickerClient(authManager);
    
    // Current session state
    this.currentSession = null;
    this.selectedPhotos = [];
    this.albumInfo = null;
    
    // Event callbacks
    this.onSessionCreated = null;
    this.onPhotosSelected = null;
    this.onSelectionComplete = null;
    this.onError = null;
    
    // Load existing state
    this.loadState();
  }

  // ==================== STATE MANAGEMENT ====================

  // Load state from localStorage
  loadState() {
    try {
      // Load current session
      const sessionData = localStorage.getItem(STORAGE_KEYS.currentSession);
      if (sessionData) {
        this.currentSession = JSON.parse(sessionData);
      }
      
      // Load selected photos
      const photosData = localStorage.getItem(STORAGE_KEYS.selectedPhotos);
      if (photosData) {
        this.selectedPhotos = JSON.parse(photosData);
      }
      
      // Load album info
      const albumData = localStorage.getItem(STORAGE_KEYS.albumInfo);
      if (albumData) {
        this.albumInfo = JSON.parse(albumData);
      }
      
      console.log('📸 Session manager state loaded:', {
        hasSession: !!this.currentSession,
        photosCount: this.selectedPhotos.length,
        hasAlbumInfo: !!this.albumInfo
      });
      
    } catch (error) {
      console.error('📸 Failed to load session state:', error);
      this.clearState();
    }
  }

  // Save state to localStorage
  saveState() {
    try {
      if (this.currentSession) {
        localStorage.setItem(STORAGE_KEYS.currentSession, JSON.stringify(this.currentSession));
      }
      
      if (this.selectedPhotos.length > 0) {
        localStorage.setItem(STORAGE_KEYS.selectedPhotos, JSON.stringify(this.selectedPhotos));
      }
      
      if (this.albumInfo) {
        localStorage.setItem(STORAGE_KEYS.albumInfo, JSON.stringify(this.albumInfo));
      }
      
      // Save timestamp of last selection
      localStorage.setItem(STORAGE_KEYS.lastSelection, new Date().toISOString());
      
    } catch (error) {
      console.error('📸 Failed to save session state:', error);
    }
  }

  // Clear all stored state
  clearState() {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
    
    this.currentSession = null;
    this.selectedPhotos = [];
    this.albumInfo = null;
    
    console.log('📸 Session state cleared');
  }

  // ==================== SESSION METHODS ====================

  // Check if we have photos ready to display
  hasPhotos() {
    return this.selectedPhotos.length > 0;
  }

  // Get current photos for display
  getPhotos() {
    return this.selectedPhotos.map(photo => ({
      ...photo,
      displayUrl: this.pickerClient.getDisplayPhotoUrl(photo.baseUrl, 800, 600)
    }));
  }

  // Get album information
  getAlbumInfo() {
    return this.albumInfo || {
      name: 'Selected Photos',
      photoCount: this.selectedPhotos.length,
      lastUpdated: localStorage.getItem(STORAGE_KEYS.lastSelection)
    };
  }

  // Start new album selection flow
  async startAlbumSelection() {
    console.log('📸 Starting new album selection...');
    
    try {
      // Clear any existing incomplete session
      if (this.currentSession && this.currentSession.status !== 'completed') {
        console.log('📸 Clearing previous incomplete session');
        this.clearState();
      }
      
      // Create new picker session
      const result = await this.pickerClient.selectAlbumFlow();
      
      if (result.success) {
        this.currentSession = {
          sessionId: result.sessionId,
          pickerUri: result.pickerUri,
          pollingToken: result.pollingToken,
          status: 'created',
          createdAt: new Date().toISOString(),
          type: 'album_selection'
        };
        
        this.saveState();
        
        // Trigger callback
        if (this.onSessionCreated) {
          this.onSessionCreated(this.currentSession);
        }
        
        console.log('📸 Album selection session created successfully');
        
        return {
          success: true,
          sessionId: this.currentSession.sessionId,
          pickerUri: this.currentSession.pickerUri,
          qrCode: this.pickerClient.generateAlbumSelectionQRCode(this.currentSession.pickerUri)
        };
        
      } else {
        throw new Error(result.error);
      }
      
    } catch (error) {
      console.error('📸 Failed to start album selection:', error);
      
      if (this.onError) {
        this.onError(error);
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Check current session status
  async checkSessionStatus() {
    if (!this.currentSession || this.currentSession.status === 'completed') {
      return {
        status: this.currentSession?.status || 'no_session',
        hasPhotos: this.hasPhotos()
      };
    }
    
    try {
      const sessionStatus = await this.pickerClient.pollSession(this.currentSession.sessionId);
      
      if (sessionStatus.mediaItemsSet) {
        console.log('📸 User completed album selection');
        
        // Get the selected photos
        const photosResult = await this.pickerClient.getSelectedPhotos(this.currentSession.sessionId);
        
        // Update state
        this.selectedPhotos = photosResult.photos;
        this.currentSession.status = 'completed';
        this.currentSession.completedAt = new Date().toISOString();
        
        // Store album info
        this.albumInfo = {
          name: 'Selected Album',
          photoCount: photosResult.totalCount,
          selectedAt: new Date().toISOString(),
          sessionId: this.currentSession.sessionId
        };
        
        this.saveState();
        
        // Trigger callbacks
        if (this.onPhotosSelected) {
          this.onPhotosSelected(this.selectedPhotos);
        }
        
        if (this.onSelectionComplete) {
          this.onSelectionComplete({
            photos: this.selectedPhotos,
            albumInfo: this.albumInfo
          });
        }
        
        return {
          status: 'completed',
          hasPhotos: true,
          photoCount: this.selectedPhotos.length,
          albumInfo: this.albumInfo
        };
      } else {
        return {
          status: 'pending',
          hasPhotos: this.hasPhotos(),
          sessionId: this.currentSession.sessionId
        };
      }
      
    } catch (error) {
      console.error('📸 Failed to check session status:', error);
      
      if (this.onError) {
        this.onError(error);
      }
      
      return {
        status: 'error',
        error: error.message,
        hasPhotos: this.hasPhotos()
      };
    }
  }

  // Start polling for session completion (for background monitoring)
  startPolling(intervalMs = 3000) {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    
    if (!this.currentSession || this.currentSession.status === 'completed') {
      return;
    }
    
    console.log('📸 Starting session polling...');
    
    this.pollingInterval = setInterval(async () => {
      const status = await this.checkSessionStatus();
      
      if (status.status === 'completed' || status.status === 'error') {
        this.stopPolling();
      }
    }, intervalMs);
  }

  // Stop polling
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('📸 Session polling stopped');
    }
  }

  // ==================== MANAGEMENT METHODS ====================

  // Clear current selection and start fresh
  async clearAndSelectNew() {
    console.log('📸 Clearing current selection and starting new...');
    
    this.stopPolling();
    this.clearState();
    
    return await this.startAlbumSelection();
  }

  // Get session info for UI display
  getSessionInfo() {
    return {
      hasActiveSession: !!this.currentSession && this.currentSession.status !== 'completed',
      hasPhotos: this.hasPhotos(),
      photoCount: this.selectedPhotos.length,
      albumInfo: this.getAlbumInfo(),
      lastSelection: localStorage.getItem(STORAGE_KEYS.lastSelection),
      currentSession: this.currentSession
    };
  }

  // Generate current QR code (if session exists)
  getCurrentQRCode() {
    if (!this.currentSession || !this.currentSession.pickerUri) {
      return null;
    }
    
    return this.pickerClient.generateAlbumSelectionQRCode(this.currentSession.pickerUri);
  }

  // Test API access
  async testAccess() {
    try {
      return await this.pickerClient.testPickerAccess();
    } catch (error) {
      console.error('📸 API test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==================== EVENT MANAGEMENT ====================

  // Set event callbacks
  setCallbacks(callbacks) {
    this.onSessionCreated = callbacks.onSessionCreated || null;
    this.onPhotosSelected = callbacks.onPhotosSelected || null;
    this.onSelectionComplete = callbacks.onSelectionComplete || null;
    this.onError = callbacks.onError || null;
  }

  // Cleanup when shutting down
  cleanup() {
    this.stopPolling();
    this.saveState();
  }

  // ==================== UTILITY METHODS ====================

  // Get stats for debugging/settings display
  getStats() {
    return {
      hasPhotos: this.hasPhotos(),
      photoCount: this.selectedPhotos.length,
      sessionStatus: this.currentSession?.status || 'none',
      lastSelection: localStorage.getItem(STORAGE_KEYS.lastSelection),
      albumName: this.albumInfo?.name || 'None selected',
      storageUsed: this.calculateStorageUsage()
    };
  }

  // Calculate approximate storage usage
  calculateStorageUsage() {
    try {
      let totalBytes = 0;
      
      Object.values(STORAGE_KEYS).forEach(key => {
        const value = localStorage.getItem(key);
        if (value) {
          totalBytes += value.length * 2; // Rough estimate for UTF-16
        }
      });
      
      return {
        bytes: totalBytes,
        kb: Math.round(totalBytes / 1024),
        mb: Math.round(totalBytes / (1024 * 1024))
      };
    } catch (error) {
      return { bytes: 0, kb: 0, mb: 0 };
    }
  }
}
