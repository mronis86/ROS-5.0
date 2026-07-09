-- Store AES-encrypted integration token for admin re-copy (Companion, Spout, etc.).
-- Auth still uses token_hash only. Run on Neon after deploying API vault code.

ALTER TABLE public.api_integration_tokens
  ADD COLUMN IF NOT EXISTS token_ciphertext TEXT;
