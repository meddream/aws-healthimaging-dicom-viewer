// SigningService.tsx
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface SigningOptions {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export class SigningService {
  private service: string;
  private region: string;
  private credentials: AwsCredentials;

  constructor(service: string, region: string, credentials: AwsCredentials) {
    this.service = service;
    this.region = region;
    this.credentials = credentials;
  }

  private async hmac(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const messageBuffer = encoder.encode(message);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    return await crypto.subtle.sign('HMAC', cryptoKey, messageBuffer);
  }

  private async getSigningKey(dateStamp: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const kSecret = encoder.encode(`AWS4${this.credentials.secretAccessKey}`);
    const kDate = await this.hmac(kSecret, dateStamp);
    const kRegion = await this.hmac(kDate, this.region);
    const kService = await this.hmac(kRegion, this.service);
    return await this.hmac(kService, 'aws4_request');
  }

  public async sha256(message: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private normalizeHeaders(headers: Record<string, string>): Record<string, string> {
    const normalized: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null) {
        // Convert header key to lowercase
        const normalizedKey = key.toLowerCase();
        // Trim whitespace and ensure string value
        const normalizedValue = value.toString().trim();
        // Remove any double spaces
        normalized[normalizedKey] = normalizedValue.replace(/\s+/g, ' ');
      }
    }
    
    return normalized;
  }

  public async signRequest(options: SigningOptions): Promise<Record<string, string>> {
    try {
      const { method, path, headers, body } = options;

      // Create a date for headers and the credential string
      const date = new Date();
      const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.substring(0, 8);

      // Calculate payload hash first
      const payloadHash = await this.sha256(body || '');

      // Normalize and prepare headers
      const normalizedHeaders = this.normalizeHeaders({
        ...headers,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash
      });

      // Add session token if present
      if (this.credentials.sessionToken) {
        normalizedHeaders['x-amz-security-token'] = this.credentials.sessionToken;
      }

      // Ensure host header is present
      if (!normalizedHeaders['host']) {
        throw new Error('Host header is required');
      }

      // Create canonical URI
      const canonicalUri = path.split('?')[0] || '/';

      // Create canonical query string (empty for now)
      const canonicalQueryString = '';

      // Create canonical headers
      const canonicalHeadersList = Object.entries(normalizedHeaders)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([key, value]) => `${key}:${value}\n`);

      const canonicalHeaders = canonicalHeadersList.join('');

      // Create signed headers string
      const signedHeaders = Object.keys(normalizedHeaders)
        .sort()
        .join(';');

      // Create canonical request
      const canonicalRequest = [
        method.toUpperCase(),
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash
      ].join('\n');

      console.log('Canonical Request:', canonicalRequest);

      // Create string to sign
      const algorithm = 'AWS4-HMAC-SHA256';
      const credentialScope = [
        dateStamp,
        this.region,
        this.service,
        'aws4_request'
      ].join('/');

      const stringToSign = [
        algorithm,
        amzDate,
        credentialScope,
        await this.sha256(canonicalRequest)
      ].join('\n');

      console.log('String to Sign:', stringToSign);

      // Calculate signature
      const signingKey = await this.getSigningKey(dateStamp);
      const signature = Array.from(new Uint8Array(
        await this.hmac(signingKey, stringToSign)
      ))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      console.log('Signature:', signature);

      // Create authorization header
      const authorizationHeader = [
        `${algorithm} Credential=${this.credentials.accessKeyId}/${credentialScope}`,
        `SignedHeaders=${signedHeaders}`,
        `Signature=${signature}`
      ].join(', ');

      const finalHeaders = {
        ...normalizedHeaders,
        'Authorization': authorizationHeader
      };

      console.log('Final Headers:', finalHeaders);

      return finalHeaders;

    } catch (error) {
      console.error('Error in signRequest:', error);
      throw error;
    }
  }
}
