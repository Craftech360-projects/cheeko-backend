# Cheeko Agent AWS Hosting Procedure (ECS Fargate)

Last updated: 2026-05-12  
Region: `ap-south-2`  
Service: `cheeko-agent-service`

## 1) Scope

This runbook explains how to deploy, update, verify, and troubleshoot the Cheeko LiveKit worker on AWS ECS Fargate using scripts in `deploy/aws/cheeko-agent`.

## 2) Deployment Architecture

- ECR image repository: `cheeko-agent`
- ECS cluster: `cheeko-agents-cluster`
- ECS service: `cheeko-agent-service`
- Task family: `cheeko-agent`
- CloudWatch log group: `/ecs/cheeko-agent`
- Secrets Manager prefix: `prod/cheeko`

## 3) Prerequisites

### 3.1 Local

- AWS CLI v2 installed and configured
- Docker Desktop installed and running
- Access to this repo and PowerShell

### 3.2 AWS

- ECS cluster exists
- Subnets and security group available
- IAM roles exist:
  - `ecsTaskExecutionRole` (with `AmazonECSTaskExecutionRolePolicy`)
  - `cheekoAgentTaskRole`

### 3.3 Required Secrets

Create or maintain these in Secrets Manager:

- `prod/cheeko/LIVEKIT_URL`
- `prod/cheeko/LIVEKIT_API_KEY`
- `prod/cheeko/LIVEKIT_API_SECRET`
- `prod/cheeko/GOOGLE_API_KEY`
- `prod/cheeko/GEMINI_REALTIME_MODEL`
- `prod/cheeko/MANAGER_API_URL`
- `prod/cheeko/MANAGER_API_SECRET`
- `prod/cheeko/ELEVEN_API_KEY`
- `prod/cheeko/ELEVENLABS_VOICE_ID`
- `prod/cheeko/MEM0_API_KEY`
- `prod/cheeko/QDRANT_URL`
- `prod/cheeko/QDRANT_API_KEY`

### 3.4 Gemini model mode (important)

- Keep `GEMINI_REALTIME_MODEL` set to a non-`gemini-live-*` value (recommended: `gemini-2.5-flash-native-audio-latest`) for Gemini API mode.
- `gemini-live-*` models are treated as Vertex-style models.
- `GEMINI_USE_VERTEXAI=true` forces Vertex mode.

### 3.5 Autoscaling model (important)

- Worker admission control: `LIVEKIT_LOAD_THRESHOLD` (default now `0.7` in `workers/cheeko_worker.py`)
- Service autoscaling: ECS target tracking on CPU
- Recommended starting target: CPU `50%` so scale-out happens before workers saturate near `0.7`

## 4) First Deployment (One Command)

Run from:

`D:\cheeko-backend\main\livekit-server`

```powershell
$Region = "ap-south-2"
$ClusterName = "cheeko-agents-cluster"
$ServiceName = "cheeko-agent-service"
$ExecutionRoleArn = "arn:aws:iam::<account-id>:role/ecsTaskExecutionRole"
$TaskRoleArn = "arn:aws:iam::<account-id>:role/cheekoAgentTaskRole"
$Subnets = @("subnet-xxxx","subnet-yyyy","subnet-zzzz")
$SecurityGroups = @("sg-xxxx")

.\deploy\aws\cheeko-agent\deploy-cheeko-agent.ps1 `
  -Region $Region `
  -ClusterName $ClusterName `
  -ServiceName $ServiceName `
  -ExecutionRoleArn $ExecutionRoleArn `
  -TaskRoleArn $TaskRoleArn `
  -Subnets $Subnets `
  -SecurityGroups $SecurityGroups `
  -AssignPublicIp ENABLED `
  -RepositoryName "cheeko-agent" `
  -ImageTag "v1" `
  -SecretPrefix "prod/cheeko" `
  -DotEnvPath ".env" `
  -DesiredCount 1
```

What this does:

1. Builds Docker image and pushes to ECR
2. Syncs `.env` keys to Secrets Manager
3. Registers ECS task definition
4. Creates/updates ECS service

## 5) Safe Update Flow (Important)

1. Update local `.env` first so deploy script does not push stale `localhost` values into AWS secrets.
2. Deploy with a new image tag (`v2`, `v3`, ...).
3. Wait for service stability.
4. Verify logs and test one real job.

## 6) Verification Commands

```powershell
aws ecs wait services-stable --region ap-south-2 --cluster cheeko-agents-cluster --services cheeko-agent-service

aws ecs describe-services --region ap-south-2 --cluster cheeko-agents-cluster --services cheeko-agent-service --query "services[0].{taskDef:taskDefinition,desired:desiredCount,running:runningCount,pending:pendingCount}" --output json
```

Expected healthy state:

- `desired=1`
- `running=1`
- `pending=0`

## 7) Operations

### 7.1 Force new deployment without rebuild

```powershell
aws ecs update-service --region ap-south-2 --cluster cheeko-agents-cluster --service cheeko-agent-service --force-new-deployment
```

### 7.2 Update one secret and restart service

```powershell
aws secretsmanager update-secret --region ap-south-2 --secret-id prod/cheeko/MANAGER_API_URL --secret-string "http://157.245.108.139:8002/toy"
aws ecs update-service --region ap-south-2 --cluster cheeko-agents-cluster --service cheeko-agent-service --force-new-deployment
```

### 7.3 Check current production secret values

```powershell
aws secretsmanager get-secret-value --region ap-south-2 --secret-id prod/cheeko/LIVEKIT_URL --query SecretString --output text
aws secretsmanager get-secret-value --region ap-south-2 --secret-id prod/cheeko/LIVEKIT_API_KEY --query SecretString --output text
aws secretsmanager get-secret-value --region ap-south-2 --secret-id prod/cheeko/LIVEKIT_API_SECRET --query SecretString --output text
aws secretsmanager get-secret-value --region ap-south-2 --secret-id prod/cheeko/MANAGER_API_URL --query SecretString --output text
aws secretsmanager get-secret-value --region ap-south-2 --secret-id prod/cheeko/GEMINI_REALTIME_MODEL --query SecretString --output text
```

### 7.4 Configure ECS autoscaling (Fargate)

```powershell
.\deploy\aws\cheeko-agent\configure-autoscaling.ps1 `
  -Region "ap-south-2" `
  -ClusterName "cheeko-agents-cluster" `
  -ServiceName "cheeko-agent-service" `
  -MinCapacity 1 `
  -MaxCapacity 5 `
  -TargetCPU 50 `
  -ScaleOutCooldown 60 `
  -ScaleInCooldown 300
```

### 7.5 Verify autoscaling configuration

```powershell
aws application-autoscaling describe-scalable-targets --region ap-south-2 --service-namespace ecs --resource-id service/cheeko-agents-cluster/cheeko-agent-service --scalable-dimension ecs:service:DesiredCount --output json
aws application-autoscaling describe-scaling-policies --region ap-south-2 --service-namespace ecs --resource-id service/cheeko-agents-cluster/cheeko-agent-service --scalable-dimension ecs:service:DesiredCount --output json
```

### 7.6 Check runtime load (CPU/Memory)

Use UTC timestamps for CloudWatch queries:

```powershell
$start = (Get-Date).ToUniversalTime().AddHours(-2).ToString("yyyy-MM-ddTHH:mm:ssZ")
$end   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
```

CPU:

```powershell
aws cloudwatch get-metric-statistics `
  --region ap-south-2 `
  --namespace AWS/ECS `
  --metric-name CPUUtilization `
  --dimensions Name=ClusterName,Value=cheeko-agents-cluster Name=ServiceName,Value=cheeko-agent-service `
  --start-time $start `
  --end-time $end `
  --period 300 `
  --statistics Average Maximum
```

Memory:

```powershell
aws cloudwatch get-metric-statistics `
  --region ap-south-2 `
  --namespace AWS/ECS `
  --metric-name MemoryUtilization `
  --dimensions Name=ClusterName,Value=cheeko-agents-cluster Name=ServiceName,Value=cheeko-agent-service `
  --start-time $start `
  --end-time $end `
  --period 300 `
  --statistics Average Maximum
```

Interpretation:

- CPU target policy is currently `50%`, so values like `0.5%` to `1.5%` are very low and will keep service near min capacity (`1` task).
- Memory around `10%` on a `4096 MB` task is about `410 MB` usage (`4096 * 0.10`).
- This is a healthy low-load baseline.

## 8) Logs

```powershell
aws logs describe-log-streams --region ap-south-2 --log-group-name /ecs/cheeko-agent --order-by LastEventTime --descending --max-items 5
aws logs tail /ecs/cheeko-agent --region ap-south-2 --since 30m
```

## 9) Known Failure Modes and Fixes

### 9.1 Old local credentials overwrite AWS

Symptom:

- Service starts with `ws://localhost:7880` or `127.0.0.1:8002`

Cause:

- Deploy script syncs from `.env` each run.

Fix:

1. Correct `.env`
2. Re-run deploy script or update secrets manually
3. Force new deployment

### 9.2 Jinja prompt template parse error + child profile None crash

Symptom:

- `Jinja2 template error: tag name expected`
- Then `AttributeError: 'NoneType' object has no attribute 'get'`

Fix already applied:

- Safe fallback rendering in `src/shared/entrypoint_utils.py`

### 9.3 Vertex model selected but no Google ADC in ECS

Symptom:

- `google.auth.exceptions.DefaultCredentialsError`

Cause:

- Vertex model (`gemini-live-*`) requires ADC credentials in container.

Fix already applied:

- Worker fallback to Gemini API model when Vertex ADC/project env is missing.

## 10) Rollback

```powershell
aws ecs update-service --region ap-south-2 --cluster cheeko-agents-cluster --service cheeko-agent-service --task-definition cheeko-agent:<older-revision>
```

## 11) Key Files in Repo

- `deploy/aws/README.md`
- `deploy/aws/cheeko-agent/deploy-cheeko-agent.ps1`
- `deploy/aws/cheeko-agent/build-and-push-image.ps1`
- `deploy/aws/cheeko-agent/create-or-update-secret.ps1`
- `deploy/aws/cheeko-agent/register-task-definition.ps1`
- `deploy/aws/cheeko-agent/create-or-update-service.ps1`
- `deploy/aws/cheeko-agent/configure-autoscaling.ps1`
- `Dockerfile.aws-cheeko`
- `start-aws-cheeko.sh`
