import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from "constructs";

interface UploaderClientRoleStackProps extends NestedStackProps{
  datastoreArn: string,
  sourceBucketArn: string,
  healthImagingRoleArn: string,
}

export class UploaderClientRoleStack extends NestedStack {

  public readonly uploaderclientRole: iam.Role;
  constructor(scope: Construct,  id: string , props : UploaderClientRoleStackProps) {
    super(scope, id);


    this.uploaderclientRole = new iam.Role(this, 'Uploaderclient', {
      assumedBy: new iam.CompositePrincipal( 
      new iam.ServicePrincipal('lambda.amazonaws.com'),
      )
    });

    this.uploaderclientRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['medical-imaging:StartDICOMImportJob'],
      resources: [props.datastoreArn], 
    }));
    this.uploaderclientRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [props.healthImagingRoleArn],
    }));  
    this.uploaderclientRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', ],
        resources: [props.sourceBucketArn+"/*"],
    }));
  }
    
  getUploaderClientRoleArn(): string {
    return this.uploaderclientRole.roleArn;
  }

}
