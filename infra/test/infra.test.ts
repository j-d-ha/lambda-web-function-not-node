import { App, Validations } from "aws-cdk-lib/core";
import { Template } from "aws-cdk-lib/assertions";
import { InfraStack } from "../lib/infra-stack";

// The bundled CloudFormation-Validate plugin doesn't know Web Function types
// yet; same acknowledgment the app itself uses.
function makeApp(): App {
  const app = new App();
  Validations.of(app).acknowledge({
    id: "CloudFormation-Validate::F3006",
    reason:
      "Lambda Web Function resource types are newer than this CDK release",
  });
  return app;
}

test("InfraStack deploys a web function per backend with an endpoint output", () => {
  const stack = new InfraStack(makeApp(), "MyTestStack");
  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "node-api-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "go-api-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunctionEndpoint", {
    EndpointType: "HomeRegion",
    AuthType: "ApplicationManaged",
  });
  template.hasOutput("EndpointUrl", {});
  template.hasOutput("GoEndpointUrl", {});

  // One shared, versioned code bucket that both revisions pin into.
  template.hasResourceProperties("AWS::S3::Bucket", {
    VersioningConfiguration: { Status: "Enabled" },
  });
  const revisions = Object.values(
    template.findResources("AWS::Lambda::WebFunctionRevision"),
  );
  expect(revisions).toHaveLength(2);
  for (const revision of revisions) {
    expect(revision.Properties.BuildConfig.CodeConfig.S3Object.Bucket).toEqual({
      Ref: expect.any(String),
    });
  }
});
