import { Duration, NestedStack, NestedStackProps, PhysicalName, RemovalPolicy, Stack, StackProps, Tags } from "aws-cdk-lib";
import { 
  IVpc, 
  SecurityGroup 
} from "aws-cdk-lib/aws-ec2";
import { 
  AccessPoint, 
  FileSystem, 
  PerformanceMode, 
  ThroughputMode 
} from "aws-cdk-lib/aws-efs";
import { Key } from "aws-cdk-lib/aws-kms";
import { 
  BlockPublicAccess, 
  Bucket, 
  BucketEncryption, 
  ObjectOwnership
} from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

interface StorageStackProps extends NestedStackProps {
  vpc: IVpc;
  efsSecurityGroup: SecurityGroup;
  enable_multi_az: boolean;
  sourceBucketId: string;
  outputBucketId: string;
}

/**
 * Stack that creates storage resources including EFS and S3 buckets for HealthImaging
 */
export class StorageStack extends NestedStack {
  /** The EFS filesystem instance */
  public readonly fileSystem: FileSystem;
  
  /** The EFS access point */
  public readonly efsAccessPoint: AccessPoint;
  
  /** The S3 bucket for HealthImaging DICOM imports */
  public readonly healthImagingSourceBucket: Bucket;

  /** The S3 bucket for HealthImaging import job results */
  public readonly healthImagingOutputBucket: Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // Create EFS resources
    const { fileSystem, accessPoint } = this.createEfsResources(props);
    this.fileSystem = fileSystem;
    this.efsAccessPoint = accessPoint;

    // Create S3 buckets for HealthImaging
    const { sourceBucket, outputBucket } = this.createHealthImagingBuckets(props);
    this.healthImagingSourceBucket = sourceBucket;
    this.healthImagingOutputBucket = outputBucket;

    // Add tags to resources
    this.addTags();
  }

  /**
   * Creates S3 buckets for HealthImaging imports and results
   */
  private createHealthImagingBuckets(props: StorageStackProps): { 
    sourceBucket: Bucket; 
    outputBucket: Bucket; 
  } {
    // Common configuration for both buckets
    const commonBucketConfig = {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
    };

    // Create source bucket for DICOM imports
    const sourceBucket = new Bucket(this, props.sourceBucketId, {
      ...commonBucketConfig,
      bucketName: PhysicalName.GENERATE_IF_NEEDED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(7),
          expiration: Duration.days(30)
        },
      ],
    });

    // Create output bucket for import job results
    const outputBucket = new Bucket(this, props.outputBucketId, {
      ...commonBucketConfig,
      bucketName: PhysicalName.GENERATE_IF_NEEDED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(7),
          expiration: Duration.days(90)
        },
      ],
    });

    return { sourceBucket, outputBucket };
  }

  /**
   * Creates EFS filesystem and access point
   */
  private createEfsResources(props: StorageStackProps): { 
    fileSystem: FileSystem; 
    accessPoint: AccessPoint; 
  } {
    // Create KMS key for EFS encryption (keeping KMS for EFS as it's required)
    const efsKmsKey = new Key(this, 'EfsEncryptionKey', {
      enableKeyRotation: true,
      description: 'KMS key for EFS encryption'
    });

    // Create EFS filesystem
    const fileSystem = new FileSystem(this, 'FileSystem', {
      vpc: props.vpc,
      securityGroup: props.efsSecurityGroup,
      performanceMode: PerformanceMode.GENERAL_PURPOSE,
      throughputMode: ThroughputMode.BURSTING,
      encrypted: true,
      kmsKey: efsKmsKey,
      removalPolicy: RemovalPolicy.DESTROY,
      enableAutomaticBackups: props.enable_multi_az
    });

    // Create EFS access point
    const accessPoint = fileSystem.addAccessPoint('AccessPoint', {
      createAcl: {
        ownerGid: "433",
        ownerUid: "431",
        permissions: "755"
      },
      posixUser: {
        gid: "433",
        uid: "431"
      },
      path: "/data"
    });

    return { fileSystem, accessPoint };
  }

  /**
   * Adds tags to all resources in the stack
   */
  private addTags(): void {
    Tags.of(this).add('Environment', process.env.ENVIRONMENT || 'development');
    Tags.of(this).add('Service', 'Storage');
    Tags.of(this).add('ManagedBy', 'CDK');
  }


  public getHealthImagingSourceBucketArn(): string {
    return this.healthImagingSourceBucket.bucketArn;
  }

  public getHealthImagingSourceBucketName(): string {
    return this.healthImagingSourceBucket.bucketName;
  }

  public getHealthImagingOutputBucketArn(): string {
    return this.healthImagingOutputBucket.bucketArn;
  }

  public getHealthImagingOutputBucketName(): string {
    return this.healthImagingOutputBucket.bucketName;
  }
}
