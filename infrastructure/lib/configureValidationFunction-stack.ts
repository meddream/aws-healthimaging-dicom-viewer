import { Stack, StackProps, lambda_layer_awscli, CustomResource, Duration, NestedStackProps, NestedStack } from "aws-cdk-lib";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from "constructs/lib/construct";
import { IamResource } from "aws-cdk-lib/aws-appsync";


interface configureValidationFunctionStackProps extends NestedStackProps {
    distributionDomainName: string;
    validationFunctionArn: string;
    validatorFunctionRoleArn : string;
    uploaderClientRoleArn: string;
    sourceBucketName: string;
    uploadBucketArn: string;
    datastoreId : string;
    ahiImportRoleArn: string;
    outputBucketName: string;
}

export class configureValidationFunctionStack extends NestedStack {
    public readonly validationFunction: lambda.IFunction;

    constructor(scope: Construct, id: string, props: configureValidationFunctionStackProps) {
        super(scope, id, props);

        // //add a sts:assume privilege to the uploaderClientRole for the meddream session validation function
        // const assumeRolePolicy = new iam.PolicyStatement({
        //     actions: ['sts:AssumeRole'],
        //     resources: [props.uploaderClientRoleArn],
        // });
        // //get the validationFunction from its arn:
        // const validationFunction = lambda.Function.fromFunctionArn(this, 'validationFunction', props.validationFunctionArn);
        // const validatorFunctionRole = iam.Role.fromRoleArn(this, 'ValidatorRole', props.validatorFunctionRoleArn);

        // //allows the session-validator function Role to assume the client uploader role, so that it can rquests STS creds.
        // const uploaderClientRole = iam.Role.fromRoleArn(this, 'UploaderClientRole', props.uploaderClientRoleArn, {mutable: true});
        // uploaderClientRole.grantAssumeRole(validatorFunctionRole);

        //create a role for the custom resource function that allows lambda:UpdateFunctionConfiguration
        const updateEnvVarsFunctionRole = new iam.Role(this, 'UpdateEnvVarsFunctionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        });

        updateEnvVarsFunctionRole.addToPolicy(new iam.PolicyStatement({
            actions: ['lambda:UpdateFunctionConfiguration'],
            resources: [props.validationFunctionArn],
        }));
        //add a policy that allows to modify the cors rules of the bucket :
        updateEnvVarsFunctionRole.addToPolicy(new iam.PolicyStatement({
            actions: ['s3:PutBucketCors'],
            resources: [props.uploadBucketArn],
        }));

        updateEnvVarsFunctionRole.addToPolicy(new iam.PolicyStatement({
            actions: ['iam:UpdateAssumeRolePolicy'],
            resources: [props.uploaderClientRoleArn],
        }));

        updateEnvVarsFunctionRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
        );


        // Create the custom resource Lambda function
        const updateEnvVarsFunction = new lambda.Function(this, 'UpdateEnvVarsFunction', {
            runtime: lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('./lambda/validator-updater'), 
            timeout: Duration.seconds(180),
            role: updateEnvVarsFunctionRole,
            layers: [new lambda_layer_awscli.AwsCliLayer(this, 'AwsCliLayer')]
          });

        // Create the custom resource provider
        const provider = new cr.Provider(this, 'UpdateEnvVarsProvider', {
            onEventHandler: updateEnvVarsFunction,
        });

        // Create the custom resource
        new CustomResource(this, 'UpdateEnvVarsCustomResource', {
            serviceToken: provider.serviceToken,
            properties: {
                validationFunctionArn: props.validationFunctionArn,
                validatorFunctionRoleArn: props.validatorFunctionRoleArn,
                distributionDomainName: props.distributionDomainName,
                uploaderClientRoleArn: props.uploaderClientRoleArn,
                sourceBucketName: props.sourceBucketName,
                uploadBuckerArn: props.uploadBucketArn,
                outputBucketName: props.outputBucketName,
                datastoreId: props.datastoreId,
                ahiImportRoleArn: props.ahiImportRoleArn,
                UpdateTimestamp: new Date().toISOString(),
            },
        });
    }
}
