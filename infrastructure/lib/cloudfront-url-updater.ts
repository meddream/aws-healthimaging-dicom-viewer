import { Construct } from 'constructs';
import { CustomResource, Duration, CfnOutput } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';

interface CloudFrontUrlUpdaterProps {
  cloudfrontDistributionUrl: string;
  ecsClusterName: string;
  proxyServiceName: string;
  proxyTaskDefinitionArn: string; // Direct task definition ARN
}

export class CloudFrontUrlUpdater extends Construct {
  public readonly newTaskDefinitionArn: string;

  constructor(scope: Construct, id: string, props: CloudFrontUrlUpdaterProps) {
    super(scope, id);

    // Lambda function to update ECS task definition
    const updateTaskDefFunction = new lambda.Function(this, 'UpdateTaskDefFunction', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      timeout: Duration.minutes(5),
      code: lambda.Code.fromInline(`
import boto3
import json
import logging
import hashlib

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    try:
        ecs = boto3.client('ecs')
        
        request_type = event['RequestType']
        props = event['ResourceProperties']
        
        cluster_name = props['ClusterName']
        service_name = props['ServiceName'] 
        task_def_arn = props['TaskDefinitionArn']
        cloudfront_url = props['CloudFrontUrl']
        
        # Create a consistent, shorter Physical Resource ID
        resource_hash = hashlib.md5(f"{cluster_name}-{service_name}".encode()).hexdigest()[:8]
        physical_resource_id = f"cf-url-updater-{resource_hash}"
        
        if request_type in ['Create', 'Update']:
            logger.info(f"Updating task definition {task_def_arn} with CloudFront URL: {cloudfront_url}")
            
            try:
                response = ecs.describe_task_definition(taskDefinition=task_def_arn)
                task_def = response['taskDefinition']
            except Exception as e:
                logger.warning(f"Could not describe task definition {task_def_arn}: {str(e)}")
                # If task definition doesn't exist, just return success
                return {
                    'PhysicalResourceId': physical_resource_id,
                    'Data': {
                        'Message': 'Task definition not found, skipping update'
                    }
                }
            
            updated = False
            for container in task_def['containerDefinitions']:
                if container['name'] == 'meddreamProxy':
                    env_vars = container.get('environment', [])
                    env_vars = [env for env in env_vars if env['name'] != 'MEDDREAM_DIRECT_URL']
                    env_vars.append({
                        'name': 'MEDDREAM_DIRECT_URL',
                        'value': f'https://{cloudfront_url}'
                    })
                    container['environment'] = env_vars
                    updated = True
                    logger.info(f"Updated environment variables for container: {container['name']}")
                    break
            
            if not updated:
                logger.warning("meddreamProxy container not found in task definition, skipping update")
                return {
                    'PhysicalResourceId': physical_resource_id,
                    'Data': {
                        'Message': 'meddreamProxy container not found, skipping update'
                    }
                }
            
            new_task_def = {
                'family': task_def['family'],
                'taskRoleArn': task_def.get('taskRoleArn'),
                'executionRoleArn': task_def.get('executionRoleArn'),
                'networkMode': task_def.get('networkMode'),
                'requiresCompatibilities': task_def.get('requiresCompatibilities'),
                'cpu': task_def.get('cpu'),
                'memory': task_def.get('memory'),
                'containerDefinitions': task_def['containerDefinitions'],
                'volumes': task_def.get('volumes', [])
            }
            
            new_task_def = {k: v for k, v in new_task_def.items() if v is not None and v != []}
            
            try:
                response = ecs.register_task_definition(**new_task_def)
                new_task_def_arn = response['taskDefinition']['taskDefinitionArn']
                logger.info(f"Created new task definition revision: {new_task_def_arn}")
                
                # Try to update service, but don't fail if service doesn't exist
                try:
                    ecs.update_service(
                        cluster=cluster_name,
                        service=service_name,
                        taskDefinition=new_task_def_arn,
                        forceNewDeployment=True
                    )
                    logger.info(f"Updated service {service_name} to use new task definition")
                except Exception as service_error:
                    logger.warning(f"Could not update service {service_name}: {str(service_error)}")
                
                return {
                    'PhysicalResourceId': physical_resource_id,
                    'Data': {
                        'NewTaskDefinitionArn': new_task_def_arn,
                        'OriginalTaskDefinitionArn': task_def_arn,
                        'CloudFrontUrl': cloudfront_url
                    }
                }
            except Exception as task_def_error:
                logger.warning(f"Could not register new task definition: {str(task_def_error)}")
                return {
                    'PhysicalResourceId': physical_resource_id,
                    'Data': {
                        'Message': 'Could not register new task definition'
                    }
                }
            
        elif request_type == 'Delete':
            logger.info("Delete request - no action needed (task definition revisions remain)")
            return {
                'PhysicalResourceId': physical_resource_id,
                'Data': {
                    'Message': 'Delete completed successfully'
                }
            }
            
    except Exception as e:
        logger.error(f"Error in CloudFront URL updater: {str(e)}")
        # For delete operations, we should not fail even if there are errors
        if request_type == 'Delete':
            resource_hash = hashlib.md5(f"{props.get('ClusterName', 'unknown')}-{props.get('ServiceName', 'unknown')}".encode()).hexdigest()[:8]
            return {
                'PhysicalResourceId': f"cf-url-updater-{resource_hash}",
                'Data': {
                    'Message': f'Delete completed with errors: {str(e)}'
                }
            }
        raise e
      `),
    });

    // Grant permissions to update ECS services and task definitions
    updateTaskDefFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecs:DescribeTaskDefinition',
        'ecs:RegisterTaskDefinition',
        'ecs:UpdateService',
        'ecs:DescribeServices'
      ],
      resources: ['*']
    }));

    updateTaskDefFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'ecs-tasks.amazonaws.com'
        }
      }
    }));

    // Create custom resource provider
    const provider = new cr.Provider(this, 'UpdateTaskDefProvider', {
      onEventHandler: updateTaskDefFunction,
    });

    // Create custom resource
    const customResource = new CustomResource(this, 'UpdateTaskDefResource', {
      serviceToken: provider.serviceToken,
      properties: {
        ClusterName: props.ecsClusterName,
        ServiceName: props.proxyServiceName,
        TaskDefinitionArn: props.proxyTaskDefinitionArn, // Direct ARN
        CloudFrontUrl: props.cloudfrontDistributionUrl,
      },
    });

    // Expose the new task definition ARN
    this.newTaskDefinitionArn = customResource.getAttString('NewTaskDefinitionArn');
  }
}
