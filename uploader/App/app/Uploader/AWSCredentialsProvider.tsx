// AWSCredentialsProvider.ts
interface STSCredentials {
    AccessKeyId: string;
    SecretAccessKey: string;
    SessionToken: string;
    Expiration: string;
  }
  
interface AppConfig{
  datastore_id : string;
  source_bucket_name : string;
  output_bucket_name : string;
  ahi_import_role_arn : string;
  region: string
}

  interface CachedCredentials {
    credentials: STSCredentials;
    expirationTime: number;
  }
  
  export class AWSCredentialsProvider {
    private static instance: AWSCredentialsProvider;
    private cachedCredentials: CachedCredentials | null = null;
    private readonly credentialsEndpoint: string;
    private readonly refreshThresholdMs: number;
    private isRefreshing: boolean = false;
    private refreshPromise: Promise<STSCredentials> | null = null;
    public app_config: AppConfig = {
      datastore_id : "",
      source_bucket_name : "",
      output_bucket_name : "",
      ahi_import_role_arn : "",
      region: ""
    };
  
    private constructor() {
      this.credentialsEndpoint = "validate";
      // Refresh credentials 15 minutes before expiration
      this.refreshThresholdMs = 15 * 60 * 1000;
    }
  
    public static getInstance(): AWSCredentialsProvider {
      if (!AWSCredentialsProvider.instance) {
        AWSCredentialsProvider.instance = new AWSCredentialsProvider();
      }
      return AWSCredentialsProvider.instance;
    }
  
    private async fetchCredentials(): Promise<STSCredentials> {
      try {
        console.log("Fetching credentials from: ", this.credentialsEndpoint);
        const response = await fetch(this.credentialsEndpoint, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
  
        if (!response.ok) {
          //throw new Error(`Failed to fetch credentials: ${response.statusText}`);
          let emptyCredentials: STSCredentials = {
            AccessKeyId: "",
            SecretAccessKey: "",
            SessionToken: "",
            Expiration: "1970-01-01T00:00:00.000Z"
          };
          return emptyCredentials
        }
        const data = await response.json();
        this.app_config = data.app_config;
        return data.Credentials
      } 
      catch (error) 
      {
        console.error('Error fetching credentials:', error);
        throw error;

      }
    }
  
    private areCredentialsExpired(): boolean {
      if (!this.cachedCredentials) return true;
  
      const now = Date.now();
      return now >= (this.cachedCredentials.expirationTime - this.refreshThresholdMs);
    }
  
    private async refreshCredentials(): Promise<STSCredentials> {
      if (this.isRefreshing) {
        return this.refreshPromise!;
      }
  
      try {
        this.isRefreshing = true;
        this.refreshPromise = this.fetchCredentials();
        const credentials = await this.refreshPromise;
        
        this.cachedCredentials = {
          credentials,
          expirationTime: new Date(credentials.Expiration).getTime()
        };
  
        return credentials;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    }
  
    public async getCredentials(): Promise<STSCredentials> {
      if (this.areCredentialsExpired()) {
        return this.refreshCredentials();
      }
      return this.cachedCredentials!.credentials;
    }
  
    public async getSigningCredentials(): Promise<{
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    }> {
      const credentials = await this.getCredentials();
      return {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken
      };
    }
  
    // Helper method to check if credentials are available and valid
    public async validateCredentials(): Promise<boolean> {
      try {
        await this.getCredentials();
        return true;
      } catch (error) {
        console.error('Credentials validation failed:', error);
        return false;
      }
    }
  
    // Method to force refresh credentials
    public async forceRefresh(): Promise<STSCredentials> {
      this.cachedCredentials = null;
      return this.refreshCredentials();
    }

    public async getAppConfig(): Promise<AppConfig> {
      try {
        const credentials = await this.getCredentials();
        return this.app_config;
      } catch (error) {
        console.error('Error fetching credentials:', error);
        throw error;
      }
    }
  }
  
