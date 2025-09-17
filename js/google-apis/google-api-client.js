// js/google-apis/google-api-client.js - Updated with Token Manager Integration
// CHANGE SUMMARY: Enhanced to automatically handle token refresh on 401 errors

// ==================== CONFIG VARIABLES ====================

// How many months ahead to pull events
const MONTHS_TO_PULL = 3;

// Calendars to include by summary (name/email as shown in calendar list)
const CALENDARS_TO_INCLUDE = [
  "jwlerch@gmail.com",
  "Veeva"
];

// ==================== GOOGLE API CLIENT ====================

export class GoogleAPIClient {
  constructor(authManager) {
    this.authManager = authManager;
    this.baseUrl = 'https://www.googleapis.com';
    
    // Request retry configuration
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 10000  // 10 seconds
    };
    
    // Rate limiting
    this.lastRequestTime = 0;
    this.minRequestInterval = 100; // 100ms between requests
  }

  // UPDATED: Get current access token with automatic refresh
  async getAccessToken() {
    try {
      // Use auth manager's getGoogleAccessToken which handles refresh automatically
      return await this.authManager.getGoogleAccessToken();
    } catch (error) {
      console.error('📡 ❌ Failed to get valid access token:', error);
      throw new Error('Unable to get valid access token');
    }
  }

  // Rate-limited request wrapper
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      console.log(`⏱️ Rate limiting: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  // ENHANCED: Request method with automatic token refresh on 401 errors
  async makeRequest(endpoint, options = {}) {
    let url;
    if (endpoint.startsWith('http')) {
      url = endpoint;
    } else if (endpoint.startsWith('/v1/')) {
      // Photos API endpoints use photoslibrary domain
      url = `https://photoslibrary.googleapis.com${endpoint}`;
    } else {
      // Other APIs use standard domain
      url = `${this.baseUrl}${endpoint}`;
    }

    // Retry logic with exponential backoff and token refresh
    let lastError;
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // Get fresh token for each attempt (important for retry after refresh)
        const token = await this.getAccessToken();
        
        if (!token) {
          throw new Error('No Google access token available');
        }

        const requestOptions = {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
          },
          ...options
        };

        // Apply rate limiting
        await this.waitForRateLimit();
        
        console.log(`📡 Google API request (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}): ${url}`);
        
        const response = await fetch(url, requestOptions);
        
        if (response.ok) {
          const data = await response.json();
          console.log(`✅ Google API request successful on attempt ${attempt + 1}`);
          return data;
        }
        
        // Handle specific error codes
        const errorText = await response.text();
        const error = new Error(`Google API request failed: ${response.status} - ${errorText}`);
        error.status = response.status;
        error.response = response;
        
        // Handle 401 Unauthorized - token may be expired
        if (response.status === 401) {
          console.warn(`🔄 Google API 401 error on attempt ${attempt + 1} - token may be expired`);
          
          // Try to refresh token if this is not the last attempt
          if (attempt < this.retryConfig.maxRetries) {
            try {
              console.log('🔄 Attempting to refresh token due to 401 error...');
              await this.authManager.tokenManager.refreshToken();
              console.log('🔄 ✅ Token refreshed, retrying API request...');
              
              // Wait a bit before retry
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue; // Retry with refreshed token
              
            } catch (refreshError) {
              console.error('🔄 ❌ Token refresh failed:', refreshError);
              // If refresh fails, don't retry further - let the error bubble up
              throw error;
            }
          } else {
            console.error('❌ Google API 401 error on final attempt - authentication failed');
            throw error;
          }
        }
        
        // Handle 403 Forbidden - insufficient permissions or quota
        if (response.status === 403) {
          console.error(`❌ Google API 403 error (forbidden):`, errorText);
          throw error; // Don't retry on 403
        }
        
        // For 5xx errors or rate limits, we'll retry
        if (response.status >= 500 || response.status === 429) {
          lastError = error;
          console.warn(`⚠️ Google API error ${response.status} on attempt ${attempt + 1}, will retry:`, errorText);
          
          if (attempt < this.retryConfig.maxRetries) {
            const delay = Math.min(
              this.retryConfig.baseDelay * Math.pow(2, attempt),
              this.retryConfig.maxDelay
            );
            console.log(`⏳ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        // For other errors, don't retry
        throw error;
        
      } catch (error) {
        lastError = error;
        
        // If it's a network error, retry if we have attempts left
        if (!error.status && attempt < this.retryConfig.maxRetries) {
          console.warn(`⚠️ Network error on attempt ${attempt + 1}, will retry:`, error.message);
          const delay = Math.min(
            this.retryConfig.baseDelay * Math.pow(2, attempt),
            this.retryConfig.maxDelay
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // If it's not a retryable error or we're out of attempts
        throw error;
      }
    }
    
    // If we get here, all retries failed
    throw lastError || new Error('All API request attempts failed');
  }

  // EXISTING CALENDAR API METHODS (updated to use enhanced makeRequest)

  // Get list of calendars
  async getCalendarList() {
    console.log('📅 Fetching calendar list...');
    
    try {
      const data = await this.makeRequest('/calendar/v3/users/me/calendarList');
      
      const calendars = data.items || [];
      console.log(`📅 Found ${calendars.length} calendars`);
      
      return calendars.map(cal => ({
        id: cal.id,
        summary: cal.summary,
        description: cal.description || '',
        primary: cal.primary || false,
        accessRole: cal.accessRole,
        backgroundColor: cal.backgroundColor,
        foregroundColor: cal.foregroundColor
      }));
      
    } catch (error) {
      console.error('📅 ❌ Failed to fetch calendar list:', error);
      throw new Error(`Calendar list fetch failed: ${error.message}`);
    }
  }

  // Get events from a specific calendar
  async getCalendarEvents(calendarId, timeMin = null, timeMax = null) {
    console.log(`📅 Fetching events from calendar: ${calendarId}`);
    
    const now = new Date();
    const defaultTimeMin = timeMin || now.toISOString();
    const defaultTimeMax = timeMax || new Date(now.getTime() + (MONTHS_TO_PULL * 30 * 24 * 60 * 60 * 1000)).toISOString();
    
    const params = new URLSearchParams({
      timeMin: defaultTimeMin,
      timeMax: defaultTimeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100'
    });
    
    try {
      const data = await this.makeRequest(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
      
      const events = data.items || [];
      console.log(`📅 Found ${events.length} events in calendar ${calendarId}`);
      
      return events.map(event => ({
        id: event.id,
        summary: event.summary || 'No title',
        description: event.description || '',
        start: event.start,
        end: event.end,
        location: event.location || '',
        attendees: event.attendees || [],
        calendarId: calendarId
      }));
      
    } catch (error) {
      console.error(`📅 ❌ Failed to fetch events from calendar ${calendarId}:`, error);
      throw new Error(`Calendar events fetch failed: ${error.message}`);
    }
  }

  // Get events from all configured calendars
  async getAllCalendarEvents() {
    console.log('📅 🔄 Fetching events from all configured calendars...');
    
    try {
      // Get calendar list first
      const calendars = await this.getCalendarList();
      
      // Filter to configured calendars
      const targetCalendars = calendars.filter(cal => 
        CALENDARS_TO_INCLUDE.some(target => 
          cal.summary.includes(target) || cal.id.includes(target)
        )
      );
      
      console.log(`📅 Fetching from ${targetCalendars.length} configured calendars:`, 
        targetCalendars.map(cal => cal.summary));
      
      // Fetch events from each calendar
      const allEvents = [];
      for (const calendar of targetCalendars) {
        try {
          const events = await this.getCalendarEvents(calendar.id);
          allEvents.push(...events);
        } catch (error) {
          console.error(`📅 ⚠️ Failed to fetch from calendar ${calendar.summary}:`, error);
          // Continue with other calendars
        }
      }
      
      // Sort all events by start time
      allEvents.sort((a, b) => {
        const aStart = new Date(a.start.dateTime || a.start.date);
        const bStart = new Date(b.start.dateTime || b.start.date);
        return aStart - bStart;
      });
      
      console.log(`📅 ✅ Total events fetched: ${allEvents.length}`);
      return allEvents;
      
    } catch (error) {
      console.error('📅 ❌ Failed to fetch all calendar events:', error);
      throw new Error(`All calendar events fetch failed: ${error.message}`);
    }
  }

  // EXISTING PHOTOS API METHODS (commented out as requested in original)

  // Test API access with enhanced token handling
  async testAccess() {
    console.log('🧪 Testing Google API access...');
    
    const results = {
      calendar: false,
      photos: false,
      tokenStatus: 'unknown',
      errors: [],
      details: {}
    };
    
    // Test Calendar API access
    try {
      console.log('🧪 Testing Calendar API access...');
      const calendarStart = Date.now();
      const calendars = await this.getCalendarList();
      const calendarTime = Date.now() - calendarStart;
      
      results.calendar = true;
      results.tokenStatus = 'valid';
      results.details.calendar = {
        calendarsFound: calendars.length,
        responseTime: calendarTime,
        configuredCalendars: calendars.filter(cal => 
          CALENDARS_TO_INCLUDE.some(target => 
            cal.summary.includes(target) || cal.id.includes(target)
          )
        ).length
      };
      console.log('✅ Google Calendar API access confirmed');
      console.log(`✅ Found ${calendars.length} calendars (${results.details.calendar.configuredCalendars} configured)`);
      
    } catch (error) {
      results.calendar = false;
      results.errors.push(`Calendar API: ${error.message}`);
      
      if (error.status === 401) {
        results.tokenStatus = 'expired';
        console.error('❌ Google Calendar API: Token expired or invalid');
      } else {
        results.tokenStatus = 'error';
        console.error('❌ Google Calendar API access failed:', error);
      }
    }
    
    // Log final results
    console.log('🧪 ✅ API test complete:', {
      calendar: results.calendar,
      photos: results.photos,
      tokenStatus: results.tokenStatus,
      errorCount: results.errors.length,
      details: results.details
    });
    
    return results;
  }

  // Health check for monitoring API status
  async healthCheck() {
    const start = Date.now();
    
    try {
      const testResults = await this.testAccess();
      const responseTime = Date.now() - start;
      
      return {
        status: testResults.calendar ? 'healthy' : 'degraded',
        responseTime,
        apis: {
          calendar: testResults.calendar,
          photos: testResults.photos
        },
        tokenStatus: testResults.tokenStatus,
        lastChecked: new Date().toISOString()
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: error.message,
        lastChecked: new Date().toISOString()
      };
    }
  }
}
