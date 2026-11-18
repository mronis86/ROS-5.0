-- Integration tokens are often created by Neon Auth admins.
-- auth.userId is neon_user_id, not public.api_users.id — so the old FK fails.
-- Keep created_by as a stable account UUID (Neon or legacy api_users) with no FK.

ALTER TABLE public.api_integration_tokens
  DROP CONSTRAINT IF EXISTS api_integration_tokens_created_by_fkey;
