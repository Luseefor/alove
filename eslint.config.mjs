import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/convex/_generated/**"] },
  tseslint.configs.recommended,
);
