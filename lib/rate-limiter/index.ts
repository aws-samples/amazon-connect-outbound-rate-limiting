import { ConnectContactFlowEvent, Context } from "aws-lambda";
import {
  ConnectClient,
  StopContactCommand,
  StopContactCommandInput,
} from "@aws-sdk/client-connect";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";

const connectClient = new ConnectClient();
const dynamoClient = new DynamoDBClient();
const dynamoDocClient = DynamoDBDocumentClient.from(dynamoClient);

export const validateEnvVariables = async () => {
  const expectedVariables = [
    "CONNECT_INSTANCE_ARN",
    "RATELIMIT_TABLE_NAME",
    "CUSTOMER_RATE_LIMIT",
    "SYSTEM_RATE_LIMIT",
  ];

  expectedVariables.forEach((variable) => {
    if (!process.env[variable]) {
      console.error(`Environment variable ${variable} is not set, exiting`);
      return;
    }
  });
};

export const stopContact = async (contactId: string, instanceId: string) => {
  console.log(
    `[Rate Limiter] Sending stop contact API request for contact ID ${contactId}`
  );
  // Send StopContact API request
  const input: StopContactCommandInput = {
    ContactId: contactId,
    InstanceId: instanceId,
  };

  const command = new StopContactCommand(input);

  try {
    const response = connectClient.send(command);
    return response;
  } catch (e) {
    console.error(`An error occured calling the StopContact command: ${e}`);
    return;
  }
};

export const isCallAllowed = async (
  phoneNumber: string,
  executionTime: number,
  rateLimit: number,
  updatedAt: number,
  usage: number
) => {
  // If last customer outbound attempt was under 1 minute ago
  if (executionTime - updatedAt <= 1 * 60 * 1000) {
    console.log(
      `[Rate Limiter] Last call to ${phoneNumber} was under 1 minute ago, validating rate limit`
    );

    // If less than x calls in the last minute for the customer number
    if (usage + 1 >= rateLimit) {
      console.log(
        `[Rate Limiter] Usage for ${phoneNumber} is greater than or equal to ${rateLimit} (current value ${
          usage + 1
        }), blocking call`
      );
      return false;
    }

    console.log(
      `[Rate Limiter] Usage for ${phoneNumber} is less than ${rateLimit} (current value ${
        usage + 1
      }), call allowed`
    );
    return true;
  } else {
    console.log(
      `[Rate Limiter] Resetting usage for phone number ${phoneNumber}, new value 0`
    );
    await resetRateLimit(phoneNumber);
    return true;
  }
};

export const resetRateLimit = async (phoneNumber: string) => {
  const resetRateLimitInput: UpdateCommandInput = {
    TableName: process.env["RATELIMIT_TABLE_NAME"],
    Key: {
      phoneNumber: phoneNumber,
    },
    UpdateExpression: "SET #usage = :start",
    ExpressionAttributeNames: {
      "#usage": "usage",
    },
    ExpressionAttributeValues: {
      ":start": 1,
    },
  };

  // Send updates to DynamoDB
  const resetRateLimitCommand = new UpdateCommand(resetRateLimitInput);

  try {
    const response = await dynamoDocClient.send(resetRateLimitCommand);
    console.log(`[Rate Limiter] Usage reset for phone number ${phoneNumber}`);
    return response;
  } catch (e) {
    console.error(`An error occured calling the UpdateItem command: ${e}`);
    return;
  }
};

export const logContact = async (
  initialContactId: string,
  instanceId: string,
  customerNumber: string,
  systemNumber: string
) => {
  // Log customer number to rate limiting table
  const executionTime = Date.now();

  const customerInput: UpdateCommandInput = {
    TableName: process.env["RATELIMIT_TABLE_NAME"],
    Key: {
      phoneNumber: customerNumber,
    },
    UpdateExpression:
      "SET #usage = if_not_exists(#usage, :start) + :inc, #type = :type, #updatedat = :updatedat",
    ExpressionAttributeNames: {
      "#usage": "usage",
      "#type": "type",
      "#updatedat": "updatedAt",
    },
    ExpressionAttributeValues: {
      ":inc": 1,
      ":start": 0,
      ":type": "customer",
      ":updatedat": executionTime,
    },
    // @ts-ignore
    ReturnValues: "UPDATED_OLD",
  };

  // Log system number to rate limiting table
  const systemInput: UpdateCommandInput = {
    TableName: process.env["RATELIMIT_TABLE_NAME"],
    Key: {
      phoneNumber: systemNumber,
    },
    UpdateExpression:
      "SET #usage = if_not_exists(#usage, :start) + :inc, #type = :type, #updatedat = :updatedat",
    ExpressionAttributeNames: {
      "#usage": "usage",
      "#type": "type",
      "#updatedat": "updatedAt",
    },
    ExpressionAttributeValues: {
      ":inc": 1,
      ":start": 0,
      ":type": "system",
      ":updatedat": Date.now().toString(),
    },
    // @ts-ignore
    ReturnValues: "UPDATED_OLD",
  };

  // Send updates to DynamoDB
  const customerCommand = new UpdateCommand(customerInput);
  const systemCommand = new UpdateCommand(systemInput);

  let customerResponse;
  let systemResponse;

  try {
    customerResponse = await dynamoDocClient.send(customerCommand);
    console.log(
      `[Rate Limiter] Call successfully logged for customer number ${customerNumber}`
    );

    systemResponse = await dynamoDocClient.send(systemCommand);
    console.log(
      `[Rate Limiter] Call successfully logged for system number ${systemNumber}`
    );
  } catch (e) {
    console.error(`An error occured calling the UpdateItem command: ${e}`);
    return;
  }

  // Validate if call is allowed
  let customerRateLimit = Number(process.env["CUSTOMER_RATE_LIMIT"]);
  let systemRateLimit = Number(process.env["SYSTEM_RATE_LIMIT"]);

  let customerCallAllowed = false;
  try {
    let customerUpdatedAt = Number(
      customerResponse["Attributes"]!["updatedAt"]!
    );
    let customerUsage = customerResponse["Attributes"]!["usage"]!;
    customerCallAllowed = await isCallAllowed(
      customerNumber,
      executionTime,
      customerRateLimit,
      customerUpdatedAt,
      customerUsage
    );
  } catch (e) {
    console.log(
      `[Rate Limiter] Call from ${customerNumber} is new to rate limiting table, allowing `
    );
    customerCallAllowed = true;
  }

  let systemCallAllowed = false;
  try {
    let systemUsage = systemResponse["Attributes"]!["usage"]!;
    let systemUpdatedAt = Number(systemResponse["Attributes"]!["updatedAt"]!);
    systemCallAllowed = await isCallAllowed(
      systemNumber,
      executionTime,
      systemRateLimit,
      systemUpdatedAt,
      systemUsage
    );
  } catch (e) {
    console.log(
      `[Rate Limiter] Call from ${systemNumber} is new to rate limiting table, allowing `
    );
    systemCallAllowed = true;
  }

  if (!customerCallAllowed) {
    await stopContact(initialContactId, instanceId);
    return {
      Result: "SUCCESS",
      CallAllowed: "false",
      Reason: "customer",
    };
  }

  if (!systemCallAllowed) {
    await stopContact(initialContactId, instanceId);
    return {
      Result: "SUCCESS",
      CallAllowed: "false",
      Reason: "system",
    };
  }

  return {
    Result: "SUCCESS",
    CallAllowed: "true",
  };
};

export const handler = async (event: ConnectContactFlowEvent, _: Context) => {
  validateEnvVariables();

  // Return error if event type is not ContactFlowEvent
  if (!event["Name"] || event["Name"] !== "ContactFlowEvent") {
    console.error("Invalid event format received, exiting function");
    return;
  }

  // Get instance ID from environment variables
  const instanceArnSplit = process.env["CONNECT_INSTANCE_ARN"]!.split("/");
  const instanceId = instanceArnSplit[instanceArnSplit.length - 1];

  // Return error if initial contact ID is not set
  let initialContactId;
  if (!event["Details"]["Parameters"]["InitialContactId"]) {
    console.error("Initial contact ID was not passed in the event, exiting");
    return;
  }
  initialContactId = event["Details"]["Parameters"]["InitialContactId"];

  // Return error if customer number is not set
  let customerNumber;
  if (!event["Details"]["ContactData"]["CustomerEndpoint"]!["Address"]) {
    console.error("Customer number was not passed in the event, exiting");
    return;
  }
  customerNumber =
    event["Details"]["ContactData"]["CustomerEndpoint"]!["Address"];

  // Return error if system number is not set
  let systemNumber;
  if (!event["Details"]["ContactData"]["SystemEndpoint"]!["Address"]) {
    console.error("System number was not passed in the event, exiting");
    return;
  }
  systemNumber = event["Details"]["ContactData"]["SystemEndpoint"]!["Address"];

  console.log(
    `[Rate Limiter] Logging outbound call for customer number ${customerNumber} and system number ${systemNumber}`
  );

  return logContact(initialContactId, instanceId, customerNumber, systemNumber);
};
