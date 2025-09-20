#!/bin/bash

# Secret Agent Data Redactor Deployment Script

# Parse command line arguments
REGION=""
PROFILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --region)
      REGION="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

echo "🕵️ Deploying Secret Agent Data Redactor..."

# Build SAM parameters
SAM_PARAMS="--guided"
[[ -n "$REGION" ]] && SAM_PARAMS="$SAM_PARAMS --region $REGION"
[[ -n "$PROFILE" ]] && SAM_PARAMS="$SAM_PARAMS --profile $PROFILE"

# Build AWS CLI parameters
AWS_PARAMS=""
[[ -n "$REGION" ]] && AWS_PARAMS="$AWS_PARAMS --region $REGION"
[[ -n "$PROFILE" ]] && AWS_PARAMS="$AWS_PARAMS --profile $PROFILE"

# Build and deploy the SAM application
sam build
if [ $? -ne 0 ]; then
    echo "❌ SAM build failed. Exiting..."
    exit 1
fi

sam deploy $SAM_PARAMS
if [ $? -ne 0 ]; then
    echo "❌ SAM deploy failed. Exiting..."
    exit 1
fi

# Get stack name from samconfig.toml
STACK_NAME="secret-agent-data-redactor"  # default
if [ -f "samconfig.toml" ]; then
    STACK_NAME=$(grep -o 'stack_name = "[^"]*"' samconfig.toml | sed 's/stack_name = "\(.*\)"/\1/' | head -1)
    if [ -z "$STACK_NAME" ]; then
        STACK_NAME="secret-agent-data-redactor"
    fi
fi
echo "Using stack name: $STACK_NAME"

# Get the bucket name from stack outputs
BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text $AWS_PARAMS)
OLAP_ARN=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='ObjectLambdaAccessPointArn'].OutputValue" --output text $AWS_PARAMS)

echo "📁 Uploading mock data to S3..."
aws s3 cp mock-data/mission-report-001.json s3://$BUCKET_NAME/ $AWS_PARAMS

echo "🧪 Testing redaction with different clearance levels..."

echo "Testing PUBLIC clearance:"
aws s3api get-object --bucket $OLAP_ARN --key mission-report-001.json --metadata "x-clearance-level=PUBLIC" /tmp/public-report.json $AWS_PARAMS
echo "Report saved to /tmp/public-report.json"

echo "Testing CONFIDENTIAL clearance:"
aws s3api get-object --bucket $OLAP_ARN --key mission-report-001.json --metadata "x-clearance-level=CONFIDENTIAL" /tmp/confidential-report.json $AWS_PARAMS
echo "Report saved to /tmp/confidential-report.json"

echo "Testing TOP_SECRET clearance:"
aws s3api get-object --bucket $OLAP_ARN --key mission-report-001.json --metadata "x-clearance-level=TOP_SECRET" /tmp/top-secret-report.json $AWS_PARAMS
echo "Report saved to /tmp/top-secret-report.json"

echo "✅ Deployment and testing complete!"
echo "🔍 Compare the files to see different redaction levels"