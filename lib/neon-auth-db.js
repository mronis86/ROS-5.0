/**
 * Direct Neon Auth (Better Auth) user cleanup via the shared Neon database.
 * Used when admin removes access or when an orphaned auth user blocks portal setup.
 */

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

async function findNeonAuthUserId(pool, { email, neonUserId }) {
  if (neonUserId) {
    const byId = await pool.query(`SELECT id FROM neon_auth."user" WHERE id = $1 LIMIT 1`, [neonUserId]);
    if (byId.rows[0]?.id) return String(byId.rows[0].id);
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const byEmail = await pool.query(`SELECT id FROM neon_auth."user" WHERE LOWER(email) = $1 LIMIT 1`, [
    normalizedEmail,
  ]);
  return byEmail.rows[0]?.id ? String(byEmail.rows[0].id) : null;
}

async function deleteNeonAuthUserById(pool, userId) {
  if (!userId) return { deleted: false, reason: 'missing_user_id' };

  try {
    await pool.query(`DELETE FROM neon_auth.session WHERE "userId" = $1`, [userId]);
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }

  try {
    await pool.query(`DELETE FROM neon_auth.account WHERE "userId" = $1`, [userId]);
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }

  try {
    await pool.query(`DELETE FROM neon_auth.verification WHERE "userId" = $1`, [userId]);
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }

  const userDelete = await pool.query(`DELETE FROM neon_auth."user" WHERE id = $1 RETURNING id`, [userId]);
  if (userDelete.rowCount === 0) {
    return { deleted: false, reason: 'user_not_found' };
  }

  try {
    await pool.query(`DELETE FROM neon_auth.users_sync WHERE id = $1`, [userId]);
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }

  return { deleted: true, userId };
}

async function deleteNeonAuthUser(pool, { email, neonUserId } = {}) {
  const userId = await findNeonAuthUserId(pool, { email, neonUserId });
  if (!userId) return { deleted: false, reason: 'user_not_found' };
  return deleteNeonAuthUserById(pool, userId);
}

module.exports = {
  isNeonUserAlreadyExistsError,
  findNeonAuthUserId,
  deleteNeonAuthUser,
  deleteNeonAuthUserById,
};
