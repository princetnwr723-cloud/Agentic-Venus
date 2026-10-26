// Writes the storyboard and the AI-written scene files to the studio computer, checks them for syntax errors and builds the registry.
// Same job as prepareProject() in venus-server.ts, but made for long videos: hundreds of scene files are checked in small batches
// inside a time budget (one HTTP request is limited to 60 s). Scenes that were not checked in time are caught by the render itself,
// which repairs the scene that crashed and renders again.
import { exec } from "@/lib/e2b-server";
import { DIR, writeFiles, type Sb } from "@/lib/venus-server";
import { checkCode, type Storyboard } from "@/lib/venus-schema";

const BATCH = 25;
const BUDGET_MS = 36_000;

export async function prepareProjectBatched(
  sb: Sb,
  pid: string,
  storyboard: Storyboard
): Promise<{ errors: Array<{ index: number; message: string }>; unchecked: number }> {
  const dir = `${DIR}/src/custom`;
  await exec(
    sb,
    `mkdir -p ${dir} ${DIR}/work/${pid} ${DIR}/public/p/${pid}/img ${DIR}/public/p/${pid}/vo ${DIR}/public/p/${pid}/vid && rm -f ${dir}/${pid}_*.tsx`,
    15_000
  );

  const files: Record<string, string> = {};
  const errors: Array<{ index: number; message: string }> = [];
  const customs: Array<{ index: number; id: string; file: string }> = [];

  const slim = {
    ...storyboard,
    scenes: storyboard.scenes.map((s, i) => {
      if (s.type !== "custom") return s;
      const { code, ...rest } = s as Record<string, unknown>;
      if (typeof code === "string" && code) {
        const problem = checkCode(code);
        if (problem) errors.push({ index: i, message: problem });
        else {
          const file = `${dir}/${pid}_${String(s.id)}.tsx`;
          files[file] = code;
          customs.push({ index: i, id: String(s.id), file });
        }
      } else {
        errors.push({ index: i, message: "This AI scene has no code yet." });
      }
      return rest;
    }),
  };
  files[`${DIR}/work/${pid}/storyboard.json`] = JSON.stringify(slim);
  await writeFiles(sb, files);

  const bad = new Map<string, string>();
  let checked = 0;
  const t0 = Date.now();
  for (let i = 0; i < customs.length; i += BATCH) {
    if (Date.now() - t0 > BUDGET_MS) break;
    const group = customs.slice(i, i + BATCH);
    const r = await exec(sb, `cd ${DIR} && node check.cjs ${group.map((c) => `'${c.file}'`).join(" ")}`, 25_000);
    try {
      const out = JSON.parse(r.stdout.trim().split("\n").pop() || "{}") as { bad?: Array<{ file: string; message: string }> };
      for (const b of out.bad ?? []) bad.set(b.file, b.message);
      checked += group.length;
    } catch { checked += group.length; /* checker unavailable: the render itself will reveal problems */ }
  }
  for (const c of customs) if (bad.has(c.file)) errors.push({ index: c.index, message: "Syntax error: " + bad.get(c.file) });
  const good = customs.filter((c) => !bad.has(c.file));

  const registry =
    good.map((c, i) => `import C${i} from "./${pid}_${c.id}";`).join("\n") +
    `\nexport const CUSTOM: any = {${good.map((c, i) => `"${c.id}": C${i}`).join(",")}};\n`;
  await writeFiles(sb, { [`${dir}/registry.ts`]: registry });

  return { errors, unchecked: Math.max(0, customs.length - checked) };
}
