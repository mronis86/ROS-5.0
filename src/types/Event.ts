export interface Event {
  id: string;
  name: string;
  date: string; // ISO date string
  location: string;
  numberOfDays: number;
  created_at?: string;
  updated_at?: string;
}

export interface EventFormData {
  name: string;
  date: string;
  location: string;
  numberOfDays: number;
}

export const LOCATION_OPTIONS = [
  { value: 'Great Hall', label: 'Great Hall', color: 'bg-blue-600' },
  { value: 'Briefing Center', label: 'Briefing Center', color: 'bg-green-600' },
  { value: 'Lee Anderson', label: 'Lee Anderson', color: 'bg-purple-600' },
  { value: 'Virtual Show', label: 'Virtual Show', color: 'bg-orange-600' },
  { value: 'Off Site', label: 'Off Site', color: 'bg-red-600' }
];

export const DAYS_OPTIONS = [1, 2, 3, 4, 5];
