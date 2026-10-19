// CSS Modules: Bun's bundler turns `import styles from "./x.module.css"` into a map of
// local class names to generated ones.
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module "*.css";
