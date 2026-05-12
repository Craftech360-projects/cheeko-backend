param(
  [Parameter(Mandatory = $true)] [string] $Region,
  [string] $RepositoryName = "cheeko-agent",
  [string] $ImageTag = "v1",
  [string] $DockerfilePath = "Dockerfile.aws-cheeko"
)

$ErrorActionPreference = "Continue"

$accountId = aws sts get-caller-identity --query Account --output text
if (-not $accountId) {
  throw "Unable to determine AWS account ID. Check aws credentials."
}

$ecrBase = "$accountId.dkr.ecr.$Region.amazonaws.com"
$imageUri = "$ecrBase/$RepositoryName`:$ImageTag"

aws ecr describe-repositories `
  --region $Region `
  --repository-names $RepositoryName 1>$null 2>$null

if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating ECR repository: $RepositoryName"
  aws ecr create-repository `
    --region $Region `
    --repository-name $RepositoryName 1>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create ECR repository: $RepositoryName"
  }
}

Write-Host "Logging in to ECR..."
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $ecrBase
if ($LASTEXITCODE -ne 0) {
  throw "ECR login failed."
}

Write-Host "Building Docker image: $imageUri"
docker build -f $DockerfilePath -t $imageUri .
if ($LASTEXITCODE -ne 0) {
  throw "Docker build failed."
}

Write-Host "Pushing Docker image: $imageUri"
docker push $imageUri
if ($LASTEXITCODE -ne 0) {
  throw "Docker push failed."
}

Write-Output $imageUri
