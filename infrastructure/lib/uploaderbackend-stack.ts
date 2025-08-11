import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Cors, LambdaIntegration, MethodLoggingLevel, Model, RestApi } from "aws-cdk-lib/aws-apigateway";
import { AllowedMethods, CachePolicy, Distribution, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from "constructs/lib/construct";

interface UploaderBackendStackProps extends StackProps {
    distributionId : string;
    getHealthImagingRoleArn : string;
  }

export class UploaderBackendStack extends Stack {

  public readonly uploaderStaticBucket : s3.Bucket;
  public readonly uploaderApiGateway : RestApi;

  constructor(scope: Construct, id: string, props: UploaderBackendStackProps) {
    super(scope, id, props);
    //get distrib object from distribution arn string
    //retrieve the Distribtuin object from the distributionId
    const distribution = cloudfront.Distribution.fromDistributionAttributes(this, 'ImportedDistribution', {
      distributionId: 'E1234ABCDEF',
      domainName: ""
    });


    //this.uploaderStaticBucket = this.addUploaderStaticbucket(distribution);
    //this.uploaderApiGateway = this.CreateSessionValidator(distribution, props.getHealthImagingRoleArn );  
  }   

  private addUploaderStaticbucket(distribution: Distribution) : s3.Bucket
  {
      const uploaderStaticBucket = new s3.Bucket(this, 'MedDreamUploaderSaticBucket', {
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          removalPolicy: RemovalPolicy.DESTROY,
          autoDeleteObjects: true,
          cors: [
            {
              allowedMethods: [
                s3.HttpMethods.GET,
                s3.HttpMethods.HEAD,
              ],
              allowedOrigins: ['*'],
              allowedHeaders: ['*'],
              maxAge: 3000
            }
          ]
        });
      //add a role for the lambda@edge function that can be assumeed by lambda and lambdaedge service
      const lambdaEdgeRole = new iam.Role(this, 'LambdaEdgeRole', {
          assumedBy: new iam.CompositePrincipal(
              new iam.ServicePrincipal('lambda.amazonaws.com'),
              new iam.ServicePrincipal('edgelambda.amazonaws.com')
          ),
      });

      //add a policy for lambda execution and read access to the uploaderstaticbucket
      lambdaEdgeRole.addToPolicy(
          new iam.PolicyStatement({
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [uploaderStaticBucket.bucketArn, uploaderStaticBucket.arnForObjects('*')]
          })
      );

      //add standard lambda execution policy to the role
      lambdaEdgeRole.addManagedPolicy(
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      );

      // Create the Edge Function
      const edgeFunction = new cloudfront.experimental.EdgeFunction(this, 'EdgeFunction', {
          runtime: lambda.Runtime.PYTHON_3_13,
          handler: 'index.lambda_handler',
          code: lambda.Code.fromAsset('./lambda/LambdaCustomResponse'),
          timeout: Duration.seconds(30),
          memorySize: 128,
          role: lambdaEdgeRole,
          description: JSON.stringify({ 'bucketname' : uploaderStaticBucket.bucketName})
      });


      uploaderStaticBucket.addToResourcePolicy(
      new iam.PolicyStatement({
          actions: ['s3:GetObject'],
          resources: [uploaderStaticBucket.arnForObjects('*')],
          principals: [new iam.AnyPrincipal()],
          conditions: {
          StringEquals: {
              'AWS:SourceArn': `arn:aws:cloudfront::${Stack.of(this).account}:distribution/${distribution.distributionId}`
          }
          }
      }));   
      distribution.addBehavior(
          "/uploader/*", 
          origins.S3BucketOrigin.withOriginAccessControl(uploaderStaticBucket, {originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST]}),
          {
              compress: true,
              cachePolicy: CachePolicy.CACHING_OPTIMIZED,
              viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
              allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
              edgeLambdas: [
                  {
                    functionVersion: edgeFunction.currentVersion,
                    eventType: cloudfront.LambdaEdgeEventType.ORIGIN_RESPONSE,
                  }
                ],
          }
      );


      return uploaderStaticBucket;
  }

  private CreateSessionValidator(distribution : Distribution , AHIImportRoleArn : string) : RestApi
  {

      const lambdaFunction = new lambda.Function(this, 'SessionValidator', {
          runtime: lambda.Runtime.NODEJS_18_X,
          handler: 'index.handler',
          code: lambda.Code.fromAsset('./lambda/session-validator'),
          timeout: Duration.seconds(30),
          memorySize: 128,
          description: 'Session Validator for MedDream',
          environment: {
              'UPLOADER_CLIENT_ROLE_ARN': AHIImportRoleArn,
          }
      });

      //allow the lambdafunciton to generate sts credentials for a the rol koinkoin
      lambdaFunction.addToRolePolicy(
          new iam.PolicyStatement({
              actions: ['sts:AssumeRole'],
              resources: [AHIImportRoleArn]
          })
      );


      const apiGateway = new RestApi(this, 'SessionValidatorAPI', {
          restApiName: 'SessionValidatorAPI',
          description: 'Session Validator API for MedDream',
          deployOptions: {
              stageName: 'prod',  // Explicitly set stage name
              tracingEnabled: true,
              loggingLevel: MethodLoggingLevel.INFO,
          },
          defaultCorsPreflightOptions: {
              allowOrigins: Cors.ALL_ORIGINS,
              allowMethods: Cors.ALL_METHODS,
              allowHeaders: ['*'],
          },
          binaryMediaTypes: ['*/*']
      });
      apiGateway.addUsagePlan('SessionValidatorUsagePlan', {
          name: 'SessionValidatorUsagePlan',
          description: 'Session Validator Usage Plan',
          throttle: {
              rateLimit: 10,
              burstLimit: 10
          }
      })
      // Create the full path structure
      const uploader = apiGateway.root.addResource('uploader');
      const validate = uploader.addResource('validate');
      // Add the method to the validate resource
      validate.addMethod('GET', 
      new LambdaIntegration(lambdaFunction, {
          proxy: true,
          // Important: Configure integration properly
          integrationResponses: [{
              statusCode: '200',
              responseParameters: {
                  'method.response.header.Access-Control-Allow-Origin': "'*'",
                  'method.response.header.Access-Control-Allow-Credentials': "'true'",
                  'method.response.header.Content-Type': "'application/json'",
              },
              responseTemplates: {
                  'application/json': ''  // Pass through the Lambda response
              }
          }],
          requestTemplates: {
              'application/json': JSON.stringify({
                  method: "$context.httpMethod",
                  path: "$context.path",
                  queryParams: "$input.params().querystring",
                  headers: "$input.params().header",
                  cookies: "$input.params().header.Cookie"
              })
          }
      }),
      {
          methodResponses: [{
              statusCode: '200',
              responseParameters: {
                  'method.response.header.Access-Control-Allow-Origin': true,
                  'method.response.header.Access-Control-Allow-Credentials': true,
                  'method.response.header.Content-Type': true,
              },
              responseModels: {
                  'application/json': Model.EMPTY_MODEL
              }
          }],
          requestParameters: {
              'method.request.header.Cookie': false  // Make Cookie header optional
          }
      }
  );

      // Create Origin Request Policy
      const originRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
          originRequestPolicyName: 'ApiOriginRequestPolicy',
          comment: 'Policy for API Gateway origin',
          cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(), // Forward all cookies to origin
          queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
          // headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
          //     'Host',
          //     'X-Api-Key',
          //     'Accept',
          //     'Content-Type'
          // ),
          headerBehavior: cloudfront.OriginRequestHeaderBehavior.all()
      });

      //add a distribution behavior to route /uploader/validate to this api gateway
      distribution.addBehavior(
          "/uploader/validate",
          new origins.RestApiOrigin(apiGateway,{originPath: '/prod'}),
          {
              compress: true,
              cachePolicy: CachePolicy.CACHING_DISABLED,
              originRequestPolicy: originRequestPolicy,
              viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
              allowedMethods: AllowedMethods.ALLOW_GET_HEAD,

          }
      );

      //lambdaFunction.addEnvironment( 'MEDDREAM_APP_ENDPOINT' ,  meddream_url);



      return apiGateway;

  }
  
}