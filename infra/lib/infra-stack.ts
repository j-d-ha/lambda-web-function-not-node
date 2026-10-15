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

    // Every artifact `task build` produces, one Web Function each. `sourcePath`
    // is that artifact; the construct treats a .zip as pre-built and uploads it
    // as-is. Two of these come from a single source tree -- src/blazor and
    // src/java-api are each built twice -- which is why a backend can carry a
    // `backendName` rather than compiling its own name in.
    const backends: Array<{
      id: string;
      functionName: string;
      sourcePath: string;
      outputId: string;
      /**
       * What the app reports from GET /health, for the backends that read it
       * from configuration instead of compiling it in. Revision-level, since
       * that is where environment variables live.
       */
      backendName?: string;
    }> = [
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
      {
        // Same shared shim; this build is self-contained and untrimmed (see
        // src/DotnetApi), so the .NET runtime travels in the zip and
        // reflection stays available. It keeps the original DotnetWebFunction
        // logical id and dotnet-api-web name, so the AOT backend below moves
        // to its own name rather than colliding with this one.
        id: "DotnetWebFunction",
        functionName: "dotnet-api-web",
        sourcePath: "../build/dotnet-api.zip",
        outputId: "DotnetEndpointUrl",
      },
      {
        // The NativeAOT variant: no .NET runtime in the environment at all.
        // Same shim, different published binary.
        id: "DotnetAotWebFunction",
        functionName: "dotnet-aot-api-web",
        sourcePath: "../build/dotnet-aot-api.zip",
        outputId: "DotnetAotEndpointUrl",
      },
      {
        // Same shim again, exec'ing the launcher through the CPython bundled
        // in the zip (see build:python-api). The revision still declares
        // nodejs24.x because that is what boots the shim.
        id: "PythonWebFunction",
        functionName: "python-api-web",
        sourcePath: "../build/python-api.zip",
        outputId: "PythonEndpointUrl",
      },
      {
        // A Blazor Web App on the shared shim: static server-side rendering
        // plus a WebAssembly client that calls back into this same function.
        // The server project is untrimmed (see src/blazor/BlazorApp), so this is the
        // dotnet-api-class zip; the WebAssembly client bundle is trimmed by the
        // Blazor SDK on its own.
        id: "BlazorWebFunction",
        functionName: "blazor-web",
        sourcePath: "../build/blazor-web.zip",
        outputId: "BlazorEndpointUrl",
      },
      {
        // The same app with the WebAssembly client compiled ahead of time. The
        // server is identical; only the client bundle differs, which is why
        // both come from one project and one Dockerfile.
        id: "BlazorAotWebFunction",
        functionName: "blazor-aot-web",
        sourcePath: "../build/blazor-aot-web.zip",
        outputId: "BlazorAotEndpointUrl",
      },
      {
        // src/java-api built the JVM way: a jlink'd JRE carried in the zip. The
        // revision still declares nodejs24.x because that is what boots the
        // shim. The name it reports is set here, not in the code, because the
        // same source also builds the native function below.
        id: "JavaWebFunction",
        functionName: "java-api-web",
        sourcePath: "../build/java-api.zip",
        outputId: "JavaEndpointUrl",
        backendName: "java",
      },
      {
        // The same src/java-api through Dockerfile.aot: GraalVM native-image,
        // so there is no JVM in the environment at all. The Java counterpart of
        // the dotnet / dotnet-aot pair above, differing in packaging where they
        // differ in code.
        id: "JavaAotWebFunction",
        functionName: "java-aot-api-web",
        sourcePath: "../build/java-aot-api.zip",
        outputId: "JavaAotEndpointUrl",
        backendName: "java-aot",
      },
      {
        // Kotlin on Ktor, also carrying a jlink'd JRE: a second framework and a
        // second build on the same shim, and not Spring.
        id: "KotlinWebFunction",
        functionName: "kotlin-api-web",
        sourcePath: "../build/kotlin-api.zip",
        outputId: "KotlinEndpointUrl",
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
        // Only the backends that derive their reported name from configuration
        // get this; the rest compile it in and would ignore it.
        environmentVariables: backend.backendName
          ? { BACKEND_NAME: backend.backendName }
          : undefined,
      });

      new cdk.CfnOutput(this, backend.outputId, { value: webFn.endpointUrl });
    }
  }
}
