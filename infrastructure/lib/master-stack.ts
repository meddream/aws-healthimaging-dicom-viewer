import { CfnOutput, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NetworkStack } from './networking-stack';
import { StorageStack } from './storage-stack';
import { MedDreamStack, ServiceTargetGroup } from './meddream-stack';
import { DataImportStack } from './dataimport-stack';
import { CloudFrontStack } from './cloudfront-stack';
import { HealthimagingStack } from './healthimaging-stack';
import { UploaderPipeline } from './uploaderpipeline-stack';
import { configureValidationFunctionStack } from './configureValidationFunction-stack';
import { UploaderClientRoleStack } from './uploaderclientrole-stack';
import { RedisStack } from './redis-stack';
import { LambdaEdgeStack } from './lambda-edge-stack';
import { CloudFrontUrlUpdater } from './cloudfront-url-updater';
import { TaskDefinition } from 'aws-cdk-lib/aws-ecs';


interface MasterStackProps extends StackProps {
    accessLogsBucketArn: string;
    enableMultiAz: boolean;
    enableVpcFlowLogs: boolean;
    importSampleData: boolean;
    deployUploader: boolean;
    meddreamContainerUri : string;
    meddreamProxyContainerUri : string;
    meddreamTokenServiceUri : string;
    meddreamHisIntegration : string;
    lambdaEdgeStack: LambdaEdgeStack;
    customTags: { [key: string]: string }; // Add custom tags property
}

export class MasterStack extends Stack {
  constructor(scope: Construct, id: string, props: MasterStackProps) {
    super(scope, id, props);

    // Apply custom tags to this stack and all child resources
    this.applyCustomTags(props.customTags);

    // Deploy Network Stack
    const networkStack = new NetworkStack(this, 'Network', {
        //env: props.env,
        enableVpcFlowLogs: props.enableVpcFlowLogs,
        maxAzs: 2
    });
    this.applyCustomTags(props.customTags, networkStack);

    // Deploy Storage Stack
    const storageStack = new StorageStack(this, 'Storage', {
        //env: props.env,
        vpc: networkStack.vpc,
        efsSecurityGroup: networkStack.efsSecurityGroup,
        enable_multi_az: props.enableMultiAz,
        sourceBucketId: 'HealthImagingSourceBucket',
        outputBucketId: 'HealthImagingOutputBucket'
    });
    this.applyCustomTags(props.customTags, storageStack);


    // Deploy HealthImaging Stack
    const healthimagingStack = new HealthimagingStack(this, 'HealthImaging', {
        //env: props.env,
        datastoreName: this.stackName.toLowerCase(),
        sourceBucket: storageStack.healthImagingSourceBucket,
        outputBucket: storageStack.healthImagingOutputBucket
    });
    this.applyCustomTags(props.customTags, healthimagingStack);


    if(props.importSampleData)
    {
        const dataimportStack = new DataImportStack(this, 'DataImport' , {
            //env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
            healthImagingRoleArn: healthimagingStack.getHealthImagingRoleArn(),
            healthImagingSourceBucketName : storageStack.getHealthImagingSourceBucketName(),
            healthImagingOutputBucketName : storageStack.getHealthImagingOutputBucketName(),
            dicomSamplesPath : "../DICOM_samples",
            s3Prefix : "DICOM_samples",
            datastoreArn : healthimagingStack.getDatastoreArn(),
            datastoreId : healthimagingStack.getDatastoreId()
            });
        this.applyCustomTags(props.customTags, dataimportStack);
    }

    //Deploy redis-stack
    const redisCluster = new RedisStack(this, 'Redis', {
        //env: props.env,
        vpc: networkStack.vpc,
        ecsSecurityGroup: networkStack.ecsSecurityGroup,
        enableMultiAz: props.enableMultiAz,
    })
    this.applyCustomTags(props.customTags, redisCluster);

    // Create UploaderClientRoleStack before MedDreamStack (original order)
    const uploaderClientRoleStack = new UploaderClientRoleStack(this,  'ClientRole' , {
        datastoreArn: healthimagingStack.getDatastoreArn(),
        sourceBucketArn: storageStack.getHealthImagingSourceBucketArn(),
        healthImagingRoleArn: healthimagingStack.getHealthImagingRoleArn(),
    });
    this.applyCustomTags(props.customTags, uploaderClientRoleStack);

    
    // Deploy MedDream Stack (now creates load balancer + ECS services)
    const meddreamStack = new MedDreamStack(this, 'MedDream', {
        //env: props.env,
        vpc: networkStack.vpc,
        enableMultiAz: props.enableMultiAz,
        datastoreId: healthimagingStack.getDatastoreId(),
        datastoreArn: healthimagingStack.getDatastoreArn(),
        ecsSecurityGroup: networkStack.ecsSecurityGroup,
        loadBalancerSecurityGroup: networkStack.loadBalancerSecurityGroup,
        fileSystem: storageStack.fileSystem,
        efsAccessPoint: storageStack.efsAccessPoint,
        redisCluster : redisCluster.getredisCluster(),
        meddreamContainerUri : props.meddreamContainerUri,
        meddreamProxyContainerUri : props.meddreamProxyContainerUri,
        meddreamTokenServiceUri : props.meddreamTokenServiceUri,
        meddreamHisIntegration : props.meddreamHisIntegration,
        cloudfrontUrl: "placeholder.example.com" // Placeholder - will be updated by custom resource
    });
    this.applyCustomTags(props.customTags, meddreamStack);

    // Deploy CloudFront Stack (gets LoadBalancer from MedDreamStack)
    const cloudfrontStack = new CloudFrontStack(this, 'CloudFront', {
        //env: props.env,
        loadBalancer: meddreamStack.getLoadBalancer(),
        addUploader: true,
        uploaderClientRoleArn: uploaderClientRoleStack.getUploaderClientRoleArn(), // Handle separately if needed
        lambdaEdgeFunction: props.lambdaEdgeStack.getTokenValidatorEdgeFunction()
    });
    this.applyCustomTags(props.customTags, cloudfrontStack);

    // Custom resource to update proxy service with real CloudFront URL
    const urlUpdater = new CloudFrontUrlUpdater(this, 'CloudFrontUrlUpdater', {
        cloudfrontDistributionUrl: cloudfrontStack.getDistributionUrl(),
        ecsClusterName: meddreamStack.getClusterName(),
        proxyServiceName: meddreamStack.getProxyServiceName(),
        proxyTaskDefinitionArn: meddreamStack.getProxyTaskDefinitionArn(),
    });
    this.applyCustomTags(props.customTags, urlUpdater);

    
    if(props.deployUploader)
    {
        const meddreamUploaderPipeline = new UploaderPipeline(this, 'UploaderPipeline', {
            //env: props.env,
            hostingBucket: cloudfrontStack.getUploaderStaticBucket(),
            distribution: cloudfrontStack.getDistribution(),
            healthImagingRoleArn: healthimagingStack.getHealthImagingRoleArn(),
            datastoreArn: healthimagingStack.getDatastoreArn(),
            sourceBucketArn: storageStack.getHealthImagingSourceBucketArn()
        });
        this.applyCustomTags(props.customTags, meddreamUploaderPipeline);
    
        const configureValidationFunction = new configureValidationFunctionStack(this, 'ConfigureValidationFunction', {
            //env: props.env,
            validationFunctionArn: cloudfrontStack.getValidationFunctionArn(),
            validatorFunctionRoleArn: cloudfrontStack.getValidationFunctionRoleArn(),
            distributionDomainName: cloudfrontStack.getDistributionUrl(),
            uploaderClientRoleArn: uploaderClientRoleStack.getUploaderClientRoleArn(),
            sourceBucketName : storageStack.getHealthImagingSourceBucketName(),
            outputBucketName : storageStack.getHealthImagingOutputBucketName(),
            ahiImportRoleArn : healthimagingStack.getHealthImagingRoleArn(),
            uploadBucketArn : storageStack.getHealthImagingSourceBucketArn(),
            datastoreId : healthimagingStack.getDatastoreId(),

        });
        this.applyCustomTags(props.customTags, configureValidationFunction);

        configureValidationFunction.addDependency(uploaderClientRoleStack);



        //output CloudFront distribution url 
        new CfnOutput(this, 'CloudFrontDistributionUrl', {
            value: cloudfrontStack.getDistributionUrl(),
            description: 'The URL of the CloudFront distribution',
        });

        if (props.meddreamHisIntegration == "study"){
            new CfnOutput(this, 'CloudFrontDistributionIntegrationUrl', {
                value: cloudfrontStack.getDistributionUrl()+"/?study=",
                description: 'The URL of for study integration',
            });
        }

        if (props.meddreamHisIntegration == "token"){
            new CfnOutput(this, 'CloudFrontDistributionIntegrationUrl', {
                value: cloudfrontStack.getDistributionUrl()+"/?token=",
                description: 'The URL of for study integration',
            });
            
            new CfnOutput(this, 'TokenServiceUrl', {
                value: cloudfrontStack.getDistributionUrl()+"/v4/generate",
                description: 'The URL of for study integration',
            });

            new CfnOutput(this, 'TokenServiceUserNameArn', {
                value: meddreamStack.tokenServiceAuthUsername.secretArn || "",
                description: 'The username for token integration',
            });

            new CfnOutput(this, 'TokenServicePasswordArn', {
                value: meddreamStack.tokenServiceAuthPassword.secretArn || "",
                description: 'The password for token integration',
            });
        }


        // Output the updated task definition ARN for reference
        new CfnOutput(this, 'UpdatedTaskDefinitionArn', {
            value: urlUpdater.newTaskDefinitionArn,
            description: 'ARN of the updated task definition with CloudFront URL'
        });

        //output the meddreamstack adminSecrert ARN
        new CfnOutput(this, 'AdminSecretArn', {
            value: meddreamStack.adminSecret.secretArn,
            description: 'The ARN of the admin secret in the SecretsManager service',
        });
     
    }
  }

  /**
   * Helper method to apply custom tags to a construct and all its child resources
   */
  private applyCustomTags(customTags: { [key: string]: string }, construct?: Construct): void {
    const targetConstruct = construct || this;
    
    Object.entries(customTags).forEach(([key, value]) => {
      Tags.of(targetConstruct).add(key, value);
    });
  }
}
