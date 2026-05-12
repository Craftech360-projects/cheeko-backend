param(
  [Parameter(Mandatory = $true)] [string] $Region,
  [Parameter(Mandatory = $true)] [string] $ClusterName,
  [Parameter(Mandatory = $true)] [string] $ServiceName,
  [Parameter(Mandatory = $true)] [string] $TaskDefinition,
  [Parameter(Mandatory = $true)] [string[]] $Subnets,
  [Parameter(Mandatory = $true)] [string[]] $SecurityGroups,
  [ValidateSet("ENABLED", "DISABLED")] [string] $AssignPublicIp = "DISABLED",
  [int] $DesiredCount = 1
)

$ErrorActionPreference = "Stop"

$subnetsCsv = ($Subnets -join ",")
$sgCsv = ($SecurityGroups -join ",")
$networkConfig = "awsvpcConfiguration={subnets=[$subnetsCsv],securityGroups=[$sgCsv],assignPublicIp=$AssignPublicIp}"

Write-Host "Checking if service '$ServiceName' exists in cluster '$ClusterName'..."
$status = aws ecs describe-services `
  --region $Region `
  --cluster $ClusterName `
  --services $ServiceName `
  --query "services[0].status" `
  --output text

if ($status -eq "ACTIVE" -or $status -eq "DRAINING") {
  Write-Host "Service exists. Updating service..."
  aws ecs update-service `
    --region $Region `
    --cluster $ClusterName `
    --service $ServiceName `
    --task-definition $TaskDefinition `
    --desired-count $DesiredCount `
    --force-new-deployment | Out-Null
} else {
  Write-Host "Service not found. Creating service..."
  aws ecs create-service `
    --region $Region `
    --cluster $ClusterName `
    --service-name $ServiceName `
    --task-definition $TaskDefinition `
    --desired-count $DesiredCount `
    --launch-type FARGATE `
    --network-configuration $networkConfig | Out-Null
}

Write-Host "Done. Service: $ServiceName"
