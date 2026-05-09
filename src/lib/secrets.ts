const SECRET_MIN_LENGTH = 32;
const SECRET_MAX_LENGTH = 128;
const PRINTABLE_ASCII_NO_SPACE = /^[!-~]+$/;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function isStrongSecret(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= SECRET_MIN_LENGTH
    && value.length <= SECRET_MAX_LENGTH
    && PRINTABLE_ASCII_NO_SPACE.test(value);
}

export function requiredSecret(name: string, value: unknown): string {
  if (!isStrongSecret(value)) {
    throw new ConfigError(`${name} must be ${SECRET_MIN_LENGTH}-${SECRET_MAX_LENGTH} printable ASCII characters without whitespace`);
  }
  return value;
}

export function secretPolicyMessage(label = "密钥"): string {
  return `${label}必须是 ${SECRET_MIN_LENGTH}-${SECRET_MAX_LENGTH} 个不含空格的可打印 ASCII 字符`;
}
