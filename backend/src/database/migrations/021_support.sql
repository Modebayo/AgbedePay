-- 021_support.sql
-- Help & Support: a ticket thread per conversation with the support desk.
-- Tickets are APPEND-ONLY user messages plus an agent reply column; nothing
-- here touches money, so it deliberately has no ledger or idempotency rows.
-- A user's own open tickets are limited per day in the service layer.

CREATE TABLE support_tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reference     VARCHAR(24) NOT NULL UNIQUE,
  category      VARCHAR(32) NOT NULL CHECK (category IN
                  ('PAYMENT', 'WITHDRAWAL', 'KYC', 'DISPATCH', 'RIDE', 'CARD', 'OTHER')),
  subject       VARCHAR(120) NOT NULL,
  message       VARCHAR(1000) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  agent_reply   VARCHAR(1000),
  replied_at    TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open-ish ticket per user per category is enough; resolved ones pile up.
CREATE INDEX idx_support_tickets_user_created ON support_tickets(user_id, created_at DESC);
CREATE UNIQUE INDEX uq_support_tickets_user_open
ON support_tickets(user_id, category)
WHERE status IN ('OPEN', 'IN_PROGRESS');

CREATE TRIGGER support_tickets_set_updated_at
BEFORE UPDATE ON support_tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
