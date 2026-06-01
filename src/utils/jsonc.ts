/** Strips line and block comments from JSONC so it can be parsed as JSON. */
export function stripJsonComments(raw: string): string {
  let output = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  output = output.replace(/^\s*\/\/.*$/gm, '');
  return output;
}
