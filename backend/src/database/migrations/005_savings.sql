-- 005_savings.sql
-- Savings goals ("New Laptop" -> target amount by a date)
-- and every deposit that built them.

CREATE TABLE savings_goals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  VARCHAR(120) NOT NULL,
  target_amount_minor   BIGINT NOT NULL CHECK (target_amount_minor > 0),
  current_amount_minor  BIGINT NOT NULL DEFAULT 0 CHECK (current_amount_minor >= 0),
  target_date           DATE,
  status                VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'ACHIEVED', 'CLOSED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_savings_goals_user_id ON savings_goals(user_id);

CREATE TRIGGER savings_goals_set_updated_at
BEFORE UPDATE ON savings_goals
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every deposit (money is never "guessed"; each kobo has a row).
CREATE TABLE savings_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id      UUID NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  type         VARCHAR(20) NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL')),
  reference    VARCHAR(64) NOT NULL UNIQUE,
  status       VARCHAR(20) NOT NULL DEFAULT 'SUCCESS'
               CHECK (status IN ('SUCCESS', 'FAILED', 'REVERSED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_savings_tx_goal_id ON savings_transactions(goal_id);
CREATE INDEX idx_savings_tx_user_id ON savings_transactions(user_id);