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

test("InfraStack creates the web function stack with an endpoint output", () => {
  const stack = new InfraStack(makeApp(), "MyTestStack");
  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::Lambda::WebFunction", {
    FunctionName: "node-api-web",
  });
  template.hasResourceProperties("AWS::Lambda::WebFunctionEndpoint", {
    EndpointType: "HomeRegion",
    AuthType: "IamAuth",
  });
  template.hasOutput("EndpointUrl", {});
});
