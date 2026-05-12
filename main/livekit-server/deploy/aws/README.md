# AWS ECS/Fargate Deployment (Cheeko Agent First)

This folder contains a production path to deploy only `cheeko-agent` on AWS ECS Fargate.

## What This Deploys

- One ECS task definition for `cheeko-agent`
- One ECS service for `cheeko-agent`
- CloudWatch logs for the container (`/ecs/cheeko-agent`)

This deployment does not include game workers yet.

## Files

- `Dockerfile.aws-cheeko`: container image for AWS
- `start-aws-cheeko.sh`: starts `workers/cheeko_worker.py` in production mode (`start`)
- `cheeko-agent/task-definition.template.json`: ECS task definition template
- `cheeko-agent/deploy-cheeko-agent.ps1`: one-command deploy (build image + sync secrets + register task + create/update service)
- `cheeko-agent/build-and-push-image.ps1`: ECR build/push helper
- `cheeko-agent/create-or-update-secret.ps1`: Secrets Manager helper
- `cheeko-agent/register-task-definition.ps1`: renders and registers task definition
- `cheeko-agent/create-or-update-service.ps1`: creates or updates ECS service

## 0) Security First

Before any AWS rollout:

1. Rotate all keys currently exposed in repository history/config files.
2. Store every runtime secret in AWS Secrets Manager.
3. Do not bake secrets into Docker image or task definition plaintext.

## 1) Prerequisites

- AWS CLI v2 configured (`aws configure`)
- Docker installed and logged in to ECR
- Existing VPC/subnets/security group for ECS tasks
- ECS cluster created (for example `cheeko-agents-cluster`)

## 2) Build and Push Image

PowerShell example:

```powershell
$Region = "us-east-1"
$AccountId = (aws sts get-caller-identity --query Account --output text)
$RepoName = "cheeko-agent"
$ImageTag = "v1"
$ImageUri = "$AccountId.dkr.ecr.$Region.amazonaws.com/$RepoName`:$ImageTag"

aws ecr create-repository --region $Region --repository-name $RepoName 2>$null
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin "$AccountId.dkr.ecr.$Region.amazonaws.com"

docker build -f Dockerfile.aws-cheeko -t $ImageUri .
docker push $ImageUri
```

## 2.5) Optional: One-command deployment

If your `.env` already has required values, this script can do all steps:

```powershell
.\deploy\aws\cheeko-agent\deploy-cheeko-agent.ps1 `
  -Region "us-east-1" `
  -ClusterName "cheeko-agents-cluster" `
  -ServiceName "cheeko-agent-service" `
  -ExecutionRoleArn "arn:aws:iam::<account>:role/ecsTaskExecutionRole" `
  -TaskRoleArn "arn:aws:iam::<account>:role/cheekoAgentTaskRole" `
  -Subnets @("subnet-aaaa1111","subnet-bbbb2222") `
  -SecurityGroups @("sg-cccc3333") `
  -RepositoryName "cheeko-agent" `
  -ImageTag "v1" `
  -SecretPrefix "prod/cheeko" `
  -DotEnvPath ".env" `
  -AssignPublicIp DISABLED `
  -DesiredCount 1
```

## 3) Create Secrets in Secrets Manager

Create one secret per value (recommended), for example:

- `prod/cheeko/LIVEKIT_URL`
- `prod/cheeko/LIVEKIT_API_KEY`
- `prod/cheeko/LIVEKIT_API_SECRET`
- `prod/cheeko/GOOGLE_API_KEY`
- `prod/cheeko/MANAGER_API_URL`
- `prod/cheeko/MANAGER_API_SECRET`
- `prod/cheeko/ELEVEN_API_KEY`
- `prod/cheeko/ELEVENLABS_VOICE_ID`
- `prod/cheeko/MEM0_API_KEY`
- `prod/cheeko/QDRANT_URL`
- `prod/cheeko/QDRANT_API_KEY`

Collect each ARN from Secrets Manager for the next step.

## 4) Register Task Definition

```powershell
$Region = "us-east-1"
$ImageUri = "<account>.dkr.ecr.<region>.amazonaws.com/cheeko-agent:v1"
$ExecutionRoleArn = "arn:aws:iam::<account>:role/ecsTaskExecutionRole"
$TaskRoleArn = "arn:aws:iam::<account>:role/cheekoAgentTaskRole"

.\deploy\aws\cheeko-agent\register-task-definition.ps1 `
  -Region $Region `
  -ImageUri $ImageUri `
  -ExecutionRoleArn $ExecutionRoleArn `
  -TaskRoleArn $TaskRoleArn `
  -SecretLivekitUrlArn "<arn>" `
  -SecretLivekitApiKeyArn "<arn>" `
  -SecretLivekitApiSecretArn "<arn>" `
  -SecretGoogleApiKeyArn "<arn>" `
  -SecretManagerApiUrlArn "<arn>" `
  -SecretManagerApiSecretArn "<arn>" `
  -SecretElevenApiKeyArn "<arn>" `
  -SecretElevenlabsVoiceIdArn "<arn>" `
  -SecretMem0ApiKeyArn "<arn>" `
  -SecretQdrantUrlArn "<arn>" `
  -SecretQdrantApiKeyArn "<arn>"
```

Then get latest revision:

```powershell
$TaskDefArn = aws ecs describe-task-definition `
  --region $Region `
  --task-definition cheeko-agent `
  --query "taskDefinition.taskDefinitionArn" `
  --output text
```

## 5) Create or Update ECS Service

```powershell
$Region = "us-east-1"
$ClusterName = "cheeko-agents-cluster"
$ServiceName = "cheeko-agent-service"
$TaskDefArn = "<task-definition-arn>"
$Subnets = @("subnet-aaaa1111","subnet-bbbb2222")
$SecurityGroups = @("sg-cccc3333")

.\deploy\aws\cheeko-agent\create-or-update-service.ps1 `
  -Region $Region `
  -ClusterName $ClusterName `
  -ServiceName $ServiceName `
  -TaskDefinition $TaskDefArn `
  -Subnets $Subnets `
  -SecurityGroups $SecurityGroups `
  -AssignPublicIp DISABLED `
  -DesiredCount 1
```

## 6) Verify

1. ECS service has running task count `1/1`
2. CloudWatch logs show worker startup with `agent_name=cheeko-agent`
3. Health endpoint in container returns `200` at `http://0.0.0.0:8081/`
4. A test dispatch to `cheeko-agent` is accepted and joins room

## 7) Roll Forward

To deploy a new version:

1. Build and push new image tag
2. Re-run `register-task-definition.ps1` with new `-ImageUri`
3. Re-run `create-or-update-service.ps1` with latest task definition ARN
