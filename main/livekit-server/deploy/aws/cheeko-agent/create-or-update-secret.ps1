param(
  [Parameter(Mandatory = $true)] [string] $Region,
  [Parameter(Mandatory = $true)] [string] $Name,
  [Parameter(Mandatory = $true)] [string] $Value
)

$ErrorActionPreference = "Stop"

$existingArn = aws secretsmanager describe-secret `
  --region $Region `
  --secret-id $Name `
  --query "ARN" `
  --output text 2>$null

if ($LASTEXITCODE -eq 0 -and $existingArn -and $existingArn -ne "None") {
  aws secretsmanager put-secret-value `
    --region $Region `
    --secret-id $Name `
    --secret-string $Value | Out-Null
  Write-Host "Updated secret: $Name"
}
else {
  aws secretsmanager create-secret `
    --region $Region `
    --name $Name `
    --secret-string $Value | Out-Null
  Write-Host "Created secret: $Name"
}

$arn = aws secretsmanager describe-secret `
  --region $Region `
  --secret-id $Name `
  --query "ARN" `
  --output text

Write-Output $arn
