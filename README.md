# CDK Serverless Web App Pattern

A production-ready, reusable AWS CDK pattern for serverless web applications that combines static frontend hosting with serverless API backends, designed with real-world deployment challenges in mind.

## Key Features

- **Cross-Region Architecture**: WAF in us-east-1 (CloudFront requirement) with other resources in Sydney
- **Stack Separation**: Frontend and Backend isolated for independent deployment cycles
- **Modern Security**: AWS WAF with rate limiting and Origin Access Control (OAC)
- **Auto-Scaling**: Serverless Lambda functions with API Gateway
- **CDN Integration**: CloudFront with automatic cache invalidation
- **Production-Ready**: CORS, error handling, and monitoring built-in
- **Reusable Components**: Modular design for easy customization

## Architecture

```
User Browser → WAF → CloudFront → API Gateway → Lambda Functions
                        │
                        └─────────► S3 Bucket (Static Files)

Request Flow:
• /* (static files) → User → WAF → CloudFront → S3
• /api/* (API calls) → User → WAF → CloudFront → API Gateway → Lambda
```

## Real-World Problem Solving

This architecture addresses common production challenges I've encountered:

### Cross-Region Compliance
**Challenge**: AWS WAF for CloudFront must be deployed in us-east-1, while application resources are in other regions.
**Solution**: Implemented cross-region references with `crossRegionReferences: true` to securely connect WAF in us-east-1 with CloudFront in Sydney.

### Independent Deployment Cycles
**Challenge**: Frontend and backend teams have different release schedules, causing pipeline conflicts.
**Solution**: Separated into distinct stacks (FrontendStack, BackendStack) enabling:
- Independent deployment pipelines
- Reduced blast radius for changes
- Team autonomy in release management

### Cache Management
**Challenge**: Static assets remain cached in CloudFront after updates, serving stale content.
**Solution**: Automated CloudFront invalidation (`distributionPaths: ['/*']`) triggered after S3 deployment.

### Scalability Concerns
**Challenge**: Monolithic infrastructure becomes unwieldy as projects grow.
**Solution**: Modular stack design allows easy addition of new Lambda functions, API routes, and frontend features.

## Project Structure

```
cdk-serverless-web-app-pattern/
├── bin/
│   └── cdk-serverless-web-app-pattern.ts    # App entry point with stack orchestration
├── lib/
│   └── cdk-serverless-web-app-pattern-stack.ts # All stack definitions
├── lambda/
│   ├── sample-lambda-1/
│   │   └── index.js                         # API endpoint handler
│   └── sample-lambda-2/
│       └── index.js                         # Another API endpoint handler
├── web/
│   └── index.html                           # Frontend application
├── test/
│   └── *.test.ts                           # Unit tests
├── cdk.json                                # CDK configuration
├── package.json                            # Dependencies
└── README.md                               # This file
```

## Prerequisites

- Node.js (v18+)
- AWS CLI configured
- CDK CLI installed (`npm install -g aws-cdk`)
- AWS credentials with appropriate permissions

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Bootstrap CDK (if first time)
```bash
# Bootstrap both regions
cdk bootstrap aws://YOUR-ACCOUNT/us-east-1
cdk bootstrap aws://YOUR-ACCOUNT/ap-southeast-2
```

### 3. Deploy All Stacks
```bash
cdk deploy --all
```

### 4. Test the Application
After deployment, CDK will output the CloudFront distribution URL:
```
FrontendStack.DistributionDomainName = d1234567890abc.cloudfront.net
```

Visit the URL and test both Lambda functions using the provided buttons.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/lambda-1` | GET | Returns greeting from Lambda 1 |
| `/api/lambda-2` | GET | Returns greeting from Lambda 2 |

## Production Considerations

### For Large-Scale Projects

**File Organization**: 
```bash
# Recommended structure for production
project/
├── infrastructure/
│   ├── stacks/
│   │   ├── waf-stack.ts
│   │   ├── frontend-stack.ts
│   │   └── backend-stack.ts
│   └── constructs/
│       ├── api-construct.ts
│       └── frontend-construct.ts
├── frontend/                    # Separate repository
└── backend/                     # Separate repository
```

**Multi-Pipeline Strategy**:
- **Frontend Pipeline**: Triggers on `frontend/` changes
- **Backend Pipeline**: Triggers on `backend/` changes  
- **Infrastructure Pipeline**: Triggers on `infrastructure/` changes

This separation prevents:
- Unnecessary deployments
- Cross-team blocking
- Accidental infrastructure changes during feature deployments

### Environment Management
```typescript
// Add environment-specific configurations
const envConfig = {
  dev: { domainName: 'dev.example.com' },
  prod: { domainName: 'example.com' }
};
```

### Monitoring and Observability
Consider adding:
- CloudWatch dashboards
- X-Ray tracing
- Custom metrics
- Alarms and notifications

## Extending the Pattern

### Adding New Lambda Functions
1. Create new function in `lambda/` directory
2. Add to BackendStack:
```typescript
const newFunction = new lambda.Function(this, 'NewFunction', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda/new-function'),
});

const newResource = api.addResource('new-endpoint');
newResource.addMethod('GET', new apigateway.LambdaIntegration(newFunction));
```

### Frontend Framework Integration
Replace `web/index.html` with your preferred framework build output:
- React: `npm run build` → `build/`
- Vue: `npm run build` → `dist/`
- Angular: `ng build` → `dist/`

## Security Features

- **AWS WAF**: Rate limiting (2000 req/5min per IP)
- **Origin Access Control**: Secure S3 access via CloudFront only
- **CORS**: Properly configured for cross-origin requests
- **HTTPS**: Enforced via CloudFront viewer protocol policy

## Performance Optimizations

- **CloudFront Caching**: Static assets cached globally
- **API Caching**: Disabled for dynamic content (`/api/*`)
- **Lambda Cold Start**: Minimized with simple handlers
- **S3 Optimization**: Direct CloudFront integration

## Customization Options

### WAF Rules
Add custom security rules:
```typescript
rules: [
  {
    name: 'BlockSQLInjection',
    priority: 2,
    statement: {
      sqliMatchStatement: {
        fieldToMatch: { body: {} },
        textTransformations: [{ priority: 0, type: 'URL_DECODE' }]
      }
    },
    action: { block: {} }
  }
]
```

### CloudFront Behaviors
Add custom routing:
```typescript
additionalBehaviors: {
  '/images/*': {
    origin: s3Origin,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
  }
}
```

## Useful CDK Commands

- `cdk ls` - List all stacks
- `cdk synth` - Synthesize CloudFormation templates
- `cdk deploy WafStack` - Deploy specific stack
- `cdk diff` - Compare deployed stack with current state
- `cdk destroy --all` - Remove all stacks

## Best Practices Implemented

1. **Infrastructure as Code**: All resources defined in CDK
2. **Least Privilege**: IAM roles with minimal permissions
3. **Resource Naming**: Consistent and descriptive naming
4. **Error Handling**: Proper HTTP status codes and CORS headers
5. **Documentation**: Self-documenting code with clear comments
6. **Testing**: Includes unit test structure
7. **Version Control**: GitIgnore configured for CDK projects

## Contributing

This pattern is designed to be a starting point. Common extensions:
- Database integration (DynamoDB, RDS)
- Authentication (Cognito, Auth0)
- Custom domains (Route53, ACM)
- CI/CD pipelines (CodePipeline, GitHub Actions)
- Environment promotion workflows

## License

MIT License - Feel free to use this pattern in your projects!

---

**Built with real-world production experience**