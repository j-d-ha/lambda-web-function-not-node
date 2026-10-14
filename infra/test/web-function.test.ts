import {
  App,
  Duration,
  RemovalPolicy,
  Stack,
  Validations,
} from "aws-cdk-lib/core";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Match, Template } from "aws-cdk-lib/assertions";
import { WebFunction, WebFunctionEndpointType } from "../lib/web-function";
import { join } from "path";

// The bundled CloudFormation-Validate plugin doesn't know Web Function types
// yet; same acknowledgment the app itself uses.
function makeStack(): Stack {
  const app = new App();
  Validations.of(app).acknowledge({
    id: "CloudFormation-Validate::F3006",
    reason:
      "Lambda Web Function resource types are newer than this CDK release",
  });
  const stack = new Stack(app, "TestStack");
  new WebFunction(stack, "WebFunction", {
    functionName: "test-web-fn",
    sourcePath: join(__dirname, "..", "..", "src", "node-api", "dist"),
  });
  return stack;
}

test("creates function, revision, endpoint in order", () => {
  const template = Template.fromStack(makeStack());

  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "test-web-fn",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunctionRevision", {
    FunctionName: "test-web-fn",
    BuildConfig: {
      RuntimeConfig: { Runtime: "nodejs24.x" },
    },
  });
  template.hasResourceProperties("AWS::Lambda::WebFunctionEndpoint", {
    FunctionName: "test-web-fn",
    EndpointType: "HomeRegion",
    AuthType: "IamAuth",
    RevisionWeights: [{ Weight: 100 }],
  });
});

test("declares the function log group and deletes it with the stack", () => {
  const template = Template.fromStack(makeStack());

  const group = Object.values(
    template.findResources("AWS::Logs::LogGroup"),
  ).find((r) => r.Properties?.LogGroupName === "/aws/lambda/test-web-fn");
  expect(group).toBeDefined();
  expect(group!.DeletionPolicy).toEqual("Delete");

  const revision = Object.values(
    template.findResources("AWS::Lambda::WebFunctionRevision"),
  )[0].Properties;
  expect(revision.ServiceConfig.TelemetryConfig.LoggingConfig).toEqual({
    LogGroup: "/aws/lambda/test-web-fn",
  });
});

test("log group props override name, retention, and removal policy", () => {
  const app = new App();
  Validations.of(app).acknowledge({
    id: "CloudFormation-Validate::F3006",
    reason:
      "Lambda Web Function resource types are newer than this CDK release",
  });
  const stack = new Stack(app, "TestStack");
  new WebFunction(stack, "WebFunction", {
    functionName: "test-web-fn",
    sourcePath: join(__dirname, "..", "..", "src", "node-api", "dist"),
    logGroupName: "/app/custom-logs",
    logRetention: RetentionDays.ONE_WEEK,
    logRemovalPolicy: RemovalPolicy.RETAIN,
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::Logs::LogGroup", {
    LogGroupName: "/app/custom-logs",
    RetentionInDays: 7,
  });
  const group = Object.values(
    template.findResources("AWS::Logs::LogGroup"),
  ).find((r) => r.Properties?.LogGroupName === "/app/custom-logs");
  expect(group!.DeletionPolicy).not.toEqual("Delete"); // RETAIN

  // A custom name needs an explicit grant, and the revision points at it.
  template.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({ Action: Match.arrayWith(["logs:PutLogEvents"]) }),
      ]),
    },
  });
  const revision = Object.values(
    template.findResources("AWS::Lambda::WebFunctionRevision"),
  )[0].Properties;
  expect(revision.ServiceConfig.TelemetryConfig.LoggingConfig).toEqual({
    LogGroup: "/app/custom-logs",
  });
});

test("passes through env vars, tags, KMS key, and endpoint description", () => {
  const app = new App();
  Validations.of(app).acknowledge({
    id: "CloudFormation-Validate::F3006",
    reason:
      "Lambda Web Function resource types are newer than this CDK release",
  });
  const stack = new Stack(app, "TestStack");
  new WebFunction(stack, "WebFunction", {
    functionName: "test-web-fn",
    sourcePath: join(__dirname, "..", "..", "src", "node-api", "dist"),
    environmentVariables: { FOO: "bar" },
    tags: [{ key: "Team", value: "core" }],
    kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/abc",
    endpointDescription: "public api",
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    Tags: [{ Key: "Team", Value: "core" }],
  });
  template.hasResourceProperties("AWS::Lambda::WebFunctionRevision", {
    KmsKeyArn: "arn:aws:kms:us-east-1:123456789012:key/abc",
    ServiceConfig: { EnvironmentVariables: { FOO: "bar" } },
  });
  template.hasResourceProperties("AWS::Lambda::WebFunctionEndpoint", {
    Description: "public api",
  });
});

test("revision pins the deployed object version, not just the key", () => {
  const template = Template.fromStack(makeStack());

  const s3 = Object.values(
    template.findResources("AWS::Lambda::WebFunctionRevision"),
  )[0].Properties;

  expect(s3.BuildConfig.CodeConfig.S3Object.VersionId).toEqual({
    "Fn::Select": [
      0,
      { "Fn::GetAtt": [expect.any(String), "SourceObjectVersionIds"] },
    ],
  });
});

test("endpoint depends on the revision, revision on the function", () => {
  const template = Template.fromStack(makeStack());
  const ep = Object.values(
    template.findResources("AWS::Lambda::WebFunctionEndpoint"),
  )[0];
  const rev = Object.values(
    template.findResources("AWS::Lambda::WebFunctionRevision"),
  )[0];

  const revLogicalId = Object.keys(
    template.findResources("AWS::Lambda::WebFunctionRevision"),
  )[0];
  const fnLogicalId = Object.keys(
    template.findResources("AWS::Lambda::WebFunction"),
  )[0];

  expect(ep.DependsOn).toContain(revLogicalId);
  expect(rev.DependsOn).toContain(fnLogicalId);
});

test("grants lambda.amazonaws.com read access to the code object", () => {
  const template = Template.fromStack(makeStack());

  template.hasResourceProperties("AWS::S3::BucketPolicy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: "Allow",
          Principal: { Service: "lambda.amazonaws.com" },
          Action: Match.arrayWith(["s3:GetObject", "s3:GetObjectVersion"]),
          Condition: {
            ArnLike: {
              "aws:SourceArn": Match.objectLike({
                "Fn::Join": [
                  "",
                  Match.arrayWith([":web-function/test-web-fn/revision/*"]),
                ],
              }),
            },
          },
        }),
      ]),
    },
  });

  // The revision is rejected at create time unless the grant lands first.
  const rev = Object.values(
    template.findResources("AWS::Lambda::WebFunctionRevision"),
  )[0];
  const policyId = Object.keys(
    template.findResources("AWS::S3::BucketPolicy"),
  )[0];
  expect(rev.DependsOn).toContain(policyId);
});

test("multi-region endpoint without regions fails at synth, not deploy", () => {
  const app = new App();
  Validations.of(app).acknowledge({
    id: "CloudFormation-Validate::F3006",
    reason:
      "Lambda Web Function resource types are newer than this CDK release",
  });
  const stack = new Stack(app, "TestStack");
  expect(
    () =>
      new WebFunction(stack, "WebFunction", {
        functionName: "test-web-fn",
        sourcePath: join(__dirname, "..", "..", "src", "node-api", "dist"),
        endpointType: WebFunctionEndpointType.MULTI_REGION,
      }),
  ).toThrow(/props\.regions/);
});

test("unsupported prop values fail at synth, not deploy", () => {
  const app = new App();
  Validations.of(app).acknowledge({
    id: "CloudFormation-Validate::F3006",
    reason:
      "Lambda Web Function resource types are newer than this CDK release",
  });
  const src = join(__dirname, "..", "..", "src", "node-api", "dist");

  expect(
    () =>
      new WebFunction(new Stack(app, "T1"), "WebFunction", {
        functionName: "test-web-fn",
        sourcePath: src,
        timeout: Duration.minutes(20),
      }),
  ).toThrow(/900s/);

  expect(
    () =>
      new WebFunction(new Stack(app, "T2"), "WebFunction", {
        functionName: "test-web-fn",
        sourcePath: src,
        timeout: Duration.seconds(1),
      }),
  ).toThrow(/3-900s/);

  expect(
    () =>
      new WebFunction(new Stack(app, "T2b"), "WebFunction", {
        functionName: "test-web-fn",
        sourcePath: src,
        maxConcurrencyPerEnvironment: 200,
      }),
  ).toThrow(/1-128/);

  expect(
    () =>
      new WebFunction(new Stack(app, "T3"), "WebFunction", {
        functionName: "test-web-fn",
        sourcePath: src,
        rateLimit: 1500, // in the gap between 1000 and 2000
      }),
  ).toThrow(/rateLimit 1500/);
});

test("supported rateLimit values pass validation", () => {
  const app = new App();
  Validations.of(app).acknowledge({
    id: "CloudFormation-Validate::F3006",
    reason:
      "Lambda Web Function resource types are newer than this CDK release",
  });
  const src = join(__dirname, "..", "..", "src", "node-api", "dist");

  expect(
    () =>
      new WebFunction(new Stack(app, "T1"), "WebFunction", {
        functionName: "test-web-fn",
        sourcePath: src,
        rateLimit: 0,
      }),
  ).not.toThrow();

  expect(
    () =>
      new WebFunction(new Stack(app, "T2"), "WebFunction", {
        functionName: "test-web-fn",
        sourcePath: src,
        rateLimit: 2000,
      }),
  ).not.toThrow();
});
