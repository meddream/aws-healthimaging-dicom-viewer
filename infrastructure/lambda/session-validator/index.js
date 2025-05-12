const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');

const stsClient = new STSClient();

const validateMedDreamToken = async (token) => {
    //execute get request to ww.koin.com/isAuthenticated and add the session id as cookie
    const url = "https://"+process.env.MEDDREAM_APP_ENDPOINT+"/isAuthenticated";
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Cookie: token
        }
    });
    //read the response body
    const body = await response.text();
    if (body == '{"authenticated":"APP","loginEnabled":true}')
    {
        return true;
    }    
    else
    {   
        return false;
    }

};

const assumeRoleForUser = async (username, groups) => {
    // Define role based on user groups
    const roleArn = process.env.UPLOADER_CLIENT_ROLE_ARN;
    
    try {
        const command = new AssumeRoleCommand({
            RoleArn: roleArn,
            RoleSessionName: `session`,
            DurationSeconds: 3600, // 1 hour
        });

        const response = await stsClient.send(command);
        return {
            accessKeyId: response.Credentials.AccessKeyId,
            secretAccessKey: response.Credentials.SecretAccessKey,
            sessionToken: response.Credentials.SessionToken,
            expiration: response.Credentials.Expiration
        };
    } catch (error) {
        console.error('Error assuming role:', error);
        throw error;
    }
};

exports.handler = async (event) => {
    try{

    
        console.log('Event:', JSON.stringify(event));
        const json_headers = event.headers;
        console.log(json_headers.Cookie);
        const meddream_cookie  = json_headers.Cookie;
        
        
        const validationResult = await validateMedDreamToken(meddream_cookie);

        if (!validationResult) {
            return {
                statusCode: 401,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Credentials': true
                },
                body: JSON.stringify({
                    message: 'Invalid user session'
                })
            };
        }

        // Get STS credentials
        const credentials = await assumeRoleForUser(
            validationResult.username,
            validationResult.groups
        );

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': true,
                'Cache-Control': 'no-store'
            },
            body: JSON.stringify({
                message: 'Success',
                Credentials: {
                    AccessKeyId: credentials.accessKeyId,
                    SecretAccessKey: credentials.secretAccessKey,
                    SessionToken: credentials.sessionToken,
                    Expiration: credentials.expiration
                },
                app_config: {
                    datastore_id: process.env.DATASTORE_ID,
                    source_bucket_name: process.env.SOURCE_BUCKET_NAME,
                    output_bucket_name: process.env.OUTPUT_BUCKET_NAME,
                    ahi_import_role_arn: process.env.AHI_IMPORT_ROLE_ARN,
                    region: process.env.AWS_REGION
                }
            })
        };

    } catch (error) {
        console.error('Error:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': true
            },
            body: JSON.stringify({
                message: 'Internal server error',
                error: error.message
            })
        };
    }
};
