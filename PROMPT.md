@main/mqtt-gateway-go/prd.md @main/mqtt-gateway-go/activity.md

We are building the MQTT Gateway in Go — a drop-in replacement for the existing Node.js gateway at `main/mqtt-gateway/`.

First read activity.md to see what was recently accomplished.

## Project Locations

- **Go Gateway**: `main/mqtt-gateway-go/` (being built)
- **Node.js Gateway**: `main/mqtt-gateway/` (reference implementation)
- **LiveKit Agents**: `main/livekit-server/workers/` (downstream — do not modify)
- **Manager API**: `main/manager-api-node/` (upstream — do not modify)

## Reference Implementation

The existing Node.js gateway at `main/mqtt-gateway/` is the source of truth for all behavior. When in doubt about how something should work, read the Node.js code:

- `gateway/mqtt-gateway.js` — MQTT connection, device lifecycle, message routing
- `gateway/udp-server.js` — UDP packet handling, encryption
- `livekit/livekit-bridge.js` — LiveKit rooms, audio tracks, agent dispatch
- `livekit/audio-processor.js` — Audio pipeline (resample, buffer, silence detect)
- `livekit/mcp-handler.js` — MCP request/response bridge
- `core/worker-pool-manager.js` — Worker thread pool (replaced by goroutines in Go)
- `core/opus-worker.js` — Opus encode/decode worker

## Build & Run

### Build the Go gateway
```bash
cd main/mqtt-gateway-go
go build -o gateway ./cmd/gateway/
```

### Run in development
```bash
cd main/mqtt-gateway-go
go run ./cmd/gateway/
```

### Run tests
```bash
cd main/mqtt-gateway-go
go test ./...
```

### Run tests with coverage
```bash
cd main/mqtt-gateway-go
go test -cover ./...
```

### Lint
```bash
cd main/mqtt-gateway-go
go vet ./...
```

## System Dependencies

The Go gateway requires libopus for Opus audio codec (CGo binding):
- **Ubuntu/Debian**: `apt install libopus-dev`
- **macOS**: `brew install opus`
- **Windows**: Use MSYS2 or pre-built binaries

## Work on Tasks

Open prd.md and find the next task where `"passes": false`.

For each task:
1. Read the corresponding Node.js reference code to understand expected behavior
2. Implement the Go equivalent following Go idioms and best practices
3. Write unit tests for the new code
4. Verify tests pass with `go test ./...`
5. Verify the build succeeds with `go build ./cmd/gateway/`

## Verification

After completing a feature:
1. Run `go vet ./...` — no warnings
2. Run `go test ./...` — all tests pass
3. Run `go build ./cmd/gateway/` — compiles successfully
4. For integration features: test with a mock or real ESP32 device if possible

## Log Progress

Append a dated progress entry to activity.md describing:
- Which task was completed
- What Go packages/patterns were used
- Any deviations from the Node.js reference (and why)
- Test results

## Update Task Status

When the task is confirmed working, update that task's `"passes"` field in prd.md from `false` to `true`.

## Commit Changes

Make one git commit for that task only:
```
git add main/mqtt-gateway-go/
git commit -m "feat(mqtt-gateway-go): [brief description]"
```

Do NOT run `git init`, do NOT change git remotes, and do NOT push.

## Important Rules

- ONLY work on a SINGLE task per iteration
- Always reference the Node.js gateway code for expected behavior
- Follow Go conventions: error handling, naming, package organization
- Use `context.Context` for cancellation — no manual timer cleanup
- Use goroutines + channels instead of worker thread pools
- Use `sync.Pool` for buffer reuse where performance matters
- Always run `go vet` and `go test` before marking a task done
- Always log your progress in activity.md
- Always commit after completing a task

## Completion

When ALL tasks have `"passes": true`, output:

<promise>COMPLETE</promise>
