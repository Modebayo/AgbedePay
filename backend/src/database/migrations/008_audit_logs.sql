-- 008_audit_logs.sql
-- Immutable trail of security + financial events (login, transfer, PIN change…).
-- NEVER stores PINs, passwords, OTPs or tokens.

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(64) NOT NULL,         -- e.g. 'LOGIN', 'TRANSFER_SUCCESS'
  entity_type VARCHAR(64),                  -- what thing, e.g. 'TRANSACTION'
  entity_id   VARCHAR(64),                  -- its id
  metadata    JSONB,                        -- extra context, still no secrets
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_user_id    ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action     ON audit_logs(action);