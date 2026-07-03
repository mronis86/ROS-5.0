/**
 * Direct Neon Auth (Better Auth) user cleanup via the shared Neon database.
 * Used when admin removes access or when an orphaned auth user blocks portal setup.
 */

const { deleteNeonAuthUserViaManagementApi } = require('./neon-management-api');

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isNeonUserAlreadyExistsError(result) {
  if (!result || result.ok) return false;
  const msg = String(result.error || '').toLowerCase();
  const code = String(result.code || '').toLowerCase();
  return (
    msg.includes('already exists') ||
    msg.includes('user already') ||
    code.includes('user_already_exists') ||
    code === 'user_already_exists'
  );
}

async function queryOptional(pool, sql, params) {
  try {
    return await pool.query(sql, params);
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return null;
    throw err;
  }
}

async function findNeonAuthUserId(pool, { email, neonUserId }) {
  if (neonUserId) {
    const byId = await queryOptional(pool, `SELECT id FROM neon_auth."user" WHERE id = $1 LIMIT 1`, [neonUserId]);
    if (byId?.rows[0]?.id) return String(byId.rows[0].id);
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const byEmail = await queryOptional(pool, `SELECT id FROM neon_auth."user" WHERE LOWER(email) = $1 LIMIT 1`, [
    normalizedEmail,
  ]);
  return byEmail?.rows[0]?.id ? String(byEmail.rows[0].id) : null;
}

async function deleteNeonAuthUserByIdSql(pool, userId, email) {
  if (!userId) return { deleted: false, reason: 'missing_user_id' };

  await queryOptional(pool, `DELETE FROM neon_auth.session WHERE "userId" = $1`, [userId]);
  await queryOptional(pool, `DELETE FROM neon_auth.account WHERE "userId" = $1`, [userId]);
  await queryOptional(pool, `DELETE FROM neon_auth.member WHERE "userId" = $1`, [userId]);
  await queryOptional(pool, `DELETE FROM neon_auth.invitation WHERE "inviterId" = $1`, [userId]);
  await queryOptional(pool, `DELETE FROM neon_auth.verification WHERE "userId" = $1`, [userId]);

  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    await queryOptional(pool, `DELETE FROM neon_auth.verification WHERE LOWER(identifier) = $1`, [normalizedEmail]);
  }

  const userDelete = await queryOptional(pool, `DELETE FROM neon_auth."user" WHERE id = $1 RETURNING id`, [userId]);
  if (!userDelete || userDelete.rowCount === 0) {
    return { deleted: false, reason: 'user_not_found', method: 'sql' };
  }

  await queryOptional(pool, `DELETE FROM neon_auth.users_sync WHERE id = $1`, [userId]);
  if (normalizedEmail) {
    await queryOptional(pool, `DELETE FROM neon_auth.users_sync WHERE LOWER(email) = $1`, [normalizedEmail]);
  }

  return { deleted: true, userId, method: 'sql' };
}

async function deleteNeonAuthUser(pool, { email, neonUserId } = {}) {
  const userId = await findNeonAuthUserId(pool, { email, neonUserId });
  if (!userId) {
    const apiOnly = await deleteNeonAuthUserViaManagementApi(neonUserId);
    if (apiOnly.deleted) return apiOnly;
    return { deleted: false, reason: 'user_not_found' };
  }

  try {
    const sqlResult = await deleteNeonAuthUserByIdSql(pool, userId, email);
    if (sqlResult.deleted) return sqlResult;
  } catch (err) {
    console.error('[neon-auth-db] SQL delete failed:', err.message);
  }

  const stillThere = await findNeonAuthUserId(pool, { email, neonUserId: userId });
  if (!stillThere) {
    return { deleted: true, userId, method: 'sql' };
  }

  const apiResult = await deleteNeonAuthUserViaManagementApi(userId);
  if (apiResult.deleted) return apiResult;

  const afterApi = await findNeonAuthUserId(pool, { email, neonUserId: userId });
  if (!afterApi) {
    return { deleted: true, userId, method: 'neon_management_api' };
  }

  return {
    deleted: false,
    reason: apiResult.reason || 'delete_failed',
    userId,
    error: apiResult.error || 'Could not remove Neon Auth user.',
  };
}

module.exports = {
  isNeonUserAlreadyExistsError,
  findNeonAuthUserId,
  deleteNeonAuthUser,
  deleteNeonAuthUserByIdSql,
};
