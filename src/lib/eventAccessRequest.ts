export type EventAccessRequestStatus = 'pending' | 'approved' | 'denied';

export type EventListAccessState = 'open' | 'locked' | 'pending';

export type EventAccessRequestItem = {
  id: string;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  requesterName: string;
  requesterEmail: string;
  createdAt: string;
};

export function eventListAccessState(event: {
  canAccess?: boolean;
  accessRequestStatus?: EventAccessRequestStatus | null;
}): EventListAccessState {
  if (event.canAccess === false) {
    return event.accessRequestStatus === 'pending' ? 'pending' : 'locked';
  }
  return 'open';
}
