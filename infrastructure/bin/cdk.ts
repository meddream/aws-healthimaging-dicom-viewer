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
//   - us-west-2 (US West, Oregon)
//   - eu-west-1 (Europe, Ireland)
//   - ap-southeast-2 (Asia Pacific, Sydney)
//
// IMPORTANT: The entire stack must be deployed in the same region as HealthImaging
//            See: https://docs.aws.amazon.com/healthimaging/latest/devguide/endpoints-quotas.html

// ********************************
// Deployment mode configuration
// ********************************
// deploymentMode controls which container registry is used:
//   "dockerhub"   - pulls from Docker Hub (default, for open deployments)
//   "marketplace" - pulls from AWS Marketplace ECR (for AWS Marketplace listing)
//
// Usage:
//   cdk deploy -c deploymentMode=dockerhub
//   cdk deploy -c deploymentMode=marketplace
//   cdk deploy -c deploymentMode=marketplace -c version=8.8.1

// ********************************
// Deployment parameters
// ********************************
const STACK_NAME = "meddream881";           // Should be unique for each deployment. Keep it less than 47 chars.
const MEDDREAM_HIS_INTEGRATION = "token";  // Specify the integration mode between the HIS/RIS and the meddream viewer. Possible values are "token", "study", or "none".
const ACCESS_LOGS_BUCKET_ARN = "";         // If provided, enables ALB access logs using the specified bucket ARN
const ENABLE_MULTI_AZ = false;             // If true, uses multi-AZ deployment for ECS
const ENABLE_VPC_FLOW_LOGS = false;        // If true, enables VPC flow logs to CloudWatch

// Optional: Provide an existing AWS HealthImaging datastore ARN to use instead of creating a new one
// Format: arn:aws:medical-imaging:region:account:datastore/datastore-id
// Leave empty ("") to create a new datastore
const EXISTING_DATASTORE_ARN = "";

const IMPORT_SAMPLE_DATA = false;  // Controls if DICOM samples are loaded in the HealthImaging datastore during the deployment.
const DEPLOY_UPLOADER = true;      // Controls if the DICOM data importer is deployed at https://[cloudfront_url]/uploader/ during the deployment.

// ********************************
// Resource Tagging Configuration
// ********************************
const CUSTOM_TAGS: { [key: string]: string } = {
  "Project": "AWS-HealthImaging-DICOM-Viewer",
  "Environment": "Development",
  "Owner": "Medical-IT-Team"
};

// ********************************
// App & Stack configuration
// ********************************
const app = new App();

// Apply tags at the app level
Object.entries(CUSTOM_TAGS).forEach(([key, value]) => {
  app.node.setContext(`aws-cdk:tags:${key}`, value);
});

// ********************************
// Image URI resolution
// ********************************
const MARKETPLACE_ECR = "709825985650.dkr.ecr.us-east-1.amazonaws.com/meddream";
const DOCKERHUB = "docker.io/meddream";

const deploymentMode = app.node.tryGetContext('deploymentMode') || 'dockerhub';

if (!['dockerhub', 'marketplace'].includes(deploymentMode)) {
  throw new Error(`Invalid deploymentMode "${deploymentMode}". Must be "dockerhub" or "marketplace".`);
}

let MEDDREAM_IMAGE_URI: string;
let AWS_AHI_PROXY_IMAGE_URI: string;
let TOKEN_SERVICE_IMAGE_URI: string;

if (deploymentMode === 'marketplace') {
  MEDDREAM_IMAGE_URI      = `${MARKETPLACE_ECR}/meddream-dicom-viewer:8.8.1`;
  AWS_AHI_PROXY_IMAGE_URI = `${MARKETPLACE_ECR}/meddream-healthimaging-proxy:1.0.4`;
  TOKEN_SERVICE_IMAGE_URI = `${MARKETPLACE_ECR}/meddream-token-service:2.1.19`;
} else {
  // dockerhub (default)
  MEDDREAM_IMAGE_URI      = `${DOCKERHUB}/aws-healthimaging-dicom-viewer:8.8.1`;
  AWS_AHI_PROXY_IMAGE_URI = `${DOCKERHUB}/aws-healthimaging-proxy:1.0.4`;
  TOKEN_SERVICE_IMAGE_URI = `${DOCKERHUB}/token-service:2.1.19`;
}

console.log(`Deployment mode: ${deploymentMode}`);
console.log(`  viewer  : ${MEDDREAM_IMAGE_URI}`);
console.log(`  proxy   : ${AWS_AHI_PROXY_IMAGE_URI}`);
console.log(`  token   : ${TOKEN_SERVICE_IMAGE_URI}`);

// ********************************
// Region validation
// ********************************
const HEALTHIMAGING_REGION = app.node.tryGetContext('region') || process.env.CDK_DEFAULT_REGION || "us-east-1";

const VALID_HEALTHIMAGING_REGIONS = [
  "us-east-1",
  "us-west-2",
  "eu-west-1",
  "ap-southeast-2"
];

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
    region: 'us-east-1'
  },
  crossRegionReferences: false,
  description: 'Lambda@Edge functions for MedDream (must be in us-east-1)',
  tags: CUSTOM_TAGS
});

// Create main stack in the target region
const masterStack = new MasterStack(app, STACK_NAME, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: HEALTHIMAGING_REGION
  },
  crossRegionReferences: false,
  accessLogsBucketArn: ACCESS_LOGS_BUCKET_ARN,
  enableMultiAz: ENABLE_MULTI_AZ,
  enableVpcFlowLogs: ENABLE_VPC_FLOW_LOGS,
  importSampleData: IMPORT_SAMPLE_DATA,
  deployUploader: DEPLOY_UPLOADER,
  meddreamContainerUri: MEDDREAM_IMAGE_URI,
  meddreamProxyContainerUri: AWS_AHI_PROXY_IMAGE_URI,
  meddreamTokenServiceUri: TOKEN_SERVICE_IMAGE_URI,
  meddreamHisIntegration: MEDDREAM_HIS_INTEGRATION,
  existingDatastoreArn: EXISTING_DATASTORE_ARN,
  lambdaEdgeStack: lambdaEdgeStack,
  customTags: CUSTOM_TAGS,
  tags: CUSTOM_TAGS
});

masterStack.addDependency(lambdaEdgeStack);

app.synth();