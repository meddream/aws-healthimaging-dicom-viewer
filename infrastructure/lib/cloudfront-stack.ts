import { RemovalPolicy, Stack, StackProps , Duration, CfnResource, CfnCondition, Fn, CustomResource, NestedStackProps, NestedStack  } from "aws-cdk-lib";
import { Distribution, OriginRequestPolicy, OriginRequestCookieBehavior, OriginRequestHeaderBehavior, OriginRequestQueryStringBehavior, Function, FunctionCode, OriginProtocolPolicy, ResponseHeadersPolicy, CachePolicy, AllowedMethods, FunctionEventType, SecurityPolicyProtocol, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from "constructs/lib/construct";
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Cors, LambdaIntegration, MethodLoggingLevel, Model, RestApi } from "aws-cdk-lib/aws-apigateway";
import { CfnDisk } from "aws-cdk-lib/aws-lightsail";




interface cloudFrontStackProps extends NestedStackProps {
    service: ApplicationLoadBalancedFargateService;
    addUploader: boolean;
    uploaderClientRoleArn : string;
  }

export class CloudFrontStack extends NestedStack {
    public readonly meddreamUrl: string;
    public distribution: Distribution;
    public readonly uploaderStaticBucket: s3.Bucket;
    public readonly uploaderApiGateway: RestApi;
    public readonly validationFunction : lambda.Function;
    public readonly validationFunctionRole : iam.Role
    constructor(scope: Construct, id: string, props: cloudFrontStackProps) {
        super(scope, id, props);

        this.distribution = this.createCloudFrontDistribution(props.service.loadBalancer);
        this.meddreamUrl = this.distribution.distributionDomainName;

        if( props.addUploader)
        {
            const resources  = this.CreateSessionValidator(this.distribution, props.uploaderClientRoleArn );
            this.validationFunction = resources.validationFunction;
            this.validationFunctionRole = resources.validationFunctionRole;
            this.uploaderApiGateway = resources.uploaderApiGateway;
            this.uploaderStaticBucket = this.addUploaderStaticbucket(this.distribution);
        }
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
      
        uploaderStaticBucket.addToResourcePolicy(
        new iam.PolicyStatement({
            actions: ['s3:GetObject'],
            resources: [uploaderStaticBucket.arnForObjects('*')],
            principals: [new iam.AnyPrincipal()],
            conditions: {
            StringEquals: {
                'AWS:SourceArn': `arn:aws:cloudfront::${Stack.of(this).account}:distribution/${this.distribution.distributionId}`
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
            }
        );


        return uploaderStaticBucket;
    }

    private CreateSessionValidator(distribution : Distribution , uploaderClientRoleArn : string) : {validationFunction : lambda.Function, validationFunctionRole: iam.Role, uploaderApiGateway : RestApi}
    {

        const sessionValidatorFunctionRole = new iam.Role(this, 'SessionValidatorFunctionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
        });

        //add sts assume on uploaderclient role to the sessionValidatorFunctionRole
        sessionValidatorFunctionRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['sts:AssumeRole'],
                resources: [uploaderClientRoleArn]
            })
        );

        const lambdaFunction = new lambda.Function(this, 'SessionValidator', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('./lambda/session-validator'),
            timeout: Duration.seconds(30),
            memorySize: 128,
            description: 'Session Validator for MedDream',
            role: sessionValidatorFunctionRole,
        });


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
            originRequestPolicyName: `${Stack.of(this).stackName}-ApiOriginRequestPolicy`,
            comment: 'Policy for API Gateway origin',
            cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(), // Forward all cookies to origin
            queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.none(),
            headerBehavior: cloudfront.OriginRequestHeaderBehavior.none()
        });

        distribution.addBehavior(
            "/uploader/validate",
            new origins.RestApiOrigin(apiGateway,{originPath: '/prod' , }),
            {
                compress: true,
                cachePolicy: CachePolicy.CACHING_DISABLED,
                originRequestPolicy: originRequestPolicy,
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
            }
        );

        return  {   
                    validationFunction : lambdaFunction,
                    validationFunctionRole : sessionValidatorFunctionRole,
                    uploaderApiGateway : apiGateway,
                     };

    }

    /**
     * Creates CloudFront distribution
     */
    private createCloudFrontDistribution(loadBalancer: ApplicationLoadBalancer): Distribution {
        const originRequestPolicy = new OriginRequestPolicy(this, "MedDreamUploaderOriginRequestPolicy", {
        originRequestPolicyName: `${Stack.of(this).stackName}-MedDreamPolicy`,
        comment: "Policy optimised for MedDream",
        cookieBehavior: OriginRequestCookieBehavior.all(),
        headerBehavior: OriginRequestHeaderBehavior.all(),
        queryStringBehavior: OriginRequestQueryStringBehavior.all(),
        });

        const corsFunction = new Function(this, "CorsFunction", {
        code: FunctionCode.fromInline(`
            function handler(event) {
            if(event.request.method === 'OPTIONS') {
                var response = {
                    statusCode: 204,
                    statusDescription: 'OK',
                    headers: {
                        'access-control-allow-origin': { value: '*' },
                        'access-control-allow-headers': { value: '*' }
                    }
                };
                return response;
            }
            return event.request;
            }
        `),
        });

        //add a custom cache policy
        const cachePolicy = new CachePolicy(this, "MedDreamCachePolicy", {
        cachePolicyName: `${Stack.of(this).stackName}-MedDreamCachePolicy`,
        comment: "Policy optimised for MedDream",
        defaultTtl: Duration.seconds(43200),
        minTtl: Duration.seconds(43200),
        maxTtl: Duration.seconds(43200),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
        });

        const ALBorigin = new origins.LoadBalancerV2Origin(loadBalancer, {
            protocolPolicy: OriginProtocolPolicy.HTTP_ONLY,
            })
        const distribution =  new Distribution(this, "MedDreamDistribution", {
        defaultBehavior: {
            origin: ALBorigin,
            originRequestPolicy,
            responseHeadersPolicy: ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
            cachePolicy: CachePolicy.CACHING_DISABLED,
            allowedMethods: AllowedMethods.ALLOW_ALL,
            functionAssociations: [
            {
                function: corsFunction,
                eventType: FunctionEventType.VIEWER_REQUEST,
            },
            ],
        },
        minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2019,
        });

        distribution.addBehavior(
            "*/pixels*",
            ALBorigin,
            {
            compress: true,
            cachePolicy: cachePolicy,
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
            originRequestPolicy : OriginRequestPolicy.ALL_VIEWER
            }
        );
        distribution.addBehavior(
            "*/metadata*",
            ALBorigin,
            {
            compress: true,
            cachePolicy: cachePolicy,
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
            originRequestPolicy : OriginRequestPolicy.ALL_VIEWER
            }
        );
        distribution.addBehavior(
            "*/thumbnail*",
            ALBorigin,
            {
            compress: true,
            cachePolicy: cachePolicy,
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
            originRequestPolicy : OriginRequestPolicy.ALL_VIEWER
            }
        );
        distribution.addBehavior(
            "*/structure*",
            ALBorigin,
            {
            compress: true,
            cachePolicy: cachePolicy,
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
            originRequestPolicy : OriginRequestPolicy.ALL_VIEWER
            }
        );
        return distribution


    }

    getDistributionUrl(): string {
        return this.meddreamUrl;
    }

    getDistributionId() : string {
        return this.distribution.distributionId;
    }
    getDistribution() : Distribution {
        return this.distribution;
    }

    getUploaderStaticBucket() : s3.Bucket {
        return this.uploaderStaticBucket;
    }

    getValidationFunctionArn() : string {
        return this.validationFunction.functionArn;
    }
    getValidationFunctionName() : string {
        return this.validationFunction.functionName;
    }
    getValidationFunctionRoleArn() : string {
        return this.validationFunctionRole.roleArn;
    }
}

 