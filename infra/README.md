# infra

The AWS CDK app for this repo: a Lambda Web Functions stack plus the L2
construct it is built on. [`../Taskfile.yml`](../Taskfile.yml) drives it through
`task deploy`, which builds the artifacts first and then runs `cdk deploy`.

## What is here

- `lib/web-function.ts`: an L2 construct over `AWS::Lambda::WebFunction`,
  `WebFunctionRevision`, and `WebFunctionEndpoint`. It uploads the app code to a
  versioned S3 bucket, pins the revision to the exact object version, grants
  `lambda.amazonaws.com` read access to that object, creates the execution role
  and log group, and fronts the revision with an HTTPS endpoint. Values the
  CloudFormation resource would reject only at deploy time throw at synth time
  instead: a timeout outside 3-900s, concurrency outside 1-128, a rate limit
  that is not `0` / `100`-`1000` in steps of 100 / `2000`-`10000` in steps of
  1000, or a `MultiRegion`/`PerRegion` endpoint with no `regions`.
- `lib/infra-stack.ts`: one `WebFunction` per artifact in `../build`, all
  sharing one versioned code bucket, each with a `CfnOutput` for its endpoint
  URL.
- `bin/infra.ts`: the app entry point. Names the stack
  `LambdaWebFunctionNotNode` and tags it `Application`/`ManagedBy`.
- `test/`: jest template tests over the construct and the stack.

## Useful commands

- `npm run build` type-check the project
- `npm run watch` watch for changes and type-check
- `npm run test` run the jest unit tests
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emit the synthesized CloudFormation template
