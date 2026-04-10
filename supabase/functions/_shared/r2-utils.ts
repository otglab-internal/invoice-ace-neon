/**
 * Cloudflare R2 utilities using S3-compatible REST API with AWS Signature V4.
 * No external SDK needed — pure fetch + Web Crypto.
 */

function getR2Config() {
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const endpoint = Deno.env.get("R2_ENDPOINT"); // e.g. https://<account>.r2.cloudflarestorage.com
  const bucket = Deno.env.get("R2_BUCKET_NAME");

  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    throw new Error("Missing R2 configuration (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME)");
  }

  return { accessKeyId, secretAccessKey, endpoint: endpoint.replace(/\/$/, ""), bucket };
}

// ── AWS Signature V4 helpers ──

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function sha256(data: Uint8Array | string): Promise<string> {
  const encoded = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", encoded));
}

async function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  let key: ArrayBuffer = await hmacSha256(new TextEncoder().encode("AWS4" + secretKey), dateStamp);
  key = await hmacSha256(key, region);
  key = await hmacSha256(key, service);
  key = await hmacSha256(key, "aws4_request");
  return key;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

async function signRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  payloadHash: string,
  config: ReturnType<typeof getR2Config>,
): Promise<SignedRequest> {
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = dateStamp + "T" + now.toISOString().slice(11, 19).replace(/:/g, "") + "Z";

  const url = `${config.endpoint}/${config.bucket}/${path}`;
  const parsedUrl = new URL(url);

  const allHeaders: Record<string, string> = {
    ...headers,
    host: parsedUrl.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };

  const signedHeaderKeys = Object.keys(allHeaders).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${allHeaders[k]}\n`).join("");

  const canonicalRequest = [
    method,
    parsedUrl.pathname,
    "", // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join("\n");

  const signingKey = await getSigningKey(config.secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  allHeaders["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url, headers: allHeaders };
}

// ── Public API ──

/**
 * Upload a file to R2 and return the object key.
 */
export async function uploadToR2(
  objectKey: string,
  body: Uint8Array | Blob,
  contentType = "application/pdf",
): Promise<string> {
  const config = getR2Config();
  const bytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body;
  const payloadHash = await sha256(bytes);

  const { url, headers } = await signRequest("PUT", objectKey, { "content-type": contentType }, payloadHash, config);

  const res = await fetch(url, { method: "PUT", headers, body: bytes });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 upload failed [${res.status}]: ${text}`);
  }
  return objectKey;
}

/**
 * Generate a presigned URL for reading an object from R2.
 * Uses query-string signing (no body needed).
 */
export async function getR2PresignedUrl(objectKey: string, expiresInSeconds = 300): Promise<string> {
  const config = getR2Config();
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = dateStamp + "T" + now.toISOString().slice(11, 19).replace(/:/g, "") + "Z";

  const url = `${config.endpoint}/${config.bucket}/${objectKey}`;
  const parsedUrl = new URL(url);

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${config.accessKeyId}/${credentialScope}`;

  // Build canonical query string
  const qp = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  });
  // URLSearchParams sorts may differ — we need alphabetical
  const sortedQs = [...qp.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

  const canonicalRequest = [
    "GET",
    parsedUrl.pathname,
    sortedQs,
    `host:${parsedUrl.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join("\n");

  const signingKey = await getSigningKey(config.secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  return `${url}?${sortedQs}&X-Amz-Signature=${signature}`;
}
