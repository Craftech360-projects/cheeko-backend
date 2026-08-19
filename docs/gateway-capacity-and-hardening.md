# MQTT Gateway Capacity and Hardening

Last updated: 2026-08-19

Scope: the **mqtt-gateway** — the component in this repo. For the LiveKit agent
fleet (EKS, HPA, node groups, pod sizing) see `deploy/k8s/capacity-and-hardening.md`
in the **picoclaw** repo; that file is canonical for anything Kubernetes. Numbers
that appear in both come from the same 2026-08-19 test run. If you change one,
change the other — duplicated measurements drift silently.

## Production shape

Four sharded instances on one host (`139.59.7.72`), managed by pm2:

| App | Shard | UDP | Health | Internal |
|---|---|---|---|---|
| `gw-0` | 0/4 | 8884 | 8004 | 8091 |
| `gw-1` | 1/4 | 8885 | 8005 | 8092 |
| `gw-2` | 2/4 | 8886 | 8006 | 8093 |
| `gw-3` | 3/4 | 8887 | 8007 | 8094 |

Each instance also runs with `MALLOC_ARENA_MAX=2`, a 4 GB `max_memory_restart`, and
`NODE_OPTIONS=--require /root/loop-lag.js` (writes p99 event-loop lag to
`/root/loop-lag-<shard>.txt` every 5 s). All persisted via `pm2 save`.

## Measured capacity

| Load | Gateway RSS (all 4) | Worst shard loop lag | Agent-timeouts | Restarts |
|---|---|---|---|---|
| idle | 709-888 MB | ~10 ms (floor) | - | - |
| 50 **real toys** | 1305 MB | 13.2 ms | 0 | 0 |
| 150 synthetic sessions | 1326 MB | at floor | 0 | 0 |

**Certified: 150+ concurrent real-audio sessions.** That is where testing stopped,
not where the gateway broke — memory grew only ~106 MB going from 60 to 150
sessions, and loop lag never left the measurement floor.

**Real toys cost less than synthetic load.** 50 real toys used 1305 MB against 1326
MB for 150 synthetic sessions, because children speak in bursts while a load client
streams continuously. Treat 150 as conservative for real traffic. Caveat: that test
measured 50 toys *connected and conversing*, not 50 talking simultaneously and
continuously — true peak duty cycle would push the audio worker threads harder.

### Before sharding, for contrast

A single instance was the binding constraint for the whole system:

- **~30-40 concurrent real-audio sessions.** At 60 sessions with live agents, RSS ran
  172 MB -> 1.9 GB and climbing, loop lag hit 148 ms (60 ms audio frames start
  queueing above ~50 ms). Aborted before the memory cap.
- At 100 sessions it did not degrade, it died: RSS 147 MB -> 4.4 GB in ~150 s,
  loop lag 276 ms, PM2 memory-restart, every device dropped.

**Never certify gateway capacity with silent load clients.** Sessions without agent
audio cost ~6 MB and ~1.3% CPU; with live audio they cost ~28 MB and ~4.5% — a 4-5x
error that invalidated every earlier estimate extrapolated from silent clients.

## Sharding

A device is owned wholly by the instance its MAC hashes to
(`shardFor(mac, count) = FNV-1a(normalize(mac)) % count`, in `gateway/shard.js`).
No shared state, no load balancer, no sticky sessions. UDP needs no routing layer —
the device learns its audio port from the hello response, which carries the owning
instance's own port.

Design rationale, rejected alternatives and upgrade path:
`docs/plans/2026-08-19-gateway-sharding-decision.md`.

Two operational obligations:

- **The hash is a cross-service contract with manager-api**, which runs the same
  function to route settings-pushes to the owning instance's internal port. Changing
  the hash, the normalization, or `GATEWAY_SHARD_COUNT` remaps every device and needs
  a coordinated redeploy of both sides — not a rolling restart.
  `tests/shard-contract.test.js` pins the two implementations together.
- **A dead instance strands its shard** until pm2 restarts it, rather than
  rebalancing. Blast radius is 1/N of devices.

Sequential production MACs do not clump: toys ship sharing an OUI prefix
(`68:EE:8F:60:xx:xx`), and FNV-1a spreads a 50-device sequential batch 12/12/13/13.
The 50-toy hardware test landed 2/2/3/3 exactly as predicted.

## Memory behaviour

The gateway's memory is **native, not JavaScript**. A forced GC on prod found
1.17 GB RSS sitting on a 32 MB JS heap — the rest is LiveKit `Room` objects
(~5-10 MB of C++ each), Opus codecs, and glibc malloc arenas. A JS heap snapshot
will show nothing; do not go hunting there.

`MALLOC_ARENA_MAX=2` cut retained memory ~67% in an A/B burst (+341 MB vs +114 MB
per 20-session burst) and is the only intervention with a measured effect. Teardown
hygiene (removing room listeners, clearing per-session queues) was also implemented
but measured **no** memory difference — see commit `4b725c56`.

The 4 GB `max_memory_restart` is the backstop, and it works: it converted a runaway
100-session test into a 10-second restart instead of an OOM kill of the whole box.

## Operations

Check all four shards at once:

```bash
ssh root@139.59.7.72 'for i in 0 1 2 3; do echo "gw-$i lag=$(cat /root/loop-lag-$i.txt)ms"; done; pm2 list | grep gw-'
```

Per-shard RSS sampler (writes `ts,gw0,gw1,gw2,gw3,total` to `/root/gwshard2.csv`):

```bash
ssh root@139.59.7.72 'setsid nohup /root/gwsample.sh </dev/null >/dev/null 2>&1 &'
```

Logs for one shard, or all:

```bash
ssh root@139.59.7.72 'pm2 logs gw-0 --lines 50'
ssh root@139.59.7.72 'tail -n 50 /root/.pm2/logs/gw-*-out.log'
```

Rollback to the pre-sharding single instance: `/root/ROLLBACK-gateway.txt` on the
prod box holds the commit and the full restore command.

**Deploying gateway changes:** restart shards one at a time so only a quarter of
devices blip. Run `npm test` on the box before touching the running shards. Note
`pm2 restart` will **not** pick up new environment variables — that needs
`pm2 delete` followed by a fresh `pm2 start` with the env inline, then `pm2 save`.

## Future: running the gateway on Kubernetes

Not implemented. Recorded so the design questions are answered before someone starts.

**StatefulSet, not Deployment.** A StatefulSet gives stable pod ordinals, and the
ordinal *is* the shard index — `gw-0`..`gw-3` map directly onto
`GATEWAY_SHARD_INDEX=0..3`, derived from the pod name at startup. A Deployment's
random pod names cannot express shard identity.

**The hard part is UDP ingress.** Each shard needs its own externally reachable
UDP endpoint, because the device connects directly to the port the hello response
gives it. A normal Service load-balances across pods, which breaks the model.
Options, in increasing order of cleanliness and effort:

1. `hostNetwork: true` plus pod anti-affinity so each pod lands on its own node —
   each shard then uses its node IP with ports 8884-8887. Simplest, but ties shard
   count to node count and puts pods on the host network.
2. One NodePort Service per pod, selecting on the
   `statefulset.kubernetes.io/pod-name` label. Stable external port per shard with
   proper isolation; more YAML.
3. One LoadBalancer per pod. Cleanest addressing, one cloud LB bill per shard.

Whichever is chosen, manager-api's OTA response must return the owning shard's
external IP and UDP port — the same routing decision it makes today, with node or
LB addresses instead of one host IP.

**Internal routing gets easier.** A headless Service gives stable DNS
(`gw-0.mqtt-gateway.<ns>.svc.cluster.local`), so manager-api's settings-push targets
a name instead of `127.0.0.1:8091-8094`. This is strictly better than today.

**The gateway still cannot autoscale, and this is the part people will get wrong.**
Shard assignment is `hash(mac) % count`, so changing the replica count remaps
*every* device. An HPA on this StatefulSet would silently scramble device-to-shard
ownership mid-traffic and desynchronise manager-api. Kubernetes buys rolling
updates, self-healing, and scheduling — **not** elastic scaling.

To make the gateway genuinely elastic, replace modulo with **consistent hashing** (a
ring with virtual nodes), which limits remapping to roughly 1/N of devices when the
count changes. That is the prerequisite for an HPA here, and it also softens the
"dead instance strands its shard" trade-off. Until then, treat replica count as a
deliberate, coordinated change across the gateway and manager-api.

**Session state is in-memory**, so a pod restart drops its shard's live sessions and
those devices reconnect. Set `terminationGracePeriodSeconds` generously (the agent
worker uses 900s) so a rolling update drains conversations instead of cutting them.

## Load testing

Harness lives on the dev box (`64.227.170.31`):

- `/root/loadclient.py` — `client.py` with the activation gate skipped and
  `LOAD_TEST_HOLD_SECONDS` replacing the interactive keyboard wait (the stock client
  dies instantly under `nohup`).
- `/root/burst2.sh` — single burst, `/root/ramp-gradual.sh` — 60/90/120/150 ramp.

**Always check `sessions_established` before trusting any RSS number.** Three
separate runs produced beautiful flat memory graphs that turned out to be zero load
arriving — dev's manager-api rate limit (1000 req/15 min) throttles OTA and silently
starves the test. Raise `RATE_LIMIT_MAX_REQUESTS` for the run and restore it after.
