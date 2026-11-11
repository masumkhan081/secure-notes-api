import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const secret = Buffer.from(env.JWT_SECRET, "hex");
const issuer = "secure-notes-api";
const audience = "secure-notes-web";

export function createAccessToken(userId: string): string {
  return jwt.sign({}, secret, {
    algorithm: "HS256",
    subject: userId,
    issuer,
    audience,
    expiresIn: "15m",
  });
}

export function verifyAccessToken(token: string): string {
  const payload = jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer,
    audience,
    maxAge: "15m",
  });

  if (
    typeof payload === "string" ||
    typeof payload.sub !== "string" ||
    !/^[a-f0-9]{24}$/i.test(payload.sub) ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Invalid access token payload");
  }

  return payload.sub;
}