import { Stack, StackProps, lambda_layer_awscli } from "aws-cdk-lib";
import { Key } from "aws-cdk-lib/aws-kms";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { memoryUsage } from "process";
import * as cr from 'aws-cdk-lib/custom-resources';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';


interface DataImportstackProps extends cdk.NestedStackProps {
    healthImagingRoleArn : string,
    healthImagingSourceBucketName : string,
    healthImagingOutputBucketName : string,
    dicomSamplesPath : string,
    s3Prefix : string,
    datastoreId : string,
    datastoreArn : string
}

export class DataImportStack extends cdk.NestedStack {
    constructor(scope: Construct, id: string , props : DataImportstackProps ) {
        super(scope, id, props);


        const sourceBucket = s3.Bucket.fromBucketName(this, 'ImportedBucket', props.healthImagingSourceBucketName);
        const fileupload =new BucketDeployment(this, 'ImportBucketUpload', {
            sources: [Source.asset(props.dicomSamplesPath)],
            destinationBucket: sourceBucket,
            destinationKeyPrefix: props.s3Prefix,
            memoryLimit: 1024
        });


        // Create the IAM role for the custom resource Import Function.
        const ImportfunctionRole = new iam.Role(this, 'ImportfunctionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        });
    
        // Add permissions to the role
        ImportfunctionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['medical-imaging:StartDICOMImportJob'],
            resources: [props.datastoreArn], 
        }));
        ImportfunctionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['iam:PassRole'],
            resources: [props.healthImagingRoleArn],
        }));    
        ImportfunctionRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
        );

        const customResourceHandler = new lambda.Function(this, 'DataImporterFunction', {
            runtime: lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('./lambda/data-importer'), 
            timeout: cdk.Duration.seconds(180),
            role: ImportfunctionRole,
            layers: [new lambda_layer_awscli.AwsCliLayer(this, 'AwsCliLayer')]
          });

        const provider = new cr.Provider(this, 'CustomResourceProvider', {
            onEventHandler: customResourceHandler,
        });
        const customResource = new cdk.CustomResource(this, 'DataImportCustomResource', {
            serviceToken: provider.serviceToken,
            properties: {
            // Add any properties you want to pass to your Lambda function
            Timestamp: new Date().toISOString(),
            InputBucket: props.healthImagingSourceBucketName,
            OutputBucket: props.healthImagingOutputBucketName,
            InputPrefix: props.s3Prefix,
            OutputPrefix: 'output',
            DatastoreId : props.datastoreId,
            DataAccessRoleArn : props.healthImagingRoleArn

            }
      });
      customResource.node.addDependency(fileupload);
      const response = customResource.getAtt('Message');        

    }
}



