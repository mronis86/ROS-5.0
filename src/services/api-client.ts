// API Client for communicating with our Express API server
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

// Smart caching system
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class ApiClient {
  private cache: Map<string, CacheEntry<any>> = new Map();
  
  // Cache TTL settings (in milliseconds)
  private readonly CACHE_TTL = {
    calendarEvents: 5 * 60 * 1000,    // 5 minutes
    runOfShowData: 30 * 1000,         // 30 seconds (frequently updated)
    completedCues: 2 * 60 * 1000,     // 2 minutes
    activeTimers: 10 * 1000,          // 10 seconds (very dynamic)
    changeLog: 1 * 60 * 1000,         // 1 minute
    timerMessages: 1 * 60 * 1000,     // 1 minute
  };

  private getCacheKey(endpoint: string, params?: any): string {
    return `${endpoint}${params ? `_${JSON.stringify(params)}` : ''}`;
  }

  private getCachedData<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  private setCachedData<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, cacheKey?: string, cacheTTL?: number): Promise<T> {
    // Check cache first (only for GET requests)
    if (options.method === 'GET' || !options.method) {
      const cacheKeyToUse = cacheKey || this.getCacheKey(endpoint);
      const cachedData = this.getCachedData<T>(cacheKeyToUse);
      if (cachedData) {
        console.log(`📦 Cache hit for: ${endpoint}`);
        return cachedData;
      }
    }

    const url = `${API_BASE_URL}${endpoint}`;
    
    const defaultOptions: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, defaultOptions);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Cache the response (only for GET requests)
      if (options.method === 'GET' || !options.method) {
        const cacheKeyToUse = cacheKey || this.getCacheKey(endpoint);
        const ttlToUse = cacheTTL || this.CACHE_TTL.calendarEvents;
        this.setCachedData(cacheKeyToUse, data, ttlToUse);
      }
      
      return data;
    } catch (error) {
      console.error(`API request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  // Health check
  async healthCheck() {
    return this.request('/health');
  }

  // Calendar Events
  async getCalendarEvents() {
    return this.request('/api/calendar-events', {}, 'calendarEvents', this.CACHE_TTL.calendarEvents);
  }

  async createCalendarEvent(event: { name: string; date: string; schedule_data: any }) {
    const result = await this.request('/api/calendar-events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
    
    // Invalidate calendar events cache
    this.cache.delete('calendarEvents');
    return result;
  }

  async getCalendarEvent(id: string) {
    return this.request(`/api/calendar-events/${id}`, {}, `calendarEvent_${id}`, this.CACHE_TTL.calendarEvents);
  }

  async updateCalendarEvent(id: string, event: { name: string; date: string; schedule_data: any }) {
    const result = await this.request(`/api/calendar-events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(event),
    });
    
    // Invalidate calendar events cache
    this.cache.delete('calendarEvents');
    this.cache.delete(`calendarEvent_${id}`);
    return result;
  }

  async deleteCalendarEvent(id: string) {
    const result = await this.request(`/api/calendar-events/${id}`, {
      method: 'DELETE',
    });
    
    // Invalidate calendar events cache
    this.cache.delete('calendarEvents');
    this.cache.delete(`calendarEvent_${id}`);
    return result;
  }

  // Run of Show Data
  async getRunOfShowData(eventId: string) {
    return this.request(`/api/run-of-show-data/${eventId}`, {}, `runOfShowData_${eventId}`, this.CACHE_TTL.runOfShowData);
  }

  async saveRunOfShowData(data: {
    event_id: string;
    event_name?: string;
    event_date?: string;
    schedule_items: any[];
    custom_columns: any[];
    settings: any;
    last_modified_by?: string;
    last_modified_by_name?: string;
    last_modified_by_role?: string;
  }) {
    const result = await this.request('/api/run-of-show-data', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    
    // Invalidate run of show data cache for this event
    this.cache.delete(`runOfShowData_${data.event_id}`);
    return result;
  }

  // Completed Cues
  async getCompletedCues(eventId: string) {
    return this.request(`/api/completed-cues/${eventId}`, {}, `completedCues_${eventId}`, this.CACHE_TTL.completedCues);
  }

  async markCueAsCompleted(eventId: string, itemId: number, userId: string) {
    const result = await this.request('/api/completed-cues', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, item_id: itemId, user_id: userId }),
    });
    
    // Invalidate completed cues cache
    this.cache.delete(`completedCues_${eventId}`);
    return result;
  }

  async unmarkCueAsCompleted(eventId: string, itemId: number, userId: string) {
    const result = await this.request('/api/completed-cues', {
      method: 'DELETE',
      body: JSON.stringify({ event_id: eventId, item_id: itemId, user_id: userId }),
    });
    
    // Invalidate completed cues cache
    this.cache.delete(`completedCues_${eventId}`);
    return result;
  }

  // Active Timers
  async getActiveTimers(eventId: string) {
    return this.request(`/api/active-timers/${eventId}`, {}, `activeTimers_${eventId}`, this.CACHE_TTL.activeTimers);
  }

  async saveActiveTimer(timerData: any) {
    const result = await this.request('/api/active-timers', {
      method: 'POST',
      body: JSON.stringify(timerData),
    });
    
    // Invalidate active timers cache
    this.cache.delete(`activeTimers_${timerData.event_id}`);
    return result;
  }

  // Sub Cue Timers
  async getSubCueTimers(eventId: string) {
    return this.request(`/api/sub-cue-timers/${eventId}`);
  }

  // Change Log
  async getChangeLog(eventId: string, limit: number = 100) {
    return this.request(`/api/change-log/${eventId}?limit=${limit}`);
  }

  // Timer Messages
  async getTimerMessages(eventId: string) {
    return this.request(`/api/timer-messages/${eventId}`);
  }

  // Change Log
  async logChange(changeData: any) {
    const result = await this.request('/api/change-log', {
      method: 'POST',
      body: JSON.stringify(changeData),
    });
    return result;
  }
}

export const apiClient = new ApiClient();
