# Secret Agent Data Redactor Deployment Script (PowerShell)
param(
    [string]$Region,
    [string]$Profile
)

Write-Host "Deploying Secret Agent Data Redactor..." -ForegroundColor Cyan

# Helper function to run AWS CLI commands
function Invoke-AwsCli {
    param([string]$Command, [array]$Arguments = @())
    
    $allArgs = @()
    $allArgs += $Command.Split(' ')
    $allArgs += $Arguments
    if ($Region) { $allArgs += @("--region", $Region) }
    if ($Profile) { $allArgs += @("--profile", $Profile) }
    
    Write-Host "Running: aws $($allArgs -join ' ')" -ForegroundColor Gray
    $result = & aws @allArgs
    return $result
}

# Build and deploy the SAM application
Write-Host "Running: sam build" -ForegroundColor Gray
sam build
if ($LASTEXITCODE -ne 0) {
    Write-Host "SAM build failed. Exiting..." -ForegroundColor Red
    exit 1
}

# Build SAM deploy arguments
$samArgs = @("deploy", "--guided")
if ($Region) { $samArgs += @("--region", $Region) }
if ($Profile) { $samArgs += @("--profile", $Profile) }

Write-Host "Running: sam $($samArgs -join ' ')" -ForegroundColor Gray
& sam @samArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "SAM deploy failed. Exiting..." -ForegroundColor Red
    exit 1
}

# Get stack name from samconfig.toml
$STACK_NAME = "secret-agent-data-redactor"  # default
if (Test-Path "samconfig.toml") {
    $samConfig = Get-Content "samconfig.toml" -Raw
    if ($samConfig -match 'stack_name\s*=\s*"([^"]+)"') {
        $STACK_NAME = $matches[1]
    }
}
Write-Host "Using stack name: $STACK_NAME" -ForegroundColor Yellow

# Get the bucket name from stack outputs
Write-Host "Getting stack outputs..." -ForegroundColor Gray
$BUCKET_NAME = Invoke-AwsCli "cloudformation describe-stacks" @("--stack-name", $STACK_NAME, "--query", "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue", "--output", "text")
$OLAP_ARN = Invoke-AwsCli "cloudformation describe-stacks" @("--stack-name", $STACK_NAME, "--query", "Stacks[0].Outputs[?OutputKey=='ObjectLambdaAccessPointArn'].OutputValue", "--output", "text")

Write-Host "Bucket: '$BUCKET_NAME'" -ForegroundColor Gray
Write-Host "OLAP ARN: '$OLAP_ARN'" -ForegroundColor Gray

# Debug: Check if values are empty
if ([string]::IsNullOrWhiteSpace($BUCKET_NAME)) {
    Write-Host "WARNING: BUCKET_NAME is empty!" -ForegroundColor Red
}
if ([string]::IsNullOrWhiteSpace($OLAP_ARN)) {
    Write-Host "WARNING: OLAP_ARN is empty!" -ForegroundColor Red
    Write-Host "Let's check all stack outputs:" -ForegroundColor Yellow
    Invoke-AwsCli "cloudformation describe-stacks" @("--stack-name", $STACK_NAME, "--query", "Stacks[0].Outputs", "--output", "table")
}

Write-Host "Uploading mock data to S3..." -ForegroundColor Yellow
Invoke-AwsCli "s3 cp" @("mock-data/mission-report-001.json", "s3://$BUCKET_NAME/")

Write-Host "Testing redaction with different clearance levels..." -ForegroundColor Green

Write-Host "Testing PUBLIC clearance:" -ForegroundColor White
Invoke-AwsCli "s3api get-object" @("--bucket", $OLAP_ARN, "--key", "mission-report-001.json?clearance=PUBLIC", "$env:TEMP\public-report.json")
Write-Host "Report saved to $env:TEMP\public-report.json" -ForegroundColor Gray

Write-Host "Testing CONFIDENTIAL clearance:" -ForegroundColor White
Invoke-AwsCli "s3api get-object" @("--bucket", $OLAP_ARN, "--key", "mission-report-001.json?clearance=CONFIDENTIAL", "$env:TEMP\confidential-report.json")
Write-Host "Report saved to $env:TEMP\confidential-report.json" -ForegroundColor Gray

Write-Host "Testing TOP_SECRET clearance:" -ForegroundColor White
Invoke-AwsCli "s3api get-object" @("--bucket", $OLAP_ARN, "--key", "mission-report-001.json?clearance=TOP_SECRET", "$env:TEMP\top-secret-report.json")
Write-Host "Report saved to $env:TEMP\top-secret-report.json" -ForegroundColor Gray

Write-Host "Deployment and testing complete!" -ForegroundColor Green
Write-Host "Compare the files to see different redaction levels" -ForegroundColor Cyan