const { S3Client, WriteGetObjectResponseCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client();

exports.handler = async (event) => {
  console.log('Secret Agent Data Redactor activated:', JSON.stringify(event));
  
  const { getObjectContext, userRequest, configuration } = event;
  const { outputRoute, outputToken } = getObjectContext;
  const fullUrl = userRequest?.url || '';

  const bucket = configuration.supportingAccessPointArn;
  const { key, clearanceLevel } = parseDetailsFromRequestUrl(fullUrl);
  
  console.log(`Processing request with clearance level: ${clearanceLevel}`);
  console.log(`Full URL: ${fullUrl}`);
  console.log(`Bucket name: ${bucket}`);
  console.log(`Object key: ${key}`);

  try {
    // Use AWS SDK instead of direct HTTP request
    const getObjectParams = {
      Bucket: bucket,
      Key: key
    };
    
    const getObjectResult = await s3.send(new GetObjectCommand(getObjectParams));
    const reportData = await getObjectResult.Body.transformToString();
    const report = JSON.parse(reportData);
    
    const redactedReport = redactBasedOnClearance(report, clearanceLevel);
    
    await s3.send(new WriteGetObjectResponseCommand({
      RequestRoute: outputRoute,
      RequestToken: outputToken,
      Body: JSON.stringify(redactedReport, null, 2),
    }));
    
    console.log(`Report successfully redacted for ${clearanceLevel} clearance`);
  } catch (error) {
    console.error('Redaction failed:', error);
    throw error;
  }
};

function redactBasedOnClearance(report, clearanceLevel) {
  const redacted = JSON.parse(JSON.stringify(report));
  
  switch (clearanceLevel.toUpperCase()) {
    case 'TOP_SECRET':
      // Minimal redaction - only the most sensitive operational details
      redacted.operationalDetails = redacted.operationalDetails?.map(detail => 
        detail.includes('CLASSIFIED_METHOD') ? '[REDACTED]' : detail
      );
      break;
      
    case 'CONFIDENTIAL':
      // Moderate redaction - agent names and specific locations
      redacted.agentNames = redacted.agentNames?.map(() => '[AGENT_REDACTED]');
      redacted.specificLocations = redacted.specificLocations?.map(() => '[LOCATION_REDACTED]');
      redacted.operationalDetails = redacted.operationalDetails?.map(detail => 
        detail.includes('CLASSIFIED_METHOD') ? '[REDACTED]' : detail
      );
      break;
      
    case 'PUBLIC':
    default:
      // Heavy redaction - names, locations, dates, operations
      redacted.agentNames = redacted.agentNames?.map(() => '[AGENT_REDACTED]');
      redacted.specificLocations = redacted.specificLocations?.map(() => '[LOCATION_REDACTED]');
      redacted.dates = redacted.dates?.map(() => '[DATE_REDACTED]');
      redacted.operationalDetails = redacted.operationalDetails?.map(() => '[REDACTED]');
      redacted.contactInfo = redacted.contactInfo?.map(() => '[CONTACT_REDACTED]');
      if (redacted.missionCode) redacted.missionCode = '[MISSION_REDACTED]';
      break;
  }
  
  // Add redaction metadata
  redacted._redactionInfo = {
    clearanceLevel,
    redactedAt: new Date().toISOString(),
    redactorVersion: '1.0.0'
  };
  
  return redacted;
}

function parseDetailsFromRequestUrl(fullUrl) {
  // Parse the URL to extract components
  const url = new URL(fullUrl);
  
  const fullPath = decodeURIComponent(url.pathname.substring(1)); // Remove leading '/'
  
  // Extract clearance level from URL-encoded query parameter (%3Fclearance%3D)
  // Note: fullPath is decoded, so we look for ?clearance= in the decoded path
  // The clearance value (stops at & or end)
  const clearanceMatch = fullPath.match(/(.+?)\?clearance=([^&?]+)/);
  
  let key, rawClearanceLevel;
  if (clearanceMatch) {
    key = clearanceMatch[1];
    rawClearanceLevel = clearanceMatch[2]; 
  } else {
    key = fullPath;
    rawClearanceLevel = process.env.DEFAULT_SECURITY_CLEARANCE || 'PUBLIC';
  }
  
  const clearanceLevel = validateClearanceLevel(rawClearanceLevel);
  
  return { key, clearanceLevel };
}

function validateClearanceLevel(rawLevel) {
  const validLevels = ['PUBLIC', 'CONFIDENTIAL', 'TOP_SECRET'];
  const normalizedLevel = (rawLevel || '').toUpperCase();
  
  return validLevels.includes(normalizedLevel) ? normalizedLevel : 'PUBLIC';
}
