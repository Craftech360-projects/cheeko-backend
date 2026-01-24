@main/manager-api-node/prd.md @main/manager-api-node/activity.md

We are testing and fixing the Node.js API to ensure full compatibility with the Vue.js manager-web frontend.

First read activity.md to see what was recently accomplished.

## Project Locations

- **Node.js API**: `main/manager-api-node/` (being tested/fixed)
- **Spring Boot API**: `main/manager-api/` (reference for expected behavior)
- **Frontend**: `main/manager-web/` (Vue.js application)

## Start the Applications

### 1. Start Node.js API (port 8002)
```bash
cd main/manager-api-node
npm run dev
```

### 2. Start Spring Boot API (port 8003) - Reference
```bash
cd main/manager-api
mvn spring-boot:run -Dspring-boot.run.profiles=dev -Dserver.port=8003
```

### 3. Start Frontend (port 8080)
```bash
cd main/manager-web
npm run serve
```

## Testing Pattern

For each API endpoint, compare responses between both backends:

```bash
# Get auth token from Spring Boot (reference)
TOKEN=$(curl -s -X POST http://localhost:8003/toy/user/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.data.token')

# Compare responses
echo "=== Spring Boot (expected) ==="
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8003/toy/endpoint | jq

echo "=== Node.js (being tested) ==="
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8002/toy/endpoint | jq
```

## Work on Tasks

Open prd.md and find the next task where `"passes": false`.

For each task:
1. Test the endpoint(s) on Spring Boot API (port 8003) to see expected behavior
2. Test the same endpoint(s) on Node.js API (port 8002)
3. Compare the responses (fields, format, status codes)
4. If different, fix the Node.js API code to match Spring Boot
5. Verify the fix works
6. Test in the frontend if applicable

## Verification

After fixing an endpoint:
1. Verify curl responses match between both APIs
2. Check if frontend uses this endpoint
3. If yes, test the feature in the frontend
4. Check browser console for any errors

## Log Progress

Append a dated progress entry to activity.md describing:
- Which endpoints were tested
- What differences were found
- What fixes were made
- Verification results

## Update Task Status

When the task is confirmed working, update that task's `"passes"` field in prd.md from `false` to `true`.

## Commit Changes

Make one git commit for that task only:
```
git add .
git commit -m "fix: [brief description of what was fixed]"
```

Do NOT run `git init`, do NOT change git remotes, and do NOT push.

## Important Rules

- ONLY work on a SINGLE task per iteration
- Always compare with Spring Boot API before fixing
- Always verify in frontend when applicable
- Always log your progress in activity.md
- Always commit after completing a task

## Completion

When ALL tasks have `"passes": true`, output:

<promise>COMPLETE</promise>
