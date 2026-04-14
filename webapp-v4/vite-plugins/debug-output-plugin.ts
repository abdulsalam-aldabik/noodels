import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Dev-only Vite plugin that:
 *
 * 1. Accepts POSTs to `/__debug-save/<filename>` and writes the request body
 *    to `<projectRoot>/debug-output/<filename>`.
 *
 * 2. Serves GET `/__test-images/` → JSON array of filenames found in
 *    `<projectRoot>/test-images/`.
 *    Serves GET `/__test-images/<filename>` → binary image file from that dir.
 *
 * Only runs in `vite dev`.
 */

const DEBUG_PREFIX = "/__debug-save/";
const TEST_IMG_PREFIX = "/__test-images";

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

function sanitizeFilename(raw: string): string | null {
  const noQuery = raw.split("?")[0];
  let name: string;
  try {
    name = decodeURIComponent(noQuery);
  } catch {
    return null;
  }
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return null;
  if (name.length === 0 || name.length > 200) return null;
  return name;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

interface Logger { info(msg: string): void; error(msg: string): void; }

async function handleDebugSave(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  outDir: string,
  logger: Logger,
): Promise<void> {
  if (req.method !== "POST") { res.statusCode = 405; res.end("Method Not Allowed"); return; }
  const filename = sanitizeFilename(url.slice(DEBUG_PREFIX.length));
  if (!filename) { res.statusCode = 400; res.end("Bad filename"); return; }
  try {
    const body = await readBody(req);
    writeFileSync(join(outDir, filename), body);
    logger.info(`[debug-output] wrote debug-output/${filename} (${body.length} bytes)`);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, path: `debug-output/${filename}` }));
  } catch (err) {
    logger.error(`[debug-output] failed to write ${filename}: ${String(err)}`);
    res.statusCode = 500;
    res.end(`Write failed: ${String(err)}`);
  }
}

function handleTestImagesList(res: ServerResponse, testImagesDir: string): void {
  if (!existsSync(testImagesDir)) { res.statusCode = 200; res.setHeader("Content-Type", "application/json"); res.end("[]"); return; }
  try {
    const files = readdirSync(testImagesDir).filter((f) => extname(f).toLowerCase() in IMAGE_MIME);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(files));
  } catch (err) {
    res.statusCode = 500;
    res.end(`List failed: ${String(err)}`);
  }
}

function handleTestImageServe(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  testImagesDir: string,
): void {
  if (req.method !== "GET") { res.statusCode = 405; res.end("Method Not Allowed"); return; }
  const filename = sanitizeFilename(url.slice(TEST_IMG_PREFIX.length + 1));
  if (!filename) { res.statusCode = 400; res.end("Bad filename"); return; }
  const mime = IMAGE_MIME[extname(filename).toLowerCase()];
  if (!mime) { res.statusCode = 415; res.end("Not an image"); return; }
  try {
    const data = readFileSync(join(testImagesDir, filename));
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-cache");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}

export function debugOutputPlugin(): Plugin {
  let outDir = "";
  let testImagesDir = "";

  return {
    name: "iq-noodles-debug-output",
    apply: "serve",
    configResolved(config) {
      outDir = resolve(config.root, "debug-output");
      testImagesDir = resolve(config.root, "test-images");
    },
    configureServer(server: ViteDevServer) {
      mkdirSync(outDir, { recursive: true });
      mkdirSync(testImagesDir, { recursive: true });
      server.config.logger.info(
        `[debug-output] writing scan artifacts to ${outDir}`,
      );
      server.config.logger.info(
        `[test-images] serving test images from ${testImagesDir}`,
      );

      server.middlewares.use(async (req, res: ServerResponse, next) => {
        const url = req.url ?? "";
        if (url.startsWith(DEBUG_PREFIX)) {
          await handleDebugSave(req, res, url, outDir, server.config.logger);
        } else if (url === TEST_IMG_PREFIX || url === TEST_IMG_PREFIX + "/") {
          handleTestImagesList(res, testImagesDir);
        } else if (url.startsWith(TEST_IMG_PREFIX + "/")) {
          handleTestImageServe(req, res, url, testImagesDir);
        } else {
          next();
        }
      });
    },
  };
}
