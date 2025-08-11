import {
  Duration,
  NestedStack,
  NestedStackProps,
  Stack,
  StackProps,
  Tags,
  Names,
  PhysicalName,
  CfnOutput
} from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import {
    ISubnet,
  IVpc,
  SecurityGroup,

} from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerDefinition,
  ContainerImage,
  FargateTaskDefinition,
  LogDriver,

  FargateService,
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancedFargateService,
} from "aws-cdk-lib/aws-ecs-patterns";
import { 
  ApplicationLoadBalancer, 
  Protocol as ElbProtocol, 
  ApplicationListener,
  ApplicationTargetGroup,
  TargetType,
  ListenerAction,
  ListenerCondition,
  ApplicationProtocol
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { AccessPoint, FileSystem } from "aws-cdk-lib/aws-efs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as elasticache from 'aws-cdk-lib/aws-elasticache'

interface MedDreamStackProps extends NestedStackProps {
    vpc: IVpc;
    enableMultiAz: boolean;
    datastoreId: string;
    datastoreArn : string;
    meddreamContainerUri : string;
    meddreamProxyContainerUri : string;
    meddreamTokenServiceUri : string;
    meddreamHisIntegration : string;
    ecsSecurityGroup: SecurityGroup;
    loadBalancerSecurityGroup: SecurityGroup; // Add load balancer security group
    fileSystem: FileSystem;
    efsAccessPoint: AccessPoint;
    minCapacity?: number;      // Optional minimum capacity override
    maxCapacity?: number;      // Optional maximum capacity override 
    cpuScaleTarget?: number;   // Optional CPU utilization target percentage
    redisCluster: elasticache.CfnReplicationGroup;
    cloudfrontUrl: string;    //Cloudfront distribution URL.
}

// Add interface for target group information
export interface ServiceTargetGroup {
    targetGroup: ApplicationTargetGroup;
    pathPattern: string;
    priority: number;
}

export class MedDreamStack extends NestedStack {
  private cluster: Cluster;
  private viewerService: FargateService;
  private proxyService: FargateService;
  private tokenService: FargateService | undefined;
  public adminSecret: secretsmanager.Secret;
  
  // Load balancer resources (moved from NetworkStack)
  public readonly applicationLoadBalancer: ApplicationLoadBalancer;
  public readonly applicationListener: ApplicationListener;
  public  tokenServiceAuthUsername : secretsmanager.Secret;
  public  tokenServiceAuthPassword : secretsmanager.Secret;



  
  // Collection of target groups to be used for listener rules
  public readonly serviceTargetGroups: ServiceTargetGroup[] = [];
  
  constructor(scope: Construct, id: string, props: MedDreamStackProps) {
    super(scope, id, props);
    
    // Create Application Load Balancer
    this.applicationLoadBalancer = new ApplicationLoadBalancer(this, "MedDreamLoadBalancer", {
      vpc: props.vpc,
      securityGroup: props.loadBalancerSecurityGroup,
      internetFacing: true
    });

    // Create the shared listener
    this.applicationListener = this.applicationLoadBalancer.addListener("SharedPublicListener", {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(404, {
        contentType: "text/plain",
        messageBody: "Not Found",
      }),
    });
    
    const ecsResources = this.createEcsResources(props);
    this.cluster = ecsResources.cluster;
    this.viewerService = ecsResources.viewerService;
    this.proxyService = ecsResources.proxyService;
    this.tokenService = ecsResources.tokenService;
    this.adminSecret = ecsResources.adminSecret;

    
    this.createOutputs();
    this.addTags();
  }
  /**
   * Creates ECS resources including cluster and service
   */
  private createEcsResources(props: MedDreamStackProps): {
    cluster: Cluster;
    viewerService: FargateService;
    proxyService: FargateService;
    tokenService: FargateService | undefined;
    adminSecret: secretsmanager.Secret;
    tokenServiceAuthUsername: string | undefined;
    tokenServiceAuthPassword: string | undefined;
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
      taskRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'elasticache:Connect'
        ],
        resources: [
          `arn:aws:elasticache:${this.region}:${this.account}:replicationgroup:${props.redisCluster.replicationGroupId}`,
        ]
      }));
 
    

    // Add EFS access permissions using AWS managed policy
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonElasticFileSystemClientReadWriteAccess')
    );

    //create an IAM user

    const medDreamIAMuser = new iam.User(this, 'MedDreamContainerIAMUser', {
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

    // Create viewer Task Definition
    const viewerTaskDefinition = new FargateTaskDefinition(this, "MedDreamViewerTaskDef", {
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
      },
      description : "MedDream deployement admin user"
    });


    //Generate the JWT Secure Key
    const jwtSecurekey = new secretsmanager.Secret(this, 'JWTSecuredKey', {
      secretName: `${Stack.of(this).stackName}-jwt-securekey`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ purpose : 'JWT secure key' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
        includeSpace: false,
        requireEachIncludedType: true,
        excludeCharacters : "!\"#$%&'()*+,-./:;<=>?@[]^_{|}~`\\"
      },
      description : "JWT secure key" 
    });





    // Setting up env variables fot rhe container configuration
    let TaskEnvVariables: Record<string, string> = {
        JAVA_OPTS : "-Xmx2048m",
        AWS_REGION: Stack.of(this).region,
        AWS_ACCESS_KEY_ID: medDreamIAMuserAccessKey.ref,
        AWS_SECRET_ACCESS_KEY: medDreamIAMuserAccessKey.attrSecretAccessKey ,
        AWS_DATASTORE_ID: props.datastoreId ,
        REDIS_URL : "rediss://master.mer1qf7y0sbv8zak.kys1z0.use1.cache.amazonaws.com:6379",
        AUTHENTICATION_JWT_ENABLED : "true",
        AUTHENTICATION_JWT_SECUREKEY : jwtSecurekey.secretValueFromJson("password").toString(),

        COM_SOFTNETA_MEDDREAM_LOGINENABLED : "true",
        AUTHENTICATION_INMEMORY_USERS_0_USERNAME : "admin",
        AUTHENTICATION_INMEMORY_USERS_0_PASSWORD : adminSecret.secretValueFromJson("password").toString(),
        AUTHORIZATION_DEFAULTLOGINPERMISSIONS : "ADMIN,SEARCH,EXPORT_ISO,EXPORT_ARCH,FORWARD,PATIENT_HISTORY,DOCUMENT_VIEW,CLEAR_CACHE",
        SERVER_COMPRESSION_ENABLED : "true",
        SERVER_COMPRESSION_MIMETYPES : "application/json",
        SERVER_COMPRESSION_MINRESPONSESIZE : "102400",
        COM_SOFTNETA_PREPARATION_IGNORESTEPSFOR512RESOLUTION : "true",
        COM_SOFTNETA_PREPARATION_COMPRESSPRIXELSBEFORESAVE : "false",
        COM_SOFTNETA_PREPARATION_COMPRESSPRIXELSINSTEPSBEFORESAVE : "gzip",
        COM_SOFTNETA_PREPARATION_LEAVEHTJ2KPIXELSEXCEPTTHESESOPCLASSES : "1.2.840.10008.5.1.4.1.1.9.1.1,1.2.840.10008.5.1.4.1.1.88.22,1.2.840.10008.5.1.4.1.1.104.1,1.2.840.10008.5.1.4.1.1.7",
        COM_SOFTNETA_PREPARATION_PREPAREFROMPACSMETADATAEXCEPTTHESESOPCLASSES : "1.2.840.10008.5.1.4.1.1.9.1.1,1.2.840.10008.5.1.4.1.1.88.22,1.2.840.10008.5.1.4.1.1.104.1,1.2.840.10008.5.1.4.1.1.7",
        STORAGE_PATH : "/data",
        COM_SOFTNETA_MEDDREAM_TEMPDIR : "/data/temp",
        COM_SOFTNETA_LICENSE_LICENSE_FILE_LOCATION : "/data",
        LOGGING_FILE_NAME : "/data/logs/meddream",
        LOGGING_LEVEL_COM_SOFTNETA_PACS_GATEWAY_PLUGIN_DICOMWEB : "ERROR",
        LOGGING_LEVEL_COM_SOFTNETA_PACS_GATEWAY_PLUGIN_AWS_HEALTHIMAGING : "ERROR",
        LOGGING_LEVEL_COM_SOFTNETA : "ERROR",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_TYPE : "AWSHealthImaging",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_ID : "AHI1",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_DATASTORE_ID : props.datastoreId,
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_AWS_REGION : this.region,
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_QIDORSURL : `https://dicom-medical-imaging.${this.region}.amazonaws.com/datastore/${props.datastoreId}/`,
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_SEARCHPAGESIZE : "100",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_DICOMCACHEDIRECTORY : "",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_PREPAREFROMPACSMETADATA : "true",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_DIRECTAHIFORPIXELS : "true",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_0_EVENTAPIENABLED : "false",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_TYPE : "Dicomweb",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_ID : "AHI1",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_SEARCHAPIENABLED : "false",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_AUTH_TYPE : "aws",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_AWS_REGION : this.region,
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_DICOMFILEURL : `https://dicom-medical-imaging.${this.region}.amazonaws.com/datastore/${props.datastoreId}/tudies/{study}/series/{series}/instances/{image}`,
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_FILEACCEPTHEADER : "application/dicom; transfer-syntax=*",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_DICOMCACHEDIRECTORY : "/data/temp/STORE/AWS/AHI1",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_STORAGEAPIENABLED : "false",
        COM_SOFTNETA_MEDDREAM_PACS_CONFIGURATIONS_1_STOWRSURL : `https://dicom-medical-imaging.${this.region}.amazonaws.com/datastore/${props.datastoreId}/`,

    };

    // Configure the meddream viewer container
    const viewerContainer = viewerTaskDefinition.addContainer("MedDreamviewerContainer", {
      image: ContainerImage.fromRegistry(props.meddreamContainerUri),
      containerName: "meddreamViewer",
      cpu: 2048,
      memoryLimitMiB: 4096,
      logging: LogDriver.awsLogs({
        streamPrefix: "meddreamViewer",
        logRetention: RetentionDays.ONE_MONTH,
      }),
      environment: TaskEnvVariables
    });
    
    if(props.redisCluster)
      {
        viewerContainer.addEnvironment("REDIS_URL", `rediss://${props.redisCluster.attrPrimaryEndPointAddress}:${props.redisCluster.attrPrimaryEndPointPort}`)
      }

    // Add viewerContainer mount point for EFS
    viewerContainer.addMountPoints({
      sourceVolume: volumeName,
      containerPath: "/data",
      readOnly: false
    });

    // Add port mapping
    viewerContainer.addPortMappings({
      containerPort: 8080
    });

    // Use the load balancer DNS from this stack
    const loadBalancerDnsName = this.applicationLoadBalancer.loadBalancerDnsName;

    let tokenService = undefined;
    let tokenServiceAuthUsername = undefined;
    let tokenServiceAuthPassword = undefined;
    switch(props.meddreamHisIntegration.toLowerCase())
    {
        case "token":
            //in this mode we need to add a few more env variables to the viewer task definition, and also deploy the token service.
            const AuthTokenconfig = this.configureFortokenAuth(viewerContainer, props, loadBalancerDnsName, cluster);
            this.tokenService = AuthTokenconfig.tokenService;
            this.tokenServiceAuthUsername = AuthTokenconfig.tokenServiceAuthUsername;
            this.tokenServiceAuthPassword = AuthTokenconfig.tokenServiceAuthPassword;
            
        break;
        case "study":
            viewerContainer.addEnvironment("SPRING_PROFILES_INCLUDE", "auth-inmemory,redis,stateless,auth-his");
            viewerContainer.addEnvironment("AUTHENTICATION_HIS_VALIDHISPARAMS", "study");
            viewerContainer.addEnvironment("AUTHORIZATION_DEFAULTHISPERMISSIONS", "SEARCH,EXPORT_ISO,EXPORT_ARCH,FORWARD,PATIENT_HISTORY,DOCUMENT_VIEW,CLEAR_CACHE");
        break;
        case "none":
            viewerContainer.addEnvironment("SPRING_PROFILES_INCLUDE", "auth-inmemory,redis,stateless");
        break;
    }

    //Create Proxy Task Definition
    const proxyTaskDefinition = new FargateTaskDefinition(this, "MedDreamProxyTaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
      volumes: [efsVolume],
      taskRole: taskRole
    });

    // Configure the meddream Proxy container
    const proxyContainer = proxyTaskDefinition.addContainer("MedDreamviewerContainer", {
      image: ContainerImage.fromRegistry(props.meddreamProxyContainerUri),
      containerName: "meddreamProxy",
      cpu: 512,
      memoryLimitMiB: 1024,
      logging: LogDriver.awsLogs({
        streamPrefix: "meddreamPoxy",
        logRetention: RetentionDays.ONE_MONTH,
      }),
      environment: {
            AWS_REGION: Stack.of(this).region,
            AWS_ACCESS_KEY_ID: medDreamIAMuserAccessKey.ref,
            AWS_SECRET_ACCESS_KEY: medDreamIAMuserAccessKey.attrSecretAccessKey ,
            MEDDREAM_DIRECT_URL : `https://${props.cloudfrontUrl}`
      }
    });

    // Add port mapping
    proxyContainer.addPortMappings({
      containerPort: 3000
    });



    // Create services using target groups (listener rules will be created by NetworkStack)
    const viewerService = this.createFargateServiceWithTargetGroup(
      cluster,
      viewerTaskDefinition,
      "MedDreamViewer",
      "/*", // Default path - catches all requests not matched by other rules
      1000, // Lowest priority (highest number) - default route
      props.enableMultiAz,
      props.ecsSecurityGroup,
      props.vpc,
      8080, // Traffic port
      "/index.html", // Health check path
      8080, // Health check port
      "200" // Expected response code
    );

    const proxyService = this.createFargateServiceWithTargetGroup(
      cluster,
      proxyTaskDefinition,
      "MedDreamProxy", 
      "/pixels/store*", // Proxy-specific paths
      100, // Higher priority than viewer
      props.enableMultiAz,
      props.ecsSecurityGroup,
      props.vpc,
      3000, // Traffic port
      "/", // Health check path
      3000, // Health check port
      "200" // Expected response code
    );

    // Configure auto-scaling for viewer service
    this.configureAutoScaling(viewerService, props);
    
    // Configure auto-scaling for proxy service  
    this.configureAutoScaling(proxyService, props);




    return { 
      cluster, 
      viewerService, 
      proxyService, 
      tokenService, 
      adminSecret,
      tokenServiceAuthUsername,
      tokenServiceAuthPassword
    };
  }


    private  configureFortokenAuth(
        viewerContainer: ContainerDefinition, 
        props: MedDreamStackProps,
        loadBalancerDnsName: string,
        cluster: Cluster
    ): { tokenService : FargateService , tokenServiceAuthUsername : secretsmanager.Secret , tokenServiceAuthPassword: secretsmanager.Secret }
    {
        
        //Create Token Service Task Definition
        const tokenServiceTaskDefinition = new FargateTaskDefinition(this, "MedDreamTokenServiceTaskDef", {
        cpu: 512,
        memoryLimitMiB: 2048
        });


        const tokenServiceAuthUsername = new secretsmanager.Secret(this, 'TokenServiceUsername', {
        secretName: `${Stack.of(this).stackName}-token-username`,
        generateSecretString: {
            secretStringTemplate: JSON.stringify({ purpose: 'token service username' }),
            generateStringKey: 'password',
            excludePunctuation: true,
            passwordLength: 12,
            includeSpace: false,
            requireEachIncludedType: true,
            excludeCharacters : "!\"#$%&'()*+,-./:;<=>?@[]^_{|}~`\\"
        },
        description : "token service username"
        });

        const tokenServiceAuthPassword = new secretsmanager.Secret(this, 'TokenServicePassword', {
        secretName: `${Stack.of(this).stackName}-token-password`,
        generateSecretString: {
            secretStringTemplate: JSON.stringify({ purpose : 'token service passsword' }),
            generateStringKey: 'password',
            excludePunctuation: true,
            passwordLength: 32,
            includeSpace: false,
            requireEachIncludedType: true,
            excludeCharacters : "!\"#$%&'()*+,-./:;<=>?@[]^_{|}~`\\"
        },
        description : "token service password"
        });

        //Generate the Encryption Secret Key
        const tokenEncryptionSecretkey = new secretsmanager.Secret(this, 'TokenEncryptionSecretkey', {
        secretName: `${Stack.of(this).stackName}-tokenservice-secretkey`,
        generateSecretString: {
            secretStringTemplate: JSON.stringify({ purpose: 'token service secret key' }),
            generateStringKey: 'password',
            excludePunctuation: true,
            passwordLength: 32,
            includeSpace: false,
            requireEachIncludedType: true,
            excludeCharacters : "!\"#$%&'()*+,-./:;<=>?@[]^_{|}~`\\"
        },
        description : "token service secret key"
        });

        //Generate the initialization vector
        const tokenInitalizationVector= new secretsmanager.Secret(this, 'TokenInitalizationVector', {
        secretName: `${Stack.of(this).stackName}-tokenservice-initialization-vector`,
        generateSecretString: {
            secretStringTemplate: JSON.stringify({ purpose: 'token service vector intiialization' }),
            generateStringKey: 'password',
            excludePunctuation: true,
            passwordLength: 16,
            includeSpace: false,
            requireEachIncludedType: true,
            excludeCharacters : "!\"#$%&'()*+,-./:;<=>?@[]^_{|}~`\\"
        },
        description : "token service vector intiialization"
        });

        // Configure the meddream viewer container
        const tokenServiceContainer = tokenServiceTaskDefinition.addContainer("MedDreamvTokenServiceContainer", {
        image: ContainerImage.fromRegistry(props.meddreamTokenServiceUri),
        containerName: "meddreamViewer",
        cpu: 512,
        memoryLimitMiB: 2048,
        logging: LogDriver.awsLogs({
            streamPrefix: "meddreamTokenService",
            logRetention: RetentionDays.ONE_MONTH,
        }),
        environment: {
            JAVA_ARGS : "-XX:+UseContainerSupport -XshowSettings:vm -XX:+PrintCommandLineFlags -Xms512m -Xmx512m -Dspring.profiles.active=basic-authentication-for-generation,basic-authentication-for-validation",
            LOGGING_LEVEL_ROOT : "ERROR",
            SECURITY_SERVICE_PASSWORD : tokenServiceAuthPassword.secretValueFromJson("password").toString(),
            SECURITY_SERVICE_NAME : tokenServiceAuthUsername.secretValueFromJson("password").toString(),
            SPRING_PROFILES_INCLUDE : "redis",
            TOKEN_REDIS_URL : `rediss://${props.redisCluster!.attrPrimaryEndPointAddress}:${props.redisCluster!.attrPrimaryEndPointPort}`,
            COM_SOFTNETA_TOKEN_ENCRYPTION_SECRETKEY : tokenEncryptionSecretkey.secretValueFromJson("password").toString(),
            COM_SOFTNETA_TOKEN_ENCRYPTION_INITIALIZATIONVECTOR : tokenInitalizationVector.secretValueFromJson("password").toString()
        }
        });

        tokenServiceContainer.addPortMappings({
            containerPort: 8088
        });

        //Configure the necessary env variables for token service config in the viewer container.
        viewerContainer.addEnvironment("AUTHENTICATION_HIS_TOKENSERVICEAUTHUSERNAME", tokenServiceAuthUsername.secretValueFromJson("password").toString());
        viewerContainer.addEnvironment("AUTHENTICATION_HIS_TOKENSERVICEAUTHPASSWORD", tokenServiceAuthPassword.secretValueFromJson("password").toString());
        viewerContainer.addEnvironment("AUTHENTICATION_HIS_TOKENSERVICEADDRESS", `http://${loadBalancerDnsName}/v4/validate`);
        viewerContainer.addEnvironment("AUTHORIZATION_DEFAULTHISPERMISSIONS", "SEARCH,EXPORT_ISO,EXPORT_ARCH,FORWARD,PATIENT_HISTORY,DOCUMENT_VIEW,CLEAR_CACHE");
        viewerContainer.addEnvironment("SPRING_PROFILES_INCLUDE", "auth-inmemory,redis,stateless,auth-his");
        viewerContainer.addEnvironment("AUTHENTICATION_HIS_VALIDHISPARAMS", "");

        // Create token service using target group
        const tokenService = this.createFargateServiceWithTargetGroup(
            cluster,
            tokenServiceTaskDefinition,
            "MedDreamTokenService",
            "/v4/*", // Token service paths
            50, // Higher priority than viewer, lower than proxy
            props.enableMultiAz,
            props.ecsSecurityGroup,
            props.vpc,
            8088, // Traffic port
            "/v4/validate", // Health check path
            8088, // Health check port
            "401" // Expected response code (service running but requires auth)
        );

        // Configure auto-scaling for token service
        this.configureAutoScaling(tokenService, props);

        new CfnOutput(this, 'TokenServiceUserNameArn', {
            value: tokenServiceAuthUsername.secretArn,
            description: 'The username for token integration',
        });

        new CfnOutput(this, 'TokenServicePasswordArn', {
            value: tokenServiceAuthPassword.secretArn,
            description: 'The password for token integration',
        });

        return {tokenService , tokenServiceAuthUsername , tokenServiceAuthPassword};

    }

  /**
   * Creates a Fargate service that shares the same load balancer listener
   */
  private createFargateServiceWithTargetGroup(
    cluster: Cluster,
    taskDefinition: FargateTaskDefinition,
    serviceName: string,
    pathPattern: string,
    priority: number,
    enableMultiAz: boolean,
    ecsSecurityGroup: SecurityGroup,
    vpc: IVpc,
    trafficPort: number,
    healthCheckPath: string,
    healthCheckPort: number,
    expectedResponseCodes?: string
  ): FargateService {
    
    // Create the Fargate service
    const service = new FargateService(this, `${serviceName}-Service`, {
      cluster,
      taskDefinition,
      desiredCount: enableMultiAz ? 2 : 1,
      assignPublicIp: false,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: { subnets: vpc.privateSubnets },
    });

    // Create target group for this service
    const targetGroup = new ApplicationTargetGroup(this, `${serviceName}-TargetGroup`, {
      port: trafficPort,
      protocol: ApplicationProtocol.HTTP,
      vpc,
      targetType: TargetType.IP,
      healthCheck: {
        path: healthCheckPath,
        port: healthCheckPort.toString(),
        protocol: ElbProtocol.HTTP,
        interval: Duration.seconds(30),
        timeout: Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
        ...(expectedResponseCodes && { healthyHttpCodes: expectedResponseCodes }),
      },
    });

    // Register the service with the target group
    targetGroup.addTarget(service);

    // Create listener rule for this service (now we have the listener in this stack)
    this.applicationListener.addAction(`${serviceName}-Action`, {
      priority,
      conditions: [ListenerCondition.pathPatterns([pathPattern])],
      action: ListenerAction.forward([targetGroup]),
    });

    return service;
  }

  /**
   * Configures auto-scaling for a Fargate service
   */
  private configureAutoScaling(service: FargateService, props: MedDreamStackProps): void {
    // Define min and max capacity
    const minCapacity = props.minCapacity ?? (props.enableMultiAz ? 2 : 1);
    const maxCapacity = props.maxCapacity ?? 6;  // Maximum of 6 instances by default
    const cpuTarget = props.cpuScaleTarget ?? 70; // Default to 70% CPU utilization

    // Enable auto-scaling
    const scaling = service.autoScaleTaskCount({
      minCapacity,
      maxCapacity,
    });

    // Add CPU utilization scaling policy
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: cpuTarget,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });
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

    /**
     * Get the ECS cluster name for custom resource
     */
    public getClusterName(): string {
        return this.cluster.clusterName;
    }

    /**
     * Get the proxy service name for custom resource
     */
    public getProxyServiceName(): string {
        return this.proxyService.serviceName;
    }

    /**
     * Get the proxy task definition ARN for custom resource
     */
    public getProxyTaskDefinitionArn(): string {
        return this.proxyService.taskDefinition.taskDefinitionArn;
    }

    /**
     * Get the load balancer for CloudFrontStack
     */
    public getLoadBalancer(): ApplicationLoadBalancer {
        return this.applicationLoadBalancer;
    }

    /**
     * Get the load balancer DNS name
     */
    public getLoadBalancerDnsName(): string {
        return this.applicationLoadBalancer.loadBalancerDnsName;
    }


}