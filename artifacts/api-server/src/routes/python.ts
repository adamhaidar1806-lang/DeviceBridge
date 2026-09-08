import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Router, type IRouter } from "express";

const execFileAsync = promisify(execFile);
const router: IRouter = Router();
const pythonScript = path.resolve(process.cwd(), "python/devicebridge_service.py");

async function runPython(argument: string): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync("python3", [pythonScript, argument], {
    maxBuffer: 32 * 1024,
  });
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}

router.get("/python/health", async (_req, res): Promise<void> => {
  try {
    res.json(await runPython("--health"));
  } catch {
    res.status(503).json({ status: "offline", engine: "python-device-fit-v1" });
  }
});

router.post("/python/device-fit", async (req, res): Promise<void> => {
  try {
    const payload = {
      purpose: typeof req.body?.purpose === "string" ? req.body.purpose : "",
      category: typeof req.body?.category === "string" ? req.body.category : "",
      offer: typeof req.body?.offer === "string" ? req.body.offer : "",
      locationMatch: req.body?.locationMatch === true,
    };
    res.json(await runPython(JSON.stringify(payload)));
  } catch {
    res.status(500).json({ error: "Python fit analyzer is unavailable." });
  }
});

export default router;