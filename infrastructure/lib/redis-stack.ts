import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from "constructs";
import * as ec2 from 'aws-cdk-lib/aws-ec2';
  
  interface RedisStackProps extends NestedStackProps {
    vpc: ec2.IVpc;
    ecsSecurityGroup : ec2.SecurityGroup;
    enableMultiAz: boolean;
  }
  
  export class RedisStack extends NestedStack {
    readonly redisCluster: elasticache.CfnReplicationGroup;

    constructor(scope: Construct, id: string, props: RedisStackProps) {
        super(scope, id, props);

        this.redisCluster = this.createRedisCluster(props.vpc, props.ecsSecurityGroup, props.enableMultiAz)
    }

    private createRedisCluster(vpc : ec2.IVpc, ecsSecurityGroup : ec2.SecurityGroup, enableMultiAz: boolean) : elasticache.CfnReplicationGroup
    {
        // Elasticache security group
        const redis_security_group = new ec2.SecurityGroup(this, "RedisSecurityGroup", {
        vpc: vpc,
        description: "MedDream - Redis security group",
        allowAllOutbound: true,
        });

        redis_security_group.addIngressRule(ec2.Peer.securityGroupId(ecsSecurityGroup.securityGroupId), ec2.Port.tcp(6379));

        const description = "valkey-cache";
        
        // Configure cluster based on Multi-AZ setting
        let clusterConfig: any = {
            replicationGroupDescription: description,
            engine: "valkey",
            engineVersion: "7.2",
            cacheNodeType: "cache.t3.micro",
            cacheSubnetGroupName: new elasticache.CfnSubnetGroup(this, "SubnetGroup", {
                description,
                subnetIds: vpc.selectSubnets({ subnetGroupName: "Private" }).subnetIds,
            }).ref,
            cacheParameterGroupName: new elasticache.CfnParameterGroup(this, "ParameterGroup", {
                description,
                cacheParameterGroupFamily: "valkey7",
            }).ref,
            securityGroupIds: [redis_security_group.securityGroupId],
            atRestEncryptionEnabled: true,
            transitEncryptionEnabled: true,
        };

        if (enableMultiAz) {
            // Multi-AZ: Use replication group with automatic failover
            clusterConfig = {
                ...clusterConfig,
                numNodeGroups: 1,
                replicasPerNodeGroup: 1,
                automaticFailoverEnabled: true,
                multiAzEnabled: true,
            };
        } else {
            // Single-AZ: Use replication group but with automatic failover disabled
            clusterConfig = {
                ...clusterConfig,
                numNodeGroups: 1,
                replicasPerNodeGroup: 0,
                automaticFailoverEnabled: false,
                multiAzEnabled: false,
            };
        }
        
        const cluster = new elasticache.CfnReplicationGroup(this, "ReplicationGroup", clusterConfig);

        return cluster;
    }

    public getredisCluster() : elasticache.CfnReplicationGroup
    {
        return this.redisCluster;
    }

    public getredisClusterArn() : string
    {
       return `arn:aws:elasticache:${this.region}:${this.account}:replicationgroup:${this.redisCluster.replicationGroupId}`

    }
  
}