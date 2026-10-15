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
  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "dotnet-api-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "dotnet-aot-api-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "python-api-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "blazor-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "blazor-aot-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "java-api-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "java-aot-api-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "kotlin-api-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunctionEndpoint", {
    EndpointType: "HomeRegion",
    AuthType: "ApplicationManaged",
  });
  template.hasOutput("EndpointUrl", {});
  template.hasOutput("GoEndpointUrl", {});
  template.hasOutput("DotnetEndpointUrl", {});
  template.hasOutput("DotnetAotEndpointUrl", {});
  template.hasOutput("PythonEndpointUrl", {});
  template.hasOutput("BlazorEndpointUrl", {});
  template.hasOutput("BlazorAotEndpointUrl", {});
  template.hasOutput("JavaEndpointUrl", {});
  template.hasOutput("JavaAotEndpointUrl", {});
  template.hasOutput("KotlinEndpointUrl", {});

  // One shared, versioned code bucket that every revision pins into.
  template.hasResourceProperties("AWS::S3::Bucket", {
    VersioningConfiguration: { Status: "Enabled" },
  });
  const revisions = Object.values(
    template.findResources("AWS::Lambda::WebFunctionRevision"),
  );
  expect(revisions).toHaveLength(10);
  for (const revision of revisions) {
    expect(revision.Properties.BuildConfig.CodeConfig.S3Object.Bucket).toEqual({
      Ref: expect.any(String),
    });
  }
});
