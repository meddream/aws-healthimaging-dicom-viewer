import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NetworkStack } from './networking-stack';
import { StorageStack } from './storage-stack';
import { MedDreamStack } from './meddream-stack';
import { DataImportStack } from './dataimport-stack';
import { CloudFrontStack } from './cloudfront-stack';
import { HealthimagingStack } from './healthimaging-stack';
import { UploaderPipeline } from './uploaderpipeline-stack';
import { configureValidationFunctionStack } from './configureValidationFunction-stack';
import { UploaderClientRoleStack } from './uploaderclientrole-stack';
import { RedisStack } from './redis-stack';


interface MasterStackProps extends StackProps {
    accessLogsBucketArn: string;
    enableMultiAz: boolean;
    enableVpcFlowLogs: boolean;
    importSampleData: boolean;
    deployUploader: boolean;
}

export class MasterStack extends Stack {
  constructor(scope: Construct, id: string, props: MasterStackProps) {
    super(scope, id, props);

    // Deploy Network Stack
    const networkStack = new NetworkStack(this, 'Network', {
        //env: props.env,
        enableVpcFlowLogs: props.enableVpcFlowLogs,
        maxAzs: 2
    });

    // Deploy Storage Stack
    const storageStack = new StorageStack(this, 'Storage', {
        //env: props.env,
        vpc: networkStack.vpc,
        efsSecurityGroup: networkStack.efsSecurityGroup,
        enable_multi_az: props.enableMultiAz,
        sourceBucketId: 'HealthImagingSourceBucket',
        outputBucketId: 'HealthImagingOutputBucket'
    });

    // Deploy HealthImaging Stack
    const healthimagingStack = new HealthimagingStack(this, 'HealthImaging', {
        //env: props.env,
        datastoreName: this.stackName.toLowerCase(),
        sourceBucket: storageStack.healthImagingSourceBucket,
        outputBucket: storageStack.healthImagingOutputBucket
    });

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
    }

    //Deploy redis-stack
    const redisCluster = new RedisStack(this, 'Redis', {
        //env: props.env,
        vpc: networkStack.vpc,
        ecsSecurityGroup: networkStack.ecsSecurityGroup,
    })

    //Deploy MedDream Stack
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
        redisCluster : redisCluster.getredisCluster()
    });



    const uploaderClientRoleStack = new UploaderClientRoleStack(this,  'ClientRole' , {
        datastoreArn: healthimagingStack.getDatastoreArn(),
        sourceBucketArn: storageStack.getHealthImagingSourceBucketArn(),
        healthImagingRoleArn: healthimagingStack.getHealthImagingRoleArn(),
    });


    const cloudfrontStack = new CloudFrontStack(this, 'CloudFront', {
        //env: props.env,
        service: meddreamStack.getservice(),
        addUploader: true,
        uploaderClientRoleArn : uploaderClientRoleStack.getUploaderClientRoleArn()
    });

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

        configureValidationFunction.addDependency(uploaderClientRoleStack);

        //output CloudFront distribution url 
        new CfnOutput(this, 'CloudFrontDistributionUrl', {
            value: cloudfrontStack.getDistributionUrl(),
            description: 'The URL of the CloudFront distribution',
        });
        //output the meddreamstack adminSecrert ARN
        new CfnOutput(this, 'AdminSecretArn', {
            value: meddreamStack.adminSecret.secretArn,
            description: 'The ARN of the admin secret in the SecretsManager service',
        });
     
    }
  }
}
