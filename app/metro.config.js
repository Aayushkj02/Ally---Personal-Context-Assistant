// OWNER: AAYUSH
//
// Keeps Metro out of the generated native projects.
//
// `expo prebuild` regenerates android/ from scratch — thousands of files appearing and
// disappearing under the project root. Metro's file crawler was choking on that and
// wedging: it kept listening on 8081 and answering /status, but every bundle request
// timed out. The symptom on device is a permanent white screen that looks like an app bug.
//
// android/ and ios/ hold no JS that Metro needs, so excluding them costs nothing.
// See docs/DEVICE_NOTES.md.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [/.*[\/]android[\/].*/, /.*[\/]ios[\/].*/];

module.exports = config;
