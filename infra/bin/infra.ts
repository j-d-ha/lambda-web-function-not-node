#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { InfraStack } from "../lib/infra-stack";

const app = new cdk.App();

// The CloudFormation-Validate plugin bundled with this CDK release doesn't
// recognize the Web Function resource types yet. They are real, deployed
// resource types; acknowledge the check so synth succeeds.
cdk.Validations.of(app).acknowledge({
  id: "CloudFormation-Validate::F3006",
  reason: "Lambda Web Function resource types are newer than this CDK release",
});

const STACK_NAME = "LambdaWebFunctionNotNode";

cdk.Tags.of(app).add("Application", STACK_NAME);
cdk.Tags.of(app).add("ManagedBy", "aws-cdk");

new InfraStack(app, STACK_NAME, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
