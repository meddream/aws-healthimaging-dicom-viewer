#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { MasterStack } from '../lib/master-stack';

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
const STACK_NAME = "meddream1"; 			//Should be unique for each deployment. Keep it less than 47 chars.
const ACCESS_LOGS_BUCKET_ARN = "";        // If provided, enables ALB access logs using the specified bucket ARN
const ENABLE_MULTI_AZ = false;            // If true, uses multi-AZ deployment for ECS
const ENABLE_VPC_FLOW_LOGS = false;       // If true, enables VPC flow logs to CloudWatch

const IMPORT_SAMPE_DATA = true;   //Controls if DICOM samples are loaded in the HealthImaging datastore during the deployment.
const DEPLOY_UPLOADER = true;     //controls if the DICOM data importer is deployed at https://[cloudfront_url]/uploader/ during the deployment.

// Get region from context with fallback to environment
const app = new App();
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

// ********************************
// App & Stack configuration
// ********************************   

new MasterStack(app, STACK_NAME, {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: HEALTHIMAGING_REGION // Use the validated region
  },
  accessLogsBucketArn: ACCESS_LOGS_BUCKET_ARN,
  enableMultiAz: ENABLE_MULTI_AZ,
  enableVpcFlowLogs: ENABLE_VPC_FLOW_LOGS,
  importSampleData: IMPORT_SAMPE_DATA,
  deployUploader: DEPLOY_UPLOADER
});

app.synth();
