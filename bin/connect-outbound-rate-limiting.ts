#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ConnectOutboundRateLimitingStack } from '../lib/connect-outbound-rate-limiting-stack';

const app = new cdk.App();
new ConnectOutboundRateLimitingStack(app, 'ConnectOutboundRateLimitingStack');