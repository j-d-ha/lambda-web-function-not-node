import { App, Duration, Stack, Validations } from "aws-cdk-lib/core";
import { Template } from "aws-cdk-lib/assertions";
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
