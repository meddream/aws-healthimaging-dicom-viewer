import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { Construct } from 'constructs';
import { Fn, NestedStack, NestedStackProps, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';



interface UploaderPipelineStackProps extends NestedStackProps {
  hostingBucket: s3.Bucket,
  distribution: cdk.aws_cloudfront.Distribution,
  healthImagingRoleArn: string,
  datastoreArn: string,
  sourceBucketArn: string
}

export class UploaderPipeline extends NestedStack {

  public readonly uploaderclientRole : iam.Role;

  constructor(scope: Construct, id: string, props: UploaderPipelineStackProps) {
    super(scope, id, props);

    // Create CodeBuild project for invalidation
    const invalidationProject = new codebuild.PipelineProject(this, 'InvalidateProject', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              // Invalidate the /uploader/* path in CloudFront
              `aws cloudfront create-invalidation --distribution-id ${props.distribution.distributionId} --paths "/uploader/*"`
            ]
          }
        }
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      }
    });

    // Add CloudFront invalidation permissions to CodeBuild role
    invalidationProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${Stack.of(this).account}:distribution/${props.distribution.distributionId}`],
        effect: iam.Effect.ALLOW,
      })
    );


     

    // Create source bucket for the application code
    const sourceBucket = new s3.Bucket(this, 'MedDreamUploaderSourceBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true
    });

    const bucketDeployment = new s3deploy.BucketDeployment(this, 'MedDreamZipAndUpload', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../uploader/App'))],
      destinationBucket: sourceBucket,
      extract: false,
      memoryLimit : 4096
    });   

    // Create artifact bucket for the pipeline
    const artifactBucket = new s3.Bucket(this, 'MedDreamUploaderArtifactBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create the pipeline

    const pipeline = new codepipeline.Pipeline(this, 'MedDreamUploaderReactPipeline', {
      artifactBucket: artifactBucket,
      pipelineName: cdk.Names.uniqueResourceName(this, {
        maxLength: 100,
        separator: '-'
      })
    });

    pipeline.node.addDependency(bucketDeployment);

    // Source stage output
    const sourceOutput = new codepipeline.Artifact();

    // Add source stage using S3
    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipeline_actions.S3SourceAction({
          actionName: 'S3Source',
          bucket: sourceBucket,
          bucketKey: Fn.select(0, bucketDeployment.objectKeys), // Match the zip filename
          output: sourceOutput,
          trigger: codepipeline_actions.S3Trigger.POLL
        }),
      ],
    });

    // Invalidation stage
    const invalidateAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'InvalidateCache',
      project: invalidationProject,
      input: sourceOutput, // Need an input artifact even if we don't use it
    });
    // Create build project
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
        computeType: codebuild.ComputeType.LARGE
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'rm -rf node_modules',
              'rm -rf build',
              'npm cache clean --force',
            ]
          },
          build: {
            commands: [
              'npm install --force',
              'PUBLIC_URL="uploader/" npm run build',
            ],
          },
        },
        artifacts: {
          'base-directory': 'build/client',
          files: [
            '**/*'
          ],
        },
      }),
    });

    // Grant build project permissions to upload to S3
    props.hostingBucket.grantReadWrite(buildProject);
    sourceBucket.grantRead(buildProject);
    

    // Build stage output
    const buildOutput = new codepipeline.Artifact();

    // Add build stage
    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Build',
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput],
        }),
      ],
    });

    // Add deploy stage
    pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new codepipeline_actions.S3DeployAction({
          actionName: 'Deploy',
          input: buildOutput,
          bucket: props.hostingBucket,
          objectKey: 'uploader',
        }),
      ],
    });

    pipeline.addStage({
      stageName: 'Invalidate',
      actions: [invalidateAction],
    });

  }

}
