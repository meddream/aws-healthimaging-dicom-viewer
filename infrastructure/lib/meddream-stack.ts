import {
  Duration,
  NestedStack,
  NestedStackProps,
  Stack,
  StackProps,
  Tags,
  Names,
  PhysicalName
} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { LoadBalancerV2Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  IVpc,
  SecurityGroup,
} from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  LogDriver,
  OperatingSystemFamily,
  Protocol,
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancedFargateService,
} from "aws-cdk-lib/aws-ecs-patterns";
import { ApplicationLoadBalancer, Protocol as ElbProtocol } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { AccessPoint, FileSystem } from "aws-cdk-lib/aws-efs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as elasticache from 'aws-cdk-lib/aws-elasticache'

interface MedDreamStackProps extends NestedStackProps {
  vpc: IVpc;
  enableMultiAz: boolean;
  datastoreId: string;
  datastoreArn : string;
  ecsSecurityGroup: SecurityGroup;
  loadBalancerSecurityGroup: SecurityGroup;
  fileSystem: FileSystem;
  efsAccessPoint: AccessPoint;
  minCapacity?: number;      // Optional minimum capacity override
  maxCapacity?: number;      // Optional maximum capacity override 
  cpuScaleTarget?: number;   // Optional CPU utilization target percentage
  redisCluster?: elasticache.CfnReplicationGroup;
}

export class MedDreamStack extends NestedStack {
  private cluster: Cluster;
  private service: ApplicationLoadBalancedFargateService;
  public adminSecret : secretsmanager.Secret;
  
  constructor(scope: Construct, id: string, props: MedDreamStackProps) {
    super(scope, id, props);
    const ecsResources = this.createEcsResources(props);
    this.cluster = ecsResources.cluster;
    this.service = ecsResources.service;
    this.adminSecret = ecsResources.adminSecret;
    
    this.createOutputs();
    this.addTags();
  }
  /**
   * Creates ECS resources including cluster and service
   */
  private createEcsResources(props: MedDreamStackProps): {
    cluster: Cluster;
    service: ApplicationLoadBalancedFargateService;
    adminSecret: secretsmanager.Secret;
  } {
    // Create ECS Cluster
    const cluster = new Cluster(this, "MedDreamCluster", {
      vpc: props.vpc,
      enableFargateCapacityProviders: true,
    });

    // Create EFS Volume
    const volumeName = "cache-volume";
    const efsVolume = {
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: props.fileSystem.fileSystemId,
        transitEncryption: "ENABLED",
        authorizationConfig: {
          accessPointId: props.efsAccessPoint.accessPointId,
          iam: "ENABLED"
        }
      }
    };

    // Create Task Role with permissions
    const taskRole = new iam.Role(this, "MedDreamTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Role for MedDream ECS task to access AWS HealthImaging"
    });

    const taskAHIAccessPolicy =  new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // Read access to datastores
        "medical-imaging:*",
      ],
      resources: [
        props.datastoreArn,
        props.datastoreArn+'/*',
        props.datastoreArn + '/imageset/*'
      ]
    })
    // Add HealthImaging permissions
    taskRole.addToPolicy(taskAHIAccessPolicy);

    //Add policty to allow to connect to the redis cluster
    if (props.redisCluster) {
      taskRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'elasticache:Connect'
        ],
        resources: [
          `arn:aws:elasticache:${this.region}:${this.account}:replicationgroup:${props.redisCluster.replicationGroupId}`,
        ]
      }));
    }
    

    // Add EFS access permissions using AWS managed policy
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonElasticFileSystemClientReadWriteAccess')
    );

    //create an IAM user
    const parentStackName = Stack.of(this).stackName;
    const medDreamIAMuser = new iam.User(this, 'MedDreamContaainerIAMUser', {
      userName: PhysicalName.GENERATE_IF_NEEDED
    });
    // Create access key for the IAM user
    const medDreamIAMuserAccessKey = new iam.CfnAccessKey(this, 'MedDreamUserAccessKey', {
      userName: medDreamIAMuser.userName,
    });


    // Update the role's trust policy to allow the user to assume it
    taskRole.assumeRolePolicy?.addStatements(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      principals: [new iam.ArnPrincipal(medDreamIAMuser.userArn)]
    }));

    medDreamIAMuser.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonElasticFileSystemClientReadWriteAccess'))
    medDreamIAMuser.addToPolicy(taskAHIAccessPolicy);

    // Create Task Definition
    const taskDefinition = new FargateTaskDefinition(this, "MedDreamTaskDef", {
      cpu: 2048,
      memoryLimitMiB: 4096,
      volumes: [efsVolume],
      taskRole: taskRole
    });

    //Generate the admin password
    const adminSecret = new secretsmanager.Secret(this, 'AdminUserSecret', {
      secretName: `${Stack.of(this).stackName}-admin-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'admin',
          environment: Stack.of(this).stackName,
          application: 'meddream'
        }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 16,
        includeSpace: false,
        requireEachIncludedType: true
      }
    });

    // Configure container
    const container = taskDefinition.addContainer("MedDreamContainer", {
      image: ContainerImage.fromRegistry('meddream/aws-healthimaging-dicom-viewer:8.6.0'),
      containerName: "meddream",
      cpu: 2048,
      memoryLimitMiB: 4096,
      logging: LogDriver.awsLogs({
        streamPrefix: "meddream",
        logRetention: RetentionDays.ONE_MONTH,
      }),
      environment: {
        // AWS HealthImaging Configuration
        AWS_REGION: Stack.of(this).region,
        AWS_ACCESS_KEY_ID: medDreamIAMuserAccessKey.ref,
        AWS_SECRET_ACCESS_KEY: medDreamIAMuserAccessKey.attrSecretAccessKey ,
        AWS_DATASTORE_ID: props.datastoreId ,

        STORAGE_PATH: "/data",
        AUTHORIZATION_ENABLED: "false",     //srt to false instead of right for testing.
        JAVA_OPTS: "-Xmx2048m",

        //File-systems Configuration
        LOGGING_FILE_NAME: "/data/logs/meddream",
        //COM_SOFTNETA_SETTINGS_FILELOCATION: "/data/settings",
        COM_SOFTNETA_MEDDREAM_TEMPDIR : "/data/temp",
        COM_SOFTNETA_LICENSE_LICENSE_FILE_LOCATION : "/data",

        SPRING_PROFILES_INCLUDE : "auth-inmemory,redis,stateless",  // origin entry was : auth-inmemory,auth-his,redis,stateless
        COM_SOFTNETA_MEDDREAM_LOGINENABLED : "true",

        AUTHENTICATION_INMEMORY_USERS_0_USERNAME : "admin",
        AUTHENTICATION_INMEMORY_USERS_0_PASSWORD : adminSecret.secretValueFromJson("password").toString(),

        AUTHORIZATION_DEFAULTLOGINPERMISSIONS : "ADMIN,SEARCH,EXPORT_ISO,EXPORT_ARCH,FORWARD,PATIENT_HISTORY,DOCUMENT_VIEW",

        LOGGING_LEVEL_COM_SOFTNETA : "ERROR",

        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_ID : "DX",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_TYPE : "AWSHealthImaging",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_DATASTORE_ID : props.datastoreId,
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_AWS_REGION : this.region,
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_ID : "DX",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_TYPE : "Dicomweb",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_SEARCHAPIENABLED : "false",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_AUTH_TYPE : "aws",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_AWS_REGION : this.region,
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_DICOMFILEURL : `https://dicom-medical-imaging.${this.region}.amazonaws.com/datastore/${props.datastoreId}/studies/{study}/series/{series}/instances/{image}`,
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_FILEACCEPTHEADER : "application/dicom; transfer-syntax=*",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_DICOMCACHEDIRECTORY : "/data/temp/STORE/AWS/DX",

        AUTHENTICATION_HIS_TOKENSERVICEADDRESS : "",
        AUTHENTICATION_JWT_ENABLED : "false",
        AUTHENTICATION_JWT_SECUREKEY : "meddream_very_secret_key_1234567"

      }
    });

    //Add the REDIS env variable if redis clcuster is present
    if(props.redisCluster)
      {
        container.addEnvironment("REDIS_URL", `rediss://${props.redisCluster.attrPrimaryEndPointAddress}:${props.redisCluster.attrPrimaryEndPointPort}`)
      }

    // Add container mount point for EFS
    container.addMountPoints({
      sourceVolume: volumeName,
      containerPath: "/data",
      readOnly: false
    });

    // Add port mapping
    container.addPortMappings({
      containerPort: 8080
    });

    // Create Fargate Service with ALB
    const service = new ApplicationLoadBalancedFargateService(
      this,
      "MedDreamService",
      {
        cluster,
        taskDefinition,
        desiredCount: props.enableMultiAz ? 2 : 1,
        publicLoadBalancer: true,
        assignPublicIp: false,
        securityGroups: [props.ecsSecurityGroup],
        taskSubnets: { subnets: props.vpc.privateSubnets },
        loadBalancerName: "MedDreamALB",
        loadBalancer: new ApplicationLoadBalancer(this, "MedDreamLoadBalancer", {
          vpc: props.vpc,
          securityGroup: props.loadBalancerSecurityGroup,
          internetFacing: true,
        }),
      }
    );

    // Configure health check
    service.targetGroup.configureHealthCheck({
      path: "/index.html",
      port: "8080",
      protocol: ElbProtocol.HTTP,
      interval: Duration.seconds(30),
      timeout: Duration.seconds(10),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

    // Define min and max capacity
    const minCapacity = props.minCapacity ?? (props.enableMultiAz ? 2 : 1);
    const maxCapacity = props.maxCapacity ?? 6;  // Maximum of 6 instances by default
    const cpuTarget = props.cpuScaleTarget ?? 70; // Default to 70% CPU utilization

    // Enable auto-scaling
    const scaling = service.service.autoScaleTaskCount({
      minCapacity,
      maxCapacity,
    });

    // Add CPU utilization scaling policy
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: cpuTarget,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });
  
    return { cluster, service , adminSecret };
  }

 

  /**
   * Creates CloudFormation outputs
   */
  private createOutputs(): void {
    // Add any stack outputs here if needed
  }

  /**
   * Adds tags to all resources in the stack
   */
  private addTags(): void {
    Tags.of(this).add('Environment', process.env.ENVIRONMENT ?? 'development');
    Tags.of(this).add('Service', 'MedDream');
    Tags.of(this).add('ManagedBy', 'CDK');
  }

  public getcluster(): Cluster {
    return this.cluster;
  }
  
  public getservice(): ApplicationLoadBalancedFargateService {
    return this.service;
  }
}
