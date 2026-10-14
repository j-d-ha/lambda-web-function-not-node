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

    // Every backend in src/ that ships a deployable artifact, one Web Function
    // each. `sourcePath` is produced by `task build`; the construct treats a
    // .zip as a pre-built artifact and uploads it as-is.
    const backends = [
      {
        // `id` becomes the construct's logical ID. "WebFunction" here is the
        // id the node function was first deployed under; renaming it would
        // make CloudFormation replace resources whose names are fixed
        // (functionName, log group), which fails with "already exists".
        id: "WebFunction",
        functionName: "node-api-web",
        sourcePath: "../build/node-api.zip",
        outputId: "EndpointUrl",
      },
      {
        // Go runs via index.js + process.execve; the revision still declares
        // the nodejs24.x runtime because that is what boots the shim.
        id: "GoWebFunction",
        functionName: "go-api-web",
        sourcePath: "../build/go-api.zip",
        outputId: "GoEndpointUrl",
      },
    ];

    for (const backend of backends) {
      const webFn = new WebFunction(this, backend.id, {
        functionName: backend.functionName,
        sourcePath: backend.sourcePath,
        codeBucket,
        timeout: cdk.Duration.seconds(30),
        maxConcurrencyPerEnvironment: 64,
        maxEnvironments: 2,
        rateLimit: 100,
        authType: WebFunctionAuthType.APPLICATION_MANAGED,
      });

      new cdk.CfnOutput(this, backend.outputId, { value: webFn.endpointUrl });
    }
  }
}
