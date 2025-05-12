const { MedicalImagingClient  } = require("@aws-sdk/client-medical-imaging");
const { StartDICOMImportJobCommand } = require("@aws-sdk/client-medical-imaging");
const { Console } = require("console");

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

const onCreate = async (event) => {
    try {
        console.log('onCreate');
        console.log(event);
        console.log(event.ResourceProperties);
        try {
            let jobName = "DICOM-Samples";
            let datastoreId = event.ResourceProperties.DatastoreId;
            let dataAccessRoleArn = event.ResourceProperties.DataAccessRoleArn;
            let inputS3Uri = "s3://"+event.ResourceProperties.InputBucket+"/"+event.ResourceProperties.InputPrefix
            let outputS3Uri = "s3://"+event.ResourceProperties.OutputBucket+"/"+event.ResourceProperties.OutputPrefix

            console.log("jobName: "+jobName);
            console.log("datastoreId: "+datastoreId);
            console.log("dataAccessRoleArn: "+dataAccessRoleArn);
            console.log("inputS3Uri: "+inputS3Uri);
            console.log("outputS3Uri: "+outputS3Uri);
            const client = new MedicalImagingClient({ region: process.env.AWS_REGION });
            const response = await client.send(
                new StartDICOMImportJobCommand({
                  jobName: jobName,
                  datastoreId: datastoreId,
                  dataAccessRoleArn: dataAccessRoleArn,
                  inputS3Uri: inputS3Uri,
                  outputS3Uri: outputS3Uri,
                }),
              );
              console.log(response);
            
            // Your other logic here
            
        } catch (error) {
            console.error('Error:', error);
            throw error;
        }
        
        const responseData = {
            Message: 'Resource created successfully',
            Timestamp: new Date().toISOString()
        };

        // Generate a unique physical ID for the resource
        const physicalResourceId = `custom-resource-${Date.now()}`;
        
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
        // Add your update logic here
        // You can access old properties via event.OldResourceProperties
        // and new properties via event.ResourceProperties
        
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
                response = await onUpdate(event);
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
