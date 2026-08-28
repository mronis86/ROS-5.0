/**
 * Detect content review changes and queue email notifications to assignees.
 */

const { getNotifyRecipientsForRole } = require('./content-review-assignees');

function commentFingerprint(comment) {
  if (!comment || typeof comment !== 'object') return '';
  return [
    String(comment.id || ''),
    String(comment.text || '').trim(),
    String(comment.createdAt || ''),
    String(comment.createdById || ''),
  ].join('|');
}

function listStageComments(stage) {
  if (!stage || typeof stage !== 'object') return [];
  if (Array.isArray(stage.comments) && stage.comments.length > 0) {
    return stage.comments.filter((c) => c && String(c.text || '').trim());
  }
  const legacy = String(stage.note ?? '').trim();
  if (!legacy) return [];
  return [
    {
      id: `legacy-${legacy.slice(0, 24)}`,
      text: legacy,
      createdAt: stage.updatedAt || '',
      createdBy: stage.updatedBy || 'Unknown',
      createdById: '',
    },
  ];
}

function listResponseComments(stage) {
  if (!stage || typeof stage !== 'object') return [];
  if (Array.isArray(stage.responseComments) && stage.responseComments.length > 0) {
    return stage.responseComments.filter((c) => c && String(c.text || '').trim());
  }
  const legacy = String(stage.response ?? '').trim();
  if (!legacy) return [];
  return [
    {
      id: `legacy-response-${legacy.slice(0, 24)}`,
      text: legacy,
      createdAt: stage.updatedAt || '',
      createdBy: stage.updatedBy || 'Creative',
      createdById: '',
    },
  ];
}

function getCueEntry(reviews, cueId) {
  if (!reviews || typeof reviews !== 'object') return null;
  return reviews[cueId] ?? reviews[String(cueId)] ?? null;
}

function diffReviewNotifications(beforeReviews, afterReviews) {
  const events = [];
  const cueIds = new Set([
    ...Object.keys(beforeReviews || {}),
    ...Object.keys(afterReviews || {}),
  ]);

  for (const cueId of cueIds) {
    const before = getCueEntry(beforeReviews, cueId) || {};
    const after = getCueEntry(afterReviews, cueId) || {};

    for (const stage of ['creative', 'ros']) {
      const beforeStage = before[stage] || {};
      const afterStage = after[stage] || {};

      const beforeComments = listStageComments(beforeStage);
      const afterComments = listStageComments(afterStage);
      const beforeCommentIds = new Set(beforeComments.map((c) => commentFingerprint(c)));
      for (const comment of afterComments) {
        if (!beforeCommentIds.has(commentFingerprint(comment))) {
          events.push({
            type: 'reviewer_comment',
            cueId,
            stage,
            comment,
          });
        }
      }

      if (stage === 'creative') {
        const beforeResponses = listResponseComments(beforeStage);
        const afterResponses = listResponseComments(afterStage);
        const beforeResponseIds = new Set(beforeResponses.map((c) => commentFingerprint(c)));
        for (const comment of afterResponses) {
          if (!beforeResponseIds.has(commentFingerprint(comment))) {
            events.push({
              type: 'creative_response',
              cueId,
              stage: 'creative',
              comment,
            });
          }
        }
      }

      const beforeStatus = String(beforeStage.status || 'pending');
      const afterStatus = String(afterStage.status || 'pending');
      if (beforeStatus !== afterStatus) {
        if (afterStatus === 'needs_update') {
          events.push({ type: 'needs_review', cueId, stage });
        } else if (afterStatus === 'edits_made') {
          events.push({ type: 'edits_made', cueId, stage });
        } else if (afterStatus === 'approved') {
          events.push({ type: 'approved', cueId, stage });
        }
      }
    }
  }

  return events;
}

function recipientsForEvent(event) {
  switch (event.type) {
    case 'reviewer_comment':
      return { role: 'creative', reason: 'reviewer_comment' };
    case 'creative_response':
      return { role: 'production', reason: 'creative_response' };
    case 'needs_review':
      return { role: 'creative', reason: 'needs_review' };
    case 'edits_made':
      return { role: 'production', reason: 'edits_made' };
    case 'approved':
      return { role: event.stage === 'creative' ? 'production' : 'creative', reason: 'approved' };
    default:
      return null;
  }
}

async function collectContentReviewNotificationJobs(pool, {
  eventId,
  eventName,
  beforeReviews,
  afterReviews,
  modifierAccessId,
  modifierName,
}) {
  const diffEvents = diffReviewNotifications(beforeReviews, afterReviews);
  const jobs = [];

  for (const event of diffEvents) {
    const target = recipientsForEvent(event);
    if (!target) continue;
    const recipients = await getNotifyRecipientsForRole(pool, eventId, target.role, modifierAccessId);
    if (!recipients.length) continue;

    jobs.push({
      ...event,
      eventId,
      eventName,
      modifierName: modifierName || '',
      targetRole: target.role,
      reason: target.reason,
      recipients,
    });
  }

  return jobs;
}

module.exports = {
  diffReviewNotifications,
  recipientsForEvent,
  collectContentReviewNotificationJobs,
};
