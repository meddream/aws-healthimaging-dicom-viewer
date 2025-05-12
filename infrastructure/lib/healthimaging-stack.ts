import * as healthimaging from 'aws-cdk-lib/aws-healthimaging';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NestedStack, NestedStackProps, RemovalPolicy, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IBucket } from 'aws-cdk-lib/aws-s3';

interface HealthImagingStackProps extends NestedStackProps {
    datastoreName: string;
    sourceBucket: IBucket;
    outputBucket: IBucket;
}

/**
 * Stack that creates an AWS HealthImaging datastore and related resources
 */
export class HealthimagingStack extends NestedStack {
    /** The HealthImaging datastore instance */
    readonly datastore: healthimaging.CfnDatastore;

    /** The IAM role for HealthImaging to access S3 buckets */
    readonly healthImagingRole: iam.Role;

    constructor(scope: Construct, id: string, props: HealthImagingStackProps) {
        super(scope, id, props);

        // Create the HealthImaging datastore
        this.datastore = this.createHealthImagingDatastore(props.datastoreName);
        // Create IAM role for HealthImaging
        this.healthImagingRole = this.createHealthImagingRole(props.sourceBucket, props.outputBucket);



        // Add tags to the stack
        this.addTags();
    }

    /**
     * Creates the IAM role for HealthImaging to access S3 buckets
     */
    private createHealthImagingRole(sourceBucket: IBucket, outputBucket: IBucket): iam.Role {
        const role = new iam.Role(this, 'HealthImagingRole', {
            assumedBy: new iam.ServicePrincipal('medical-imaging.amazonaws.com'),
            description: 'Role for AWS HealthImaging to access import and output buckets',
        });

        // Add policy for source bucket access (read-only)
        role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject',
                's3:ListBucket'
            ],
            resources: [
                sourceBucket.bucketArn,
                `${sourceBucket.bucketArn}/*`
            ]
        }));

        // Add policy for output bucket access (read-write)
        role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:PutObject',
                's3:GetObject',
                's3:ListBucket'
            ],
            resources: [
                outputBucket.bucketArn,
                `${outputBucket.bucketArn}/*`
            ]
        }));

        role.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'medical-imaging:StartDICOMImportJob'
            ],
            resources: [ this.datastore.attrDatastoreArn]
        }));

        return role;

    }

    /**
     * Creates the HealthImaging datastore
     */
    private createHealthImagingDatastore(datastoreName: string): healthimaging.CfnDatastore {
        const datastore = new healthimaging.CfnDatastore(this, 'HealthImagingDatastore', {
            datastoreName: datastoreName,
        });
        datastore.applyRemovalPolicy(RemovalPolicy.RETAIN);

        return datastore
    }

    /**
     * Adds tags to all resources in the stack
     */
    private addTags(): void {
        Tags.of(this).add('Environment', process.env.ENVIRONMENT ?? 'development');
        Tags.of(this).add('Service', 'HealthImaging');
        Tags.of(this).add('ManagedBy', 'CDK');
    }

    /**
     * Returns the ARN of the HealthImaging datastore
     */
    public getDatastoreArn(): string {
        return this.datastore.attrDatastoreArn;
    }

    /**
     * Returns the ID of the HealthImaging datastore
     */
    public getDatastoreId(): string {
        return this.datastore.attrDatastoreId;
    }

    /**
     * Returns the name of the HealthImaging datastore
     */
    public getDatastoreName(): string {
        return this.datastore.datastoreName ?? '';
    }

    /**
     * Returns the ARN of the HealthImaging role
     */
    public getHealthImagingRoleArn(): string {
        return this.healthImagingRole.roleArn;
    }
}
