import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

interface LambdaEdgeStackProps extends StackProps {
  // No additional props needed for now
}

/**
 * Stack that creates Lambda@Edge functions in us-east-1 region
 * This stack must always be deployed in us-east-1 regardless of the main stack region
 */
export class LambdaEdgeStack extends Stack {
  public readonly tokenValidatorEdgeFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaEdgeStackProps) {
    super(scope, id, {
      ...props,
      env: {
        ...props.env,
        region: 'us-east-1' // Force Lambda@Edge to us-east-1
      }
    });

    this.tokenValidatorEdgeFunction = this.createTokenValidatorEdgeFunction();
  }

  /**
   * Creates Lambda@Edge function for MedDream token validation
   */
  private createTokenValidatorEdgeFunction(): lambda.Function {
    // Create IAM role for Lambda@Edge
    const edgeFunctionRole = new iam.Role(this, 'MedDreamTokenValidatorEdgeRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com')
      ),
      description: 'Role for MedDream token validator Lambda@Edge function'
    });

    // Add basic Lambda execution permissions
    edgeFunctionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Create the Lambda@Edge function
    const tokenValidatorFunction = new lambda.Function(this, 'MedDreamTokenValidatorEdge', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/meddream-token-validator')),
      timeout: Duration.seconds(5), // Lambda@Edge has a 5-second limit
      memorySize: 128, // Minimum memory for Lambda@Edge
      role: edgeFunctionRole,
      description: 'Validates MedDream session tokens at CloudFront edge locations'
    });

    return tokenValidatorFunction;
  }

  /**
   * Returns the Lambda@Edge token validator function
   */
  public getTokenValidatorEdgeFunction(): lambda.Function {
    return this.tokenValidatorEdgeFunction;
  }
}
