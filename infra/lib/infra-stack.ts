import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { WebFunction } from "./web-function";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const webFn = new WebFunction(this, "WebFunction", {
      functionName: "node-api-web",
      sourcePath: "../src/node-api/dist",
      timeout: cdk.Duration.seconds(30),
    });

    new cdk.CfnOutput(this, "EndpointUrl", { value: webFn.endpointUrl });
  }
}
