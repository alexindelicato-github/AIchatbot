// ---------------------------------------------------------------------------
// Upload storage
//
// Stores uploaded files in an S3 bucket when S3_BUCKET is set (with AWS_REGION
// and credentials from the standard AWS provider chain), otherwise on local
// disk under uploads/. Downloads from S3 go through short-lived signed URLs,
// so the app never serves uploaded content from its own origin.
// ---------------------------------------------------------------------------

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const KEY_PREFIX = "uploads/";
const DEFAULT_URL_TTL_SECONDS = 300;

export function generateStoredName(originalName) {
  return `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${path.extname(originalName)}`;
}

export function createUploadStore({
  bucket = process.env.S3_BUCKET,
  region = process.env.AWS_REGION,
  urlTtlSeconds = Number(process.env.S3_SIGNED_URL_TTL) || DEFAULT_URL_TTL_SECONDS,
  uploadDir,
  client,
} = {}) {
  if (!bucket) {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const localPath = (name) => path.join(uploadDir, path.basename(name)); // basename blocks path traversal

    return {
      backend: "local",
      multerStorage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => cb(null, generateStoredName(file.originalname)),
      }),
      // multer's disk storage has already written the file
      async save(file) {
        return file.filename;
      },
      async read(name) {
        const fullPath = localPath(name);
        if (!fs.existsSync(fullPath)) return null;
        return { size: fs.statSync(fullPath).size, content: fs.readFileSync(fullPath, "utf8") };
      },
      async remove(name) {
        const fullPath = localPath(name);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      },
      async downloadUrl(name) {
        return `/uploads/${encodeURIComponent(path.basename(name))}`;
      },
    };
  }

  const s3 = client || new S3Client({ region });
  const keyFor = (name) => KEY_PREFIX + path.basename(name);

  return {
    backend: "s3",
    multerStorage: multer.memoryStorage(),
    async save(file) {
      const name = generateStoredName(file.originalname);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: keyFor(name),
        Body: file.buffer,
        ContentType: "text/plain; charset=utf-8",
        ServerSideEncryption: "AES256",
      }));
      file.filename = name;
      return name;
    },
    async read(name) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: keyFor(name) }));
        return { size: res.ContentLength, content: await res.Body.transformToString("utf8") };
      } catch (error) {
        if (error.name === "NoSuchKey") return null;
        throw error;
      }
    },
    async remove(name) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyFor(name) }));
    },
    // Force download as plain text so uploaded HTML can't render, even on the S3 origin
    async downloadUrl(name) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: keyFor(name),
        ResponseContentDisposition: `attachment; filename="${path.basename(name)}"`,
        ResponseContentType: "text/plain; charset=utf-8",
      });
      return getSignedUrl(s3, command, { expiresIn: urlTtlSeconds });
    },
  };
}
