import { NestedStack, NestedStackProps, Stack, StackProps, Tags } from 'aws-cdk-lib'; 
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { 
  FlowLogDestination, 
  FlowLogTrafficType, 
  IVpc,
  Peer, 
  Port, 
  SecurityGroup, 
  SubnetType,
  Vpc,
  PrefixList
} from 'aws-cdk-lib/aws-ec2';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';


interface NetworkStackProps extends NestedStackProps {
  enableVpcFlowLogs: boolean;
  maxAzs?: number;
}

/**
 * Network stack that creates VPC and security groups for the application
 */
export class NetworkStack extends NestedStack {
  /** The VPC instance */
  public readonly vpc: IVpc;
  
  /** Security group for ECS tasks */
  public readonly ecsSecurityGroup: SecurityGroup;
  
  /** Security group for EFS mount targets */
  public readonly efsSecurityGroup: SecurityGroup;
  
  /** Security group for the application load balancer */
  public readonly loadBalancerSecurityGroup: SecurityGroup;

  // Private fields for security group initialization
  private _ecsSecurityGroup: SecurityGroup;
  private _efsSecurityGroup: SecurityGroup;
  private _loadBalancerSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    // Create VPC
    this.vpc = this.createVpc(props);

    // Create Security Groups
    const securityGroups = this.createSecurityGroups();
    this.ecsSecurityGroup = securityGroups.ecsSecurityGroup;
    this.efsSecurityGroup = securityGroups.efsSecurityGroup;
    this.loadBalancerSecurityGroup = securityGroups.loadBalancerSecurityGroup;

    // Configure VPC Flow Logs if enabled
    if (props.enableVpcFlowLogs) {
      this.configureVpcFlowLogs();
    }

    // Add tags to resources
    this.addTags();
  }

  /**
   * Creates the VPC with the specified configuration
   */
  private createVpc(props: NetworkStackProps): Vpc {
    return new Vpc(this, 'ApplicationVpc', {
      maxAzs: props.maxAzs || 2,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        }
      ]
    });
  }

  /**
   * Creates all required security groups
   */
  private createSecurityGroups(): {
    loadBalancerSecurityGroup: SecurityGroup;
    ecsSecurityGroup: SecurityGroup;
    efsSecurityGroup: SecurityGroup;
  } {
    // ALB Security Group
    const loadBalancerSecurityGroup = new SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Application Load Balancer',
      allowAllOutbound: false
    });

    // switch statement to figure whihc cloudFrontPrefixListId based on the current region:
    let cloudFrontPrefixListId = '';
    switch (this.region) {
      case 'us-east-1':
        cloudFrontPrefixListId = 'pl-3b927c52';
      break;
      case 'us-east-2':
        cloudFrontPrefixListId = 'pl-b6a144df';
      break;
      case 'us-west-2':
        cloudFrontPrefixListId = 'pl-82a045eb';
        break;
      case 'eu-west-1':
        cloudFrontPrefixListId = 'pl-4fa04526';
      break;
      case 'ap-southeast-2':
        cloudFrontPrefixListId = 'pl-b8a742d1';
      break;

    }

    // Allow inbound HTTPS traffic to ALB
    loadBalancerSecurityGroup.addIngressRule(
      Peer.prefixList(cloudFrontPrefixListId),
      Port.tcp(80),
      'Allow HTTPS traffic from CloudFront globally'
    );

    // ECS Security Group
    const ecsSecurityGroup = new SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ECS tasks',
      allowAllOutbound: true
    });

    // Allow inbound traffic from ALB to ECS container port
    ecsSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      Port.tcp(8080),
      'Allow traffic from ALB to MedDream container'
    );

    // Allow all traffic between ECS tasks
    ecsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      Port.allTraffic(),
      'Allow all traffic between ECS tasks'
    );

    // EFS Security Group
    const efsSecurityGroup = new SecurityGroup(this, 'EfsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for EFS mount targets',
      allowAllOutbound: false
    });

    // Allow NFS traffic from ECS tasks to EFS
    efsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      Port.tcp(2049),
      'Allow NFS traffic from ECS tasks'
    );

    // Allow outbound traffic from ALB to ECS
    loadBalancerSecurityGroup.addEgressRule(
      ecsSecurityGroup,
      Port.tcp(8080),
      'Allow outbound traffic to ECS tasks'
    );

    // Allow outbound NFS traffic from ECS to EFS
    ecsSecurityGroup.addEgressRule(
      efsSecurityGroup,
      Port.tcp(2049),
      'Allow outbound NFS traffic to EFS'
    );
    
    return {
      loadBalancerSecurityGroup,
      ecsSecurityGroup,
      efsSecurityGroup
    };
  }

  /**
   * Configures VPC Flow Logs to CloudWatch
   */
  private configureVpcFlowLogs(): void {
    const logGroup = new LogGroup(this, 'VpcFlowLogs', {
      logGroupName: `/aws/vpc/${this.stackName}/flowlogs`,
      retention: RetentionDays.ONE_MONTH
    });

    this.vpc.addFlowLog('FlowLogs', {
      destination: FlowLogDestination.toCloudWatchLogs(logGroup),
      trafficType: FlowLogTrafficType.ALL
    });
  }

  /**
   * Adds tags to all resources in the stack
   */
  private addTags(): void {
    Tags.of(this).add('Environment', process.env.ENVIRONMENT ?? 'development');
    Tags.of(this).add('Service', 'Networking');
    Tags.of(this).add('ManagedBy', 'CDK');
  }
}
