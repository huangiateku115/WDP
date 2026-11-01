const {getDefaultConfig}=require('expo/metro-config');
const path=require('node:path');
const config=getDefaultConfig(__dirname);
// Preserve nested SDK dependency resolution; prioritize this app's modules.
config.resolver.nodeModulesPaths=[path.join(__dirname,'node_modules')];
module.exports=config;
