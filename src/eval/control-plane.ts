/**
 * RSI 控制面守卫 — 自改航点的 diff 触及控制面即强制回滚。
 *
 * 控制面 = orchestrator（agent 自己的决策中枢）。self-improve 可以改任何
 * 能力文件（fitness/tools/verify/eval），但 orchestrator 的变更必须经人类
 * 审查——「递归自我改进但永不越神」的工程化：能力可近神，控制面必在人。
 *
 * dist 产物同样受控：dist/ 已入库，绕过 src 直改 dist 是同一条越权路径。
 */
const CONTROL_PLANE_PATHS: readonly string[] = [
  'src/cerebellum/orchestrator.ts',
  'dist/cerebellum/orchestrator.js',
];

export interface ControlPlaneVerdict {
  readonly blocked: boolean;
  readonly violations: readonly string[];
}

export function guardControlPlane(changedFiles: readonly string[]): ControlPlaneVerdict {
  const violations = changedFiles.filter((file) =>
    CONTROL_PLANE_PATHS.some(
      (guarded) => file === guarded || file.startsWith(`${guarded.replace(/\.tsx?$/, '.js')}.`)
    )
  );
  return { blocked: violations.length > 0, violations };
}
