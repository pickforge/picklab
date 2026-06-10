import readline from "node:readline/promises";

export type ConfirmAnswer = "yes" | "no" | "non-interactive";

export interface ConfirmOptions {
  yes?: boolean;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

export async function confirm(
  question: string,
  opts: ConfirmOptions = {},
): Promise<ConfirmAnswer> {
  if (opts.yes === true) {
    return "yes";
  }
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stderr;
  if (input.isTTY !== true) {
    return "non-interactive";
  }
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim()) ? "yes" : "no";
  } finally {
    rl.close();
  }
}
