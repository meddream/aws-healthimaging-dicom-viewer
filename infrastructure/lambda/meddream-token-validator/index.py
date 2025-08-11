import json
import http.client
import time

# Global dictionary for caching sessions
# Key: session id (string)
# Value: timestamp of the last successful validation (float)
session_cache = {}

def lambda_handler(event, context):
    global session_cache

    request = event['Records'][0]['cf']['request']
    headers = request.get('headers', {})

    # Extract the MEDDREAMSESSID cookie
    cookies = headers.get('cookie', [])
    meddreamsessid = None

    for cookie in cookies:
        cookie_value = cookie['value']
        cookie_parts = cookie_value.split(';')
        for part in cookie_parts:
            if part.strip().startswith('MEDDREAMSESSID='):
                meddreamsessid = part.strip().split('=')[1]
                break

    # If the cookie is missing, block the request
    if not meddreamsessid:
        return {
            'status': '403',
            'statusDescription': 'Forbidden',
            'headers': {
                'content-type': [{'key': 'Content-Type', 'value': 'text/plain'}]
            },
            'body': 'Unauthorized: Missing MEDDREAMSESSID cookie.'
        }

    # Check if we have a valid (unexpired) session cached
    current_time = time.time()
    if meddreamsessid in session_cache:
        last_validated_time = session_cache[meddreamsessid]
        # If less than 60 seconds have passed since last validation, skip re-check
        if current_time - last_validated_time < 60:
            return request        
        else:
            # If the cache is older than 60s, remove it and proceed to validate
            del session_cache[meddreamsessid]

    # Proceed to validate the session if not found in cache or cache expired

    host = headers['host'][0]['value']  # The CloudFront domain
    is_authenticated = False
    try:
        conn = http.client.HTTPSConnection(host)
        conn.request(
            "GET",
            "/isAuthenticated",
            headers={"Cookie": cookie_value}
        )
        response = conn.getresponse()
        if response.status == 200:
            is_authenticated = True
    except Exception as e:
        print(f"Error validating session: {e}")
    finally:
        conn.close()

                                             
    if not is_authenticated:
        return {
            'status': '403',
            'statusDescription': 'Forbidden',
            'headers': {
                'content-type': [{'key': 'Content-Type', 'value': 'text/plain'}]
            },
            'body': 'Unauthorized: Invalid session.'
        }

    # If authenticated, store the session in cache with current timestamp
    session_cache[meddreamsessid] = current_time

    return request
