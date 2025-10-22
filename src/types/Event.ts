export interface Event {
  id: string;
  name: string;
  date: string; // ISO date string
  location: string;
  numberOfDays: number;
  timezone?: string; // Event timezone
  created_at?: string;
  updated_at?: string;
}

export interface EventFormData {
  name: string;
  date: string;
  location: string;
  numberOfDays: number;
  timezone?: string;
}

export const LOCATION_OPTIONS = [
  { value: 'Great Hall', label: 'Great Hall', color: 'bg-blue-600' },
  { value: 'Briefing Center', label: 'Briefing Center', color: 'bg-green-600' },
  { value: 'Lee Anderson', label: 'Lee Anderson', color: 'bg-purple-600' },
  { value: 'Virtual Show', label: 'Virtual Show', color: 'bg-orange-600' },
  { value: 'Off Site', label: 'Off Site', color: 'bg-red-600' }
];

export const DAYS_OPTIONS = [1, 2, 3, 4, 5];

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (EST/EDT)' },
  { value: 'America/Chicago', label: 'Central (CST/CDT)' },
  { value: 'America/Denver', label: 'Mountain (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PST/PDT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKST/AKDT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' }
];
