import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

// WAF Stack (us-east-1)
export class WafStack extends cdk.Stack {
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.webAcl = new wafv2.CfnWebACL(this, 'WebACL', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'WebACL',
      },
      rules: [
        {
          name: 'RateLimitRule',
          priority: 1,
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          action: { block: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
          },
        },
      ],
    });
  }
}

// Backend Stack - SQS + Lambda (Sydney)
export class BackendStack extends cdk.Stack {
  public readonly apiGateway: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Dead Letter Queues for error handling
    const dlq1 = new sqs.Queue(this, 'SampleLambda1DLQ', {
      queueName: 'sample-lambda-1-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    const dlq2 = new sqs.Queue(this, 'SampleLambda2DLQ', {
      queueName: 'sample-lambda-2-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS Queues
    const queue1 = new sqs.Queue(this, 'SampleLambda1Queue', {
      queueName: 'sample-lambda-1-queue',
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: dlq1,
        maxReceiveCount: 3,
      },
    });

    const queue2 = new sqs.Queue(this, 'SampleLambda2Queue', {
      queueName: 'sample-lambda-2-queue',
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: dlq2,
        maxReceiveCount: 3,
      },
    });

    // Lambda functions
    const lambdaFunction1 = new lambda.Function(this, 'ApiHandler1', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/sample-lambda-1'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        QUEUE_URL: queue1.queueUrl,
      },
    });

    const lambdaFunction2 = new lambda.Function(this, 'ApiHandler2', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/sample-lambda-2'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        QUEUE_URL: queue2.queueUrl,
      },
    });

    // Grant permissions to Lambda functions to read from queues
    queue1.grantConsumeMessages(lambdaFunction1);
    queue2.grantConsumeMessages(lambdaFunction2);

    // Configure SQS as event source for Lambda functions
    lambdaFunction1.addEventSource(new eventsources.SqsEventSource(queue1, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    lambdaFunction2.addEventSource(new eventsources.SqsEventSource(queue2, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // IAM role for API Gateway to send messages to SQS
    const apiGatewayRole = new iam.Role(this, 'ApiGatewaySqsRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      inlinePolicies: {
        SendMessagePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sqs:SendMessage'],
              resources: [queue1.queueArn, queue2.queueArn],
            }),
          ],
        }),
      },
    });

    // API Gateway
    this.apiGateway = new apigateway.RestApi(this, 'Api', {
      restApiName: 'Serverless API with SQS',
      description: 'API Gateway with SQS integration for serverless web app',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // SQS Integrations
    const sqsIntegration1 = new apigateway.AwsIntegration({
      service: 'sqs',
      path: `${cdk.Aws.ACCOUNT_ID}/${queue1.queueName}`,
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: apiGatewayRole,
        requestParameters: {
          'integration.request.header.Content-Type': "'application/x-www-form-urlencoded'",
        },
        requestTemplates: {
          'application/json': 'Action=SendMessage&MessageBody=$util.urlEncode($input.body)&MessageAttributes.1.Name=Source&MessageAttributes.1.Value.StringValue=API-Gateway&MessageAttributes.1.Value.DataType=String&MessageAttributes.2.Name=RequestId&MessageAttributes.2.Value.StringValue=$context.requestId&MessageAttributes.2.Value.DataType=String',
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': JSON.stringify({
                message: 'Message sent to queue successfully',
                requestId: '$context.requestId'
              }),
            },
          },
        ],
      },
    });

    const sqsIntegration2 = new apigateway.AwsIntegration({
      service: 'sqs',
      path: `${cdk.Aws.ACCOUNT_ID}/${queue2.queueName}`,
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: apiGatewayRole,
        requestParameters: {
          'integration.request.header.Content-Type': "'application/x-www-form-urlencoded'",
        },
        requestTemplates: {
          'application/json': 'Action=SendMessage&MessageBody=$util.urlEncode($input.body)&MessageAttributes.1.Name=Source&MessageAttributes.1.Value.StringValue=API-Gateway&MessageAttributes.1.Value.DataType=String&MessageAttributes.2.Name=RequestId&MessageAttributes.2.Value.StringValue=$context.requestId&MessageAttributes.2.Value.DataType=String',
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': JSON.stringify({
                message: 'Message sent to queue successfully',
                requestId: '$context.requestId'
              }),
            },
          },
        ],
      },
    });
    
    // Add /api resource and sub-resources
    const api = this.apiGateway.root.addResource('api');
    const lambda1Resource = api.addResource('sample-lambda-1');
    const lambda2Resource = api.addResource('sample-lambda-2');
    
    // Add methods with proper method responses
    lambda1Resource.addMethod('POST', sqsIntegration1, {
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
      ],
    });

    lambda2Resource.addMethod('POST', sqsIntegration2, {
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': apigateway.Model.EMPTY_MODEL,
          },
        },
      ],
    });

    // Output queue URLs for testing
    new cdk.CfnOutput(this, 'Queue1Url', {
      value: queue1.queueUrl,
      description: 'SQS Queue URL for sample-lambda-1',
    });

    new cdk.CfnOutput(this, 'Queue2Url', {
      value: queue2.queueUrl,
      description: 'SQS Queue URL for sample-lambda-2',
    });
  }
}

// Frontend Stack - S3 & CloudFront (Sydney)
export class FrontendStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: cdk.StackProps & {
    apiGateway: apigateway.RestApi;
    webAcl: wafv2.CfnWebACL;
  }) {
    super(scope, id, props);

    // S3 Bucket for static website
    this.bucket = new s3.Bucket(this, 'WebsiteBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // S3 Origin
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);

    // API Gateway Origin
    const apiOrigin = new origins.RestApiOrigin(props.apiGateway);

    // CloudFront Distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
      defaultRootObject: 'index.html',
      webAclId: props.webAcl.attrArn,
    });

    // Deploy web assets to S3 with CloudFront invalidation
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset('web')],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
    });
  }
}


// Main Stack - deprecated, kept for compatibility
export class CdkSqsLambdaPatternStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // This stack is now empty - resources moved to separate stacks
  }
}
