/**
 * Input validation utilities for AgentRegistry configuration fields.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const API_KEY_PREFIX = "api-ar-";
const API_KEY_LENGTH = 64;

/**
 * Validate API Key format: must start with "api-ar-" prefix and have total length of 64.
 */
export function validateApiKey(value: string): ValidationResult {
  if (!value.startsWith(API_KEY_PREFIX)) {
    return { valid: false, error: `API Key must start with "${API_KEY_PREFIX}" prefix` };
  }
  if (value.length !== API_KEY_LENGTH) {
    return { valid: false, error: `API Key must be exactly ${API_KEY_LENGTH} characters long` };
  }
  return { valid: true };
}

/**
 * Validate NATS URL format: must match nats://{host}:{port} where host is non-empty,
 * port is 1-65535, and total length does not exceed 256.
 */
export function validateNatsUrl(value: string): ValidationResult {
  if (value.length > 256) {
    return { valid: false, error: "NATS URL must not exceed 256 characters" };
  }

  const match = value.match(/^nats:\/\/(.+):(\d+)$/);
  if (!match) {
    return { valid: false, error: "NATS URL must match format nats://{host}:{port}" };
  }

  const host = match[1];
  const portStr = match[2];

  if (!host || host.length === 0) {
    return { valid: false, error: "NATS URL host must not be empty" };
  }

  const port = Number.parseInt(portStr, 10);
  if (port < 1 || port > 65535) {
    return { valid: false, error: "NATS URL port must be between 1 and 65535" };
  }

  return { valid: true };
}

/**
 * Validate Agent ID: only [a-zA-Z0-9_-] characters, length 1-64.
 */
export function validateAgentId(value: string): ValidationResult {
  if (value.length < 1 || value.length > 64) {
    return { valid: false, error: "Agent ID must be between 1 and 64 characters" };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return { valid: false, error: "Agent ID must only contain letters, digits, hyphens, and underscores" };
  }
  return { valid: true };
}

/**
 * Validate Agent Name: length 1-128.
 */
export function validateAgentName(value: string): ValidationResult {
  if (value.length < 1 || value.length > 128) {
    return { valid: false, error: "Agent Name must be between 1 and 128 characters" };
  }
  return { valid: true };
}

/**
 * Validate AgentRegistry Service Address URL: e.g., http://ip:port or https://domain
 */
export function validateRegistryUrl(value: string): ValidationResult {
  if (value.length > 256) {
    return { valid: false, error: "服务地址长度不能超过 256 个字符" };
  }
  if (!/^https?:\/\/.+/.test(value)) {
    return { valid: false, error: "服务地址格式必须为 http://ip:port 或 https://domain" };
  }
  return { valid: true };
}

