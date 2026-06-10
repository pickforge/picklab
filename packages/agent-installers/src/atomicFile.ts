import fs from "node:fs";
import path from "node:path";

let tmpCounter = 0;

export async function writeFileAtomic(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  tmpCounter += 1;
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${tmpCounter}`,
  );
  let mode: number | undefined;
  try {
    mode = (await fs.promises.stat(filePath)).mode & 0o777;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw error;
    }
  }
  try {
    await fs.promises.writeFile(tmp, content, { encoding: "utf8", mode });
    if (mode !== undefined) {
      await fs.promises.chmod(tmp, mode);
    }
    await fs.promises.rename(tmp, filePath);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true });
    throw error;
  }
}
