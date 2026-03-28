-- ═══════════════════════════════════════════════════════════════
-- Stock 訂閱系統 — PostgreSQL Schema
-- 版本: v1.0.0  日期: 2026-03-28
-- ═══════════════════════════════════════════════════════════════

-- ═══ 擴展 ═══
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ═══ 枚舉類型 ═══
CREATE TYPE user_plan     AS ENUM ('free','pro','premium');
CREATE TYPE signal_type   AS ENUM ('buy','sell','add','stop_loss');
CREATE TYPE trade_action  AS ENUM ('buy','sell','add');
CREATE TYPE trade_status  AS ENUM ('pending','confirmed','adjusted','ignored','expired');
CREATE TYPE email_status  AS ENUM ('pending','sending','sent','failed');
CREATE TYPE order_status  AS ENUM ('pending','paid','refunded','cancelled');

-- ═══════════ 3.1 users ═══════════
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  name          TEXT,
  plan          user_plan NOT NULL DEFAULT 'free',
  locale        TEXT NOT NULL DEFAULT 'zh-CN',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra         JSONB DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX idx_users_email   ON users (lower(email));
CREATE INDEX        idx_users_active  ON users (is_active) WHERE is_active = true;
CREATE INDEX        idx_users_plan    ON users (plan);

-- ═══════════ 3.2 email_codes ═══════════
CREATE TABLE email_codes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  purpose    TEXT NOT NULL DEFAULT 'login',
  ip         INET,
  used_at    TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_codes_lookup ON email_codes (lower(email), code)
  WHERE used_at IS NULL;
CREATE INDEX idx_email_codes_expire ON email_codes (expires_at)
  WHERE used_at IS NULL;

-- ═══════════ 3.3 sessions ═══════════
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_info JSONB DEFAULT '{}'::jsonb,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user   ON sessions (user_id);
CREATE INDEX idx_sessions_expire ON sessions (expires_at);

-- ═══════════ 3.4 symbols ═══════════
CREATE TABLE symbols (
  symbol      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_zh     TEXT,
  asset_type  TEXT NOT NULL DEFAULT 'equity',
  exchange    TEXT,
  sector      TEXT,
  market_cap  BIGINT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra       JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_symbols_trgm_name   ON symbols USING gin (name gin_trgm_ops);
CREATE INDEX idx_symbols_trgm_symbol ON symbols USING gin (symbol gin_trgm_ops);
CREATE INDEX idx_symbols_type        ON symbols (asset_type);

-- ═══════════ 3.5 ohlcv ═══════════
CREATE TABLE ohlcv (
  symbol  TEXT NOT NULL REFERENCES symbols(symbol),
  ts      TIMESTAMPTZ NOT NULL,
  tf      TEXT NOT NULL DEFAULT '1d',
  o       NUMERIC(18,6) NOT NULL,
  h       NUMERIC(18,6) NOT NULL,
  l       NUMERIC(18,6) NOT NULL,
  c       NUMERIC(18,6) NOT NULL,
  v       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, tf, ts)
);

CREATE INDEX idx_ohlcv_recent ON ohlcv (symbol, tf, ts DESC);

-- ═══════════ 3.6 user_account ═══════════
CREATE TABLE user_account (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_capital NUMERIC(18,2) NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra         JSONB DEFAULT '{}'::jsonb
);

-- ═══════════ 3.7 user_watchlist ═══════════
CREATE TABLE user_watchlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT NOT NULL REFERENCES symbols(symbol),
  notify     BOOLEAN NOT NULL DEFAULT true,
  min_score  SMALLINT NOT NULL DEFAULT 65
             CHECK (min_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra      JSONB DEFAULT '{}'::jsonb,
  UNIQUE (user_id, symbol)
);

CREATE INDEX idx_watchlist_symbol ON user_watchlist (symbol)  WHERE notify = true;
CREATE INDEX idx_watchlist_user   ON user_watchlist (user_id);

-- ═══════════ 3.8 user_portfolio ═══════════
CREATE TABLE user_portfolio (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL REFERENCES symbols(symbol),
  shares        NUMERIC(18,6) NOT NULL,
  avg_cost      NUMERIC(18,6) NOT NULL,
  total_capital NUMERIC(18,2) NOT NULL,
  target_profit NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  stop_loss     NUMERIC(5,4) NOT NULL DEFAULT 0.08,
  notify        BOOLEAN NOT NULL DEFAULT true,
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra         JSONB DEFAULT '{}'::jsonb,
  UNIQUE (user_id, symbol)
);

CREATE INDEX idx_portfolio_symbol ON user_portfolio (symbol)  WHERE notify = true;
CREATE INDEX idx_portfolio_user   ON user_portfolio (user_id);

-- ═══════════ 3.9 signals ═══════════
CREATE TABLE signals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol     TEXT NOT NULL,
  type       signal_type NOT NULL,
  score      SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  price      NUMERIC(18,6) NOT NULL,
  reasons    TEXT[] NOT NULL DEFAULT '{}',
  analysis   JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_signals_symbol ON signals (symbol, created_at DESC);
CREATE INDEX idx_signals_type   ON signals (type, created_at DESC);

-- ═══════════ 3.10 trade_log ═══════════
CREATE TABLE trade_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  symbol           TEXT NOT NULL,
  action           trade_action NOT NULL,

  -- 系統建議
  suggested_shares NUMERIC(18,6) NOT NULL,
  suggested_price  NUMERIC(18,6) NOT NULL,
  suggested_amount NUMERIC(18,2) NOT NULL,

  -- 用戶實際（確認後填入）
  actual_shares    NUMERIC(18,6),
  actual_price     NUMERIC(18,6),
  actual_amount    NUMERIC(18,2),

  -- 狀態與安全
  signal_id        UUID REFERENCES signals(id),
  status           trade_status NOT NULL DEFAULT 'pending',
  link_token       TEXT NOT NULL,
  link_sig         TEXT NOT NULL,
  confirmed_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra            JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_trade_user    ON trade_log (user_id, created_at DESC);
CREATE INDEX idx_trade_pending ON trade_log (status, expires_at)
  WHERE status = 'pending';
CREATE UNIQUE INDEX idx_trade_link_token ON trade_log (link_token);

-- ═══════════ 3.11 notifications (按月分區) ═══════════
CREATE TABLE notifications (
  id         UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  signal_id  UUID,
  trade_id   UUID,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE notifications_2026_03 PARTITION OF notifications
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE notifications_2026_04 PARTITION OF notifications
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE notifications_2026_05 PARTITION OF notifications
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE notifications_2026_06 PARTITION OF notifications
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE notifications_2026_07 PARTITION OF notifications
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE notifications_2026_08 PARTITION OF notifications
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE notifications_default  PARTITION OF notifications DEFAULT;

CREATE INDEX idx_notif_user ON notifications (user_id, created_at DESC);

-- ═══════════ 3.12 email_queue ═══════════
CREATE TABLE email_queue (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID NOT NULL,
  email        TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body_html    TEXT NOT NULL,
  priority     SMALLINT NOT NULL DEFAULT 5,
  status       email_status NOT NULL DEFAULT 'pending',
  attempts     SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 3,
  locked_by    TEXT,
  locked_at    TIMESTAMPTZ,
  error        TEXT,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_pending ON email_queue (priority, created_at)
  WHERE status = 'pending';
CREATE INDEX idx_email_locked  ON email_queue (locked_by, locked_at)
  WHERE status = 'sending';

-- ═══════════ 3.13 user_events (按月分區) ═══════════
CREATE TABLE user_events (
  id         UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  event      TEXT NOT NULL,
  payload    JSONB DEFAULT '{}'::jsonb,
  ip         INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE user_events_2026_03 PARTITION OF user_events
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE user_events_2026_04 PARTITION OF user_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE user_events_2026_05 PARTITION OF user_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE user_events_2026_06 PARTITION OF user_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE user_events_2026_07 PARTITION OF user_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE user_events_2026_08 PARTITION OF user_events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE user_events_default  PARTITION OF user_events DEFAULT;

CREATE INDEX idx_events_user ON user_events (user_id, created_at DESC);

-- ═══════════ 3.14 sys_config ═══════════
CREATE TABLE sys_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sys_config (key, value, note) VALUES
  ('max_watchlist_free',  '10',  'free 用戶最多關注數'),
  ('max_portfolio_free',  '5',   'free 用戶最多持倉數'),
  ('max_watchlist_pro',   '50',  'pro 用戶最多關注數'),
  ('max_portfolio_pro',   '20',  'pro 用戶最多持倉數'),
  ('scanner_interval',    '300', 'Scanner 掃描間隔（秒）'),
  ('email_merge_window',  '300', '郵件合併窗口（秒）'),
  ('trade_expires_hours', '24',  '交易建議過期時間（小時）');

-- ═══════════ 3.15 預留表 ═══════════
CREATE TABLE orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id),
  plan           user_plan NOT NULL,
  amount         NUMERIC(10,2) NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'USD',
  payment_method TEXT,
  status         order_status NOT NULL DEFAULT 'pending',
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra          JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE posts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL,
  content    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra      JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE signal_outcomes (
  signal_id    UUID NOT NULL REFERENCES signals(id),
  check_days   INT NOT NULL,
  price_then   NUMERIC(18,6) NOT NULL,
  price_now    NUMERIC(18,6) NOT NULL,
  pnl_pct      NUMERIC(8,4) NOT NULL,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_id, check_days)
);

-- ═══════════ 3.16 物化視圖 active_symbols ═══════════
CREATE MATERIALIZED VIEW active_symbols AS
  SELECT DISTINCT symbol FROM (
    SELECT symbol FROM user_watchlist WHERE notify = true
    UNION
    SELECT symbol FROM user_portfolio WHERE notify = true
  ) sub;

CREATE UNIQUE INDEX idx_active_symbols ON active_symbols (symbol);

-- ═══════════ 維護備注 ═══════════
-- 每月自動創建下月分區（cron 任務）
-- 每季度清理 3 個月前的 email_queue (status IN ('sent','failed'))
-- 每天清理過期的 email_codes (expires_at < now() - interval '1 day')
-- 每天清理過期的 sessions (expires_at < now())
-- 每天過期未操作的 trade_log (status='pending' AND expires_at < now())
