const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sourcePath = path.resolve(
  "lib/server/correction-engine.ts"
);

const source = fs.readFileSync(
  sourcePath,
  "utf8"
);

const compiled = ts.transpileModule(
  source,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }
);

const mod = new Module(
  sourcePath,
  module
);

mod.filename = sourcePath;
mod.paths = Module._nodeModulePaths(
  path.dirname(sourcePath)
);

mod._compile(
  compiled.outputText,
  sourcePath
);

const {
  verifyGridAgainstReference,
} = mod.exports;

const reference = {
  sourceType: "test",
  workUnits: 3,
  detectedColumns: 3,
  confidence: 1,
  records: [
    ["Name", "Age", "City"],
    ["Ramesh", "45", "Prayagraj"],
    ["Suresh", "52", "Lucknow"],
  ],
};

const grid = [
  ["Person", "Location"],
  ["Ramesh (45)", "Prayagraj"],
  ["Suresh (52)", "Lucknow"],
];

const report =
  verifyGridAgainstReference(
    reference,
    grid
  );

console.log(
  JSON.stringify(report, null, 2)
);
