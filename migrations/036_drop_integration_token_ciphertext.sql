-- Remove retrievable token storage; auth uses token_hash only (secret shown once at create/regenerate).
-- Run on Neon after deploying API without the token vault. Safe if column never existed.

ALTER TABLE public.api_integration_tokens
  DROP COLUMN IF EXISTS token_ciphertext;
