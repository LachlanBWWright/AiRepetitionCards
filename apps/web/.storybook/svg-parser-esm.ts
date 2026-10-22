import type { Plugin } from "vite";

/** RN SVG ships generated PEG parsers as CommonJS inside its ESM distribution. */
export function svgParserEsm(): Plugin {
  return {
    name: "storybook-svg-parser-esm",
    enforce: "pre",
    transform(code, id) {
      const source = id.split("?", 1)[0] ?? id;
      if (
        !source.includes("/react-native-svg/") ||
        !/\/lib\/module\/lib\/extract\/transform(?:ToRn)?\.js$/.test(source)
      )
        return null;
      const start = code.lastIndexOf("module.exports = {");
      if (start < 0) return null;
      const startRules = source.endsWith("transformToRn.js")
        ? 'export const StartRules = ["start"];\n'
        : "";
      return {
        code: `${code.slice(0, start)}${startRules}export { peg$SyntaxError as SyntaxError, peg$parse as parse };`,
        map: null,
      };
    },
  };
}
