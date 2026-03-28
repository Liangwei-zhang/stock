# 📈 Stock 订阅系统 — 完整设计方案

> **版本**: v1.0.0 | **日期**: 2026-03-28 | **状态**: 已锁定，开始开发
>
> 本文档是 stock 项目改造为手机端订阅系统的唯一设计真相源（Single Source of Truth），
> 所有后续 PR 以本文档为准。

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [数据库完整 Schema](#3-数据库完整-schemapostgresql)
4. [资金闭环模型](#4-资金闭环模型)
5. [用户全流程](#5-用户全流程步骤--到-)
6. [邮件内容模板](#6-邮件内容模板)
7. [手机端 H5 页面设计](#7-手机端-h5-页面设计)
8. [API 接口清单](#8-api-接口清单)
9. [技术栈与依赖](#9-技术栈与依赖)
10. [目录结构](#10-目录结构)
11. [开发计划 PR 路线](#11-开发计划pr-路线)
12. [成本估算](#12-成本估算)
13. [安全设计](#13-安全设计)
14. [SmartClean Framework 提取方案](#14-smartclean-framework-提取方案)

---

## 1. 项目概述

### 1.1 产品定位

将现有的股票分析工具（`Liangwei-zhang/stock`）改造为**手机端邮件订阅系统**，
帮助普通用户解决两个核心痛点：

| 模块 | 痛点 | 解决方案 |
|------|------|---------|
| **模块 1 — 买入时机** | 用户不知道什么时候该买 | 系统扫描信号 → 发邮件告知精确买入股数和金额 |
| **模块 2 — 卖出时机** | 用户不知道什么时候该卖 | 系统按用户成本逐人计算 → 分批止盈/止损邮件 |

### 1.2 核心设计原则

- **邮箱验证码登录**：无密码，零门槛
- **邮件是唯一通知渠道**：网页只做设置，不展示实时行情
- **仓位管理闭环**：系统建议精确到股数和金额，用户可确认/调整/忽略
- **一步到位**：PostgreSQL 数据库面向 1000 万日活设计，不做后续迁移

### 1.3 目标规模

| 指标 | 数值 |
|------|------|
| 目标日活 | 1000 万 |
| 注册用户 | 5000 万 |
| 关注记录 | 2.5 亿条 |
| 持仓记录 | 1 亿条 |
| 每日邮件 | 500 万 ~ 5000 万封（取决于信号密度）|
| 通知记录 | 数十亿（按月分区）|

---

## 2. 系统架构

### 2.1 架构图

```
                         ┌─────────────────────┐
                         │     用户手机端        │
                         │  ① H5 网页（设置）    │
                         │  ② 邮箱（收通知）     │
                         └──────────┬──────────┘
                                    │
                         ┌──────────▼──────────┐
                         │       Nginx          │
                         │  SSL / gzip / 静态   │
                         │  HTTP/3 + 零拷贝     │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
           ┌────────▼──────┐ ┌─────▼──────┐ ┌──────▼───────┐
           │  Express API  │ │  Scanner   │ │ Email Worker │
           │  (HTTP 服务)   │ │ (定时扫描)  │ │ (邮件发送)   │
           │  端口 3000     │ │ 每5分钟     │ │ 持续运行     │
           └───────┬───────┘ └─────┬──────┘ └──────┬───────┘
                   │               │               │
           ┌───────┴───────────────┴───────────────┴───────┐
           │                                               │
    ┌──────▼──────┐                              ┌─────────▼─────────┐
    │  PostgreSQL  │                              │      Redis        │
    │  + PgBouncer │                              │  L1+L2 缓存       │
    │  持久化存储   │                              │  Session / 限流   │
    └─────────────┘                              └───────────────────┘
```

### 2.2 四个进程

| 进程 | 职责 | 运行方式 |
|------|------|---------|
| **API** | HTTP 接口，处理登录/设置/确认 | Express，PM2 管理 |
| **Scanner** | 定时扫描 symbol，生成买卖信号 | 独立 Node 进程，每 5 分钟一轮 |
| **Email Worker** | 消费 `email_queue`，发送邮件 | 独立 Node 进程，持续轮询 |
| **Scheduler** | cron 任务：分区维护、物化视图刷新 | 复用 Scanner 进程的定时器 |

### 2.3 容量估算

| 资源 | 估算 |
|------|------|
| API QPS | ~7（用户极少打开网页，只改设置）|
| Scanner 每轮 | 5000 unique symbols × 5ms = **25 秒**，远小于 5 分钟间隔 |
| 邮件峰值 | 热门 symbol 触发 → 50 万封，Amazon SES 10K/秒 = **50 秒** |
| PostgreSQL | 连接池 40（PgBouncer），pool_mode=transaction |
| Redis | 2GB 内存，allkeys-lru |

---

## 3. 数据库完整 Schema（PostgreSQL）

### 3.0 扩展与全局设置

```sql
-- ═══ 扩展 ═══
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- 模糊搜索

-- ═══ 枚举类型 ═══
CREATE TYPE user_plan     AS ENUM ('free','pro','premium');
CREATE TYPE signal_type   AS ENUM ('buy','sell','add','stop_loss');
CREATE TYPE trade_action  AS ENUM ('buy','sell','add');
CREATE TYPE trade_status  AS ENUM ('pending','confirmed','adjusted','ignored','expired');
CREATE TYPE email_status  AS ENUM ('pending','sending','sent','failed');
CREATE TYPE order_status  AS ENUM ('pending','paid','refunded','cancelled');
```

### 3.1 users — 用户表

```sql
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

CREATE UNIQUE INDEX idx_users_email ON users (lower(email));
CREATE INDEX idx_users_active ON users (is_active) WHERE is_active = true;
CREATE INDEX idx_users_plan ON users (plan);
```

### 3.2 email_codes — 邮箱验证码

```sql
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
```

### 3.3 sessions — 会话

```sql
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_info JSONB DEFAULT '{}'::jsonb,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expire ON sessions (expires_at);
```

### 3.4 symbols — 标的基础信息

```sql
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

CREATE INDEX idx_symbols_trgm_name ON symbols
  USING gin (name gin_trgm_ops);
CREATE INDEX idx_symbols_trgm_symbol ON symbols
  USING gin (symbol gin_trgm_ops);
CREATE INDEX idx_symbols_type ON symbols (asset_type);
```

### 3.5 ohlcv — K 线缓存

```sql
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
```

### 3.6 user_account — 用户资金账户

```sql
CREATE TABLE user_account (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_capital NUMERIC(18,2) NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra         JSONB DEFAULT '{}'::jsonb
);
```

### 3.7 user_watchlist — 关注清单（模块 1）

```sql
CREATE TABLE user_watchlist (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol    TEXT NOT NULL REFERENCES symbols(symbol),
  notify    BOOLEAN NOT NULL DEFAULT true,
  min_score SMALLINT NOT NULL DEFAULT 65
            CHECK (min_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra      JSONB DEFAULT '{}'::jsonb,
  UNIQUE (user_id, symbol)
);

CREATE INDEX idx_watchlist_symbol ON user_watchlist (symbol)
  WHERE notify = true;
CREATE INDEX idx_watchlist_user ON user_watchlist (user_id);
```

### 3.8 user_portfolio — 持仓管理（模块 2）

```sql
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

CREATE INDEX idx_portfolio_symbol ON user_portfolio (symbol)
  WHERE notify = true;
CREATE INDEX idx_portfolio_user ON user_portfolio (user_id);
```

### 3.9 signals — 信号记录

```sql
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
CREATE INDEX idx_signals_type ON signals (type, created_at DESC);
```

### 3.10 trade_log — 交易建议记录

```sql
CREATE TABLE trade_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  symbol           TEXT NOT NULL,
  action           trade_action NOT NULL,

  -- 系统建议
  suggested_shares NUMERIC(18,6) NOT NULL,
  suggested_price  NUMERIC(18,6) NOT NULL,
  suggested_amount NUMERIC(18,2) NOT NULL,

  -- 用户实际（确认后填入）
  actual_shares    NUMERIC(18,6),
  actual_price     NUMERIC(18,6),
  actual_amount    NUMERIC(18,2),

  -- 状态与安全
  signal_id        UUID REFERENCES signals(id),
  status           trade_status NOT NULL DEFAULT 'pending',
  link_token       TEXT NOT NULL,
  link_sig         TEXT NOT NULL,
  confirmed_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra            JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_trade_user ON trade_log (user_id, created_at DESC);
CREATE INDEX idx_trade_pending ON trade_log (status, expires_at)
  WHERE status = 'pending';
```

### 3.11 notifications — 通知记录（按月分区）

```sql
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

-- 分区
CREATE TABLE notifications_2026_03 PARTITION OF notifications
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE notifications_2026_04 PARTITION OF notifications
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE notifications_2026_05 PARTITION OF notifications
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE notifications_2026_06 PARTITION OF notifications
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE notifications_default PARTITION OF notifications DEFAULT;

CREATE INDEX idx_notif_user ON notifications (user_id, created_at DESC);
```

### 3.12 email_queue — 邮件队列

```sql
CREATE TABLE email_queue (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID NOT NULL,
  email      TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body_html  TEXT NOT NULL,
  priority   SMALLINT NOT NULL DEFAULT 5,
  status     email_status NOT NULL DEFAULT 'pending',
  attempts   SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 3,
  locked_by  TEXT,
  locked_at  TIMESTAMPTZ,
  error      TEXT,
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_pending ON email_queue (priority, created_at)
  WHERE status = 'pending';
CREATE INDEX idx_email_locked ON email_queue (locked_by, locked_at)
  WHERE status = 'sending';
```

### 3.13 user_events — 用户行为日志（按月分区）

```sql
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
CREATE TABLE user_events_default PARTITION OF user_events DEFAULT;

CREATE INDEX idx_events_user ON user_events (user_id, created_at DESC);
```

### 3.14 sys_config — 系统配置

```sql
CREATE TABLE sys_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sys_config (key, value, note) VALUES
  ('max_watchlist_free',  '10',    'free 用户最多关注数'),
  ('max_portfolio_free',  '5',     'free 用户最多持仓数'),
  ('max_watchlist_pro',   '50',    'pro 用户最多关注数'),
  ('max_portfolio_pro',   '20',    'pro 用户最多持仓数'),
  ('scanner_interval',    '300',   'Scanner 扫描间隔（秒）'),
  ('email_merge_window',  '300',   '邮件合并窗口（秒）'),
  ('trade_expires_hours', '24',    '交易建议过期时间（小时）');
```

### 3.15 预留表

```sql
-- 付费订单（预留）
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

-- 社区帖子（预留）
CREATE TABLE posts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL,
  content    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra      JSONB DEFAULT '{}'::jsonb
);

-- 信号准确率追踪（预留）
CREATE TABLE signal_outcomes (
  signal_id    UUID NOT NULL REFERENCES signals(id),
  check_days   INT NOT NULL,
  price_then   NUMERIC(18,6) NOT NULL,
  price_now    NUMERIC(18,6) NOT NULL,
  pnl_pct      NUMERIC(8,4) NOT NULL,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_id, check_days)
);
```

### 3.16 物化视图 — active_symbols

```sql
CREATE MATERIALIZED VIEW active_symbols AS
  SELECT DISTINCT symbol FROM (
    SELECT symbol FROM user_watchlist WHERE notify = true
    UNION
    SELECT symbol FROM user_portfolio WHERE notify = true
  ) sub;

CREATE UNIQUE INDEX idx_active_symbols ON active_symbols (symbol);

-- 刷新（Scanner 每轮开始前执行）
-- REFRESH MATERIALIZED VIEW CONCURRENTLY active_symbols;
```

### 3.17 维护备注

```sql
-- 每月自动创建下月分区（cron 任务）
-- 每季度清理 3 个月前的 email_queue (status IN ('sent','failed'))
-- 每天清理过期的 email_codes (expires_at < now() - interval '1 day')
-- 每天清理过期的 sessions (expires_at < now())
-- 每天过期未操作的 trade_log (status='pending' AND expires_at < now())
```

---

## 4. 资金闭环模型

### 4.1 资金流向

```
┌─────────────────────────────────────────────────────────┐
│                    用户账户总览                           │
│                                                         │
│   总资产 = 总资金（user_account.total_capital）           │
│                                                         │
│   ┌──────────┐    买入确认        ┌──────────────────┐  │
│   │          │  ──────────────→   │                  │  │
│   │  可用现金  │   现金 → 持仓      │   持仓（多支）     │  │
│   │  动态计算  │                    │  AAPL $10,000    │  │
│   │          │  ←──────────────   │  NVDA $20,000    │  │
│   │          │   卖出确认          │  TSLA $15,000    │  │
│   │          │   持仓 → 现金      │                  │  │
│   └──────────┘                    └──────────────────┘  │
│                                                         │
│   可用现金 = total_capital - Σ(portfolio.total_capital)   │
│   ★ 动态计算，永远不存字段                                │
└─────────────────────────────────────────────────────────┘
```

### 4.2 买入头寸计算

| 信号强度 | 目标仓位占比 |
|---------|------------|
| Score 60-70（弱） | 总资金的 5% |
| Score 70-80（中） | 总资金的 10% |
| Score 80-90（强） | 总资金的 15% |
| Score 90+（极强） | 总资金的 20% |

**约束条件**：
- 单支不超过总资金 30%
- 保留 10% 现金缓冲（极强信号放宽到 5%）
- 可用现金不足时按比例缩减
- 向下取整到整股

### 4.3 卖出分批策略

| 条件 | 卖出比例 | 说明 |
|------|---------|------|
| 盈利 ≥ target_profit（默认15%）且 < 25% | 卖 50% | 锁定一半利润 |
| 盈利 ≥ 25% 且 < 40% | 卖 75% | 锁定大部分 |
| 盈利 ≥ 40% | 卖 100% | 全部清仓 |
| SMC 顶部概率 > 70% | 至少卖 50% | 无论盈利多少 |
| 止损触发 (亏损 ≥ stop_loss) | 卖 100% | 全部止损 |

### 4.4 确认流程（三按钮）

```
邮件到达
   │
   ├─ [按建议确认] → 一键更新持仓（免登录，一次性 token）
   │
   ├─ [我调整了]   → 打开 H5 调整页面，填实际股数/价格（免登录）
   │
   └─ [忽略]       → 标记 ignored，不改持仓
```

**状态机**：

```
                    邮件发出
                       │
                       ▼
                   ┌────────┐
                   │ pending │
                   └────┬───┘
                        │
           ┌────────────┼────────────┐──────────┐
           │            │            │          │
    [按建议确认]    [我调整了]     [忽略]     24h 超时
           │            │            │          │
           ▼            ▼            ▼          ▼
     ┌───────────┐ ┌──────────┐ ┌─────────┐ ┌────────┐
     │ confirmed │ │ adjusted │ │ ignored │ │expired │
     └───────────┘ └──────────┘ └─────────┘ └────────┘
```

### 4.5 持仓更新逻辑

**买入确认后**：
```
已有持仓 → 加权平均成本
  new_total_shares = old_shares + actual_shares
  new_avg_cost = (old_shares × old_avg_cost + actual_shares × actual_price) / new_total_shares
  new_total_capital = new_total_shares × new_avg_cost

无持仓 → 新建
  INSERT (symbol, shares=actual_shares, avg_cost=actual_price, total_capital=shares×price)
```

**卖出确认后**：
```
部分卖出 → 减少股数（成本不变）
  remain = old_shares - actual_shares
  total_capital = remain × avg_cost

全部卖出 → DELETE 持仓行
```

---

## 5. 用户全流程（步骤 ① 到 ㉛）

### Phase 1：注册 / 登录（①-⑦）

| 步骤 | 用户操作 | 系统行为 | 数据库变化 |
|------|---------|---------|-----------|
| ① | 手机打开 `stock.xxx.com` | Nginx 返回 H5 页面 | 无 |
| ② | 看到登录页，输入邮箱 | 前端渲染 LoginPage | 无 |
| ③ | 点击「发送验证码」| 限流检查(60s/次) → 生成6位码 → 写DB + Redis(TTL 5min) → 发邮件 | INSERT email_codes |
| ④ | 查邮箱，收到验证码 | SES 已发出 | 无 |
| ⑤ | 填入验证码，点击登录 | — | — |
| ⑥ | — | 校验验证码 → 查 users → 不存在则自动注册 → 生成 JWT | INSERT/UPDATE users, INSERT sessions |
| ⑦ | 前端存 token，跳转首页 | 后续请求带 Authorization header | 无 |

**首次用户引导**：跳转到「设置总资金」页面。

### Phase 2：设置关注 — 模块 1（⑧-⑭）

| 步骤 | 用户操作 | 系统行为 |
|------|---------|---------|
| ⑧ | 进入首页 | 展示账户总览 |
| ⑨ | 点击「关注」tab | GET /api/watchlist（首次为空）|
| ⑩ | 点击「+ 添加关注」| 弹出搜索框 |
| ⑪ | 搜索 "AAPL" | GET /api/search?q=AAPL → pg_trgm 模糊匹配 |
| ⑫ | 选择 AAPL，设灵敏度 65 | POST /api/watchlist → INSERT user_watchlist |
| ⑬ | 继续添加 TSLA、BTC | 重复 ⑪⑫ |
| ⑭ | 查看关注列表 | 纯设置页面，**不展示实时价格** |

**约束**：free 用户最多 10 个关注。

### Phase 3：设置持仓 — 模块 2（⑮-⑱）

| 步骤 | 用户操作 | 系统行为 |
|------|---------|---------|
| ⑮ | 点击「持仓」tab | GET /api/portfolio |
| ⑯ | 点击「+ 新增持仓」| 弹出表单 |
| ⑰ | 填写：NVDA / $20,000 / 100股 / 止盈15% / 止损8% | POST /api/portfolio → INSERT user_portfolio |
| ⑱ | 查看持仓列表 | 展示仓位占比，**不展示当前价格和盈亏** |

**约束**：free 用户最多 5 个持仓。

### Phase 4：Scanner 后台扫描（⑲-㉕）

| 步骤 | 系统行为 |
|------|---------|
| ⑲ | Scheduler 每 5 分钟触发 Scanner |
| ⑳ | REFRESH MATERIALIZED VIEW active_symbols → 得到 ~5000 unique symbol |
| ㉑ | 批量更新行情：Redis L1(5s) → Redis L2(60s) → ohlcv 表 → Yahoo API 兜底 |
| ㉒ | 对每个 symbol 跑 SMC Gen 3.0 分析（复用 indicatorService.analyzeStock）|
| ㉓ | **买入信号检测**：score ≥ 用户 min_score → 调 PositionEngine 算头寸 → INSERT signals → 批量 INSERT email_queue |
| ㉔ | **卖出信号检测**：逐用户算盈亏 → 匹配分批止盈/止损条件 → 调 PositionEngine → INSERT email_queue |
| ㉕ | 扫描完成，日志记录耗时 |

### Phase 5：邮件发送（㉖-㉙）

| 步骤 | 系统行为 |
|------|---------|
| ㉖ | Email Worker 轮询 `SELECT ... FROM email_queue WHERE status='pending' ORDER BY priority, created_at LIMIT 100 FOR UPDATE SKIP LOCKED` |
| ㉗ | 同用户 5 分钟内多信号 → 合并为一封 |
| ㉘ | 调用 Amazon SES 发送 HTML 邮件 |
| ㉙ | 成功 → status='sent'；失败 → attempts+1，3 次后 status='failed' |

### Phase 6：用户收到邮件（㉚-㉛）

| 步骤 | 说明 |
|------|------|
| ㉚ | 用户手机收到邮件（买入/加仓/卖出/止损），包含 3 个按钮链接 |
| ㉛ | 用户去券商 APP 操作后，回邮件点确认/调整/忽略 |

### Phase 7：交易确认

邮件中 3 个按钮的链接：
```
[按建议确认] → GET /api/trade/:id/confirm?action=accept&t=one_time_token&sig=hmac
[我调整了]   → GET /trade/adjust?id=xxx&t=one_time_token&sig=hmac  → 打开 H5 表单
[忽略]       → GET /api/trade/:id/confirm?action=ignore&t=one_time_token&sig=hmac
```

**全程免登录**，一次性 token + HMAC 签名认证。

### Phase 8：稳态

- 用户极少打开网页（只改设置）
- 绝大多数时间只看邮件
- 没信号不打扰

---

## 6. 邮件内容模板

### 6.1 验证码邮件

```
Subject: 您的登录验证码 382716

您正在登录 Stock Signal 系统，验证码为：

382716

5 分钟内有效，请勿泄露给他人。

如非本人操作，请忽略此邮件。
```

### 6.2 买入建议邮件

```
Subject: 📈 买入建议 | AAPL  Apple Inc.

🎯 信号强度：强买入（Score: 82/100）
💰 当前价格：$178.52

── 建议操作 ──────────────────
买入 28 股 × $178.52
投入金额：$4,998.56

── 您的账户 ──────────────────
总资金：    $50,000
当前持仓：  $32,000 (64%)
可用现金：  $18,000 (36%)
  ↓ 买入后 ↓
AAPL 仓位：$4,998 (10%)
可用现金：  $13,001 (26%)

📊 信号依据：
  • SFP 底部确认
  • CHOCH 结构转换
  • FVG 公允价值缺口

⚠️ 以上为系统算法建议，不构成投资建议

[按建议确认]  [我调整了]  [忽略]
```

### 6.3 加仓建议邮件

```
Subject: 📈 加仓建议 | AAPL  Apple Inc.

🎯 信号强度：极强买入（Score: 92/100）
💰 当前价格：$172.30（较成本 $178.52 下跌 3.5%）

── 建议操作 ──────────────────
加仓 29 股 × $172.30
追加金额：$4,996.70

── 您的持仓变化 ──────────────
         加仓前        →    加仓后
股数：    28 股              57 股
成本：    $178.52            $175.47（摊低）
仓位：    10%                20%

── 您的账户 ──────────────────
可用现金：$13,001 → $8,004

📊 加仓理由：极强买入信号，价格在支撑区间

⚠️ 以上为系统算法建议，不构成投资建议

[按建议确认]  [我调整了]  [忽略]
```

### 6.4 卖出/止盈建议邮件

```
Subject: 🔔 止盈建议 | NVDA  NVIDIA Corp

📊 您的持仓：
  100 股 × 成本 $200.00
  当前价格：$234.00
  盈亏：+$3,400 (+17.0%)

── 建议操作 ──────────────────
卖出 50 股 × $234.00
回收金额：$11,700
锁定利润：+$1,700

── 卖出后持仓 ──────────────
剩余：50 股 × 成本 $200.00

── 您的账户 ──────────────────
可用现金：$8,004 → $19,704
总持仓：  64% → 41%

✅ 已达目标 15%（当前 +17%），建议卖出 50% 锁定利润

⚠️ 以上为系统算法建议，不构成投资建议

[按建议确认]  [我调整了]  [忽略]
```

### 6.5 止损建议邮件

```
Subject: ⛔ 止损提醒 | TSLA  Tesla Inc.

📊 您的持仓：
  40 股 × 成本 $175.00
  当前价格：$159.25
  盈亏：-$630 (-9.0%)

── 建议操作 ──────────────────
全部卖出 40 股 × $159.25
回收金额：$6,370
止损金额：-$630

⛔ 已触发止损线 8%（当前 -9.0%），建议全部卖出止损

⚠️ 以上为系统算法建议，不构成投资建议

[按建议确认]  [我调整了]  [忽略]
```

### 6.6 合并通知邮件

```
Subject: 📊 3 个信号提醒

您有 3 个新的交易建议：

1. 📈 买入 AAPL — 28 股 × $178.52 [查看详情]
2. 🔔 止盈 NVDA — 卖出 50 股 × $234.00 [查看详情]
3. ⛔ 止损 TSLA — 卖出 40 股 × $159.25 [查看详情]

请点击各项查看详情并确认操作。

── 管理订阅 ──
[修改关注] [取消订阅]
```

---

## 7. 手机端 H5 页面设计

### 7.1 页面清单

| 页面 | 路由 | 说明 |
|------|------|------|
| 登录页 | `/login` | 邮箱 + 验证码 |
| 引导页 | `/onboard` | 首次设置总资金 |
| 首页 | `/` | 账户总览 |
| 关注页 | `/watchlist` | 关注 CRUD + 搜索 |
| 持仓页 | `/portfolio` | 持仓列表 + 分配柱状图 |
| 通知记录 | `/notifications` | 通知历史 |
| 设置页 | `/settings` | 总资金 / 语言 / 时区 / 注销 |
| 确认成功页 | `/trade/success` | 邮件链接确认后落地 |
| 调整表单页 | `/trade/adjust` | 邮件链接调整操作 |

底部导航：**首页 | 关注 | 持仓 | 设置**

### 7.2 首页账户总览

```
┌─────────────────────────────────────────────┐
│  💰 我的账户                                 │
│ ─────────────────────────────────────────── │
│   总资金        $50,000                      │
│   ┌─────────────────────────────────────┐   │
│   │██████████████████░░░░░░░░░░░░░░░░│   │
│   └─────────────────────────────────────┘   │
│   持仓 $32,000 (64%)    现金 $18,000 (36%)   │
│                                             │
│   持仓明细：                                 │
│   AAPL  28股  $178.52   $4,998    (10%)     │
│   NVDA 100股  $200.00  $20,000    (40%)     │
│   TSLA  40股  $175.00   $7,000    (14%)     │
│                                             │
│   [修改总资金]                                │
└─────────────────────────────────────────────┘
```

---

## 8. API 接口清单

### Auth

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/auth/send-code` | 发送验证码 |
| POST | `/api/auth/verify` | 验证码登录 |
| POST | `/api/auth/logout` | 登出 |

### Account

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/account` | 获取账户信息（含可用现金计算）|
| PUT | `/api/account` | 更新总资金 / 语言 / 时区 |

### Watchlist

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/watchlist` | 获取关注列表 |
| POST | `/api/watchlist` | 添加关注 |
| PUT | `/api/watchlist/:id` | 修改灵敏度 |
| DELETE | `/api/watchlist/:id` | 删除关注 |

### Portfolio

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/portfolio` | 获取持仓列表 |
| POST | `/api/portfolio` | 手动添加持仓 |
| PUT | `/api/portfolio/:id` | 修改持仓参数 |
| DELETE | `/api/portfolio/:id` | 删除持仓 |

### Search

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/search?q=xxx` | 搜索标的（pg_trgm）|

### Trade

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/trade/:id/confirm` | 确认/忽略（邮件链接）|
| POST | `/api/trade/:id/adjust` | 提交实际操作（调整页面）|

### Notifications

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/notifications` | 通知历史 |
| PUT | `/api/notifications/:id/read` | 标记已读 |

### Health

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 健康检查 |

---

## 9. 技术栈与依赖

| 层 | 技术 |
|----|------|
| 前端 | React + TypeScript + Vite（现有）+ 新增 H5 页面 |
| 后端 | Express.js（重构现有 server.ts）|
| 数据库 | PostgreSQL 16 + PgBouncer |
| 缓存 | Redis 7 (ioredis) |
| 邮件 | Amazon SES / Resend |
| 部署 | Docker Compose + PM2 + Nginx |
| 从 SmartClean 复用 | 见第 14 章 |

---

## 10. 目录结构

```
stock/
├── server/
│   ├── api.ts                   # Express 入口
│   ├── scanner.ts               # Scanner 引擎入口
│   ├── email-worker.ts          # Email Worker 入口
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── account.ts
│   │   ├── watchlist.ts
│   │   ├── portfolio.ts
│   │   ├── search.ts
│   │   ├── trade.ts
│   │   ├── notification.ts
│   │   └── health.ts
│   ├── middleware/
│   │   ├── authMiddleware.ts    # JWT 验证
│   │   ├── rateLimiter.ts       # 限流
│   │   └── validate.ts          # 参数校验
│   ├── services/
│   │   ├── userService.ts
│   │   ├── emailService.ts
│   │   ├── cacheService.ts
│   │   └── marketDataService.ts
│   ├── scanner/
│   │   ├── index.ts
│   │   ├── buyScanner.ts
│   │   ├── sellScanner.ts
│   │   ├── positionEngine.ts
│   │   └── notifier.ts
│   └── db/
│       ├── pool.ts
│       ├── schema.sql
│       └── migrations/
├── src/                          # 前端
│   ├── shared/algorithms/        # 从现有 services 提取
│   │   ├── indicators.ts
│   │   ├── prediction.ts
│   │   ├── signals.ts
│   │   └── sellTiming.ts
│   ├── pages/                    # 新增 H5 页面
│   └── components/mobile/
├── docker-compose.yml
├── nginx.conf
├── ecosystem.config.js           # PM2 配置
├── SUBSCRIPTION_SYSTEM_DESIGN.md # ← 本文件
└── package.json
```

---

## 11. 开发计划（PR 路线）

| PR | 内容 | 依赖 |
|----|------|------|
| **PR 1** | 基础设施：PostgreSQL schema + Docker Compose + PgBouncer + Redis + 连接池 + env 配置 | 无 |
| **PR 2** | 认证系统：邮箱验证 + JWT + 登录页 + 中间件 + user_account 设置 | PR 1 |
| **PR 3** | 模块 1 — 买入时机：watchlist CRUD + 搜索 + Scanner 买入检测 + positionEngine + H5 页面 | PR 2 |
| **PR 4** | 模块 2 — 卖出时机：portfolio CRUD + sellTiming + Scanner 卖出检测 + H5 页面 | PR 3 |
| **PR 5** | 邮件系统：email_queue + Worker + 交易确认流程（3 按钮）+ 调整页面 + 邮件模板 | PR 4 |
| **PR 6** | 生产就绪：PM2 cluster + Nginx + 限流 + 监控 + 压测 | PR 5 |

---

## 12. 成本估算

| 项目 | 初期（1000 用户）| 规模期（100 万用户）| 目标（1000 万日活）|
|------|----------------|-------------------|-------------------|
| 服务器 | 4C16G $50/月 | 16C64G $300/月 | 64C128G $1,500/月 |
| 数据库 | 同服务器 | 独立实例 $200/月 | RDS $800/月 |
| Redis | 同服务器 | 独立 $50/月 | ElastiCache $300/月 |
| 邮件 SES | $0（免费层）| $300/月 | $3,000/月 |
| 域名+SSL | $15/年 | $15/年 | $15/年 |
| **月总计** | **~$50** | **~$850** | **~$5,600** |

**收入模型**：1% 付费用户 × $5/月 = $50,000/月 @ 100 万用户

---

## 13. 安全设计

| 风险 | 措施 |
|------|------|
| 暴力破解验证码 | 同邮箱 60 秒一次，同 IP 10 次/分钟 |
| JWT 泄露 | token_hash 存储（SHA256），不存明文 |
| 邮件链接伪造 | HMAC 签名 + 随机 link_token |
| 邮件链接重放 | 一次性使用，status 检查 |
| 链接过期 | 24 小时自动过期 |
| 连接池耗尽 | PgBouncer transaction pooling |
| Redis 缓存穿透 | L1+L2 两级缓存 + 防击穿锁 |
| 邮件轰炸 | 5 分钟窗口合并同用户通知 |
| 合规 | 每封邮件含取消订阅链接 + 免责声明 |

---

## 14. SmartClean Framework 提取方案

> 目标：从 `Liangwei-zhang/SmartClean` 提取可复用的基础设施框架，
> 做成可快速迁移的 template，后期开发新的中心化应用可直接 fork 使用，
> 支撑 1000 万日活。

### 14.1 SmartClean 核心文件审计

| 文件 | 行数 | 能力 | 复用价值 | 迁移方式 |
|------|------|------|---------|---------|
| `app/core/database.py` | 48 | PostgreSQL async + PgBouncer | ⭐⭐⭐⭐⭐ | 改写为 Node.js `pg` Pool |
| `app/core/cache.py` | 125 | L1 内存 + L2 Redis 两级缓存 + 防击穿 | ⭐⭐⭐⭐⭐ | 用 `ioredis` + `Map` 重写 |
| `app/core/rate_limit.py` | 138 | Redis 限流 + 黑名单 | ⭐⭐⭐⭐⭐ | 升级为滑动窗口算法 |
| `app/core/idempotency.py` | 101 | 幂等性 Key + Redis 分布式锁 | ⭐⭐⭐⭐ | 直接��译为 TS |
| `app/core/config.py` | 55 | Pydantic Settings + lru_cache | ⭐⭐⭐⭐ | 用 Zod + dotenv 替代 |
| `app/core/monitoring.py` | 131 | 内存指标收集 + 结构化日志 | ⭐⭐⭐⭐ | 翻译为 TS |
| `app/core/response.py` | 26 | 统一响应格式 (ORJSON) | ⭐⭐⭐ | Express 中间件版 |
| `app/core/websocket.py` | 295 | Redis Pub/Sub + WebSocket 管理 | ⭐⭐⭐ | 后期实时推送时用 |
| `app/core/s3.py` | 164 | S3 / MinIO 对象存储 | ⭐⭐⭐ | 按需引入 |
| `app/services/notifications.py` | 139 | 通知服务接口 | ⭐⭐⭐ | 改为邮件队列适配器 |
| `app/main.py` | 196 | FastAPI 启动 + CORS + 中间件链 | ⭐⭐⭐⭐ | 模式参考 |
| `docker-compose.prod.yml` | 108 | PG + PgBouncer + Redis + Nginx | ⭐⭐⭐⭐⭐ | 直接搬 |

### 14.2 七层 Framework 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 7: 部署编排层                                         │
│  docker-compose.yml + nginx.conf + ecosystem.config.js      │
│  来源: SmartClean docker-compose.prod.yml                   │
├─────────────────────────────────────────────────────────────┤
│  Layer 6: 监控观测层                                         │
│  Metrics + 结构化日志 + Health Check                         │
│  来源: SmartClean monitoring.py                             │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: 安全防护层                                         │
│  限流 + 黑名单 + 幂等性 + HMAC 签名                          │
│  来源: SmartClean rate_limit.py + idempotency.py            │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: 缓存层                                            │
│  L1 内存(5s) + L2 Redis(60-300s) + 防击穿分布式锁            │
│  来源: SmartClean cache.py（修复内存锁 → Redis SETNX）       │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 消息 / 推送层                                      │
│  邮件队列 + Redis Pub/Sub + WebSocket（可选）                │
│  来源: SmartClean websocket.py + notifications.py           │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 数据访问层                                         │
│  PostgreSQL Pool + PgBouncer + 事务管理                      │
│  来源: SmartClean database.py                               │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 配置基础层                                         │
��  环境变量 + 统一响应 + CORS                                  │
│  来源: SmartClean config.py + response.py + main.py         │
└─────────────────────────────────────────────────────────────┘
```

### 14.3 SmartClean 已知 Bug — 迁移时必须修复

| # | Bug | SmartClean 现状 | Framework 修复方案 |
|---|-----|----------------|-------------------|
| 1 | 防击穿锁是内存 dict | `_lock_cache = {}` 多进程无效 | 改用 Redis `SET key NX EX 10` |
| 2 | 限流 memory_limits 内存泄漏 | `defaultdict(list)` 无上限 | 改用 Redis `INCR + EXPIRE` |
| 3 | rate_limit 裸 except | `except: pass` 吞异常 | `except Exception as e: logger.warn(e)` |
| 4 | idempotency import 顺序 | `import asyncio` 在末尾 | 规范化 import 顺序 |
| 5 | PgBouncer 密码明文 | `USERS: nico/password` 在 yml | 改用 `.env` + Docker secrets |
| 6 | Cleaner model 重复字段 | `code` 定义了两次 | 删除重复 |
| 7 | get_rate_limit_stats 用同步锁 | `with lock` 应该是 `async with lock` | 修复为 async |
| 8 | Nginx 和 API 端口冲突 | 都用 80 端口 | API 改为 3000，Nginx 代理 |
| 9 | Settings 类体内执行逻辑 | `if not SECRET_KEY` 在类定义体内 | 移到 `@validator` |
| 10 | monitoring `_data` 是类变量 | 跨实例共享但非线程安全 | 改为实例变量 + asyncio.Lock |

### 14.4 每层的 Node.js 等价实现

#### Layer 1 — 配置（SmartClean `config.py` → `config.ts`）

```typescript
// server/core/config.ts
import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  NODE_ENV:        z.enum(['development', 'production', 'test']).default('development'),
  PORT:            z.coerce.number().default(3000),
  DATABASE_URL:    z.string(),
  REDIS_URL:       z.string().default('redis://localhost:6379/0'),
  JWT_SECRET:      z.string().min(32),
  TRADE_LINK_SECRET: z.string().min(16),
  SES_REGION:      z.string().default('us-east-1'),
  SES_ACCESS_KEY:  z.string().optional(),
  SES_SECRET_KEY:  z.string().optional(),
  APP_URL:         z.string().default('http://localhost:3000'),
  CORS_ORIGINS:    z.string().default(''),
});

export const config = envSchema.parse(process.env);
```

#### Layer 2 — 数据库（SmartClean `database.py` → `pool.ts`）

```typescript
// server/db/pool.ts
import { Pool } from 'pg';
import { config } from '../core/config';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 40,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected PG error', err);
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows as T[];
}

export async function transaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

#### Layer 4 — 缓存（SmartClean `cache.py` → `cache.ts`，修复防击穿锁）

```typescript
// server/core/cache.ts
import Redis from 'ioredis';
import crypto from 'crypto';
import { config } from './config';

export const redis = new Redis(config.REDIS_URL);

// L1 内存缓存
const l1 = new Map<string, { data: any; exp: number }>();
const L1_TTL = 5_000; // 5 秒

export function cacheKey(prefix: string, params: Record<string, any>): string {
  const hash = crypto.createHash('md5')
    .update(JSON.stringify(params))
    .digest('hex').slice(0, 12);
  return `${prefix}:${hash}`;
}

export async function getCache(key: string): Promise<any | null> {
  // L1
  const l1Entry = l1.get(key);
  if (l1Entry && l1Entry.exp > Date.now()) return l1Entry.data;
  l1.delete(key);

  // L2
  const raw = await redis.get(key);
  if (raw) {
    const data = JSON.parse(raw);
    l1.set(key, { data, exp: Date.now() + L1_TTL });
    return data;
  }
  return null;
}

export async function setCache(key: string, value: any, ttlSec = 300) {
  l1.set(key, { data: value, exp: Date.now() + L1_TTL });
  await redis.setex(key, ttlSec, JSON.stringify(value));
}

export async function delCache(key: string) {
  l1.delete(key);
  await redis.del(key);
}

// ★ 修复 SmartClean 的内存锁 → 改用 Redis SETNX 分布式锁
export async function cacheWithLock<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSec = 300
): Promise<T> {
  const cached = await getCache(key);
  if (cached !== null) return cached;

  const lockKey = `lock:${key}`;
  const locked = await redis.set(lockKey, '1', 'EX', 10, 'NX');

  if (!locked) {
    // 等待其他请求完成
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 100));
      const result = await getCache(key);
      if (result !== null) return result;
    }
    // 超时兜底
    return fetchFn();
  }

  try {
    const data = await fetchFn();
    await setCache(key, data, ttlSec);
    return data;
  } finally {
    await redis.del(lockKey);
  }
}
```

#### Layer 5 — 限流（SmartClean `rate_limit.py` → `rateLimiter.ts`）

```typescript
// server/middleware/rateLimiter.ts
import { Request, Response, NextFunction } from 'express';
import { redis } from '../core/cache';

export function rateLimiter(limit: number, windowSec = 60) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unknown';
    const key = `rl:${ip}:${req.path}`;

    const current = await redis.incr(key);
    if (current === 1) await redis.expire(key, windowSec);

    if (current > limit) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    next();
  };
}

// 黑名单检查
export async function checkBlacklist(ip: string): Promise<boolean> {
  const blocked = await redis.get(`blacklist:${ip}`);
  return blocked !== null;
}
```

### 14.5 Docker Compose — Framework 基础模板

```yaml
# docker-compose.yml — 通用 Framework 模板
# 新项目只需改 container_name 和 env 即可使用

services:
  postgres:
    image: postgres:16-alpine
    container_name: ${APP_NAME}_db
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./server/db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    command: >
      postgres
        -c shared_buffers=4GB
        -c effective_cache_size=12GB
        -c work_mem=64MB
        -c maintenance_work_mem=512MB
        -c max_connections=200

  pgbouncer:
    image: edoburu/pgbouncer:latest
    container_name: ${APP_NAME}_pgbouncer
    environment:
      DATABASE: ${DB_NAME}
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 500
      DEFAULT_POOL_SIZE: 40
      MIN_POOL_SIZE: 10
      RESERVE_POOL_SIZE: 15
      USERS: ${DB_USER}/${DB_PASSWORD}
    ports:
      - "6432:5432"
    depends_on:
      postgres:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    container_name: ${APP_NAME}_redis
    command: >
      redis-server
        --appendonly yes
        --maxmemory 2gb
        --maxmemory-policy allkeys-lru
        --save 60 1000
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build: .
    container_name: ${APP_NAME}_api
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@pgbouncer:6432/${DB_NAME}
      REDIS_URL: redis://redis:6379/0
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    ports:
      - "3000:3000"
    depends_on:
      pgbouncer:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    container_name: ${APP_NAME}_nginx
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
      - ./dist/client:/app/static:ro
    depends_on:
      - api
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### 14.6 新项目 Fork 使用方式

```bash
# 1. Fork framework-template 仓库
git clone https://github.com/Liangwei-zhang/framework-template my-new-app
cd my-new-app

# 2. 修改 .env
APP_NAME=my_new_app
DB_NAME=my_new_app
DB_USER=admin
DB_PASSWORD=xxx
JWT_SECRET=xxx

# 3. 编写业务 Schema
vim server/db/schema.sql

# 4. 编写业务路由
vim server/routes/xxx.ts

# 5. 启动
docker-compose up -d

# 6. 基础设施全部就绪：
#    ✅ PostgreSQL + PgBouncer（40 连接池）
#    ✅ Redis（2GB，L1+L2 缓存）
#    ✅ 限流 + 黑名单
#    ✅ 幂等性 Key
#    ✅ 防击穿分布式锁
#    ✅ 结构化日志 + Metrics
#    ✅ Nginx SSL + gzip
#    ✅ Docker 一键部署
```

### 14.7 Framework 与 stock 项目的关系

```
SmartClean (Python)        Framework (Node.js)         stock 项目
─────────────────        ──────────────────         ──────────────
    源代码                                              第一个落地
         ↘                                           ↗
           提取 + 翻译 + 修 Bug → framework-template
         ↗                                           ↘
    经验教训                                            验证后抽取

时间线：
  Phase 1: stock 开发中直接使用 Framework 代码（在 server/core/ 下）
  Phase 2: stock v1.0 发布后，抽取到独立 framework-template 仓库
  Phase 3: 新项目直接 fork framework-template
```

### 14.8 SmartClean → Framework 完整对照表

```
SmartClean 已验证的技术栈             Framework (Node.js 版)
────────────────────────────       ─────────────────────────────
PostgreSQL + asyncpg           →   PostgreSQL + pg Pool
PgBouncer transaction pool     →   PgBouncer（配置直接搬）
Redis L1+L2 两级缓存            →   ioredis + Map（修复分布式锁）
防击穿 cache_with_lock          →   cacheWithLock + Redis SETNX
Redis 限流 + 黑名单             →   rateLimiter middleware
幂等性 Key                     →   idempotencyMiddleware
ORJSON 统一响应                 →   Express res.json wrapper
Pydantic Settings              →   Zod schema + dotenv
内存 Metrics + 结构化日志        →   Metrics class + pino
WebSocket + Pub/Sub            →   Socket.IO + ioredis（后期）
S3 对象存储                     →   @aws-sdk/client-s3（按需）
Docker Compose 全家桶           →   直接搬 + 参数化
Nginx HTTP/3 + 零拷贝           →   直接搬

SmartClean 不需要的              stock + Framework 新增的
──────────────────────         ─────────────────────────
PostGIS 空间索引                Scanner 定时扫描引擎
Arq (Python) 任务队列           BullMQ / 自建 email_queue
清潔工 WebSocket 派單            邮件交易确认（一次性 token）
                               仓位计算引擎（PositionEngine）
                               分区表（亿级通知）
```

---

> **文档结束** — 所有后续开发 PR 以本文档为唯一依据。