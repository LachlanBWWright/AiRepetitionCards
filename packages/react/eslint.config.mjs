import shared from "../eslint.config.mjs";
import reactHooks from "eslint-plugin-react-hooks";
export default [...shared, reactHooks.configs.flat.recommended];
