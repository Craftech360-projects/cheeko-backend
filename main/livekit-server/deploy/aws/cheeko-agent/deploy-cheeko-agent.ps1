param(
  [Parameter(Mandatory = $true)] [string] $Region,
  [Parameter(Mandatory = $true)] [string] $ClusterName,
  [Parameter(Mandatory = $true)] [string] $ServiceName,
  [Parameter(Mandatory = $true)] [string] $ExecutionRoleArn,
  [Parameter(Mandatory = $true)] [string] $TaskRoleArn,
  [Parameter(Mandatory = $true)] [string[]] $Subnets,
  [Parameter(Mandatory = $true)] [string[]] $SecurityGroups,
  [string] $RepositoryName = "cheeko-agent",
  [string] $ImageTag = "v1",
  [string] $SecretPrefix = "prod/cheeko",
  [string] $DotEnvPath = ".env",
  [ValidateSet("ENABLED", "DISABLED")] [string] $AssignPublicIp = "DISABLED",
  [int] $DesiredCount = 1,
  [switch] $SkipImageBuild
)

$ErrorActionPreference = "Stop"

function Read-DotEnv {
  param([string] $Path)
  if (-not (Test-Path $Path)) {
    throw "dotenv file not found: $Path"
  }

  $map = @{}
  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }
    if ($trimmed -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $key = $matches[1]
      $value = $matches[2]
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $map[$key] = $value
    }
  }
  return $map
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = (Resolve-Path (Join-Path $scriptDir "..\..\..")).Path
$dotenvFile = if ([System.IO.Path]::IsPathRooted($DotEnvPath)) { $DotEnvPath } else { Join-Path $rootDir $DotEnvPath }

Write-Host "Reading secrets from: $dotenvFile"
$envMap = Read-DotEnv -Path $dotenvFile

$requiredKeys = @(
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "GOOGLE_API_KEY",
  "MANAGER_API_URL",
  "MANAGER_API_SECRET",
  "ELEVEN_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "MEM0_API_KEY",
  "QDRANT_URL",
  "QDRANT_API_KEY"
)

foreach ($key in $requiredKeys) {
  if (-not $envMap.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($envMap[$key])) {
    throw "Missing required key in .env: $key"
  }
}

# 1) Build and push image (unless skipped)
$imageUri = $null
if ($SkipImageBuild) {
  $accountId = aws sts get-caller-identity --query Account --output text
  $imageUri = "$accountId.dkr.ecr.$Region.amazonaws.com/$RepositoryName`:$ImageTag"
  Write-Host "Skipping image build; using: $imageUri"
}
else {
  $imageUri = & (Join-Path $scriptDir "build-and-push-image.ps1") `
    -Region $Region `
    -RepositoryName $RepositoryName `
    -ImageTag $ImageTag `
    -DockerfilePath (Join-Path $rootDir "Dockerfile.aws-cheeko")
  $imageUri = $imageUri | Select-Object -Last 1
}

# 2) Create or update secrets
$secretArn = @{}
foreach ($key in $requiredKeys) {
  $secretName = "$SecretPrefix/$key"
  $arn = & (Join-Path $scriptDir "create-or-update-secret.ps1") `
    -Region $Region `
    -Name $secretName `
    -Value $envMap[$key]
  $secretArn[$key] = ($arn | Select-Object -Last 1)
}

# 3) Register task definition with rendered secret ARNs
& (Join-Path $scriptDir "register-task-definition.ps1") `
  -Region $Region `
  -ImageUri $imageUri `
  -ExecutionRoleArn $ExecutionRoleArn `
  -TaskRoleArn $TaskRoleArn `
  -SecretLivekitUrlArn $secretArn["LIVEKIT_URL"] `
  -SecretLivekitApiKeyArn $secretArn["LIVEKIT_API_KEY"] `
  -SecretLivekitApiSecretArn $secretArn["LIVEKIT_API_SECRET"] `
  -SecretGoogleApiKeyArn $secretArn["GOOGLE_API_KEY"] `
  -SecretManagerApiUrlArn $secretArn["MANAGER_API_URL"] `
  -SecretManagerApiSecretArn $secretArn["MANAGER_API_SECRET"] `
  -SecretElevenApiKeyArn $secretArn["ELEVEN_API_KEY"] `
  -SecretElevenlabsVoiceIdArn $secretArn["ELEVENLABS_VOICE_ID"] `
  -SecretMem0ApiKeyArn $secretArn["MEM0_API_KEY"] `
  -SecretQdrantUrlArn $secretArn["QDRANT_URL"] `
  -SecretQdrantApiKeyArn $secretArn["QDRANT_API_KEY"] | Out-Null

$taskDefArn = aws ecs describe-task-definition `
  --region $Region `
  --task-definition cheeko-agent `
  --query "taskDefinition.taskDefinitionArn" `
  --output text

if (-not $taskDefArn) {
  throw "Could not resolve latest cheeko-agent task definition ARN."
}

# 4) Create or update ECS service
& (Join-Path $scriptDir "create-or-update-service.ps1") `
  -Region $Region `
  -ClusterName $ClusterName `
  -ServiceName $ServiceName `
  -TaskDefinition $taskDefArn `
  -Subnets $Subnets `
  -SecurityGroups $SecurityGroups `
  -AssignPublicIp $AssignPublicIp `
  -DesiredCount $DesiredCount | Out-Null

Write-Host "--------------------------------------------"
Write-Host "Cheeko deployment complete."
Write-Host "Image: $imageUri"
Write-Host "TaskDefinition: $taskDefArn"
Write-Host "Service: $ServiceName"
Write-Host "--------------------------------------------"
