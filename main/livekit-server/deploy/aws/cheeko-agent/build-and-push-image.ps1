param(
  [Parameter(Mandatory = $true)] [string] $Region,
  [string] $RepositoryName = "cheeko-agent",
  [string] $ImageTag = "v1",
  [string] $DockerfilePath = "Dockerfile.aws-cheeko"
)

$ErrorActionPreference = "Stop"

$accountId = aws sts get-caller-identity --query Account --output text
if (-not $accountId) {
  throw "Unable to determine AWS account ID. Check aws credentials."
}

$ecrBase = "$accountId.dkr.ecr.$Region.amazonaws.com"
$imageUri = "$ecrBase/$RepositoryName`:$ImageTag"

aws ecr describe-repositories `
  --region $Region `
  --repository-names $RepositoryName 2>$null | Out-Null

if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating ECR repository: $RepositoryName"
  aws ecr create-repository `
    --region $Region `
    --repository-name $RepositoryName | Out-Null
}

Write-Host "Logging in to ECR..."
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $ecrBase

Write-Host "Building Docker image: $imageUri"
docker build -f $DockerfilePath -t $imageUri .

Write-Host "Pushing Docker image: $imageUri"
docker push $imageUri

Write-Output $imageUri
