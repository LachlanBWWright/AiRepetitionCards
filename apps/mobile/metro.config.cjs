const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
config.maxWorkers = 2;
const inheritedResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    return { type: "sourceFile", filePath: require.resolve(moduleName, { paths: [__dirname] }) };
  }
  return inheritedResolve
    ? inheritedResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};
module.exports = withNativeWind(config, { input: "./global.css" });
