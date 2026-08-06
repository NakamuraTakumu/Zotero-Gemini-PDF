export const emptyNodeBuiltinsPlugin = {
  name: "empty-node-builtins",
  setup(build) {
    build.onResolve({ filter: /^node:(fs|path)$/ }, (args) => ({
      path: args.path,
      namespace: "empty-node-builtins",
    }));
    build.onLoad({ filter: /.*/, namespace: "empty-node-builtins" }, () => ({
      contents: "export default {};",
      loader: "js",
    }));
  },
};
