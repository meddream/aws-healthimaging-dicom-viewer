# CDK Stack Deployment Sequence Diagram

```mermaid
sequenceDiagram
    participant CDK as CDK Deploy
    participant LE as Lambda@Edge Stack<br/>(us-east-1)
    participant NET as Network Stack
    participant STO as Storage Stack
    participant AHI as HealthImaging Stack
    participant DI as DataImport Stack<br/>(Optional)
    participant RED as Redis Stack
    participant UCR as UploaderClientRole Stack
    participant MED as MedDream Stack
    participant CF as CloudFront Stack
    participant CU as CloudFrontUrlUpdater
    participant UP as UploaderPipeline Stack<br/>(Optional)
    participant CVF as ConfigureValidationFunction Stack<br/>(Optional)

    Note over CDK: Deployment starts with Lambda@Edge in us-east-1
    CDK->>LE: 1. Deploy Lambda@Edge Stack
    Note over LE: Token validator function<br/>Must be in us-east-1
    LE-->>CDK: ✅ Lambda@Edge Ready

    Note over CDK: Core infrastructure deployment begins
    CDK->>NET: 2. Deploy Network Stack
    Note over NET: VPC, Subnets, Security Groups
    NET-->>CDK: ✅ Network Ready

    CDK->>STO: 3. Deploy Storage Stack
    Note over STO: S3 Buckets, EFS, Access Points<br/>Depends: Network
    STO-->>CDK: ✅ Storage Ready

    CDK->>AHI: 4. Deploy HealthImaging Stack
    Note over AHI: Datastore, IAM Roles<br/>Depends: Storage
    AHI-->>CDK: ✅ HealthImaging Ready

    alt If IMPORT_SAMPLE_DATA = true
        CDK->>DI: 5a. Deploy DataImport Stack
        Note over DI: DICOM Sample Import<br/>Depends: HealthImaging
        DI-->>CDK: ✅ DataImport Complete
    end

    CDK->>RED: 5b. Deploy Redis Stack
    Note over RED: ElastiCache Cluster<br/>Multi-AZ: 2 nodes<br/>Single-AZ: 1 node<br/>Depends: Network
    RED-->>CDK: ✅ Redis Ready

    CDK->>UCR: 6. Deploy UploaderClientRole Stack
    Note over UCR: IAM Role for Uploader<br/>Depends: HealthImaging
    UCR-->>CDK: ✅ UploaderClientRole Ready

    CDK->>MED: 7. Deploy MedDream Stack
    Note over MED: ECS Cluster, Services, ALB<br/>Multi-AZ: 6 tasks<br/>Single-AZ: 3 tasks<br/>Depends: Network, Storage, HealthImaging, Redis
    MED-->>CDK: ✅ MedDream Ready

    CDK->>CF: 8. Deploy CloudFront Stack
    Note over CF: Distribution, API Gateway<br/>Session Validator<br/>Depends: MedDream, UploaderClientRole, Lambda@Edge
    CF-->>CDK: ✅ CloudFront Ready

    CDK->>CU: 9. Deploy CloudFrontUrlUpdater
    Note over CU: Updates ECS Task Definition<br/>with real CloudFront URL<br/>Depends: CloudFront, MedDream
    CU-->>CDK: ✅ URL Updated

    alt If DEPLOY_UPLOADER = true
        CDK->>UP: 10a. Deploy UploaderPipeline Stack
        Note over UP: CodePipeline, CodeBuild<br/>React App Deployment<br/>Depends: CloudFront, HealthImaging
        UP-->>CDK: ✅ UploaderPipeline Ready

        CDK->>CVF: 10b. Deploy ConfigureValidationFunction Stack
        Note over CVF: Lambda Environment Variables<br/>S3 CORS Configuration<br/>Depends: CloudFront, UploaderClientRole
        CVF-->>CDK: ✅ Configuration Complete
    end

    Note over CDK: Deployment Complete!<br/>Outputs: CloudFront URL, Admin Secret ARN
```

## Deployment Dependencies

### Core Dependencies (Always Deployed)
1. **Lambda@Edge Stack** → No dependencies (us-east-1)
2. **Network Stack** → No dependencies
3. **Storage Stack** → Network Stack
4. **HealthImaging Stack** → Storage Stack
5. **Redis Stack** → Network Stack
6. **UploaderClientRole Stack** → HealthImaging Stack
7. **MedDream Stack** → Network, Storage, HealthImaging, Redis Stacks
8. **CloudFront Stack** → MedDream, UploaderClientRole, Lambda@Edge Stacks
9. **CloudFrontUrlUpdater** → CloudFront, MedDream Stacks

### Optional Dependencies (Conditional)
- **DataImport Stack** → HealthImaging Stack (if `IMPORT_SAMPLE_DATA = true`)
- **UploaderPipeline Stack** → CloudFront, HealthImaging Stacks (if `DEPLOY_UPLOADER = true`)
- **ConfigureValidationFunction Stack** → CloudFront, UploaderClientRole Stacks (if `DEPLOY_UPLOADER = true`)

## Multi-AZ Impact on Deployment

### Single-AZ Mode (`ENABLE_MULTI_AZ = false`)
- **Redis Stack**: 1 node (primary only)
- **MedDream Stack**: 3 ECS tasks (1 per service)
- **Storage Stack**: No EFS automatic backups

### Multi-AZ Mode (`ENABLE_MULTI_AZ = true`)
- **Redis Stack**: 2 nodes (primary + replica)
- **MedDream Stack**: 6 ECS tasks (2 per service across AZs)
- **Storage Stack**: EFS automatic backups enabled

## Deployment Time Estimates

| Stack | Estimated Time | Notes |
|-------|---------------|-------|
| Lambda@Edge | 1-2 minutes | Simple Lambda function |
| Network | 2-3 minutes | VPC and security groups |
| Storage | 3-5 minutes | EFS creation takes time |
| HealthImaging | 1-2 minutes | Datastore creation |
| DataImport | 5-10 minutes | DICOM processing (optional) |
| Redis | 10-15 minutes | ElastiCache cluster creation |
| UploaderClientRole | 1 minute | IAM role creation |
| MedDream | 5-10 minutes | ECS service startup |
| CloudFront | 10-15 minutes | Distribution propagation |
| CloudFrontUrlUpdater | 1-2 minutes | Task definition update |
| UploaderPipeline | 3-5 minutes | CodePipeline setup (optional) |
| ConfigureValidationFunction | 1-2 minutes | Lambda configuration (optional) |

**Total Deployment Time**: 25-35 minutes (with optional components)
