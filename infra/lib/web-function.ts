import { Construct } from "constructs";
import { Duration, Fn, RemovalPolicy, Token } from "aws-cdk-lib";
import {
  CfnWebFunction,
  CfnWebFunctionRevision,
  CfnWebFunctionEndpoint,
} from "aws-cdk-lib/aws-lambda";
import { Bucket, CfnBucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Role, ServicePrincipal, ManagedPolicy } from "aws-cdk-lib/aws-iam";

/**
 * Runtimes Lambda Web Functions support.
 * Node.js only today — widen as AWS adds more.
 */
export enum WebFunctionRuntime {
  /** Node.js 24.x, the only runtime currently supported by Web Functions. */
  NODEJS_24_X = "nodejs24.x",
}

/** Endpoint authentication mode. */
export enum WebFunctionAuthType {
  /** Only SigV4-signed IAM callers can reach the endpoint. */
  IAM_AUTH = "IamAuth",
  /** Public endpoint — the app must implement its own auth. */
  APPLICATION_MANAGED = "ApplicationManaged",
}

/** Endpoint routing type. */
export enum WebFunctionEndpointType {
  /** Serve from the endpoint's home region. */
  HOME_REGION = "HomeRegion",
  /** One hostname, latency-routed across regions. */
  MULTI_REGION = "MultiRegion",
  /** Each region gets its own domain name. */
  PER_REGION = "PerRegion",
}

/**
 * An L2 construct for AWS Lambda Web Functions
 * (AWS::Lambda::WebFunction + WebFunctionRevision + WebFunctionEndpoint).
 *
 * Handles the whole chain: zips your app code, uploads it to a versioned S3
 * bucket via BucketDeployment, pins the revision to that exact object
 * version, and fronts it with an HTTPS endpoint.
 */
export interface WebFunctionProps {
  /** Unique function name across all Regions in the account (max 64 chars). */
  readonly functionName: string;

  /** Path to the app code directory. Zipped and uploaded to S3 as-is. */
  readonly sourcePath: string;

  /** Runtime for the revision. Web Functions currently only support Node.js. */
  readonly runtime?: WebFunctionRuntime; // default NODEJS_24_X

  /** Endpoint auth: IAM_AUTH (SigV4 callers only) or APPLICATION_MANAGED (public). */
  readonly authType?: WebFunctionAuthType; // default IAM_AUTH

  /** Endpoint type: HOME_REGION (default), MULTI_REGION, or PER_REGION. */
  readonly endpointType?: WebFunctionEndpointType;

  /**
   * Regions to serve the endpoint from. Required when endpointType is
   * MULTI_REGION or PER_REGION — at least one region other than the home
   * region; the home region alone is not accepted.
   */
  readonly regions?: Array<string>;

  /** Endpoint name. Default "default". */
  readonly endpointName?: string;

  /** Per-request timeout. Default 30s, max 900s. */
  readonly timeout?: Duration;

  /** Max concurrent requests per execution environment (1–128). */
  readonly maxConcurrencyPerEnvironment?: number;

  /** Cap on concurrent execution environments for the endpoint. */
  readonly maxEnvironments?: number;

  /** Per-endpoint request rate limit (up to 10000 RPS). */
  readonly rateLimit?: number;

  /** Optional execution role; one is created if omitted. */
  readonly role?: Role;

  /** Optional code bucket; one is created (versioned, DESTROY) if omitted. */
  readonly codeBucket?: Bucket;

  /** Optional description for the revision. */
  readonly description?: string;
}

export class WebFunction extends Construct {
  /** The underlying WebFunction resource. */
  public readonly function: CfnWebFunction;
  /** The immutable code+config revision. */
  public readonly revision: CfnWebFunctionRevision;
  /** The HTTPS endpoint. */
  public readonly endpoint: CfnWebFunctionEndpoint;
  /** The bucket holding the zipped code. */
  public readonly bucket: Bucket;
  /** The execution role. */
  public readonly role: Role;

  constructor(scope: Construct, id: string, props: WebFunctionProps) {
    super(scope, id);

    // Fail early on values CFN would only reject at deploy time.
    const endpointType =
      props.endpointType ?? WebFunctionEndpointType.HOME_REGION;
    if (
      (endpointType === WebFunctionEndpointType.MULTI_REGION ||
        endpointType === WebFunctionEndpointType.PER_REGION) &&
      (!props.regions || props.regions.length === 0)
    ) {
      throw new Error(
        `${endpointType} endpoints require at least one additional region in props.regions`,
      );
    }
    if (props.timeout && props.timeout.toSeconds() > 900) {
      throw new Error(
        `timeout ${props.timeout.toSeconds()}s exceeds the 900s web function maximum`,
      );
    }
    if (
      props.maxConcurrencyPerEnvironment !== undefined &&
      (props.maxConcurrencyPerEnvironment < 1 ||
        props.maxConcurrencyPerEnvironment > 128)
    ) {
      throw new Error(
        `maxConcurrencyPerEnvironment ${props.maxConcurrencyPerEnvironment} is outside the 1-128 range`,
      );
    }
    // Supported set from the CFN docs; actual availability can vary by Region
    // (an unsupported regional value is still caught at deploy time).
    if (props.rateLimit !== undefined) {
      const v = props.rateLimit;
      const supported =
        v === 0 ||
        (v >= 100 && v <= 1000 && v % 100 === 0) ||
        (v >= 2000 && v <= 10000 && v % 1000 === 0);
      if (!supported) {
        throw new Error(
          `rateLimit ${v} is not a supported value: use 0, 100-1000 in steps of 100, or 2000-10000 in steps of 1000`,
        );
      }
    }

    // 1. Versioned code bucket — versioning is required so the revision can
    //    pin an immutable object version.
    this.bucket =
      props.codeBucket ??
      new Bucket(this, "CodeBucket", {
        versioned: true,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });
    // A user-supplied bucket must be versioned, or objectVersionIds comes
    // back empty strings and the revision pins nothing. We can only verify
    // this for buckets created in the same app; imported buckets are trusted.
    if (this.bucket instanceof Bucket) {
      const cfnBucket = this.bucket.node.defaultChild as CfnBucket | undefined;
      const versioning = cfnBucket?.versioningConfiguration;
      if (
        !versioning ||
        Token.isUnresolved(versioning) ||
        (typeof versioning === "object" &&
          "status" in versioning &&
          versioning.status !== "Enabled")
      ) {
        throw new Error(
          "codeBucket must have versioning enabled: revisions pin an object version",
        );
      }
    }

    // 2. Execution role — trusted by lambda.amazonaws.com, logs to CloudWatch.
    this.role =
      props.role ??
      new Role(this, "ExecutionRole", {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaBasicExecutionRole",
          ),
        ],
      });

    // 3. Zip the source dir and upload as a single unextracted object.
    //    extract: false keeps the zip 1:1, which is what the revision wants.
    const deployment = new BucketDeployment(this, "CodeDeployment", {
      sources: [Source.asset(props.sourcePath)],
      destinationBucket: this.bucket,
      extract: false,
    });

    // 4. The web function itself — just a name.
    this.function = new CfnWebFunction(this, "Function", {
      functionName: props.functionName,
    });

    // 5. The revision pins the exact S3 object version BucketDeployment just
    //    uploaded — a code change gets a new version, so a redeploy is picked
    //    up even under the same key.
    this.revision = new CfnWebFunctionRevision(this, "Revision", {
      functionName: props.functionName, // bare name, never an ARN
      buildConfig: {
        codeConfig: {
          s3Object: {
            bucket: this.bucket.bucketName,
            key: Fn.select(0, deployment.objectKeys),
            versionId: Fn.select(0, deployment.objectVersionIds),
          },
        },
        runtimeConfig: {
          runtime: props.runtime ?? WebFunctionRuntime.NODEJS_24_X,
        },
      },
      serviceConfig: {
        executionRoleArn: this.role.roleArn,
        timeoutSeconds: (props.timeout ?? Duration.seconds(30)).toSeconds(),
        maxConcurrencyPerEnvironment: props.maxConcurrencyPerEnvironment,
      },
      description: props.description,
    });

    // Cfn ordering: the revision needs the function to exist first.
    this.revision.addResourceDependency(this.function);

    // 6. The HTTPS endpoint, weighted 100% to this revision.
    this.endpoint = new CfnWebFunctionEndpoint(this, "Endpoint", {
      functionName: props.functionName, // bare name, never an ARN
      endpointName: props.endpointName ?? "default",
      endpointType,
      regions: props.regions,
      authType: props.authType ?? WebFunctionAuthType.IAM_AUTH, // public by accident is the bad default
      revisionWeights: [
        {
          revisionId: this.revision.attrRevisionId,
          weight: 100,
        },
      ],
      scalingConfig: props.maxEnvironments
        ? { maxEnvironments: props.maxEnvironments }
        : undefined,
      throttleConfig:
        props.rateLimit !== undefined
          ? { rateLimit: props.rateLimit }
          : undefined,
    });

    this.endpoint.addResourceDependency(this.revision);
  }

  /** The HTTPS domain of the endpoint. */
  public get endpointUrl(): string {
    return this.endpoint.attrDomainName;
  }
}
