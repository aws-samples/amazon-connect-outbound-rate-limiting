import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import * as connect from "aws-cdk-lib/aws-connect";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambda_nodejs from "aws-cdk-lib/aws-lambda-nodejs";

export class ConnectOutboundRateLimitingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const connectInstanceARN = new cdk.CfnParameter(
      this,
      "ConnectInstanceARN",
      {
        type: "String",
        description:
          "The ARN of the Connect instance to deploy the contact flows to.",
      }
    );

    const customerRateLimit = new cdk.CfnParameter(this, "CustomerRateLimit", {
      type: "String",
      description:
        "The number of calls per minute to allow to a specific customer number.",
    });

    const systemRateLimit = new cdk.CfnParameter(this, "SystemRateLimit", {
      type: "String",
      description:
        "The number of calls per minute to allow from a Connect phone number.",
    });

    const rateLimitTable = new dynamodb.Table(this, "RateLimitTable", {
      partitionKey: {
        name: "phoneNumber",
        type: dynamodb.AttributeType.STRING,
      },
    });

    const rateLimitLambdaFunction = new lambda_nodejs.NodejsFunction(
      this,
      "RateLimitLambdaFunction",
      {
        runtime: lambda.Runtime.NODEJS_LATEST,
        handler: "index.handler",
        entry: path.join(__dirname, "rate-limiter/index.ts"),
        environment: {
          CONNECT_INSTANCE_ARN: connectInstanceARN.valueAsString,
          RATELIMIT_TABLE_NAME: rateLimitTable.tableName,
          CUSTOMER_RATE_LIMIT: customerRateLimit.valueAsString,
          SYSTEM_RATE_LIMIT: systemRateLimit.valueAsString,
        },
      }
    );

    rateLimitLambdaFunction.addPermission("AmazonConnectInvocation", {
      principal: new iam.ServicePrincipal("connect.amazonaws.com"),
      sourceArn: connectInstanceARN.valueAsString,
    });

    rateLimitLambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["connect:StopContact"],
        resources: [`${connectInstanceARN.valueAsString}/contact/*`],
      })
    );

    rateLimitTable.grantReadWriteData(rateLimitLambdaFunction);

    const rateLimitWarningToAgentFlowJSON = {
      Version: "2019-10-30",
      StartAction: "b4fbc019-e6b0-417c-9b28-ec464e031428",
      Metadata: {
        entryPointPosition: { x: -70.4, y: -10.4 },
        ActionMetadata: {
          "b4fbc019-e6b0-417c-9b28-ec464e031428": {
            position: { x: 54.4, y: -41.6 },
          },
          "c8bb98ec-3c25-4c56-b06e-6afb712d0014": {
            position: { x: 322.4, y: -57.6 },
            parameters: { AgentId: { useDynamic: true } },
            useDynamic: true,
          },
          "6ca4409c-f377-40c3-b529-5b8d229fd53b": {
            position: { x: 588, y: -61.6 },
          },
          "4a5eb84a-d024-440a-929a-d92b5f58e8cf": {
            position: { x: 819.2, y: -24.8 },
          },
        },
        Annotations: [],
      },
      Actions: [
        {
          Parameters: { FlowLoggingBehavior: "Enabled" },
          Identifier: "b4fbc019-e6b0-417c-9b28-ec464e031428",
          Type: "UpdateFlowLoggingBehavior",
          Transitions: { NextAction: "c8bb98ec-3c25-4c56-b06e-6afb712d0014" },
        },
        {
          Parameters: { AgentId: "$.Attributes.AgentARN" },
          Identifier: "c8bb98ec-3c25-4c56-b06e-6afb712d0014",
          Type: "UpdateContactTargetQueue",
          Transitions: {
            NextAction: "6ca4409c-f377-40c3-b529-5b8d229fd53b",
            Errors: [
              {
                NextAction: "6ca4409c-f377-40c3-b529-5b8d229fd53b",
                ErrorType: "NoMatchingError",
              },
            ],
          },
        },
        {
          Parameters: {},
          Identifier: "6ca4409c-f377-40c3-b529-5b8d229fd53b",
          Type: "TransferContactToQueue",
          Transitions: {
            NextAction: "4a5eb84a-d024-440a-929a-d92b5f58e8cf",
            Errors: [
              {
                NextAction: "4a5eb84a-d024-440a-929a-d92b5f58e8cf",
                ErrorType: "QueueAtCapacity",
              },
              {
                NextAction: "4a5eb84a-d024-440a-929a-d92b5f58e8cf",
                ErrorType: "NoMatchingError",
              },
            ],
          },
        },
        {
          Parameters: {},
          Identifier: "4a5eb84a-d024-440a-929a-d92b5f58e8cf",
          Type: "DisconnectParticipant",
          Transitions: {},
        },
      ],
    };

    const rateLimitWarningToAgentFlow = new connect.CfnContactFlow(
      this,
      "RateLimitWarningContactFlow",
      {
        content: JSON.stringify(rateLimitWarningToAgentFlowJSON),
        instanceArn: connectInstanceARN.valueAsString,
        name: "Rate Limit Warning to Agent Flow",
        type: "CONTACT_FLOW",
        description: "Notifies agents that their call has been rate limited",
        state: "ACTIVE",
      }
    );

    const outboundWhisperFlowJSON = {
      Version: "2019-10-30",
      StartAction: "2c2eaf35-3f68-459d-92d6-4dd9c66cea8b",
      Metadata: {
        entryPointPosition: { x: -1936.8, y: 157.6 },
        ActionMetadata: {
          "7da3ff7f-964f-4a19-8c23-05497418f15a": {
            position: { x: -1340, y: 246.4 },
          },
          "2c2eaf35-3f68-459d-92d6-4dd9c66cea8b": {
            position: { x: -1832, y: 122.4 },
          },
          "Define Prefixes to Rate Limit": {
            position: { x: -1579.2, y: 94.4 },
            isFriendlyName: true,
            conditionMetadata: [
              {
                id: "5ad75f5b-b889-4ad3-9183-15c6854730b3",
                operator: {
                  name: "Starts with",
                  value: "StartsWith",
                  shortDisplay: "starts with",
                },
                value: "+1",
              },
            ],
          },
          "5d192c5d-740d-4823-9162-d3c430373581": {
            position: { x: -1061.6, y: 85.6 },
            parameters: {
              LambdaInvocationAttributes: {
                InitialContactId: { useDynamic: true },
              },
            },
            dynamicMetadata: { InitialContactId: true },
          },
          "43a1e893-ec28-45ea-89ca-4888dd43cd20": {
            position: { x: -802.4, y: 398.4 },
          },
          "5d222bc9-ea8c-47fb-8f95-cf39a842cc5a": {
            position: { x: -522.4, y: 604 },
            parameters: {
              ContactFlowId: {
                displayName: "Rate Limit Warning to Agent Flow",
              },
              Attributes: { AgentARN: { useDynamic: true } },
            },
            ContactFlow: { text: "Rate Limit Warning to Agent Flow" },
          },
          "49e04ad2-a4b0-4b7d-a014-f13252407b5c": {
            position: { x: -780, y: 62.4 },
            conditionMetadata: [
              {
                id: "c3dbef2c-34e2-4588-81ce-f4b0458c731d",
                operator: {
                  name: "Equals",
                  value: "Equals",
                  shortDisplay: "=",
                },
                value: "true",
              },
            ],
          },
          "d9c11e0e-7cdc-438e-901a-a135768cb6c9": {
            position: { x: -268, y: 196 },
            parameters: {
              ContactFlowId: {
                displayName: "Rate Limit Warning to Agent Flow",
              },
              Attributes: { AgentARN: { useDynamic: true } },
            },
            ContactFlow: { text: "Rate Limit Warning to Agent Flow" },
          },
          "45d45ee8-6b6f-4aaa-a18d-bfc9e8bacb11": {
            position: { x: 266.4, y: 363.2 },
          },
          "0f7bd1e0-d68e-47ef-94ab-2f677c02cee6": {
            position: { x: -552, y: 227.2 },
            conditionMetadata: [
              {
                id: "f282c790-564b-40cb-8312-eff4b44c2dd6",
                operator: {
                  name: "Equals",
                  value: "Equals",
                  shortDisplay: "=",
                },
                value: "customer",
              },
            ],
          },
          "497f6839-5ad0-4c93-a754-119006faa3f4": {
            position: { x: -266.4, y: 385.6 },
            parameters: {
              ContactFlowId: {
                displayName: "Rate Limit Warning to Agent Flow",
              },
              Attributes: { AgentARN: { useDynamic: true } },
            },
            ContactFlow: { text: "Rate Limit Warning to Agent Flow" },
          },
        },
        Annotations: [
          {
            type: "default",
            id: "aa036038-eaa3-424d-9060-5c76dbd75c92",
            content:
              'Step 1: Logs an outbound call attempt to DynamoDB based on customer and system number.\n\nLambda function will terminate call via StopContact API.\n\nReturns CallBlocked as "true" or "false" depending on if the rate limit has been exceeded (defined in CloudFormation parameters)',
            actionId: "",
            isFolded: false,
            position: { x: -1383, y: -224 },
            size: { height: 295, width: 300 },
          },
          {
            type: "default",
            id: "d7000487-8108-4fc1-b065-69d43edb6976",
            content:
              'Edit the below "Check Contact Attributes" block to define the prefixes to perform rate limiting on.',
            actionId: "",
            isFolded: false,
            position: { x: -2006, y: -219 },
            size: { height: 295, width: 300 },
          },
          {
            type: "default",
            id: "81fa57e0-4e48-4bb5-845b-c2e6e53b4918",
            content:
              "Step 2: Send a task to the agent informing them why their call was terminated.",
            actionId: "",
            isFolded: false,
            position: { x: -676, y: -184 },
            size: { height: 295, width: 300 },
          },
        ],
      },
      Actions: [
        {
          Parameters: {},
          Identifier: "7da3ff7f-964f-4a19-8c23-05497418f15a",
          Type: "EndFlowExecution",
          Transitions: {},
        },
        {
          Parameters: { FlowLoggingBehavior: "Enabled" },
          Identifier: "2c2eaf35-3f68-459d-92d6-4dd9c66cea8b",
          Type: "UpdateFlowLoggingBehavior",
          Transitions: { NextAction: "Define Prefixes to Rate Limit" },
        },
        {
          Parameters: { ComparisonValue: "$.CustomerEndpoint.Address" },
          Identifier: "Define Prefixes to Rate Limit",
          Type: "Compare",
          Transitions: {
            NextAction: "7da3ff7f-964f-4a19-8c23-05497418f15a",
            Conditions: [
              {
                NextAction: "5d192c5d-740d-4823-9162-d3c430373581",
                Condition: { Operator: "TextStartsWith", Operands: ["+1"] },
              },
            ],
            Errors: [
              {
                NextAction: "7da3ff7f-964f-4a19-8c23-05497418f15a",
                ErrorType: "NoMatchingCondition",
              },
            ],
          },
        },
        {
          Parameters: {
            LambdaFunctionARN: rateLimitLambdaFunction.functionArn,
            InvocationTimeLimitSeconds: "8",
            LambdaInvocationAttributes: {
              InitialContactId: "$.InitialContactId",
            },
            ResponseValidation: { ResponseType: "STRING_MAP" },
          },
          Identifier: "5d192c5d-740d-4823-9162-d3c430373581",
          Type: "InvokeLambdaFunction",
          Transitions: {
            NextAction: "49e04ad2-a4b0-4b7d-a014-f13252407b5c",
            Errors: [
              {
                NextAction: "43a1e893-ec28-45ea-89ca-4888dd43cd20",
                ErrorType: "NoMatchingError",
              },
            ],
          },
        },
        {
          Parameters: { LoopCount: "3" },
          Identifier: "43a1e893-ec28-45ea-89ca-4888dd43cd20",
          Type: "Loop",
          Transitions: {
            NextAction: "5d222bc9-ea8c-47fb-8f95-cf39a842cc5a",
            Conditions: [
              {
                NextAction: "5d192c5d-740d-4823-9162-d3c430373581",
                Condition: {
                  Operator: "Equals",
                  Operands: ["ContinueLooping"],
                },
              },
              {
                NextAction: "5d222bc9-ea8c-47fb-8f95-cf39a842cc5a",
                Condition: { Operator: "Equals", Operands: ["DoneLooping"] },
              },
            ],
          },
        },
        {
          Parameters: {
            Name: "Rate Limiting Error",
            ContactFlowId: rateLimitWarningToAgentFlow.attrContactFlowArn,
            Description:
              'Your outbound call was blocked due to an error in the "Outbound Rate Limiting" flow. Please inform your administrator.',
            Attributes: { AgentARN: "$.Agent.ARN" },
          },
          Identifier: "5d222bc9-ea8c-47fb-8f95-cf39a842cc5a",
          Type: "CreateTask",
          Transitions: {
            NextAction: "45d45ee8-6b6f-4aaa-a18d-bfc9e8bacb11",
            Errors: [
              {
                NextAction: "45d45ee8-6b6f-4aaa-a18d-bfc9e8bacb11",
                ErrorType: "NoMatchingError",
              },
            ],
          },
        },
        {
          Parameters: { ComparisonValue: "$.External.CallAllowed" },
          Identifier: "49e04ad2-a4b0-4b7d-a014-f13252407b5c",
          Type: "Compare",
          Transitions: {
            NextAction: "0f7bd1e0-d68e-47ef-94ab-2f677c02cee6",
            Conditions: [
              {
                NextAction: "45d45ee8-6b6f-4aaa-a18d-bfc9e8bacb11",
                Condition: { Operator: "Equals", Operands: ["true"] },
              },
            ],
            Errors: [
              {
                NextAction: "0f7bd1e0-d68e-47ef-94ab-2f677c02cee6",
                ErrorType: "NoMatchingCondition",
              },
            ],
          },
        },
        {
          Parameters: {
            Name: "Rate Limited Call",
            ContactFlowId: rateLimitWarningToAgentFlow.attrContactFlowArn,
            Description:
              "Your outbound call to $.CustomerEndpoint.Address was rate limited due to administrator policy. Do not perform repeated calls to this number, and try again later.",
            Attributes: { AgentARN: "$.Agent.ARN" },
          },
          Identifier: "d9c11e0e-7cdc-438e-901a-a135768cb6c9",
          Type: "CreateTask",
          Transitions: {
            NextAction: "45d45ee8-6b6f-4aaa-a18d-bfc9e8bacb11",
            Errors: [
              {
                NextAction: "45d45ee8-6b6f-4aaa-a18d-bfc9e8bacb11",
                ErrorType: "NoMatchingError",
              },
            ],
          },
        },
        {
          Parameters: {},
          Identifier: "45d45ee8-6b6f-4aaa-a18d-bfc9e8bacb11",
          Type: "EndFlowExecution",
          Transitions: {},
        },
        {
          Parameters: { ComparisonValue: "$.External.Reason" },
          Identifier: "0f7bd1e0-d68e-47ef-94ab-2f677c02cee6",
          Type: "Compare",
          Transitions: {
            NextAction: "497f6839-5ad0-4c93-a754-119006faa3f4",
            Conditions: [
              {
                NextAction: "d9c11e0e-7cdc-438e-901a-a135768cb6c9",
                Condition: { Operator: "Equals", Operands: ["customer"] },
              },
            ],
            Errors: [
              {
                NextAction: "497f6839-5ad0-4c93-a754-119006faa3f4",
                ErrorType: "NoMatchingCondition",
              },
            ],
          },
        },
        {
          Parameters: {
            Name: "Rate Limited Call",
            ContactFlowId: rateLimitWarningToAgentFlow.attrContactFlowArn,
            Description:
              "Your outbound call to $.CustomerEndpoint.Address was rate limited due to excess calls from this outbound caller ID.",
            Attributes: { AgentARN: "$.Agent.ARN" },
          },
          Identifier: "497f6839-5ad0-4c93-a754-119006faa3f4",
          Type: "CreateTask",
          Transitions: {
            NextAction: "45d45ee8-6b6f-4aaa-a18d-bfc9e8bacb11",
            Errors: [
              {
                NextAction: "45d45ee8-6b6f-4aaa-a18d-bfc9e8bacb11",
                ErrorType: "NoMatchingError",
              },
            ],
          },
        },
      ],
    };

    rateLimitWarningToAgentFlow.node.addDependency(rateLimitLambdaFunction);

    const queueTransferFlow = new connect.CfnContactFlow(
      this,
      "QueueTransferContactFlow",
      {
        content: JSON.stringify(outboundWhisperFlowJSON),
        instanceArn: connectInstanceARN.valueAsString,
        name: "Outbound Rate Limiting Whisper Flow",
        type: "OUTBOUND_WHISPER",
        description: "Rate limits outbound calls based on TO and FROM number",
        state: "ACTIVE",
      }
    );

    queueTransferFlow.node.addDependency(rateLimitLambdaFunction);
  }
}
