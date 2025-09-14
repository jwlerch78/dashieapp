// js/google-apis/google-api-client.js - Centralized Google API client

export class GoogleAPIClient {
  constructor(authManager) {
    this.authManager = authManager;
    this.baseUrl = 'https://www.googleapis.com';
  }

  // Get current access token from auth manager
  getAccessToken() {
    return this.authManager.getGoogleAccessToken();
  }

  // Generic API request method with error handling
  async makeRequest(endpoint, options = {}) {
    const token = this.getAccessToken();
  if (!token) {
    throw new Error('No Google access token available');
  }

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
    const requestOptions = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    console.log(`📡 Making Google API request to: ${url}`);
    
    try {
      const response = await fetch(url, requestOptions);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Google API Error (${response.status}):`, errorText);
        throw new Error(`Google API request failed: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      console.log(`✅ Google API request successful`);
      return data;
      
    } catch (error) {
      console.error('Google API request failed:', error);
      throw error;
    }
  }

  // ====================
  // GOOGLE PHOTOS METHODS
  // ====================

  // Get all photo albums
  async getPhotoAlbums() {
    console.log('📸 Fetching Google Photos albums...');
    
    try {
      const response = await this.makeRequest('/v1/albums', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.getAccessToken()}`
        }
      });
      
      const albums = response.albums || [];
      console.log(`📸 Found ${albums.length} photo albums`);
      
      return albums.map(album => ({
        id: album.id,
        title: album.title,
        productUrl: album.productUrl,
        mediaItemsCount: album.mediaItemsCount,
        coverPhotoBaseUrl: album.coverPhotoBaseUrl,
        isWriteable: album.isWriteable
      }));
      
    } catch (error) {
      console.error('Failed to fetch photo albums:', error);
      return [];
    }
  }

  // Get photos from a specific album
  async getAlbumPhotos(albumId, pageSize = 50, pageToken = null) {
    console.log(`📸 Fetching photos from album: ${albumId}`);
    
    try {
      const requestBody = {
        albumId: albumId,
        pageSize: pageSize
      };
      
      if (pageToken) {
        requestBody.pageToken = pageToken;
      }

      const response = await this.makeRequest('/v1/mediaItems:search', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      
      const mediaItems = response.mediaItems || [];
      console.log(`📸 Found ${mediaItems.length} photos in album`);
      
      return {
        photos: mediaItems.map(item => ({
          id: item.id,
          filename: item.filename,
          baseUrl: item.baseUrl,
          mimeType: item.mimeType,
          creationTime: item.mediaMetadata?.creationTime,
          width: item.mediaMetadata?.width,
          height: item.mediaMetadata?.height,
          // Generate display URL with size parameters
          displayUrl: `${item.baseUrl}=w1920-h1080-c`, // Fit to 1920x1080, cropped
          thumbnailUrl: `${item.baseUrl}=w300-h300-c`   // 300x300 thumbnail
        })),
        nextPageToken: response.nextPageToken
      };
      
    } catch (error) {
      console.error(`Failed to fetch photos from album ${albumId}:`, error);
      return { photos: [], nextPageToken: null };
    }
  }

  // Get recent photos (no album specified)
  async getRecentPhotos(pageSize = 50, pageToken = null) {
    console.log('📸 Fetching recent photos...');
    
    try {
      const requestBody = {
        pageSize: pageSize,
        filters: {
          mediaTypeFilter: {
            mediaTypes: ['PHOTO'] // Only photos, no videos
          }
        }
      };
      
      if (pageToken) {
        requestBody.pageToken = pageToken;
      }

      const response = await this.makeRequest('/v1/mediaItems:search', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });
      
      const mediaItems = response.mediaItems || [];
      console.log(`📸 Found ${mediaItems.length} recent photos`);
      
      return {
        photos: mediaItems.map(item => ({
          id: item.id,
          filename: item.filename,
          baseUrl: item.baseUrl,
          mimeType: item.mimeType,
          creationTime: item.mediaMetadata?.creationTime,
          width: item.mediaMetadata?.width,
          height: item.mediaMetadata?.height,
          displayUrl: `${item.baseUrl}=w1920-h1080-c`,
          thumbnailUrl: `${item.baseUrl}=w300-h300-c`
        })),
        nextPageToken: response.nextPageToken
      };
      
    } catch (error) {
      console.error('Failed to fetch recent photos:', error);
      return { photos: [], nextPageToken: null };
    }
  }

  // ====================
  // GOOGLE CALENDAR METHODS
  // ====================

  // Get all calendar lists
  async getCalendarList() {
    console.log('📅 Fetching Google Calendar list...');
    
    try {
      const response = await this.makeRequest('/calendar/v3/users/me/calendarList');
      
      const calendars = response.items || [];
      console.log(`📅 Found ${calendars.length} calendars`);
      
      return calendars.map(cal => ({
        id: cal.id,
        summary: cal.summary,
        description: cal.description,
        primary: cal.primary,
        backgroundColor: cal.backgroundColor,
        foregroundColor: cal.foregroundColor,
        accessRole: cal.accessRole,
        selected: cal.selected,
        timeZone: cal.timeZone
      }));
      
    } catch (error) {
      console.error('Failed to fetch calendar list:', error);
      return [];
    }
  }

  // Get events from a specific calendar
  async getCalendarEvents(calendarId, timeMin = null, timeMax = null, maxResults = 250) {
    console.log(`📅 Fetching events from calendar: ${calendarId}`);
    
    try {
      const params = new URLSearchParams({
        maxResults: maxResults.toString(),
        singleEvents: 'true',
        orderBy: 'startTime'
      });
      
      // Default to next 30 days if no time range specified
      if (!timeMin) {
        timeMin = new Date().toISOString();
      }
      if (!timeMax) {
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + 30);
        timeMax = maxDate.toISOString();
      }
      
      params.append('timeMin', timeMin);
      params.append('timeMax', timeMax);
      
      const response = await this.makeRequest(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
      
      const events = response.items || [];
      console.log(`📅 Found ${events.length} events in calendar`);
      
      return events.map(event => ({
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start,
        end: event.end,
        location: event.location,
        attendees: event.attendees || [],
        creator: event.creator,
        organizer: event.organizer,
        status: event.status,
        htmlLink: event.htmlLink,
        calendarId: calendarId,
        // Computed fields
        isAllDay: !!event.start.date,
        startDateTime: event.start.dateTime || event.start.date,
        endDateTime: event.end.dateTime || event.end.date
      }));
      
    } catch (error) {
      console.error(`Failed to fetch events from calendar ${calendarId}:`, error);
      return [];
    }
  }

  // Get events from all calendars
  async getAllCalendarEvents(timeMin = null, timeMax = null) {
    console.log('📅 Fetching events from all calendars...');
    
    try {
      // First get the calendar list
      const calendars = await this.getCalendarList();
      
      // Filter to only selected/accessible calendars
      const accessibleCalendars = calendars.filter(cal => 
        cal.selected !== false && 
        ['owner', 'writer', 'reader'].includes(cal.accessRole)
      );
      
      console.log(`📅 Fetching events from ${accessibleCalendars.length} accessible calendars`);
      
      // Fetch events from each calendar
      const allEventPromises = accessibleCalendars.map(calendar => 
        this.getCalendarEvents(calendar.id, timeMin, timeMax)
          .then(events => ({
            calendar: calendar,
            events: events
          }))
          .catch(error => {
            console.warn(`Failed to fetch events from calendar ${calendar.summary}:`, error);
            return { calendar: calendar, events: [] };
          })
      );
      
      const calendarResults = await Promise.all(allEventPromises);
      
      // Flatten all events and add calendar info
      const allEvents = [];
      calendarResults.forEach(result => {
        result.events.forEach(event => {
          allEvents.push({
            ...event,
            calendarName: result.calendar.summary,
            calendarColor: result.calendar.backgroundColor,
            isPrimary: result.calendar.primary
          });
        });
      });
      
      // Sort by start time
      allEvents.sort((a, b) => 
        new Date(a.startDateTime) - new Date(b.startDateTime)
      );
      
      console.log(`📅 Total events found: ${allEvents.length}`);
      
      return {
        events: allEvents,
        calendars: accessibleCalendars,
        summary: {
          totalEvents: allEvents.length,
          totalCalendars: accessibleCalendars.length,
          timeRange: { timeMin, timeMax }
        }
      };
      
    } catch (error) {
      console.error('Failed to fetch all calendar events:', error);
      return { events: [], calendars: [], summary: null };
    }
  }

  // ====================
  // UTILITY METHODS
  // ====================

  // Test API access
  async testAccess() {
    console.log('🧪 Testing Google API access...');
    
    const results = {
      photos: false,
      calendar: false,
      errors: []
    };
    
    // Test Photos API
    try {
      await this.getPhotoAlbums();
      results.photos = true;
      console.log('✅ Google Photos API access confirmed');
    } catch (error) {
      results.errors.push(`Photos API: ${error.message}`);
      console.error('❌ Google Photos API access failed:', error);
    }
    
    // Test Calendar API
    try {
      await this.getCalendarList();
      results.calendar = true;
      console.log('✅ Google Calendar API access confirmed');
    } catch (error) {
      results.errors.push(`Calendar API: ${error.message}`);
      console.error('❌ Google Calendar API access failed:', error);
    }
    
    return results;
  }
}
