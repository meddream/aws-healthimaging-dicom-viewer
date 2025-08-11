const { LambdaClient, UpdateFunctionConfigurationCommand } = require("@aws-sdk/client-lambda");
const { S3Client, PutBucketCorsCommand } = require( "@aws-sdk/client-s3");
const { IAMClient , UpdateAssumeRolePolicyCommand} = require("@aws-sdk/client-iam");

// Helper function to send response to CloudFormation
const sendResponse = async (event, context, responseStatus, responseData, physicalResourceId) => {
    const responseBody = JSON.stringify({
        Status: responseStatus,
        Reason: `See the details in CloudWatch Log Stream: ${context.logStreamName}`,
        PhysicalResourceId: physicalResourceId || context.logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        NoEcho: false,
        Data: responseData
    });

    const parsedUrl = new URL(event.ResponseURL);
    const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'PUT',
        headers: {
            'Content-Type': '',
            'Content-Length': responseBody.length
        }
    };

    return new Promise((resolve, reject) => {
        const https = require('https');
        const request = https.request(options, (response) => {
            console.log(`Status code: ${response.statusCode}`);
            resolve(response.statusCode);
        });

        request.on('error', (error) => {
            console.log('sendResponse Error:', error);
            reject(error);
        });

        request.write(responseBody);
        request.end();
    });
};
const addEnvVariables = async (event) => {
    console.log('Adding Environment variables.');
    const client = new LambdaClient({ region: process.env.AWS_REGION });    
    // Get existing function configuration to preserve other environment variables
    const validationFunctionArn = event.ResourceProperties.validationFunctionArn;
    console.log('Targeted function ARN:', validationFunctionArn);
    // Create the update configuration command
    const command = new UpdateFunctionConfigurationCommand({
        FunctionName: validationFunctionArn,
        Environment: {
            Variables:
            {
                "MEDDREAM_APP_ENDPOINT": event.ResourceProperties.distributionDomainName,
                "UPLOADER_CLIENT_ROLE_ARN": event.ResourceProperties.uploaderClientRoleArn,
                "DATASTORE_ID" : event.ResourceProperties.datastoreId,
                "SOURCE_BUCKET_NAME" : event.ResourceProperties.sourceBucketName,
                "OUTPUT_BUCKET_NAME" : event.ResourceProperties.outputBucketName,
                "AHI_IMPORT_ROLE_ARN" : event.ResourceProperties.ahiImportRoleArn
            } 
        }
    });
    // Update the function configuration
    const response = await client.send(command);
    console.log('Function configuration updated successfully:', response);    
}

const configurefunctionRoleTrustPolicy = async (event) =>{
    try
    {
        
        const client = new IAMClient({ region: process.env.AWS_REGION });
        let vpolicy = {
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Principal: {
                        Service: "lambda.amazonaws.com"
                    },
                    Action: "sts:AssumeRole"
                },
                {
                    Effect: "Allow",
                    Principal: {
                        "AWS": event.ResourceProperties.validatorFunctionRoleArn
                    },
                    Action: "sts:AssumeRole"
                }
            ]
        };

        const command = new UpdateAssumeRolePolicyCommand({
            RoleName: event.ResourceProperties.uploaderClientRoleArn.split("/").pop(),
            PolicyDocument: JSON.stringify(vpolicy)
        });
        const response = await client.send(command);
        console.log(response)
        console.log('Function role trust policy updated successfully:', response);
        
    }
    catch (error)
    {
        console.error('Error configuring function role trust policy:', error);
        throw error;
    }


}

const configureBucketCors = async (event) => {
  const client = new S3Client({ region: process.env.AWS_REGION });
  
  const command = new PutBucketCorsCommand({
    Bucket: event.ResourceProperties.sourceBucketName,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedHeaders: ["*"],
          AllowedMethods: ["PUT", "POST",  "HEAD"],
          AllowedOrigins: ["https://"+event.ResourceProperties.distributionDomainName], // For production, specify exact origins
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3000
        }
      ]
    }
  });

  try {
    await client.send(command);
    console.log("CORS configuration successful");
  } catch (error) {
    console.error("Error configuring CORS:", error);
  }
};

const onCreate = async (event) => {
    try
    {
        console.log('onCreate');
        await addEnvVariables(event);
        await configureBucketCors(event);
        await configurefunctionRoleTrustPolicy(event);
        // Generate a unique physical ID for the resource
        const physicalResourceId = `custom-resource-${Date.now()}`;
        const responseData = {
            Message: 'Resource created successfully',
            Timestamp: new Date().toISOString()
        };
        return {
            responseData,
            physicalResourceId
        };
    } catch (error) {
        console.error('onCreate Error:', error);
        throw error;
    }
};

const onUpdate = async (event) => {
    try {
        console.log('onUpdate');
        await addEnvVariables(event);
        await configureBucketCors(event);
        const responseData = {
            Message: 'Resource updated successfully',
            Timestamp: new Date().toISOString()
        };

        // Use the existing physical ID
        const physicalResourceId = event.PhysicalResourceId;
        return {
            responseData,
            physicalResourceId
        };
    } catch (error) {
        console.error('onUpdate Error:', error);
        throw error;
    }
};

const onDelete = async (event) => {
    try {
        console.log('onDelete');
        // Add your deletion logic here
        // Clean up any resources that were created
        
        const responseData = {
            Message: 'Resource deleted successfully',
            Timestamp: new Date().toISOString()
        };

        return {
            responseData,
            physicalResourceId: event.PhysicalResourceId
        };
    } catch (error) {
        console.error('onDelete Error:', error);
        throw error;
    }
};


exports.handler = async (event, context) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    try {
        let response;

        // Route the request to the appropriate handler
        switch (event.RequestType) {
            case 'Create':
                response = await onCreate(event);
                break;
            case 'Update':
                response = await onCreate(event);
                break;
            case 'Delete':
                response = await onDelete(event);
                break;
            default:
                throw new Error(`Unsupported request type ${event.RequestType}`);
        }

        // Send success response to CloudFormation
        await sendResponse(
            event,
            context,
            'SUCCESS',
            response.responseData,
            response.physicalResourceId
        );

    } catch (error) {
        console.error('Handler Error:', error);
        
        // Send failure response to CloudFormation
        await sendResponse(
            event,
            context,
            'FAILED',
            { Error: error.message },
            event.PhysicalResourceId || context.logStreamName
        );
    }
};
