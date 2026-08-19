# Gateway Sharding: MAC-Hash, Not EMQX Shared Subscriptions

**Date:** 2026-08-19
**Status:** Decided — implemented and running in production
**Supersedes:** the distribution mechanism in `2026-03-07-mqtt-gateway-scaling-design.md`
(section 2.2). The rest of that plan stands.

## Decision

Devices are assigned to gateway instances by hashing their MAC:

```
shardFor(mac, count) = FNV-1a(normalize(mac)) % count
```

Each instance owns its devices wholly — MQTT, UDP, session state — and drops
messages for devices it does not own. There is no shared state, no load balancer,
and no sticky-session layer.

## Why not EMQX shared subscriptions

The March plan specified `$share/gateway/device-server`, relying on EMQX to
distribute messages across instances. That plan predates a topology change and no
longer applies:

- The gateway no longer subscribes to `device-server`. Devices publish there, but an
  EMQX **republish rule** transforms it into `internal/server-ingest`, injecting
  `sender_client_id` so the gateway can identify the publisher. The gateway
  subscribes to `internal/server-ingest` and `devices/+/data`.
- Shared subscriptions distribute **per message**, not per device. Under EMQX's
  default `round_robin`, a device's `hello` lands on one instance and its next
  `listen` on another, which has no session for it. Sessions are stateful and
  in-memory, so this corrupts them.
- `hash_clientid` would normally give per-publisher affinity, but on
  `internal/server-ingest` the publisher is the rule engine, not the toy. Every
  message hashes identically and all traffic collapses onto one instance.
- Dropping the republish rule to subscribe to `device-server` directly is not an
  option: MQTT does not tell a subscriber who published, and that rule exists
  precisely to supply device identity.

MAC-hash reads identity from the payload, so it is correct regardless of which
instance EMQX delivers to. That is why it fits the current topology and `$share`
does not.

## What this costs

Every instance receives every device message and three of four discard it — 4x MQTT
fan-out. At current scale this is immaterial (EMQX handles 100K+ connections; the
measured gateway load at 150 concurrent sessions was ~1.3 GB RSS total with
event-loop lag at the ~10 ms measurement floor).

**The upgrade path when fan-out does bite:** make the EMQX rule shard-aware, so it
republishes to `internal/server-ingest/0..3` by hashing the MAC in the rule SQL.
Each instance then subscribes only to its own topic — 1x delivery *and* per-device
affinity — with the in-process filter retained as a safety net. This is a rule
change plus one line in the subscribe call, and it preserves everything below.

## Consequences

- **The hash is a cross-service contract.** manager-api runs the identical function
  to route settings-pushes to the owning instance's internal port. The two copies
  must agree byte-for-byte; `tests/shard-contract.test.js` pins this. Changing the
  hash, the normalization, or the instance count breaks routing for every device
  until both sides are redeployed together.
- **Instance count is not hot-swappable.** Changing `GATEWAY_SHARD_COUNT` remaps
  every device. Do it as a coordinated restart of all instances plus manager-api,
  not a rolling one.
- **A dead instance strands its shard** until pm2 restarts it, rather than
  rebalancing. `$share` would have failed over automatically. Accepted: pm2 restarts
  are fast, the blast radius is 1/N of devices, and a device re-fetches OTA on
  reconnect. Revisit if instances start dying for reasons pm2 cannot fix.
- **Sequential production MACs do not clump.** Toys ship in batches sharing an OUI
  prefix (`68:EE:8F:60:xx:xx`); FNV-1a spreads 50 sequential MACs 12/12/13/13 across
  four instances, and the 50-toy hardware test on 2026-08-19 landed 2/2/3/3 exactly
  as predicted.

## Unplanned benefit

Sharding removed a dispatch bottleneck that was not understood at the time. With one
instance, 28 of 60 sessions hit the 25 s agent-timeout **despite free agent slots** —
a single event loop could not absorb ~1 arrival/sec while also relaying audio. Four
loops show zero timeouts through 150 concurrent sessions.

## Measured outcome

- 150 concurrent synthetic sessions: zero restarts, zero timeouts, 1326 MB total RSS
- 50 physical toys: 1305 MB, loop lag at the ~10 ms floor, correct routing throughout

See `deploy/k8s/capacity-and-hardening.md` in the picoclaw repo for the full tables.
