@main/manager-api-node/prd.md @activity.md

We are building a Node.js/Express.js API to replace the existing Java Spring Boot manager-api.

First read activity.md to see what was recently accomplished.

## Project Location

The new API is located at: `main/manager-api-node/`

## Start the Application

Start the Express.js server locally:
```bash
cd main/manager-api-node
npm run dev
```

The server runs on port 8002 with context path `/toy`.
API documentation available at: http://localhost:8002/toy/doc.html

If port 8002 is taken, update the PORT in .env.

## Available Commands

```bash
# Development with auto-reload
npm run dev

# Production start
npm start

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Initialize Supabase migrations
npx supabase init
npx supabase migration new [name]
npx supabase db push
```

## Work on Tasks

Open prd.md and find the single highest priority task where `"passes": false`.

Work on exactly ONE task:
1. Implement the change according to the task steps
2. Run verification checks:
   ```bash
   cd main/manager-api-node
   npm run lint
   npm test
   ```

## Verify API Endpoints

After implementing, verify your work using curl or the test suite:

1. Test health endpoint:
   ```bash
   curl http://localhost:8002/toy/health
   ```

2. Test specific endpoints:
   ```bash
   # Example: List agents (with auth token)
   curl -H "Authorization: Bearer TOKEN" http://localhost:8002/toy/agent/list

   # Example: Device lookup (public)
   curl http://localhost:8002/toy/device/AA:BB:CC:DD:EE:FF/mode
   ```

3. Check Swagger documentation:
   Open http://localhost:8002/toy/doc.html in browser

4. Run integration tests:
   ```bash
   npm test -- --grep "agent"
   ```

5. Take a screenshot of Swagger for visual verification:
   ```
   agent-browser open http://localhost:8002/toy/doc.html
   agent-browser screenshot screenshots/[task-name].png
   ```

## Log Progress

Append a dated progress entry to activity.md describing:
- What you changed
- What commands you ran
- The screenshot filename
- Any issues encountered and how you resolved them

## Update Task Status

When the task is confirmed working, update that task's `"passes"` field in prd.md from `false` to `true`.

## Commit Changes

Make one git commit for that task only with a clear, descriptive message:
```
git add .
git commit -m "feat: [brief description of what was implemented]"
```

Do NOT run `git init`, do NOT change git remotes, and do NOT push.

## Important Rules

- ONLY work on a SINGLE task per iteration
- Always verify in browser before marking a task as passing
- Always log your progress in activity.md
- Always commit after completing a task

## Completion

When ALL tasks have `"passes": true`, output:

<promise>COMPLETE</promise>
