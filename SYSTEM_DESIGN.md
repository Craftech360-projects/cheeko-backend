# Cheeko Subscription System — Full System Design

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CHEEKO SUBSCRIPTION SYSTEM                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                    │
│  │  QUESTION     │   │  TOKEN        │   │  TIME         │                   │
│  │  BASED        │   │  BASED        │   │  BASED        │                   │
│  │              │   │              │   │              │                    │
│  │  1 speech    │   │  weighted    │   │  wall-clock  │                    │
│  │  turn = 1    │   │  LLM tokens  │   │  seconds     │                    │
│  │  question    │   │  per turn    │   │  per session  │                    │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘                    │
│         │                  │                  │                             │
│         └──────────────────┼──────────────────┘                             │
│                            ▼                                                │
│                  ┌──────────────────┐                                       │
│                  │  UNIFIED QUOTA   │                                       │
│                  │  DISPATCHER      │                                       │
│                  │  (QuotaManager)  │                                       │
│                  └────────┬─────────┘                                       │
│                           │                                                 │
│              ┌────────────┼────────────┐                                    │
│              ▼            ▼            ▼                                     │
│     ┌────────────┐ ┌────────────┐ ┌────────────┐                           │
│     │ Razorpay   │ │ Manager    │ │ Stripe     │                           │
│     │ (India)    │ │ API        │ │ (Global)   │                           │
│     └────────────┘ └────────────┘ └────────────┘                           │
│                           │                                                 │
│                    ┌──────┴──────┐                                          │
│                    │  Supabase   │                                          │
│                    │  PostgreSQL │                                          │
│                    └─────────────┘                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ESP32 DEVICE (Child)                               │
│                     Speaks via microphone → audio stream                    │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ MQTT / UDP
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MQTT GATEWAY (Node.js)                              │
│                    Converts MQTT/UDP → WebSocket                           │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LIVEKIT CLOUD                                       │
│                    Real-time audio/video relay                              │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     LIVEKIT AGENT WORKER (Python)                           │
│                                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │ AgentSession │  │ UsageManager │  │ QuotaManager │  │ GameAnalytics │   │
│  │             │  │              │  │              │  │               │   │
│  │ LLM/STT/TTS│  │ LiveKit SDK  │  │ Quota cache  │  │ Game session  │   │
│  │ pipeline    │  │ metrics      │  │ + enforcer   │  │ tracking      │   │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └───────────────┘   │
│         │                │                  │                               │
│         │  metrics_collected event          │                               │
│         │───────────────>│                  │                               │
│         │                │  accumulates:    │                               │
│         │                │  audio_tokens    │                               │
│         │                │  text_tokens     │                               │
│         │                │  session_time    │                               │
│         │                │                  │                               │
│         │  user_input_transcribed event     │                               │
│         │─────────────────────────────────>│                               │
│         │                │                  │ consume(                      │
│         │                │   data passed    │   audio_in, audio_out,        │
│         │                │──────────────── >│   text_in, text_out,          │
│         │                │                  │   duration_seconds)           │
│         │                │                  │                               │
└─────────│────────────────│──────────────────│───────────────────────────────┘
          │                │                  │
          │                │                  │ HTTP (fire-and-forget)
          │                │                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MANAGER API (Node.js / Express)                        │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │ quota.service.js │  │ subscription     │  │ payment          │         │
│  │                  │  │ .service.js      │  │ .service.js      │         │
│  │ incrementByMac() │  │                  │  │                  │         │
│  │ incrementToken() │  │ getUnifiedQuota()│  │ createOrder()    │         │
│  │ incrementTime()  │  │ subscribe()      │  │ verify()         │         │
│  │ grantExtra*()    │  │ cancel()         │  │ handleWebhook()  │         │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘         │
│           │                     │                      │                    │
│           └─────────────────────┼──────────────────────┘                    │
│                                 │ Supabase RPC calls                       │
│                                 ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │                    SUPABASE (PostgreSQL)                          │       │
│  │                                                                  │       │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │       │
│  │  │ subscription    │  │ user            │  │ payment        │  │       │
│  │  │ _plan           │  │ _subscription   │  │ _history       │  │       │
│  │  └─────────────────┘  └─────────────────┘  └────────────────┘  │       │
│  │                                                                  │       │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │       │
│  │  │ user_question   │  │ user_token      │  │ user_time      │  │       │
│  │  │ _quota          │  │ _quota          │  │ _quota         │  │       │
│  │  └─────────────────┘  └─────────────────┘  └────────────────┘  │       │
│  │                                                                  │       │
│  │  ┌─────────────────┐  ┌─────────────────┐                      │       │
│  │  │ game_session    │  │ sys_params      │                      │       │
│  │  │ _protection     │  │                 │                      │       │
│  │  └─────────────────┘  └─────────────────┘                      │       │
│  └──────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
          ▲                                            ▲
          │ REST API                                   │ REST API
          │                                            │
┌─────────┴──────────┐                      ┌──────────┴──────────┐
│   ADMIN DASHBOARD  │                      │   PARENT APP        │
│   (manager-web)    │                      │   (Mobile/Web)      │
│                    │                      │                     │
│  - View all quotas │                      │  - View my plan     │
│  - Grant extra     │                      │  - Browse plans     │
│  - Manage plans    │                      │  - Purchase upgrade │
│  - Payment history │                      │  - Payment history  │
└────────────────────┘                      └─────────────────────┘
```

---

## 3. Data Flow — Session Lifecycle

```
═══════════════════════════════════════════════════════════════════════════
 PHASE 1: SESSION INITIALIZATION
═══════════════════════════════════════════════════════════════════════════

  Worker starts                QuotaManager              Manager API              Supabase
  ─────────────                ────────────              ───────────              ────────
       │                            │                        │                       │
       │  new QuotaManager(mac)     │                        │                       │
       │───────────────────────────>│                        │                       │
       │                            │                        │                       │
       │  await initialize()        │                        │                       │
       │───────────────────────────>│                        │                       │
       │                            │  GET /subscription/    │                       │
       │                            │  quota/{mac}           │                       │
       │                            │───────────────────────>│                       │
       │                            │                        │  resolveUserIdFromMac │
       │                            │                        │──────────────────────>│
       │                            │                        │<─────── user_id ──────│
       │                            │                        │                       │
       │                            │                        │  getUserSubscription  │
       │                            │                        │──────────────────────>│
       │                            │                        │<── plan + quota_type ─│
       │                            │                        │                       │
       │                            │                        │  SELECT from          │
       │                            │                        │  user_*_quota WHERE   │
       │                            │                        │  month_key = YYYY-MM  │
       │                            │                        │──────────────────────>│
       │                            │                        │<── used, remaining ───│
       │                            │                        │                       │
       │                            │  { quotaType: "token", │                       │
       │                            │    remaining: 38500,   │                       │
       │                            │    limit: 50000,       │                       │
       │                            │    audioTokenWeight:1.5,│                       │
       │                            │    textTokenWeight:1.0 }│                       │
       │                            │<───────────────────────│                       │
       │                            │                        │                       │
       │  quota_type = "token"      │                        │                       │
       │  remaining = 38500         │                        │                       │
       │  audio_weight = 1.5        │                        │                       │
       │<───────────────────────────│                        │                       │
       │                            │                        │                       │
       │  FAIL-OPEN: If any step    │                        │                       │
       │  fails → remaining = -1    │                        │                       │
       │  (unlimited, don't block   │                        │                       │
       │   children)                │                        │                       │


═══════════════════════════════════════════════════════════════════════════
 PHASE 2: PER-TURN CONSUMPTION (repeats for every child speech turn)
═══════════════════════════════════════════════════════════════════════════

  LiveKit SDK          UsageManager         QuotaManager            Manager API
  ──────────           ────────────         ────────────            ───────────
       │                    │                     │                      │
       │ metrics_collected  │                     │                      │
       │ (after LLM reply)  │                     │                      │
       │───────────────────>│                     │                      │
       │                    │ accumulate:          │                      │
       │                    │ input_audio += 120   │                      │
       │                    │ output_audio += 340  │                      │
       │                    │ input_text += 45     │                      │
       │                    │ output_text += 180   │                      │
       │                    │                     │                      │
       │ user_input_        │                     │                      │
       │ transcribed        │                     │                      │
       │ (is_final=True)    │                     │                      │
       │──────────────────────────────────────── >│                      │
       │                    │                     │                      │
       │                    │  pass all metrics   │                      │
       │                    │────────────────────>│                      │
       │                    │                     │                      │
       │                    │                     │  DISPATCH by type:   │
       │                    │                     │                      │
       │                    │                     │  ┌─ question ────┐   │
       │                    │                     │  │ remaining -= 1│   │
       │                    │                     │  │ POST /quota/  │   │
       │                    │                     │  │ increment/mac │──>│
       │                    │                     │  └───────────────┘   │
       │                    │                     │                      │
       │                    │                     │  ┌─ token ───────┐   │
       │                    │                     │  │ delta_audio = │   │
       │                    │                     │  │  curr - last  │   │
       │                    │                     │  │ weighted =    │   │
       │                    │                     │  │  audio*1.5 +  │   │
       │                    │                     │  │  text*1.0     │   │
       │                    │                     │  │ remaining -=  │   │
       │                    │                     │  │  weighted     │   │
       │                    │                     │  │ POST /quota/  │   │
       │                    │                     │  │ consume/token │──>│
       │                    │                     │  └───────────────┘   │
       │                    │                     │                      │
       │                    │                     │  ┌─ time ────────┐   │
       │                    │                     │  │ delta_sec =   │   │
       │                    │                     │  │  elapsed -    │   │
       │                    │                     │  │  last_reported│   │
       │                    │                     │  │ remaining -=  │   │
       │                    │                     │  │  delta_sec    │   │
       │                    │                     │  │ POST /quota/  │   │
       │                    │                     │  │ consume/time  │──>│
       │                    │                     │  └───────────────┘   │
       │                    │                     │                      │
       │                    │                     │  return (allowed,    │
       │                    │                     │         remaining)   │
       │                    │                     │                      │
       │                    │                     │  Every 3 turns:      │
       │                    │                     │  RE-SYNC from server │
       │                    │                     │  GET /subscription/  │
       │                    │                     │  quota/{mac}         │
       │                    │                     │─────────────────────>│
       │                    │                     │<─ corrected values ──│


═══════════════════════════════════════════════════════════════════════════
 PHASE 3: QUOTA ENFORCEMENT (when remaining approaches 0)
═══════════════════════════════════════════════════════════════════════════

                        QuotaManager                   Worker / Agent
                        ────────────                   ──────────────
                             │                              │
  ┌──────────────────────────┤                              │
  │ LOW QUOTA WARNING        │                              │
  │                          │                              │
  │ question: remaining <= 3 │                              │
  │ token: remaining <= 10%  │                              │
  │ time: remaining <= 120s  │                              │
  │                          │                              │
  │ should_warn_low_quota()  │                              │
  │ returns True             │                              │
  └──────────────────────────┤                              │
                             │  get_low_quota_instruction() │
                             │─────────────────────────────>│
                             │                              │
                             │  "Briefly mention the child  │
                             │   only has 3 questions left" │
                             │                              │
                             │  Agent speaks warning        │
                             │  naturally in conversation   │
                             │                              │
  ┌──────────────────────────┤                              │
  │ QUOTA EXHAUSTED          │                              │
  │                          │                              │
  │ remaining <= 0           │                              │
  │ is_exhausted = True      │                              │
  └──────────────────────────┤                              │
                             │  consume() returns           │
                             │  (False, 0)                  │
                             │─────────────────────────────>│
                             │                              │
                             │  get_limit_message()         │
                             │  per quota type:             │
                             │                              │
                             │  question: "Your free        │
                             │   questions are all used up!"│
                             │                              │
                             │  token: "We've used up all   │
                             │   our chat energy!"          │
                             │                              │
                             │  time: "Our chat time is     │
                             │   all used up!"              │
                             │─────────────────────────────>│
                             │                              │
                             │                  Agent speaks │
                             │                  limit msg   │
                             │                  then room   │
                             │                  disconnects │


═══════════════════════════════════════════════════════════════════════════
 PHASE 4: GAME SESSION PROTECTION
═══════════════════════════════════════════════════════════════════════════

  Worker                QuotaManager              Manager API           Supabase
  ──────                ────────────              ───────────           ────────
    │                        │                         │                    │
    │ start_game_session(    │                         │                    │
    │  "math_tutor",         │                         │                    │
    │  session_id)           │                         │                    │
    │───────────────────────>│                         │                    │
    │                        │ POST /quota/game-       │                    │
    │                        │ session/start/{mac}     │                    │
    │                        │────────────────────────>│                    │
    │                        │                         │ RPC start_game_   │
    │                        │                         │ session()          │
    │                        │                         │───────────────── >│
    │                        │                         │                    │
    │                        │                         │  1. Close stale   │
    │                        │                         │     (>60 min)     │
    │                        │                         │  2. Check active  │
    │                        │                         │     session exists│
    │                        │                         │  3. Check quota   │
    │                        │                         │     remaining > 0 │
    │                        │                         │     (any type)    │
    │                        │                         │  4. INSERT if OK  │
    │                        │                         │                    │
    │                        │                         │<── {allowed: true,│
    │                        │                         │     remaining: 15}│
    │                        │  {allowed, remaining}   │                    │
    │                        │<────────────────────────│                    │
    │  (true, "ok")          │                         │                    │
    │<───────────────────────│                         │                    │
    │                        │                         │                    │
    │  Game proceeds...      │                         │                    │
    │  Quota can exhaust     │                         │                    │
    │  mid-game but game     │                         │                    │
    │  continues until done  │                         │                    │
    │                        │                         │                    │
    │ end_game_session(      │                         │                    │
    │  "completed")          │                         │                    │
    │───────────────────────>│                         │                    │
    │                        │ POST /quota/game-       │                    │
    │                        │ session/end/{mac}       │                    │
    │                        │────────────────────────>│                    │
    │                        │                         │ UPDATE status =   │
    │                        │                         │ 'completed'       │
    │                        │                         │───────────────── >│
```

---

## 4. Payment Flow

```
═══════════════════════════════════════════════════════════════════════════
 RAZORPAY FLOW (India)
═══════════════════════════════════════════════════════════════════════════

  Parent App              Manager API             Razorpay            Supabase
  ──────────              ───────────             ────────            ────────
       │                       │                      │                   │
       │ GET /subscription/    │                      │                   │
       │ available-plans       │                      │                   │
       │──────────────────────>│                      │                   │
       │<── plan list ─────────│                      │                   │
       │                       │                      │                   │
       │ Parent selects        │                      │                   │
       │ "Basic Token ₹299"   │                      │                   │
       │                       │                      │                   │
       │ POST /payment/        │                      │                   │
       │ razorpay/create-order │                      │                   │
       │ { planId: 5 }         │                      │                   │
       │──────────────────────>│                      │                   │
       │                       │ razorpay.orders      │                   │
       │                       │ .create({            │                   │
       │                       │   amount: 29900,     │                   │
       │                       │   currency: "INR"    │                   │
       │                       │ })                   │                   │
       │                       │─────────────────────>│                   │
       │                       │<── order_id ─────────│                   │
       │                       │                      │                   │
       │                       │ INSERT payment_history                   │
       │                       │ (status: 'pending')  │                   │
       │                       │──────────────────────────────────────── >│
       │                       │                      │                   │
       │<── { orderId,         │                      │                   │
       │     amount, key }     │                      │                   │
       │                       │                      │                   │
       │ ┌─────────────────────────────────────┐      │                   │
       │ │ Razorpay Checkout SDK opens         │      │                   │
       │ │ Parent pays via UPI/Card/Netbanking │      │                   │
       │ └──────────────────────┬──────────────┘      │                   │
       │                        │ payment callback    │                   │
       │<───────────────────────┘                     │                   │
       │ { paymentId, orderId, signature }            │                   │
       │                       │                      │                   │
       │ POST /payment/        │                      │                   │
       │ razorpay/verify       │                      │                   │
       │ { orderId, paymentId, │                      │                   │
       │   signature }         │                      │                   │
       │──────────────────────>│                      │                   │
       │                       │                      │                   │
       │                       │ HMAC-SHA256 verify:  │                   │
       │                       │ hash(orderId + "|"   │                   │
       │                       │   + paymentId)       │                   │
       │                       │ === signature?       │                   │
       │                       │                      │                   │
       │                       │ YES → activate:      │                   │
       │                       │                      │                   │
       │                       │ 1. UPDATE payment_history               │
       │                       │    status = 'success' │                   │
       │                       │──────────────────────────────────────── >│
       │                       │                      │                   │
       │                       │ 2. UPDATE old user_subscription         │
       │                       │    status = 'expired' │                   │
       │                       │──────────────────────────────────────── >│
       │                       │                      │                   │
       │                       │ 3. INSERT user_subscription             │
       │                       │    plan_id = 5,       │                   │
       │                       │    status = 'active', │                   │
       │                       │    expires_at = +30d  │                   │
       │                       │──────────────────────────────────────── >│
       │                       │                      │                   │
       │<── { subscription,    │                      │                   │
       │     plan details }    │                      │                   │
       │                       │                      │                   │
       │                       │ WEBHOOK (async)      │                   │
       │                       │<── payment.captured ─│                   │
       │                       │ (idempotent — skip   │                   │
       │                       │  if already active)  │                   │
       │                       │── 200 OK ───────────>│                   │


═══════════════════════════════════════════════════════════════════════════
 STRIPE FLOW (International)
═══════════════════════════════════════════════════════════════════════════

  Parent App              Manager API             Stripe              Supabase
  ──────────              ───────────             ──────              ────────
       │                       │                      │                   │
       │ POST /payment/        │                      │                   │
       │ stripe/create-session │                      │                   │
       │ { planId: 5 }         │                      │                   │
       │──────────────────────>│                      │                   │
       │                       │ stripe.checkout      │                   │
       │                       │ .sessions.create({   │                   │
       │                       │   mode: "payment",   │                   │
       │                       │   line_items: [...], │                   │
       │                       │   metadata: {userId} │                   │
       │                       │ })                   │                   │
       │                       │─────────────────────>│                   │
       │                       │<── session + url ────│                   │
       │                       │                      │                   │
       │                       │ INSERT payment_history                   │
       │                       │ (status: 'pending')  │                   │
       │                       │──────────────────────────────────────── >│
       │                       │                      │                   │
       │<── { sessionId, url } │                      │                   │
       │                       │                      │                   │
       │ ┌─────────────────────────────────────┐      │                   │
       │ │ Redirect to Stripe Checkout page    │      │                   │
       │ │ Parent enters card details          │      │                   │
       │ │ Stripe processes payment            │      │                   │
       │ └─────────────────────────────────────┘      │                   │
       │                       │                      │                   │
       │ Redirect to           │                      │                   │
       │ success_url           │                      │                   │
       │                       │                      │                   │
       │                       │ WEBHOOK              │                   │
       │                       │<── checkout.session   │                   │
       │                       │    .completed         │                   │
       │                       │                      │                   │
       │                       │ constructEvent(       │                   │
       │                       │   rawBody, sig,      │                   │
       │                       │   webhookSecret)     │                   │
       │                       │                      │                   │
       │                       │ Extract userId,      │                   │
       │                       │ planId from metadata │                   │
       │                       │                      │                   │
       │                       │ Activate subscription│                   │
       │                       │ (same as Razorpay    │                   │
       │                       │  steps 1-2-3)        │                   │
       │                       │──────────────────────────────────────── >│
       │                       │── 200 OK ───────────>│                   │
```

---

## 5. Database Entity Relationship

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ENTITY RELATIONSHIP DIAGRAM                      │
└─────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐         ┌──────────────────┐
  │  sys_user     │         │  ai_device        │
  │──────────────│         │──────────────────│
  │ id (PK)      │◄───┐    │ id (PK)          │
  │ username     │    │    │ user_id (FK)  ───┤────► sys_user.id
  │ email        │    │    │ mac_address (UQ) │
  │ role         │    │    │ kid_id (FK)      │
  │ status       │    │    │ agent_id (FK)    │
  └──────┬───────┘    │    └──────────────────┘
         │            │
         │ 1:N        │ 1:1 (active)
         │            │
         ▼            │
  ┌──────────────────┐│   ┌──────────────────┐
  │ user_subscription ││   │ subscription_plan │
  │──────────────────││   │──────────────────│
  │ id (PK)          ││   │ id (PK)          │
  │ user_id (FK) ────┘│   │ plan_code (UQ)   │
  │ plan_id (FK) ─────│──>│ plan_name        │
  │ status           ││   │ quota_type       │───── "question"|"token"|"time"
  │ started_at       ││   │ question_limit   │
  │ expires_at       ││   │ token_limit      │
  │ grace_ends_at    ││   │ time_limit_secs  │
  │ payment_id (FK)──┐│   │ audio_token_wt   │
  │ auto_renew       ││   │ text_token_wt    │
  └──────────────────┘│   │ price_inr        │
                      │   │ price_usd        │
  ┌───────────────────┘   │ billing_period   │
  │                       └──────────────────┘
  ▼
  ┌──────────────────┐
  │ payment_history   │
  │──────────────────│
  │ id (PK)          │
  │ user_id (FK)     │────► sys_user.id
  │ plan_id (FK)     │────► subscription_plan.id
  │ provider         │───── "razorpay"|"stripe"
  │ provider_payment │
  │ _id              │
  │ provider_order_id│
  │ amount           │
  │ currency         │
  │ status           │───── "pending"|"success"|"failed"|"refunded"
  │ payment_method   │
  │ metadata (JSONB) │
  └──────────────────┘


         sys_user.id
              │
              │ 1:N (one per month_key)
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
  ┌────────┐ ┌────────┐ ┌────────┐
  │ user_  │ │ user_  │ │ user_  │
  │question│ │token_  │ │time_   │
  │_quota  │ │quota   │ │quota   │
  │────────│ │────────│ │────────│
  │ id     │ │ id     │ │ id     │
  │user_id │ │user_id │ │user_id │
  │month_  │ │month_  │ │month_  │
  │ key    │ │ key    │ │ key    │
  │questions│ │tokens_ │ │seconds_│
  │ _used  │ │ used   │ │ used   │
  │extra_  │ │raw_in  │ │extra_  │
  │purchased│ │raw_out │ │purchased│
  └────────┘ │extra_  │ └────────┘
             │purchased│
             └────────┘

  UNIQUE(user_id, month_key) on each quota table
  → Natural monthly reset, no cron needed


  ┌──────────────────┐
  │ game_session     │
  │ _protection      │
  │──────────────────│
  │ id (PK)          │
  │ user_id (FK)     │────► sys_user.id
  │ mac_address      │
  │ agent_type       │───── "math_tutor"|"riddle_solver"|"word_ladder"
  │ session_id       │
  │ status           │───── "active"|"completed"|"abandoned"
  │ started_at       │
  │ ended_at         │
  └──────────────────┘
  UNIQUE(user_id, agent_type) WHERE status='active'
```

---

## 6. Metric Capture Pipeline

```
═══════════════════════════════════════════════════════════════════════════
 HOW EACH METRIC IS CAPTURED (LiveKit SDK → UsageManager → QuotaManager)
═══════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────┐
│                        LIVEKIT AGENTS SDK                                │
│                                                                         │
│  from livekit.agents import metrics, MetricsCollectedEvent, AgentSession│
│                                                                         │
│  SDK automatically fires "metrics_collected" after each LLM response    │
│  with RealtimeModelMetrics / LLMMetrics / TTSMetrics / STTMetrics       │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   │ MetricsCollectedEvent
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        UsageManager (helpers.py)                         │
│                                                                         │
│  @session.on("metrics_collected")                                       │
│  def _on_metrics_collected(ev):                                         │
│      self.log_turn_metrics(ev)                                          │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ ACCUMULATED STATE (running totals, updated per LLM turn):         │  │
│  │                                                                   │  │
│  │  input_audio_tokens  ── from ev.metrics.input_token_details      │  │
│  │  input_text_tokens   ── from ev.metrics.input_token_details      │  │
│  │  input_cached_tokens ── from ev.metrics.input_token_details      │  │
│  │  output_audio_tokens ── from ev.metrics.output_token_details     │  │
│  │  output_text_tokens  ── from ev.metrics.output_token_details     │  │
│  │  total_input_tokens  ── from ev.metrics.input_tokens             │  │
│  │  total_output_tokens ── from ev.metrics.output_tokens            │  │
│  │  message_count       ── incremented each LLM turn                │  │
│  │  session_start_time  ── time.time() at init                      │  │
│  │  total_ttft          ── sum of time-to-first-token               │  │
│  │  total_response_dur  ── sum of response durations                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   │ Passed in on_user_speech_quota callback
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    QuotaManager (quota_manager.py)                        │
│                                                                         │
│  consume(                                                               │
│      audio_input  = usage_manager.input_audio_tokens,   ◄── TOKENS     │
│      audio_output = usage_manager.output_audio_tokens,  ◄── TOKENS     │
│      text_input   = usage_manager.input_text_tokens,    ◄── TOKENS     │
│      text_output  = usage_manager.output_text_tokens,   ◄── TOKENS     │
│      duration_seconds = time.time() - session_start     ◄── TIME       │
│  )                                                     (question = implicit)
│                                                                         │
│  DISPATCH by self.quota_type:                                           │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ "question"                                                   │       │
│  │   remaining -= 1                                             │       │
│  │   No metrics needed — just count the event                  │       │
│  │   POST { month_key }                                        │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ "token"                                                      │       │
│  │   delta_audio = (audio_in + audio_out) - last_reported_audio│       │
│  │   delta_text  = (text_in + text_out) - last_reported_text   │       │
│  │   weighted    = delta_audio * 1.5 + delta_text * 1.0        │       │
│  │   remaining  -= weighted                                    │       │
│  │   POST { weightedTokens, rawInput, rawOutput, monthKey }    │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ "time"                                                       │       │
│  │   delta_sec = elapsed - last_reported_time                  │       │
│  │   remaining -= delta_sec                                    │       │
│  │   POST { seconds, monthKey }                                │       │
│  └─────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Subscription Lifecycle & State Machine

```
═══════════════════════════════════════════════════════════════════════════
 SUBSCRIPTION STATE MACHINE
═══════════════════════════════════════════════════════════════════════════

                    ┌──────────────────────────────┐
                    │         NO SUBSCRIPTION       │
                    │    (uses free tier defaults)  │
                    └──────────────┬───────────────┘
                                   │
                                   │ Payment success /
                                   │ Admin subscribes
                                   ▼
          ┌───────────────────────────────────────────────┐
          │                    ACTIVE                      │
          │                                               │
          │  User has full plan limits                    │
          │  QuotaManager reads plan limits               │
          │  Quota consumption is enforced                │
          │                                               │
          │  Can be:                                      │
          │   - Monthly (expires_at = started_at + 30d)   │
          │   - Yearly (expires_at = started_at + 365d)   │
          │   - Free (expires_at = NULL, never expires)   │
          └───────┬────────────────────┬──────────────────┘
                  │                    │
                  │ expires_at         │ User cancels
                  │ reached            │
                  │                    ▼
                  │    ┌──────────────────────────────┐
                  │    │          CANCELLED            │
                  │    │                              │
                  │    │  grace_ends_at = now + 3 days│
                  │    │  User keeps plan limits      │
                  │    │  during grace period         │
                  │    └──────────────┬───────────────┘
                  │                   │
                  ▼                   │ grace_ends_at reached
          ┌───────────────────┐      │
          │      GRACE        │      │
          │                   │      │
          │  3-day grace      │      │
          │  period after     │◄─────┘
          │  expiry           │
          │  Plan limits      │
          │  still active     │
          └─────────┬─────────┘
                    │
                    │ grace_ends_at reached
                    │ (daily cron check)
                    ▼
          ┌───────────────────┐        ┌──────────────────┐
          │     EXPIRED       │        │   RE-SUBSCRIBE    │
          │                   │        │                  │
          │  Falls back to    │───────>│  New payment     │
          │  free tier limits │        │  creates new     │
          │  on next session  │        │  ACTIVE entry    │
          └───────────────────┘        └──────────────────┘


═══════════════════════════════════════════════════════════════════════════
 AUTO-RENEWAL (Razorpay Subscriptions / Stripe Recurring)
═══════════════════════════════════════════════════════════════════════════

  Stripe/Razorpay              Manager API              Supabase
  ───────────────              ───────────              ────────
       │                            │                       │
       │ invoice.paid /             │                       │
       │ subscription.charged       │                       │
       │ (webhook)                  │                       │
       │───────────────────────────>│                       │
       │                            │                       │
       │                            │ 1. Verify signature   │
       │                            │ 2. Find user by       │
       │                            │    provider_sub_id    │
       │                            │ 3. INSERT payment_    │
       │                            │    history (success)  │
       │                            │──────────────────────>│
       │                            │                       │
       │                            │ 4. UPDATE user_       │
       │                            │    subscription       │
       │                            │    expires_at += 30d  │
       │                            │──────────────────────>│
       │                            │                       │
       │<── 200 OK ─────────────────│                       │
```

---

## 8. Monthly Reset Mechanism

```
═══════════════════════════════════════════════════════════════════════════
 NO CRON NEEDED — month_key provides natural reset
═══════════════════════════════════════════════════════════════════════════

 March session:
   month_key = "2026-03"
   user_question_quota WHERE month_key = "2026-03" → questions_used = 18

 April 1st, first session:
   month_key = "2026-04"
   user_question_quota WHERE month_key = "2026-04" → NOT FOUND
     → INSERT new row with questions_used = 0
     → User starts fresh!

 Mid-session month rollover:
   QuotaManager re-syncs every 3 turns
     → Detects month_key changed from "2026-03" to "2026-04"
     → Fetches fresh quota from server
     → remaining resets to full plan limit

 ┌────────────────────────────────────────────────────────────────┐
 │                                                                │
 │  Jan        Feb        Mar        Apr        May               │
 │  2026-01    2026-02    2026-03    2026-04    2026-05           │
 │  ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐        │
 │  │used:0│   │used:0│   │used:0│   │used:0│   │used:0│        │
 │  │      │   │      │   │      │   │      │   │      │        │
 │  │▓▓▓▓▓▓│   │▓▓▓▓░░│   │▓▓▓▓▓▓│   │▓░░░░░│   │░░░░░░│        │
 │  │ 200  │   │ 180  │   │ 200  │   │  45  │   │  0   │        │
 │  │/200  │   │/200  │   │/200  │   │/200  │   │/200  │        │
 │  └──────┘   └──────┘   └──────┘   └──────┘   └──────┘        │
 │                                                                │
 │  Each month is an independent row. Old months stay for         │
 │  analytics. No deletion, no cron, no race conditions.          │
 └────────────────────────────────────────────────────────────────┘
```

---

## 9. API Endpoint Map

```
═══════════════════════════════════════════════════════════════════════════
 ALL ENDPOINTS BY CONSUMER
═══════════════════════════════════════════════════════════════════════════

 ┌─────────────────────────────────────────────────────────────────────┐
 │ LIVEKIT WORKERS → Manager API (X-Service-Key auth)                  │
 ├─────────────────────────────────────────────────────────────────────┤
 │                                                                     │
 │ GET  /subscription/quota/:mac          Unified check (returns       │
 │                                        quotaType + remaining +      │
 │                                        weights + plan info)         │
 │                                                                     │
 │ POST /quota/increment/:mac             Question consume (+=1)       │
 │ POST /quota/consume/token/:mac         Token consume (weighted Δ)  │
 │ POST /quota/consume/time/:mac          Time consume (seconds Δ)    │
 │                                                                     │
 │ POST /quota/game-session/start/:mac    Atomic game start            │
 │ POST /quota/game-session/end/:mac      Game end                     │
 └─────────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────────┐
 │ ADMIN DASHBOARD → Manager API (Bearer token, requireAdmin)          │
 ├─────────────────────────────────────────────────────────────────────┤
 │                                                                     │
 │ GET  /subscription/plans               List all plans               │
 │ POST /subscription/plans               Create/update plan           │
 │ GET  /subscription/user/:userId        User subscription + quota    │
 │ POST /subscription/user/:userId/subscribe  Subscribe user to plan   │
 │ POST /subscription/user/:userId/cancel     Cancel subscription      │
 │ POST /subscription/user/:userId/grant      Grant extra (auto-type)  │
 │ GET  /quota/summary                    Paginated all-user quotas    │
 │ GET  /payment/admin/history            All payment records          │
 └─────────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────────┐
 │ PARENT APP → Manager API (Bearer token, requireAuth)                │
 ├─────────────────────────────────────────────────────────────────────┤
 │                                                                     │
 │ GET  /subscription/my-plan             Current plan + remaining     │
 │ GET  /subscription/available-plans     Plans for purchase           │
 │                                                                     │
 │ POST /payment/razorpay/create-order    Start Razorpay payment       │
 │ POST /payment/razorpay/verify          Verify after payment         │
 │ POST /payment/stripe/create-session    Start Stripe checkout        │
 │ GET  /payment/history                  My payment history           │
 └─────────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────────┐
 │ PAYMENT WEBHOOKS → Manager API (no auth, raw body + signature)      │
 ├─────────────────────────────────────────────────────────────────────┤
 │                                                                     │
 │ POST /payment/razorpay/webhook         Razorpay event notification  │
 │ POST /payment/stripe/webhook           Stripe event notification    │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## 10. Fail-Safe Design Principles

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DESIGN PRINCIPLES                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. FAIL-OPEN                                                           │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ API unreachable? → remaining = -1 (unlimited)           │        │
│     │ Never lock out a child because of infrastructure issues │        │
│     │ Retry with exponential backoff (0.5s, 1s, give up)      │        │
│     └─────────────────────────────────────────────────────────┘        │
│                                                                         │
│  2. FIRE-AND-FORGET                                                     │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ Local decrement first (instant, zero latency)           │        │
│     │ POST to server async (don't await in speech callback)   │        │
│     │ If POST fails? Drift corrected on next re-sync          │        │
│     └─────────────────────────────────────────────────────────┘        │
│                                                                         │
│  3. ATOMIC OPERATIONS                                                   │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ PostgreSQL INSERT...ON CONFLICT (upsert)                │        │
│     │ No SELECT-then-UPDATE (race condition with 2 devices)   │        │
│     │ Single RPC call = single DB round trip                  │        │
│     └─────────────────────────────────────────────────────────┘        │
│                                                                         │
│  4. PERIODIC RE-SYNC                                                    │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ Every 3 turns: GET /subscription/quota/:mac             │        │
│     │ Corrects drift from fire-and-forget                     │        │
│     │ Detects month rollover mid-session                      │        │
│     │ Detects plan changes (admin upgraded user)              │        │
│     └─────────────────────────────────────────────────────────┘        │
│                                                                         │
│  5. GAME SESSION PROTECTION                                             │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ Games started CAN finish even if quota exhausts mid-game│        │
│     │ New games CANNOT start if quota exhausted               │        │
│     │ Stale sessions auto-close after 60 minutes              │        │
│     │ Only 1 active game per user per agent_type              │        │
│     └─────────────────────────────────────────────────────────┘        │
│                                                                         │
│  6. BACKWARD COMPATIBILITY                                              │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ No user_subscription row → legacy free question quota   │        │
│     │ Old /quota/check/:mac endpoint still works              │        │
│     │ consume_question() remains as alias                     │        │
│     │ Gradual migration, no big-bang cutover                  │        │
│     └─────────────────────────────────────────────────────────┘        │
│                                                                         │
│  7. IDEMPOTENT WEBHOOKS                                                 │
│     ┌─────────────────────────────────────────────────────────┐        │
│     │ Payment webhooks may fire multiple times                │        │
│     │ Always check: is subscription already active?           │        │
│     │ Always check: is payment already marked success?        │        │
│     │ Never create duplicate subscriptions                    │        │
│     └─────────────────────────────────────────────────────────┘        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Implementation Phases

```
  Phase 1                Phase 2              Phase 3              Phase 4
  DATABASE               NODE.JS SERVICES     PYTHON WORKER        PAYMENT
  ────────               ────────────────     ─────────────        ───────

  ┌──────────┐           ┌──────────┐        ┌──────────┐        ┌──────────┐
  │ Migration│           │subscrip- │        │ Quota    │        │ payment  │
  │ SQL file │           │tion      │        │ Manager  │        │ .service │
  │          │           │.service  │        │ .py      │        │ .js      │
  │ Tables:  │           │.js       │        │          │        │          │
  │ - plan   │           │          │        │ Add:     │        │ Razorpay │
  │ - sub    │──────────>│ Plan CRUD│        │ quota_   │        │ Stripe   │
  │ - token  │           │ Subscribe│───────>│  type    │        │ Webhooks │
  │   quota  │           │ Cancel   │        │ consume()│        │          │
  │ - time   │           │ Unified  │        │ delta    │        │ create   │
  │   quota  │           │  check   │        │  tracking│        │  order   │
  │ - payment│           │          │        │ type-    │        │ verify   │
  │          │           ├──────────┤        │  aware   │        │ activate │
  │ RPCs:    │           │quota     │        │  messages│        │  sub     │
  │ - incr_  │           │.service  │        │          │        │          │
  │   token  │           │.js       │        ├──────────┤        ├──────────┤
  │ - incr_  │           │          │        │ Workers  │        │ payment  │
  │   time   │           │ Add:     │        │ x4       │        │ .routes  │
  │ - grant_ │           │ incrToken│        │          │        │ .js      │
  │   token  │           │ incrTime │        │ Pass     │        │          │
  │ - grant_ │           │ grantTok │        │ usage_mgr│        │ Webhook  │
  │   time   │           │ grantTime│        │ data to  │        │ raw body │
  │          │           │          │        │ consume()│        │ parsing  │
  │ Seeds:   │           ├──────────┤        │          │        │          │
  │ - 10     │           │Routes    │        └──────────┘        └──────────┘
  │   plans  │           │ subscrip-│
  │ - sys_   │           │ tion     │
  │   params │           │ .routes  │            Can run
  └──────────┘           └──────────┘            in parallel
                                                    │
       │                      │                     │                │
       ▼                      ▼                     ▼                ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │                    Phase 5: INTEGRATION TESTING                      │
  │                                                                      │
  │  1. Deploy migration → verify tables + RPCs                         │
  │  2. Test unified check endpoint → returns quotaType                 │
  │  3. Test token/time consume → atomic increment                      │
  │  4. Test Python QuotaManager → dispatches correctly                 │
  │  5. Test payment flow in sandbox → subscription activates           │
  │  6. Test game session protection → works with all 3 types           │
  │  7. Test month rollover → remaining resets                          │
  │  8. Test fail-open → API down, child not blocked                    │
  │  9. Run existing quota tests → backward compat                     │
  └──────────────────────────────────────────────────────────────────────┘
```
