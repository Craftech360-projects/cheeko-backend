param(
  [Parameter(Mandatory = $true)] [string] $Region,
  [Parameter(Mandatory = $true)] [string] $ClusterName,
  [Parameter(Mandatory = $true)] [string] $ServiceName,
  [int] $MinCapacity = 1,
  [int] $MaxCapacity = 5,
  [double] $TargetCPU = 50.0,
  [int] $ScaleOutCooldown = 60,
  [int] $ScaleInCooldown = 300
)

$ErrorActionPreference = "Stop"

if ($MinCapacity -lt 0) {
  throw "MinCapacity must be >= 0"
}
if ($MaxCapacity -lt $MinCapacity) {
  throw "MaxCapacity must be >= MinCapacity"
}
if ($TargetCPU -le 0 -or $TargetCPU -ge 100) {
  throw "TargetCPU must be between 0 and 100 (exclusive)"
}

$resourceId = "service/$ClusterName/$ServiceName"
$policyName = "$ServiceName-cpu-target-tracking"

Write-Host "Registering scalable target for ECS service..."
aws application-autoscaling register-scalable-target `
  --region $Region `
  --service-namespace ecs `
  --scalable-dimension ecs:service:DesiredCount `
  --resource-id $resourceId `
  --min-capacity $MinCapacity `
  --max-capacity $MaxCapacity | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register scalable target."
}

$config = @{
  TargetValue = $TargetCPU
  PredefinedMetricSpecification = @{
    PredefinedMetricType = "ECSServiceAverageCPUUtilization"
  }
  ScaleOutCooldown = $ScaleOutCooldown
  ScaleInCooldown = $ScaleInCooldown
}

$configJson = $config | ConvertTo-Json -Depth 5
$tmpPolicyPath = Join-Path $env:TEMP "ecs-autoscaling-policy-$ServiceName.json"
[System.IO.File]::WriteAllText($tmpPolicyPath, $configJson, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Applying target tracking policy..."
aws application-autoscaling put-scaling-policy `
  --region $Region `
  --service-namespace ecs `
  --scalable-dimension ecs:service:DesiredCount `
  --resource-id $resourceId `
  --policy-name $policyName `
  --policy-type TargetTrackingScaling `
  --target-tracking-scaling-policy-configuration "file://$tmpPolicyPath" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to apply scaling policy."
}
Remove-Item -Path $tmpPolicyPath -ErrorAction SilentlyContinue

Write-Host "Done. Autoscaling configured."
Write-Host "Resource: $resourceId"
Write-Host "CPU target: $TargetCPU"
Write-Host "Min/Max: $MinCapacity / $MaxCapacity"
