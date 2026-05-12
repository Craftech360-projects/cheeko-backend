param(
  [Parameter(Mandatory = $true)] [string] $Region,
  [Parameter(Mandatory = $true)] [string] $ImageUri,
  [Parameter(Mandatory = $true)] [string] $ExecutionRoleArn,
  [Parameter(Mandatory = $true)] [string] $TaskRoleArn,
  [Parameter(Mandatory = $true)] [string] $SecretLivekitUrlArn,
  [Parameter(Mandatory = $true)] [string] $SecretLivekitApiKeyArn,
  [Parameter(Mandatory = $true)] [string] $SecretLivekitApiSecretArn,
  [Parameter(Mandatory = $true)] [string] $SecretGoogleApiKeyArn,
  [Parameter(Mandatory = $true)] [string] $SecretManagerApiUrlArn,
  [Parameter(Mandatory = $true)] [string] $SecretManagerApiSecretArn,
  [Parameter(Mandatory = $true)] [string] $SecretElevenApiKeyArn,
  [Parameter(Mandatory = $true)] [string] $SecretElevenlabsVoiceIdArn,
  [Parameter(Mandatory = $true)] [string] $SecretMem0ApiKeyArn,
  [Parameter(Mandatory = $true)] [string] $SecretQdrantUrlArn,
  [Parameter(Mandatory = $true)] [string] $SecretQdrantApiKeyArn
)

$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$templatePath = Join-Path $scriptDir "task-definition.template.json"
$renderedPath = Join-Path $scriptDir "task-definition.rendered.json"

$json = Get-Content -Raw -Path $templatePath
$json = $json.Replace("__AWS_REGION__", $Region)
$json = $json.Replace("__IMAGE_URI__", $ImageUri)
$json = $json.Replace("__EXECUTION_ROLE_ARN__", $ExecutionRoleArn)
$json = $json.Replace("__TASK_ROLE_ARN__", $TaskRoleArn)
$json = $json.Replace("__SECRET_LIVEKIT_URL_ARN__", $SecretLivekitUrlArn)
$json = $json.Replace("__SECRET_LIVEKIT_API_KEY_ARN__", $SecretLivekitApiKeyArn)
$json = $json.Replace("__SECRET_LIVEKIT_API_SECRET_ARN__", $SecretLivekitApiSecretArn)
$json = $json.Replace("__SECRET_GOOGLE_API_KEY_ARN__", $SecretGoogleApiKeyArn)
$json = $json.Replace("__SECRET_MANAGER_API_URL_ARN__", $SecretManagerApiUrlArn)
$json = $json.Replace("__SECRET_MANAGER_API_SECRET_ARN__", $SecretManagerApiSecretArn)
$json = $json.Replace("__SECRET_ELEVEN_API_KEY_ARN__", $SecretElevenApiKeyArn)
$json = $json.Replace("__SECRET_ELEVENLABS_VOICE_ID_ARN__", $SecretElevenlabsVoiceIdArn)
$json = $json.Replace("__SECRET_MEM0_API_KEY_ARN__", $SecretMem0ApiKeyArn)
$json = $json.Replace("__SECRET_QDRANT_URL_ARN__", $SecretQdrantUrlArn)
$json = $json.Replace("__SECRET_QDRANT_API_KEY_ARN__", $SecretQdrantApiKeyArn)

[System.IO.File]::WriteAllText($renderedPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Registering ECS task definition from $renderedPath..."
aws ecs register-task-definition `
  --region $Region `
  --cli-input-json "file://$renderedPath"

if ($LASTEXITCODE -ne 0) {
  throw "Failed to register ECS task definition."
}

Write-Host "Done. New task definition revision registered."
