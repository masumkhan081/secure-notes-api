import { Algorithm, hash, verify } from "@node-rs/argon2";

export function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return verify(passwordHash, password);
}