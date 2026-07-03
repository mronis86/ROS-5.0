/**
 * Neon Management API — delete auth users (works when direct SQL lacks permission).
 *
 * Env:
 *   NEON_API_KEY
 *   NEON_PROJECT_ID
 *   NEON_BRANCH_ID (optional — uses primary branch when omitted)
 */

const NEON_API_BASE = 'https://console.neon.tech/api/v2';

function getNeonManagementConfig() {
  const apiKey = (process.env.NEON_API_KEY || '').trim();
  const projectId = (process.env.NEON_PROJECT_ID || '').trim();
  const branchId = (process.env.NEON_BRANCH_ID || '').trim();
  if (!apiKey || !projectId) return null;
  return { apiKey, projectId, branchId };
}

async function neonApiRequest(config, method, path, body) {
  const res = await fetch(`${NEON_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  return { ok: res.ok, status: res.status, data };
}

async function resolveBranchId(config) {
  if (config.branchId) return config.branchId;
  const result = await neonApiRequest(config, 'GET', `/projects/${config.projectId}/branches`);
  if (!result.ok) {
    throw new Error(result.data?.message || `Could not list Neon branches (HTTP ${result.status}).`);
  }
  const branches = result.data?.branches || [];
  const primary = branches.find((b) => b.primary) || branches[0];
  if (!primary?.id) {
    throw new Error('No Neon branch found for auth user deletion.');
  }
  return primary.id;
}

async function deleteNeonAuthUserViaManagementApi(authUserId) {
  const config = getNeonManagementConfig();
  if (!config) {
    return { deleted: false, reason: 'management_api_not_configured' };
  }
  if (!authUserId) {
    return { deleted: false, reason: 'missing_user_id' };
  }

  try {
    const branchId = await resolveBranchId(config);
    const result = await neonApiRequest(
      config,
      'DELETE',
      `/projects/${config.projectId}/branches/${branchId}/auth/users/${encodeURIComponent(authUserId)}`
    );

    if (result.status === 204 || result.ok) {
      return { deleted: true, userId: authUserId, method: 'neon_management_api' };
    }

    if (result.status === 404) {
      return { deleted: false, reason: 'user_not_found', method: 'neon_management_api' };
    }

    return {
      deleted: false,
      reason: 'management_api_failed',
      method: 'neon_management_api',
      error: result.data?.message || `HTTP ${result.status}`,
    };
  } catch (err) {
    return {
      deleted: false,
      reason: 'management_api_failed',
      method: 'neon_management_api',
      error: err.message || 'Neon Management API request failed.',
    };
  }
}

module.exports = {
  getNeonManagementConfig,
  deleteNeonAuthUserViaManagementApi,
};
