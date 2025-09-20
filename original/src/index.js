const { S3Client, WriteGetObjectResponseCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client();

exports.handler = async (event) => {
  console.log('Secret Agent Data Redactor activated:', JSON.stringify(event));
  
  const { getObjectContext, userRequest } = event;
  const { inputS3Url, outputRoute, outputToken } = getObjectContext;
  
  // Parse the full URL to extract object key and clearance level
  const fullUrl = userRequest?.url || '';
  
  // Extract object key from URL path (everything after the domain)
  const urlParts = fullUrl.split('/');
  const objectKeyWithParams = urlParts[urlParts.length - 1]; // Get the last part
  
  // Extract clearance level from URL-encoded parameter (%3Fclearance%3D)
  const clearanceMatch = fullUrl.match(/%3Fclearance%3D([^%&]+)/);
  const clearanceLevel = clearanceMatch ? decodeURIComponent(clearanceMatch[1]) : 'PUBLIC';
  
  // Clean object key by removing URL-encoded query parameters
  const cleanObjectKey = objectKeyWithParams.split('%3F')[0];
  
  console.log(`Processing request with clearance level: ${clearanceLevel}`);
  console.log(`Full URL: ${fullUrl}`);
  console.log(`Clean object key: ${cleanObjectKey}`);

  try {
    // Use AWS SDK instead of direct HTTP request
    const getObjectParams = {
      Bucket: process.env.BUCKET_NAME,
      Key: cleanObjectKey
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
  const redacted = JSON.parse(JSON.stringify(report)); // Deep clone
  
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
      redacted.agentNames = redacted.agentNames?.map(() => '[REDACTED]');
      redacted.specificLocations = redacted.specificLocations?.map(() => '[REDACTED]');
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

