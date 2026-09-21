/**
 * Pi extension entry (package.json → pi.extensions).
 * Loaded by pi2dsh when this package is `dsh plugin add`-ed.
 * Registers ops_* and cr_* sibling domain tools.
 */

import { registerOpsTools } from './register.js';
import type { PiExtensionAPI } from './pi-abi.js';

export default function dshOpsAgentExtension(pi: PiExtensionAPI): void {
  registerOpsTools(pi, {
    // Env-based OpsConfig / CodeReviewConfig; DI available via programmatic registerOpsTools().
    enableCompactionGuard: true,
    enableCodeReview: true,
  });
}
