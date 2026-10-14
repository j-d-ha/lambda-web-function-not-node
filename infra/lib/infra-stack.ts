import * as cdk from "aws-cdk-lib/core";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { WebFunction, WebFunctionAuthType } from "./web-function";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // One versioned bucket for all web-function code zips. Revisions pin an
    // exact object version, so it must stay versioned for every function we
    // add here.
    const codeBucket = new Bucket(this, "CodeBucket", {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const webFn = new WebFunction(this, "WebFunction", {
      functionName: "node-api-web",
      // Produced by `task build:node-api`; the construct treats a .zip as a
      // pre-built artifact and uploads it as-is.
      sourcePath: "../build/node-api.zip",
      codeBucket,
      timeout: cdk.Duration.seconds(30),
      maxConcurrencyPerEnvironment: 64,
      maxEnvironments: 2,
      rateLimit: 100,
      authType: WebFunctionAuthType.APPLICATION_MANAGED,
    });

    new cdk.CfnOutput(this, "EndpointUrl", { value: webFn.endpointUrl });
  }
}
