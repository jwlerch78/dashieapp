// js/google-apis/google-picker-client.js
// CHANGE SUMMARY: Google Photos Picker API client focused on album selection for dashboard display

// ==================== PICKER API CONFIG ====================

const PICKER_CONFIG = {
  // Picker API base URL
  baseUrl: 'https://photospicker.googleapis.com/v1',
  
  // Request timeout settings
  requestTimeout: 30000, // 30 seconds
  
  // Session polling configuration
  polling: {
    interval: 2000,        // 2 seconds between polls
    maxAttempts: 90,       // 3 minutes total for album selection
    backoffMultiplier: 1.1 // Gradual slowdown
  }
};

// ==================== GOOGLE PHOTOS PICKER CLIENT ====================

export class GooglePhotosPickerClient {
  constructor(authManager) {
    this.authManager = authManager;
    
    // Request retry configuration
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000
    };
    
    // Rate limiting
    this.lastRequestTime = 0;
    this.minRequestInterval = 100;
  }

  // ==================== CORE API METHODS ====================

  // Get current access token with refresh capability
  async getAccessToken() {
    try {
      let token = this.authManager.getGoogleAccessToken();
      
      if (!token) {
        throw new Error('No Google access token available');
      }
      
      return token;
    } catch (error) {
      console.error('📸 Failed to get valid access token:', error);
      throw new Error('Unable to get valid access token');
    }
  }

  // Rate-limited request wrapper
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  // Enhanced request method for Picker API with retry logic
  async makePickerRequest(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${PICKER_CONFIG.baseUrl}${endpoint}`;
    
    let lastError;
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const token = await this.getAccessToken();
        
        const requestOptions = {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
          },
          ...options
        };

        await this.waitForRateLimit();
        
        console.log(`📸 Picker API request (attempt ${attempt + 1}): ${url}`);
        
        const response = await fetch(url, requestOptions);
        
        if (response.ok) {
          const data = await response.json();
          console.log(`📸 Picker API request successful on attempt ${attempt + 1}`);
          return data;
        }
        
        const errorText = await response.text();
        const error = new Error(`Picker API request failed: ${response.status} - ${errorText}`);
        error.status = response.status;
        
        // Handle 401 - try token refresh
        if (response.status === 401 && attempt < this.retryConfig.maxRetries) {
          console.warn(`📸 401 error on attempt ${attempt + 1} - refreshing token...`);
          try {
            await this.authManager.refreshGoogleAccessToken();
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          } catch (refreshError) {
            console.error('📸 Token refresh failed:', refreshError);
            throw error;
          }
        }
        
        // Handle 403 - don't retry
        if (response.status === 403) {
          console.error('📸 403 Forbidden - check API permissions:', errorText);
          throw error;
        }
        
        // Handle 5xx and 429 - retry with backoff
        if (response.status >= 500 || response.status === 429) {
          lastError = error;
          if (attempt < this.retryConfig.maxRetries) {
            const delay = Math.min(
              this.retryConfig.baseDelay * Math.pow(2, attempt),
              this.retryConfig.maxDelay
            );
            console.warn(`📸 ${response.status} error, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        throw error;
        
      } catch (error) {
        lastError = error;
        
        // Network errors - retry if attempts remain
        if (!error.status && attempt < this.retryConfig.maxRetries) {
          const delay = Math.min(
            this.retryConfig.baseDelay * Math.pow(2, attempt),
            this.retryConfig.maxDelay
          );
          console.warn(`📸 Network error, retrying in ${delay}ms:`, error.message);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError || new Error('All Picker API request attempts failed');
  }

  // ==================== ALBUM SELECTION METHODS ====================

  // Create a session for album selection
  async createAlbumSelectionSession() {
    console.log('📸 Creating album selection session...');
    
    try {
      const requestBody = {
        // No specific configuration needed for basic album selection
      };
      
      const data = await this.makePickerRequest('/sessions', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      
      const session = {
        sessionId: data.id,
        pickerUri: data.pickerUri,
        pollingToken: data.pollingToken,
        createdAt: new Date().toISOString(),
        status: 'created',
        type: 'album_selection'
      };
      
      console.log('📸 Album selection session created:', {
        sessionId: session.sessionId,
        pickerUri: session.pickerUri.substring(0, 50) + '...'
      });
      
      return session;
      
    } catch (error) {
      console.error('📸 Failed to create album selection session:', error);
      throw new Error(`Album selection session creation failed: ${error.message}`);
    }
  }

  // Poll session to check if user has selected album/photos
  async pollSession(sessionId) {
    console.log(`📸 Polling session: ${sessionId}`);
    
    try {
      const data = await this.makePickerRequest(`/sessions/${sessionId}`);
      
      return {
        sessionId: data.id,
        mediaItemsSet: data.mediaItemsSet || false,
        pollingToken: data.pollingToken,
        pickerUri: data.pickerUri,
        status: data.mediaItemsSet ? 'completed' : 'pending'
      };
      
    } catch (error) {
      console.error(`📸 Failed to poll session ${sessionId}:`, error);
      throw new Error(`Session polling failed: ${error.message}`);
    }
  }

  // Get all photos from selected album/selection
  async getSelectedPhotos(sessionId, pageToken = null) {
    console.log(`📸 Retrieving selected photos from session: ${sessionId}`);
    
    try {
      const params = new URLSearchParams({
        sessionId: sessionId
      });
      
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      
      const data = await this.makePickerRequest(`/mediaItems?${params}`);
      
      const mediaItems = data.mediaItems || [];
      console.log(`📸 Retrieved ${mediaItems.length} photos from selection`);
      
      // Transform to consistent format for dashboard
      const photos = mediaItems.map(item => ({
        id: item.mediaFile?.id || item.id,
        filename: item.mediaFile?.filename || `photo_${item.id}`,
        baseUrl: item.mediaFile?.baseUrl,
        mimeType: item.mediaFile?.mimeType,
        mediaMetadata: {
          creationTime: item.mediaFile?.creationTime,
          width: item.mediaFile?.width,
          height: item.mediaFile?.height
        }
      }));
      
      return {
        photos: photos,
        nextPageToken: data.nextPageToken,
        totalCount: photos.length
      };
      
    } catch (error) {
      console.error(`📸 Failed to get photos from session ${sessionId}:`, error);
      throw new Error(`Get selected photos failed: ${error.message}`);
    }
  }

  // Complete album selection flow with polling
  async selectAlbumFlow() {
    console.log('📸 Starting album selection flow...');
    
    try {
      // Create session
      const session = await this.createAlbumSelectionSession();
      
      return {
        success: true,
        sessionId: session.sessionId,
        pickerUri: session.pickerUri,
        pollingToken: session.pollingToken,
        status: 'session_created',
        message: 'Session created - user needs to select album'
      };
      
    } catch (error) {
      console.error('📸 Album selection flow failed:', error);
      return {
        success: false,
        error: error.message,
        status: 'error'
      };
    }
  }

  // Wait for user to complete album selection (with timeout)
  async waitForAlbumSelection(sessionId, maxAttempts = PICKER_CONFIG.polling.maxAttempts) {
    console.log(`📸 Waiting for album selection completion: ${sessionId}`);
    
    let currentInterval = PICKER_CONFIG.polling.interval;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const sessionStatus = await this.pollSession(sessionId);
        
        if (sessionStatus.mediaItemsSet) {
          console.log(`📸 User completed album selection after ${attempt} polls`);
          
          // Get all photos from the selected album
          const result = await this.getSelectedPhotos(sessionId);
          
          return {
            success: true,
            photos: result.photos,
            totalPhotos: result.totalCount,
            sessionId: sessionId,
            completedAt: new Date().toISOString()
          };
        }
        
        // Log progress every 15 attempts (30 seconds)
        if (attempt % 15 === 0) {
          console.log(`📸 Still waiting for album selection... (${attempt}/${maxAttempts})`);
        }
        
        // Wait before next poll with gradual backoff
        await new Promise(resolve => setTimeout(resolve, currentInterval));
        currentInterval = Math.min(
          currentInterval * PICKER_CONFIG.polling.backoffMultiplier,
          5000 // Max 5 seconds between polls
        );
        
      } catch (error) {
        console.error(`📸 Error during polling attempt ${attempt}:`, error);
        
        // Continue polling unless it's the last attempt
        if (attempt === maxAttempts) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, currentInterval));
      }
    }
    
    // Timeout reached
    console.log(`📸 Album selection session ${sessionId} timed out after ${maxAttempts} attempts`);
    
    return {
      success: false,
      error: 'User did not complete album selection within timeout period',
      sessionId: sessionId,
      timedOut: true
    };
  }

  // ==================== UTILITY METHODS ====================

  // Generate QR code URL for album selection
  generateAlbumSelectionQRCode(pickerUri) {
    return {
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pickerUri)}`,
      pickerUri: pickerUri,
      instructionText: "Scan to select a photo album from Google Photos",
      linkText: "Or click here to select album"
    };
  }

  // Helper to get display URL for photos
  getDisplayPhotoUrl(baseUrl, width = 800, height = 600) {
    if (!baseUrl) return null;
    return `${baseUrl}=w${width}-h${height}`;
  }

  // Test API access by creating a test session
  async testPickerAccess() {
    console.log('📸 Testing Google Photos Picker API access...');
    
    try {
      const testSession = await this.createAlbumSelectionSession();
      
      return {
        success: true,
        message: 'Picker API access confirmed',
        sessionId: testSession.sessionId,
        pickerUri: testSession.pickerUri.substring(0, 50) + '...'
      };
      
    } catch (error) {
      console.error('📸 Picker API test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}
