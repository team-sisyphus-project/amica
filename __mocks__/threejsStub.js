// Stub for three.js ESM sub-path imports (e.g. three/examples/jsm/loaders/GLTFLoader)
// These files use top-level ES module syntax that Jest cannot transform in CJS mode.
// All exported names are replaced with no-op constructors/functions so that
// modules which import them can be loaded in the test environment.

const handler = {
  construct: () => new Proxy({}, handler),
  get: (_, key) => {
    if (key === '__esModule') return true;
    return new Proxy(function () {}, handler);
  },
  apply: () => new Proxy({}, handler),
};

module.exports = new Proxy({}, handler);
