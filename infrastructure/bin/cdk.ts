#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { MasterStack } from '../lib/master-stack';
import { LambdaEdgeStack } from '../lib/lambda-edge-stack';

// ********************************
// AWS HealthImaging Region Guide
// ********************************
// To specify a region, set the CDK_DEFAULT_REGION environment variable:
//   Windows: set CDK_DEFAULT_REGION=us-east-1
//   Linux/Mac: export CDK_DEFAULT_REGION=us-east-1
// 
// AWS HealthImaging is only available in the following regions:
//   - us-east-1 (US East, N. Virginia)
//   - us-east-2 (US East, Ohio)
//   - us-west-2 (US West, Oregon)
//   - eu-west-1 (Europe, Ireland)
//   - ap-southeast-2 (Asia Pacific, Sydney)
//
// IMPORTANT: The entire stack must be deployed in the same region as HealthImaging
//            See: https://docs.aws.amazon.com/healthimaging/latest/devguide/endpoints-quotas.html

// ********************************
// Deployment parameters
// ********************************   
const STACK_NAME = "meddream3"; 			//Should be unique for each deployment. Keep it less than 47 chars.
const MEDDREAM_IMAGE_URI = "meddream/aws-healthimaging-dicom-viewer:8.7.0";         //The URI of the meddream application container to deploy.
const AWS_AHI_PROXY_IMAGE_URI = "docker.io/meddream/aws-healthimaging-proxy:1.0.3"; //The URI of the meddream AHI Proxy service.
const TOKEN_SERVICE_IMAGE_URI = "docker.io/meddream/token-service:2.1.15";
const MEDDREAM_HIS_INTEGRATION = "token" //Specify the integration mode between the HIS/RIS and the meddream viewer. Possible values are "token", "study", or "none".
const ACCESS_LOGS_BUCKET_ARN = "";        // If provided, enables ALB access logs using the specified bucket ARN
const ENABLE_MULTI_AZ = false;             // If true, uses multi-AZ deployment for ECS
const ENABLE_VPC_FLOW_LOGS = false;       // If true, enables VPC flow logs to CloudWatch

const IMPORT_SAMPLE_DATA = false;   // Controls if DICOM samples are loaded in the HealthImaging datastore during the deployment.
const DEPLOY_UPLOADER = true;     // Controls if the DICOM data importer is deployed at https://[cloudfront_url]/uploader/ during the deployment.

// ********************************
// Resource Tagging Configuration
// ********************************
// Define custom tags to be applied to all AWS resources
const CUSTOM_TAGS: { [key: string]: string } = {
  // Project identification tags
  "Project": "AWS-HealthImaging-DICOM-Viewer",
  "Environment": "Development", 
  "Owner": "Medical-IT-Team"
};

// ********************************
// App & Stack configuration
// ********************************   

// Get region from context with fallback to environment
const app = new App();

// Apply tags at the app level (will be inherited by all stacks and resources)
Object.entries(CUSTOM_TAGS).forEach(([key, value]) => {
  app.node.setContext(`aws-cdk:tags:${key}`, value);
});

const HEALTHIMAGING_REGION = app.node.tryGetContext('region') || process.env.CDK_DEFAULT_REGION || "us-east-1";

// Valid HealthImaging regions as of the documentation
const VALID_HEALTHIMAGING_REGIONS = [
  "us-east-1",     // US East (N. Virginia)
  "us-east-2",     // US East (Ohio)
  "us-west-2",     // US West (Oregon)
  "eu-west-1",     // Europe (Ireland)
  "ap-southeast-2" // Asia Pacific (Sydney)
];

// Validate the selected region
if (!VALID_HEALTHIMAGING_REGIONS.includes(HEALTHIMAGING_REGION)) {
  throw new Error(`
Error: The selected region '${HEALTHIMAGING_REGION}' does not support AWS HealthImaging.
Please choose one of the following supported regions: ${VALID_HEALTHIMAGING_REGIONS.join(", ")}

IMPORTANT: Deploy your entire stack in the selected region for proper functionality.
  `);
}

// Create Lambda@Edge stack in us-east-1 (always required for Lambda@Edge)
const lambdaEdgeStack = new LambdaEdgeStack(app, `${STACK_NAME}-lambda-edge`, {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: 'us-east-1' // Always deploy Lambda@Edge to us-east-1
  },
  description: 'Lambda@Edge functions for MedDream (must be in us-east-1)',
  tags: CUSTOM_TAGS // Apply custom tags
});

// Create main stack in the target region
const masterStack = new MasterStack(app, STACK_NAME, {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: HEALTHIMAGING_REGION // Use the validated region
  },
  accessLogsBucketArn: ACCESS_LOGS_BUCKET_ARN,
  enableMultiAz: ENABLE_MULTI_AZ,
  enableVpcFlowLogs: ENABLE_VPC_FLOW_LOGS,
  importSampleData: IMPORT_SAMPLE_DATA,
  deployUploader: DEPLOY_UPLOADER,
  meddreamContainerUri : MEDDREAM_IMAGE_URI,
  meddreamProxyContainerUri : AWS_AHI_PROXY_IMAGE_URI,
  meddreamTokenServiceUri : TOKEN_SERVICE_IMAGE_URI,
  meddreamHisIntegration : MEDDREAM_HIS_INTEGRATION,
  lambdaEdgeStack: lambdaEdgeStack, // Pass the Lambda@Edge stack
  customTags: CUSTOM_TAGS, // Pass custom tags to master stack
  tags: CUSTOM_TAGS // Apply custom tags to master stack
});

// Add dependency so Lambda@Edge stack deploys first
masterStack.addDependency(lambdaEdgeStack);

app.synth();
