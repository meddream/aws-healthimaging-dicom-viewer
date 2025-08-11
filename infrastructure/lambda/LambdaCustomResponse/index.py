import json
import boto3
from botocore.exceptions import ClientError
import logging

def load_html_template(bucket_name, file_key):
    """
    Load HTML template from S3 bucket
    
    Args:
        bucket_name (str): The S3 bucket name
        file_key (str): The path to the file in the bucket
    """
    try:
        s3_client = boto3.client('s3')
        response = s3_client.get_object(
            Bucket=bucket_name,
            Key=file_key
        )
        template_content = response['Body'].read().decode('utf-8')
        return template_content
    except ClientError as e:
        print(f"Error loading template from S3: {str(e)}")
        return None
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        return None

def lambda_handler(event, context):
    # Configure logging
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)

    request = event['Records'][0]['cf']['request']
    cf_record = event['Records'][0]['cf']
    response = cf_record['response']
    logger.info(f"Request: {json.dumps(request)}")
    # Check if it's a 404 error
    if response['status'] == '404' or response['status'] == '403':
        domainName = request.get('origin', {})["s3"]["domainName"]
        template = load_html_template(domainName.split('.')[0], "uploader/index.html")
        response_body = template
        # Modify the response
        response['status'] = '200'
        response['statusDescription'] = 'OK'
        
        # Set headers
        response['headers'].update({
            'content-type': [{
                'key': 'Content-Type',
                'value': 'text/html'
            }],
            'cache-control': [{
                'key': 'Cache-Control',
                'value': 'no-cache'
            }],
        })
        response['body'] = response_body

    return response
